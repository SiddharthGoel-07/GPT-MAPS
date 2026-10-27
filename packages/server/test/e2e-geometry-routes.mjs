/* eslint-disable */
// B1 (all polygons + holes, size cap) and B3 (straight-line fallback when no road route exists),
// through the real MCP server with Nominatim/OSRM stubbed.
// Runs the REAL built server as a child process; talks to it with the real MCP SDK client.
// Usage (repo root, after building shared + server):  node packages/server/test/e2e-geometry-routes.mjs
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { parseScene } from "@map-renderer/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = path.resolve(here, "../dist/index.js");
const STUB = path.resolve(here, "stub-network.mjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, note = "") => {
  results.push({ name, ok, note });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? "  -- " + note : ""}`);
};
async function guard(name, fn) {
  try { await fn(); } catch (e) { record(`${name} (EXCEPTION)`, false, String(e.message ?? e).slice(0, 200)); }
}

async function startServer(port, env = {}) {
  const child = spawn(process.execPath, ["--import", pathToFileURL(STUB).href, SERVER_JS], {
    env: { ...process.env, PORT: String(port), NOMINATIM_MIN_INTERVAL_MS: "0", ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let log = "";
  child.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return { child, getLog: () => log, port }; } catch {}
    await sleep(100);
  }
  child.kill();
  throw new Error("server did not start: " + log);
}
const stop = (s) => new Promise((r) => { s.child.once("exit", r); s.child.kill(); });

async function connect(port) {
  const client = new Client({ name: "rules", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  return client;
}
const text = (r) => r.content.map((c) => c.text ?? "").join("");
const call = (c, name, args = {}) => c.callTool({ name, arguments: args }, undefined, { timeout: 10000 });
const scene = async (c) => JSON.parse(text(await call(c, "renderScene"))).objects;
const ofType = (objs, t) => objs.filter((o) => o.type === t);
const countLog = (S, needle) => S.getLog().split("\n").filter((l) => l.includes(needle)).length;

const totalPoints = (polygons) => polygons.reduce((n, poly) => n + poly.reduce((m, r) => m + r.length, 0), 0);
const closed = (r) => r.length >= 4 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1];

async function main() {
  const S = await startServer(3961);
  const S2 = await startServer(3962, { POLYGON_MAX_POINTS: "500" });
  try {
    await guard("G", async () => {
      const cl = await connect(S.port);

      await call(cl, "createPolygon", { location: "Archipelago A" });
      let pg = (await scene(cl)).find((o) => o.type === "polygon");
      record("G1 every polygon of a MultiPolygon is kept (island not lost)", pg && pg.polygons.length === 2, `polygons=${pg?.polygons.length}`);
      record("G1b holes are kept (mainland has outer ring + 1 hole)", pg && pg.polygons[0].length === 2 && pg.polygons[1].length === 1, JSON.stringify(pg?.polygons.map((p) => p.length)));
      record("G1c output is still valid for the shared schema", await (async () => { try { parseScene(JSON.parse(text(await call(cl, "renderScene")))); return true; } catch (e) { return false; } })());

      const again = await call(cl, "createPolygon", { location: "archipelago a" });
      record("G1d duplicate multipolygon is still de-duplicated", (await scene(cl)).filter((o) => o.type === "polygon").length === 1, text(again).slice(0, 80));

      const cl2 = await connect(S.port);
      await call(cl2, "createPolygon", { location: "Badrings" });
      pg = (await scene(cl2)).find((o) => o.type === "polygon");
      record("G2 degenerate rings dropped, good ones kept (1 polygon, no 2-point hole, non-finite point removed)",
        pg && pg.polygons.length === 2 && pg.polygons[0].length === 1 && pg.polygons.every((p) => p.every((r) => r.length >= 4 && closed(r))),
        JSON.stringify(pg?.polygons.map((p) => p.map((r) => r.length))));
    });

    await guard("G3", async () => {
      const cl = await connect(S.port);
      const t0 = Date.now();
      const r = await call(cl, "createPolygon", { location: "Bigland" });
      const ms = Date.now() - t0;
      const raw = JSON.parse(text(await call(cl, "renderScene")));
      let ok = true, err = ""; try { parseScene(raw); } catch (e) { ok = false; err = e.message; }
      const pg = raw.objects.find((o) => o.type === "polygon");
      const n = pg ? totalPoints(pg.polygons) : -1;
      record("G3 200k-point boundary is simplified under the default cap (20000), still valid", !r.isError && ok && n > 100 && n <= 20000, `points=${n} ms=${ms} ${err}`);
      record("G3b the hole survives simplification and the shape keeps its size", pg && pg.polygons[0].length === 2 && (() => { const xs = pg.polygons[0][0].map((p) => p[0]); return Math.min(...xs) < 75.5 && Math.max(...xs) > 84.5; })());

      const c2 = await connect(S2.port);
      await call(c2, "createPolygon", { location: "Bigland" });
      const pg2 = (await scene(c2)).find((o) => o.type === "polygon");
      const n2 = pg2 ? totalPoints(pg2.polygons) : -1;
      record("G3c POLYGON_MAX_POINTS env is honoured (500)", n2 > 10 && n2 <= 500, `points=${n2}`);
    });

    await guard("G4", async () => {
      const cl = await connect(S.port);
      const r = await call(cl, "createPolygon", { location: "Pointplace" });
      record("G4 a Point result still fails clearly (B2 will improve this; passes on old code too)", r.isError === true && /Unsupported geometry/.test(text(r)), text(r).slice(0, 100));
      record("G5 simplified geometry requested from Nominatim (polygon_threshold)", /kind=boundary q=Archipelago A thr=0\.\d+/.test(S.getLog()), "");
    });

    await guard("R", async () => {
      const cl = await connect(S.port);
      const r = await call(cl, "createPath", { start: "Island One", end: "Delhi" });
      const p = (await scene(cl)).find((o) => o.type === "path");
      record("R1 NoRoute (HTTP 200) -> straight 2-point line, dashed by default, no error", !r.isError && p && p.coordinates.length === 2 && p.dash === true, `isError=${r.isError} coords=${p?.coordinates.length} dash=${p?.dash}`);
      record("R1b the model is told it is a straight line", /straight line/i.test(text(r)), text(r).slice(0, 200));
      record("R1c line runs from start to end", p && Math.abs(p.coordinates[0][0] - 120) < 2 && Math.abs(p.coordinates[1][0] - 120) > 5);

      const cl2 = await connect(S.port);
      const r2 = await call(cl2, "createPath", { start: "Reef Two", end: "Delhi" });
      const p2 = (await scene(cl2)).find((o) => o.type === "path");
      record("R2 NoSegment (HTTP 400) -> straight line too", !r2.isError && p2 && p2.coordinates.length === 2, `isError=${r2.isError} ${text(r2).slice(0, 80)}`);

      const cl3 = await connect(S.port);
      const r3 = await call(cl3, "createPath", { start: "Outage Three", end: "Delhi" });
      record("R3 routing service failure (HTTP 500) is still an error, NOT a fake straight line", r3.isError === true && (await scene(cl3)).length === 0, text(r3).slice(0, 100));

      const cl4 = await connect(S.port);
      await call(cl4, "createPath", { start: "Island Four", end: "Delhi", style: { dash: false } });
      const p4 = (await scene(cl4)).find((o) => o.type === "path");
      record("R4 an explicit dash:false is respected on a straight line", p4 && p4.dash === false);

      const cl5 = await connect(S.port);
      await call(cl5, "createPath", { start: "Delhi", end: "Mumbai" });
      const p5 = (await scene(cl5)).find((o) => o.type === "path");
      record("R5 normal road route unchanged (3 points, solid)", p5 && p5.coordinates.length === 3 && p5.dash === false);

      const cl6 = await connect(S.port);
      const before = countLog(S, "[stub] osrm");
      await call(cl6, "createPath", { start: "Island Six", end: "Delhi" });
      const mid = countLog(S, "[stub] osrm");
      const dup = await call(cl6, "createPath", { start: "island six", end: "delhi" });
      record("R6 repeating a straight-line path is ignored and does not call OSRM again", (await scene(cl6)).filter((o) => o.type === "path").length === 1 && countLog(S, "[stub] osrm") === mid && mid - before === 1, text(dup).slice(0, 80));
    });
  } finally { await stop(S); await stop(S2); }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });
