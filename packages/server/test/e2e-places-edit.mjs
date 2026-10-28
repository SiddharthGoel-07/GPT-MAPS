/* eslint-disable */
// B2 (right place / right area is chosen and shown to the model) and the editing tools
// removeObject / clearScene (needed by B5, where a map lives across prompts).
// Runs the REAL built server as a child process with Nominatim/OSRM stubbed; talks to it with the real MCP SDK client.
// Usage (repo root, after building shared + server):  node packages/server/test/e2e-places-edit.mjs
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
  try { await fn(); } catch (e) { record(`${name} (EXCEPTION)`, false, String(e.stack ?? e).slice(0, 300)); }
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
  const client = new Client({ name: "places-edit", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  return client;
}
const text = (r) => r.content.map((c) => c.text ?? "").join("");
const call = (c, name, args = {}) => c.callTool({ name, arguments: args }, undefined, { timeout: 10000 });
const scene = async (c) => JSON.parse(text(await call(c, "renderScene"))).objects;
const ofType = (objs, t) => objs.filter((o) => o.type === t);
const countLog = (S, needle) => S.getLog().split("\n").filter((l) => l.includes(needle)).length;

async function main() {
  const S = await startServer(3971);
  try {
    /* ------------------------------ B2: geocoding ------------------------------ */
    await guard("P", async () => {
      const c = await connect(S.port);
      let r = await call(c, "createMarker", { location: "pickme" });
      let objs = await scene(c);
      const m = ofType(objs, "marker")[0];
      record("P1 the most important candidate is used, not the first", !r.isError && m && m.position[0] === 81 && m.position[1] === 21, `pos=${JSON.stringify(m?.position)}`);
      record("P2 the model is told which place was matched", /Matched "pickme" to "Pickme Major, Bigland"/.test(text(r)), text(r).slice(-120));
      record("P3 an unambiguous result lists no alternatives (single clear match)", !/Other possible/.test(text(r)));

      r = await call(c, "createMarker", { location: "springfield" });
      record("P4 an ambiguous name lists real alternatives and asks for a more specific name",
        /Matched "springfield" to "Springfield, Illinois, USA"/.test(text(r)) && /Other possible matches: "Springfield, Missouri, USA"/.test(text(r)) && /more specific/.test(text(r)), text(r).slice(-200));
      record("P5 unimportant and invalid candidates are not listed", !/Tiny Hamlet/.test(text(r)) && !/Broken Coordinates/.test(text(r)));

      r = await call(c, "createPath", { start: "pickme", end: "Delhi" });
      record("P6 a path reports the match of BOTH ends", !r.isError && /Matched "pickme"/.test(text(r)) && /Matched "Delhi"/.test(text(r)), text(r).slice(-160));

      r = await call(c, "createLabel", { location: "pickme", text: "Hello" });
      record("P7 a label reports the matched place too", !r.isError && /Matched "pickme"/.test(text(r)));

      record("P8 geocoding asks Nominatim for several candidates (limit=5)", /kind=geocode q=pickme thr= limit=5/.test(S.getLog()), "");
      await c.close();
    });

    /* ------------------------------ B2: boundaries ----------------------------- */
    await guard("B", async () => {
      const c = await connect(S.port);
      await call(c, "clearScene");
      let r = await call(c, "createPolygon", { location: "mixedfeatures" });
      let objs = await scene(c);
      let poly = ofType(objs, "polygon")[0];
      record("B1 a Point that ranks first is skipped; the area is highlighted", !r.isError && poly && poly.polygons[0][0][0][0] === 50, `isError=${r.isError} ${text(r).slice(0, 100)}`);
      record("B2 the model is told which area was matched", /Matched "mixedfeatures" to the area "Mixed Area, Somewhere"/.test(text(r)), text(r).slice(-120));

      await call(c, "clearScene");
      r = await call(c, "createPolygon", { location: "twoareas" });
      poly = ofType(await scene(c), "polygon")[0];
      record("B3 the more important of two areas wins", !r.isError && poly?.polygons[0][0][0][0] === 70 && /Large Area, Region/.test(text(r)), `x=${poly?.polygons[0][0][0][0]}`);

      r = await call(c, "createPolygon", { location: "onlylines" });
      record("B4 only lines/points -> clear error telling what to do", r.isError === true && /only a point or line, not an area/.test(text(r)) && /createMarker/.test(text(r)), text(r).slice(0, 120));

      record("B5 boundary lookup asks for a few candidates (limit=3)", /kind=boundary q=twoareas thr=0\.001 limit=3/.test(S.getLog()), "");
      try { parseScene({ version: 1, objects: await scene(c) }); record("B6 resulting scene still passes the shared schema", true); }
      catch (e) { record("B6 resulting scene still passes the shared schema", false, String(e.message).slice(0, 120)); }
      await c.close();
    });

    /* --------------------------- removeObject / clearScene ---------------------- */
    await guard("E", async () => {
      const c = await connect(S.port);
      const tools = (await c.listTools()).tools.map((t) => t.name);
      record("E0 new tools are listed next to the old ones", ["removeObject", "clearScene", "renderScene", "createMarker"].every((n) => tools.includes(n)), tools.join(","));

      await call(c, "createMarker", { location: "Delhi" });
      await call(c, "createMarker", { location: "Jaipur" });
      await call(c, "createPath", { start: "Delhi", end: "Jaipur" });
      let objs = await scene(c);
      record("E1a setup: 2 markers + 2 labels + 1 path", objs.length === 5, `n=${objs.length}`);

      let r = await call(c, "removeObject", { name: "  DELHI " });
      objs = await scene(c);
      record("E1 removing a place removes its marker AND label (case/space-insensitive)", !r.isError && objs.length === 3 && !objs.some((o) => o.name === "Delhi"), `n=${objs.length} ${text(r)}`);
      record("E1b the path with a different name is untouched", ofType(objs, "path").length === 1);

      r = await call(c, "createMarker", { location: "Delhi" });
      objs = await scene(c);
      record("E1c a removed place can be created again (de-duplication index was cleaned)", /Created marker/.test(text(r)) && objs.length === 5, `n=${objs.length} ${text(r).slice(0, 80)}`);

      r = await call(c, "removeObject", { name: "Atlantis" });
      record("E2 unknown name -> error that lists the names on the map (so the model can fix itself)", r.isError === true && /Names on the map/.test(text(r)) && /Jaipur/.test(text(r)), text(r).slice(0, 160));

      r = await call(c, "removeObject", { name: "Jaipur", type: "label" });
      objs = await scene(c);
      record("E3 type filter removes only that type", !r.isError && ofType(objs, "marker").some((o) => o.name === "Jaipur") && !ofType(objs, "label").some((o) => o.name === "Jaipur"), `labels=${ofType(objs, "label").map((o) => o.name)}`);
      r = await call(c, "createMarker", { location: "Jaipur" });
      objs = await scene(c);
      record("E3b the removed label comes back, the marker is not duplicated", /already exists/.test(text(r)) && /Added label/.test(text(r)) && ofType(objs, "marker").filter((o) => o.name === "Jaipur").length === 1, text(r).slice(0, 120));

      const before = countLog(S, "[stub] osrm");
      r = await call(c, "removeObject", { name: "delhi → jaipur" });
      record("E4 a path is removed by its 'A → B' name", !r.isError && ofType(await scene(c), "path").length === 0, text(r).slice(0, 100));
      r = await call(c, "createPath", { start: "Delhi", end: "Jaipur" });
      record("E4b the path can be drawn again (new routing request, not a stale duplicate)", /Created path/.test(text(r)) && countLog(S, "[stub] osrm") === before + 1, text(r).slice(0, 80));

      r = await call(c, "removeObject", { name: "x", type: "bogus" }).catch((e) => ({ isError: true, content: [{ text: String(e.message) }] }));
      record("E5 an invalid type is rejected", r.isError === true, text(r).slice(0, 80));

      r = await call(c, "clearScene");
      record("E6 clearScene empties the map", !r.isError && (await scene(c)).length === 0 && /Cleared the map \(\d+ object/.test(text(r)), text(r));
      r = await call(c, "clearScene");
      record("E6b clearing an empty map is harmless", !r.isError && /already empty/.test(text(r)), text(r));
      r = await call(c, "createMarker", { location: "Delhi" });
      record("E6c the map can be rebuilt after clearing", /Created marker/.test(text(r)) && (await scene(c)).length === 2, text(r).slice(0, 80));
      await c.close();
    });

    await guard("I", async () => {
      const a = await connect(S.port);
      const b = await connect(S.port);
      await call(a, "createMarker", { location: "Delhi" });
      await call(b, "createMarker", { location: "Mumbai" });
      await call(b, "clearScene");
      const sa = await scene(a);
      record("E7 clearScene / removeObject only affect their own session's map", sa.length === 2 && (await scene(b)).length === 0, `a=${sa.length}`);
      await call(b, "createMarker", { location: "Mumbai" });
      await call(a, "removeObject", { name: "Mumbai" }).catch(() => undefined);
      record("E7b removing in A does not touch B's objects", (await scene(b)).length === 2);
      await a.close(); await b.close();
    });
  } finally { await stop(S); }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });
