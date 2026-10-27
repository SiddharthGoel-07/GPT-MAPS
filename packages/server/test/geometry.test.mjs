// Unit tests for the pure geometry helpers (uses built output: run after building shared + server).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScene } from "@map-renderer/shared";
import { countPoints, parseGeoJsonPolygons, simplifyPolygons } from "../dist/geometry.js";

const square = (x, y, d) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]];
const closed = (r) => r.length >= 4 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1];
const wiggly = (n, cx, cy, r, amp = 0.3, waves = 40) => {
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const ring = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, rr = r + amp * Math.sin(a * waves) + (rnd() - 0.5) * 0.02; ring.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
  ring.push(ring[0]); return ring;
};
const asScene = (polygons) => parseScene({ version: 1, objects: [{ type: "polygon", id: "p", name: "p", polygons, fillColor: "red", fillOpacity: 0.4, borderWidth: 0, borderDash: false }] });

test("Polygon: outer ring + holes kept; open ring is closed; duplicate points removed", () => {
  const open = [[0, 0], [0, 0], [4, 0], [4, 4], [0, 4]];
  const out = parseGeoJsonPolygons({ type: "Polygon", coordinates: [open, square(1, 1, 1)] });
  assert.equal(out.length, 1);
  assert.equal(out[0].length, 2);
  assert.ok(out[0].every(closed));
  assert.equal(out[0][0].length, 5);
});

test("MultiPolygon: every polygon is kept, in order", () => {
  const out = parseGeoJsonPolygons({ type: "MultiPolygon", coordinates: [[square(0, 0, 3)], [square(10, 10, 1)], [square(20, 20, 1), square(20.2, 20.2, 0.3)]] });
  assert.deepEqual(out.map((p) => p.length), [1, 1, 2]);
});

test("unusable rings: bad hole removed, bad outer drops the polygon (its holes are NOT promoted)", () => {
  const out = parseGeoJsonPolygons({ type: "MultiPolygon", coordinates: [
    [square(0, 0, 3), [[1, 1], [2, 2]]],
    [[[5, 5], [6, 6]], square(5.2, 5.2, 0.5)],
    [square(9, 9, 1)],
  ] });
  assert.deepEqual(out.map((p) => p.length), [1, 1]);
  assert.equal(out[1][0][0][0], 9);
});

test("out-of-range and non-numeric points are skipped", () => {
  const ring = [[0, 0], [4, 0], [999, 0], [4, 4], ["x", 1], [null, 2], [0, 4], [0, 0]];
  const out = parseGeoJsonPolygons({ type: "Polygon", coordinates: [ring] });
  assert.equal(out[0][0].length, 5);
});

test("non-polygon geometries are rejected with a clear message", () => {
  for (const type of ["Point", "LineString", "GeometryCollection"]) {
    assert.throws(() => parseGeoJsonPolygons({ type, coordinates: [] }), /Unsupported geometry type: .*Expected Polygon or MultiPolygon/);
  }
  assert.throws(() => parseGeoJsonPolygons({ type: "MultiPolygon", coordinates: "oops" }));
});

test("garbage input yields no polygons rather than throwing", () => {
  assert.deepEqual(parseGeoJsonPolygons({ type: "Polygon", coordinates: [] }), []);
  assert.deepEqual(parseGeoJsonPolygons({ type: "MultiPolygon", coordinates: [null, 5, [[]]] }), []);
});

test("simplify: input under the cap is returned untouched (same object)", () => {
  const polys = [[square(0, 0, 1)]];
  assert.equal(simplifyPolygons(polys, 100), polys);
});

test("simplify: over the cap -> within cap, rings closed, holes and big islands survive, valid scene", () => {
  const polys = [
    [wiggly(60_000, 0, 0, 5), square(-0.5, -0.5, 1)],     // mainland with hole
    [wiggly(30_000, 20, 0, 2)],                            // big island
    [square(40, 40, 0.0001)],                              // tiny islet
  ];
  const before = countPoints(polys);
  const out = simplifyPolygons(polys, 5000);
  assert.ok(countPoints(out) <= 5000 && countPoints(out) > 200, `points ${before} -> ${countPoints(out)}`);
  assert.ok(out.every((p) => p.every(closed)));
  assert.equal(out[0].length, 2, "hole survives");
  assert.ok(out.length >= 2 && out.length <= 3, "big island survives");
  assert.ok(out.some((p) => p[0].some((pt) => pt[0] > 21)), "second landmass is still where it was");
  asScene(out); // passes the shared schema
});

test("simplify: tiny islands are dropped only when the cap forces it", () => {
  const polys = [[wiggly(20_000, 0, 0, 5)], [square(40, 40, 0.0001)]];
  assert.equal(simplifyPolygons(polys, 25_000).length, 2, "fits: nothing dropped");
  assert.equal(simplifyPolygons(polys, 3000).length, 1, "cap forces the islet away");
});

test("simplify: absurdly small cap still returns one valid ring", () => {
  const polys = [[wiggly(10_000, 0, 0, 5)], [wiggly(500, 20, 0, 1)]];
  const out = simplifyPolygons(polys, 10);
  assert.equal(out.length >= 1, true);
  assert.ok(countPoints(out) <= 10 + 5, `points ${countPoints(out)}`);
  assert.ok(out.every((p) => p.every(closed)));
  asScene(out);
});

test("simplify: 300k points is fast enough (< 3 s) and does not blow the stack", () => {
  const t0 = Date.now();
  const out = simplifyPolygons([[wiggly(300_000, 0, 0, 5)]], 20_000);
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0}ms`);
  assert.ok(countPoints(out) <= 20_000);
});
