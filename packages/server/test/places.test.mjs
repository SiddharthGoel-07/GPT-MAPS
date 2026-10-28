// Unit tests for B2 (picking the right geocoding / boundary candidate) and the HTTP guard (D1).
// Uses built output: run after building shared + server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { pickPlace, describePlace } from "../dist/services/GeocodingService.js";
import { pickBoundary } from "../dist/services/BoundaryService.js";
import {
  BodyTooLargeError, checkRequest, parseList, readBodyLimited, readGuardConfig, tokenMatches,
} from "../dist/httpGuard.js";

const place = (lat, lon, name, importance) => ({ lat: String(lat), lon: String(lon), display_name: name, importance });
const square = (x, y, d) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]];
const area = (name, importance, ring = square(0, 0, 1)) => ({
  properties: { display_name: name, importance }, geometry: { type: "Polygon", coordinates: [ring] },
});

/* ------------------------------- pickPlace ------------------------------- */

test("pickPlace: the most important candidate wins, not the first", () => {
  const r = pickPlace([place(1, 2, "Minor", 0.2), place(3, 4, "Major", 0.9)], "x");
  assert.equal(r.name, "Major");
  assert.deepEqual(r.point, [4, 3]); // [lng, lat]
});

test("pickPlace: equal importance keeps Nominatim's order", () => {
  const r = pickPlace([place(1, 2, "First", 0.5), place(3, 4, "Second", 0.5)], "x");
  assert.equal(r.name, "First");
});

test("pickPlace: lists similarly important, differently named runners-up (max 2)", () => {
  const r = pickPlace([
    place(1, 1, "A", 0.8), place(2, 2, "B", 0.7), place(3, 3, "C", 0.6), place(4, 4, "D", 0.59),
  ], "x");
  assert.deepEqual(r.alternatives, ["B", "C"]);
});

test("pickPlace: unimportant runners-up and same-name duplicates are not alternatives", () => {
  const r = pickPlace([place(1, 1, "A", 0.8), place(2, 2, "Z", 0.1), place(3, 3, "A", 0.79)], "x");
  assert.deepEqual(r.alternatives, []);
});

test("pickPlace: invalid / out-of-range / non-object candidates are skipped", () => {
  const r = pickPlace([null, "x", { lat: "abc", lon: "1" }, place(95, 10, "BadLat", 0.99), place(10, 200, "BadLon", 0.99), place(5, 6, "Good", 0.1)], "q");
  assert.equal(r.name, "Good");
});

test("pickPlace: nothing usable -> null; non-array -> null", () => {
  assert.equal(pickPlace([{ lat: "x", lon: "y" }], "q"), null);
  assert.equal(pickPlace({}, "q"), null);
  assert.equal(pickPlace([], "q"), null);
});

test("pickPlace: results without display_name/importance (old shape) still work, name falls back to the query", () => {
  const r = pickPlace([{ lat: "8", lon: "70" }], "Delhi");
  assert.equal(r.name, "Delhi");
  assert.deepEqual(r.point, [70, 8]);
});

test("pickPlace: very long names are shortened", () => {
  const r = pickPlace([place(1, 1, "N".repeat(500), 0.5)], "q");
  assert.ok(r.name.length <= 120);
});

test("describePlace: says what was matched; mentions alternatives only when there are some", () => {
  const plain = describePlace("Paris", { point: [0, 0], name: "Paris, France", alternatives: [] });
  assert.match(plain, /Matched "Paris" to "Paris, France"\./);
  assert.doesNotMatch(plain, /Other possible/);
  const amb = describePlace("Paris", { point: [0, 0], name: "Paris, France", alternatives: ["Paris, Texas, USA"] });
  assert.match(amb, /Other possible matches: "Paris, Texas, USA"/);
  assert.match(amb, /more specific name/);
});

/* ------------------------------ pickBoundary ----------------------------- */

test("pickBoundary: a Point is skipped even when it ranks first", () => {
  const r = pickBoundary([{ properties: { importance: 0.99 }, geometry: { type: "Point", coordinates: [1, 1] } }, area("The Area", 0.1)], "q");
  assert.equal(r.name, "The Area");
  assert.equal(r.polygons.length, 1);
});

test("pickBoundary: the more important area wins", () => {
  const r = pickBoundary([area("Small", 0.3), area("Large", 0.8)], "q");
  assert.equal(r.name, "Large");
});

test("pickBoundary: an area with only unusable rings is skipped for the next one", () => {
  const junk = { properties: { display_name: "Junk", importance: 0.9 }, geometry: { type: "Polygon", coordinates: [[[1, 1], [2, 2]]] } };
  const r = pickBoundary([junk, area("Fine", 0.2)], "q");
  assert.equal(r.name, "Fine");
});

test("pickBoundary: only points/lines, empty, or garbage -> null", () => {
  assert.equal(pickBoundary([{ geometry: { type: "LineString", coordinates: [] } }], "q"), null);
  assert.equal(pickBoundary([], "q"), null);
  assert.equal(pickBoundary("nope", "q"), null);
  assert.equal(pickBoundary([null, 5, { geometry: null }], "q"), null);
});

test("pickBoundary: name falls back to the query when display_name is missing", () => {
  const r = pickBoundary([{ geometry: { type: "Polygon", coordinates: [square(0, 0, 1)] } }], "Rajasthan");
  assert.equal(r.name, "Rajasthan");
});

/* ------------------------------- http guard ------------------------------ */

test("readGuardConfig: safe defaults", () => {
  const c = readGuardConfig({});
  assert.equal(c.host, "127.0.0.1");
  assert.deepEqual(c.allowedOrigins, []);
  assert.equal(c.authToken, undefined);
  assert.equal(c.maxBodyBytes, 1024 * 1024);
});

test("readGuardConfig: env overrides; junk numbers fall back", () => {
  const c = readGuardConfig({ HOST: "0.0.0.0", ALLOWED_ORIGINS: " http://a.test , http://b.test ,", MCP_AUTH_TOKEN: " tok ", MAX_BODY_BYTES: "5000" });
  assert.equal(c.host, "0.0.0.0");
  assert.deepEqual(c.allowedOrigins, ["http://a.test", "http://b.test"]);
  assert.equal(c.authToken, "tok");
  assert.equal(c.maxBodyBytes, 5000);
  assert.equal(readGuardConfig({ MAX_BODY_BYTES: "-3" }).maxBodyBytes, 1024 * 1024);
  assert.equal(readGuardConfig({ MAX_BODY_BYTES: "abc" }).maxBodyBytes, 1024 * 1024);
  assert.equal(readGuardConfig({ MCP_AUTH_TOKEN: "   " }).authToken, undefined);
  assert.deepEqual(parseList(undefined), []);
});

test("tokenMatches: only the exact bearer token", () => {
  assert.equal(tokenMatches("Bearer secret", "secret"), true);
  assert.equal(tokenMatches("bearer secret", "secret"), true);
  assert.equal(tokenMatches("Bearer wrong", "secret"), false);
  assert.equal(tokenMatches("secret", "secret"), false);
  assert.equal(tokenMatches(undefined, "secret"), false);
  assert.equal(tokenMatches("Bearer ", "secret"), false);
  assert.equal(tokenMatches("Bearer secret2", "secret"), false);
});

const fakeReq = (headers = {}) => ({ headers });

test("checkRequest: no Origin header (normal MCP clients) is fine by default", () => {
  assert.equal(checkRequest(fakeReq(), readGuardConfig({})), null);
});

test("checkRequest: a browser Origin is refused unless listed (DNS-rebinding / cross-site protection)", () => {
  const cfg = readGuardConfig({ ALLOWED_ORIGINS: "http://ok.test" });
  assert.equal(checkRequest(fakeReq({ origin: "http://evil.test" }), cfg).status, 403);
  assert.equal(checkRequest(fakeReq({ origin: "http://ok.test" }), cfg), null);
  assert.equal(checkRequest(fakeReq({ origin: "http://evil.test" }), readGuardConfig({})).status, 403);
  assert.equal(checkRequest(fakeReq({ origin: "http://anything.test" }), readGuardConfig({ ALLOWED_ORIGINS: "*" })), null);
});

test("checkRequest: with a token configured, missing/wrong -> 401, right -> ok", () => {
  const cfg = readGuardConfig({ MCP_AUTH_TOKEN: "s3cret" });
  assert.equal(checkRequest(fakeReq(), cfg).status, 401);
  assert.equal(checkRequest(fakeReq({ authorization: "Bearer nope" }), cfg).status, 401);
  assert.equal(checkRequest(fakeReq({ authorization: "Bearer s3cret" }), cfg), null);
});

function bodyStream(headers = {}) {
  const s = new PassThrough();
  s.headers = headers;
  return s;
}

test("readBodyLimited: reads a body under the limit", async () => {
  const s = bodyStream();
  const p = readBodyLimited(s, 100);
  s.write("hello "); s.end("world");
  assert.equal((await p).toString(), "hello world");
});

test("readBodyLimited: rejects as soon as the declared Content-Length is too big", async () => {
  const s = bodyStream({ "content-length": "5000" });
  await assert.rejects(readBodyLimited(s, 100), BodyTooLargeError);
});

test("readBodyLimited: rejects a body that grows past the limit without a Content-Length", async () => {
  const s = bodyStream();
  const p = readBodyLimited(s, 10);
  s.write("12345"); s.write("67890"); s.write("X");
  await assert.rejects(p, BodyTooLargeError);
});

test("readBodyLimited: exactly the limit is accepted", async () => {
  const s = bodyStream();
  const p = readBodyLimited(s, 5);
  s.end("12345");
  assert.equal((await p).length, 5);
});
