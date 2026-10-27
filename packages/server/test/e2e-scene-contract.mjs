/* eslint-disable */
// Contract test: what the REAL server returns from renderScene must pass the shared
// scene schema (parseScene), i.e. exactly what the web app will validate.
// Runs the REAL built server as a child process; talks to it with the real MCP SDK client.
// Usage (repo root, after building shared + server):  node packages/server/test/e2e-scene-contract.mjs
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

async function main() {
  const S = await startServer(3931);
  try {
    await guard("C1", async () => {
      const cl = await connect(S.port);
      const empty = parseScene(JSON.parse(text(await call(cl, "renderScene"))));
      record("C1 empty scene is valid and versioned", empty.version === 1 && empty.objects.length === 0);
    });

    await guard("C2", async () => {
      const cl = await connect(S.port);
      await call(cl, "createMarker", { location: "Delhi", style: { color: "#123456", size: 1.2, opacity: 0.8 } });
      await call(cl, "createLabel", { location: "Agra", text: "Agra fort", style: { backgroundColor: "yellow", fontWeight: "bold" } });
      await call(cl, "createPath", { start: "Delhi", end: "Agra", style: { dash: true } });
      await call(cl, "createPolygon", { location: "Rajasthan" });
      const raw = JSON.parse(text(await call(cl, "renderScene")));
      let parsed, err = "";
      try { parsed = parseScene(raw); } catch (e) { err = e.message; }
      const types = (parsed?.objects ?? []).map((o) => o.type).sort().join(",");
      record("C2 renderScene output of all 4 tools passes parseScene", !!parsed && types === "label,label,marker,path,polygon", `types=${types} ${err}`);
      // the schema strips unknown keys; the server must not be sending any
      record("C2b wire has no leftover keys (parse == raw)", parsed && JSON.stringify(parsed) === JSON.stringify(raw));
      const m = raw.objects.find((o) => o.type === "marker");
      record("C2c marker fields: [lng,lat], flat style, name", Array.isArray(m.position) && m.name === "Delhi" && m.color === "#123456" && m.size === 1.2 && m.opacity === 0.8 && !("style" in m) && !("metadata" in m) && !("geometry" in m), JSON.stringify(m));
      const pg = raw.objects.find((o) => o.type === "polygon");
      record("C2d polygon is MultiPolygon layout [[ring]]", Array.isArray(pg.polygons) && pg.polygons.length === 1 && pg.polygons[0].length === 1 && pg.polygons[0][0].length >= 3);
      const p = raw.objects.find((o) => o.type === "path");
      record("C2e path coordinates are [lng,lat] pairs, dash passed", p.coordinates.length >= 2 && p.dash === true && p.coordinates.every((c) => c.length === 2));
    });

    await guard("C3", async () => {
      const cl = await connect(S.port);
      await call(cl, "createPolygon", { location: "Plain" });
      await call(cl, "createPolygon", { location: "ColorOnly", style: { borderColor: "red" } });
      await call(cl, "createPolygon", { location: "WidthOnly", style: { borderWidth: 3 } });
      await call(cl, "createPolygon", { location: "DashOnly", style: { borderDash: true } });
      const o = parseScene(JSON.parse(text(await call(cl, "renderScene")))).objects.filter((x) => x.type === "polygon");
      const by = Object.fromEntries(o.map((x) => [x.name, x]));
      record("C3 polygon border rule (none=0, requested=1, explicit width kept)",
        by.Plain.borderWidth === 0 && by.ColorOnly.borderWidth === 1 && by.ColorOnly.borderColor === "red"
        && by.WidthOnly.borderWidth === 3 && by.DashOnly.borderWidth === 1 && by.DashOnly.borderDash === true && by.Plain.fillOpacity === 0.4,
        o.map((x) => `${x.name}:${x.borderWidth}`).join(" "));
    });

    await guard("C4", async () => {
      const cl = await connect(S.port);
      await call(cl, "createMarker", { location: "Long name " + "x".repeat(190) });
      await call(cl, "createPath", { start: "S".repeat(200), end: "E".repeat(200) });
      let ok = true, err = "";
      try { parseScene(JSON.parse(text(await call(cl, "renderScene")))); } catch (e) { ok = false; err = e.message; }
      record("C4 maximum-length inputs still produce a valid scene", ok, err);
    });
  } finally { await stop(S); }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });
