/* eslint-disable */
// End-to-end tests for scene rules enforced IN CODE (not in the LLM prompt):
// idempotent tools, one label per spot, auto labels, geocode cache + rate limit,
// style clamping, object cap, no cached failures.
// Runs the REAL built server as a child process; talks to it with the real MCP SDK client.
// Usage (repo root, after building shared + server):  node packages/server/test/e2e-scene-rules.mjs
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
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
  const S = await startServer(3921);
  const c = await connect(S.port);
  try {
    await guard("R1", async () => {
      const cl = await connect(S.port);
      const r = await call(cl, "createMarker", { location: "Delhi" });
      const o = await scene(cl);
      const labels = ofType(o, "label");
      record("R1 marker auto-adds one name label", ofType(o, "marker").length === 1 && labels.length === 1 && labels[0].text === "Delhi", text(r));
    });

    await guard("R2", async () => {
      const cl = await connect(S.port);
      await call(cl, "createMarker", { location: "Jaipur" });
      const again = text(await call(cl, "createMarker", { location: "Jaipur" }));
      await call(cl, "createLabel", { location: "Jaipur", text: "Jaipur" });
      const o = await scene(cl);
      record("R2 repeated identical calls add nothing", ofType(o, "marker").length === 1 && ofType(o, "label").length === 1 && /already exists/.test(again), again);
    });

    await guard("R3", async () => {
      const cl = await connect(S.port);
      await call(cl, "createMarker", { location: "Agra" });
      await call(cl, "createMarker", { location: "New Agra, India" }); // same spot, different words
      const o = await scene(cl);
      record("R3 same spot under a different name is not duplicated", ofType(o, "marker").length === 1 && ofType(o, "label").length === 1, `markers=${ofType(o, "marker").length} labels=${ofType(o, "label").length}`);
    });

    await guard("R4", async () => {
      const cl = await connect(S.port);
      await call(cl, "createMarker", { location: "Pune" });
      await call(cl, "createLabel", { location: "Pune", text: "Oxford of the East" });
      await call(cl, "createMarker", { location: "Pune" }); // auto label must NOT overwrite explicit text
      const o = await scene(cl);
      const labels = ofType(o, "label");
      record("R4 explicit label replaces auto label, auto never overwrites", labels.length === 1 && labels[0].text === "Oxford of the East", JSON.stringify(labels.map((l) => l.text)));
    });

    await guard("R5", async () => {
      const cl = await connect(S.port);
      await call(cl, "createLabel", { location: "Surat", text: "Diamond City" });
      await call(cl, "createMarker", { location: "Surat" });
      const o = await scene(cl);
      const labels = ofType(o, "label");
      record("R5 label created first is kept when marker is added later", ofType(o, "marker").length === 1 && labels.length === 1 && labels[0].text === "Diamond City", JSON.stringify(labels.map((l) => l.text)));
    });

    await guard("R6", async () => {
      const cl = await connect(S.port);
      await call(cl, "createMarker", { location: "Nashik", showLabel: false });
      const o = await scene(cl);
      record("R6 showLabel=false gives marker without label", ofType(o, "marker").length === 1 && ofType(o, "label").length === 0);
    });

    await guard("R7", async () => {
      const cl = await connect(S.port);
      const before = countLog(S, "[stub] osrm");
      await call(cl, "createPath", { start: "Nagpur", end: "Bhopal" });
      const again = text(await call(cl, "createPath", { start: "Nagpur", end: "Bhopal" }));
      const o = await scene(cl);
      const osrmCalls = countLog(S, "[stub] osrm") - before;
      record("R7 duplicate path ignored and routing service called once", ofType(o, "path").length === 1 && osrmCalls === 1 && /already exists/.test(again), `paths=${ofType(o, "path").length} osrm=${osrmCalls}`);
    });

    await guard("R8", async () => {
      const cl = await connect(S.port);
      await call(cl, "createPolygon", { location: "Goa" });
      await call(cl, "createPolygon", { location: "goa " });
      const o = await scene(cl);
      record("R8 duplicate polygon ignored", ofType(o, "polygon").length === 1, `polygons=${ofType(o, "polygon").length}`);
    });

    await guard("R9", async () => {
      const a = await connect(S.port), b = await connect(S.port);
      await call(a, "createMarker", { location: "CacheTown" });
      await call(a, "createLabel", { location: "CacheTown", text: "x" });
      await call(a, "createMarker", { location: "cachetown" });
      await call(b, "createMarker", { location: "CacheTown" }); // different session, shared cache
      const n = countLog(S, "kind=geocode q=CacheTown");
      record("R9 geocode cached across calls and sessions (1 network call)", n === 1, `network calls=${n}`);
    });

    await guard("R10", async () => {
      const cl = await connect(S.port);
      const r1 = text(await call(cl, "createMarker", { location: "Kochi", style: { size: 50, color: "reddish" } }));
      const r2 = text(await call(cl, "createPath", { start: "Kochi", end: "Madurai", style: { width: 100, color: "javascript:alert(1)" } }));
      const r3 = text(await call(cl, "createLabel", { location: "Kochi", text: "k".repeat(200), style: { fontSize: 500, fontWeight: "ultra" } }));
      const o = await scene(cl);
      const m = ofType(o, "marker")[0], p = ofType(o, "path")[0], l = ofType(o, "label")[0];
      const ok = m.style.options.size === 1.5 && m.style.color === "#ff0000" && p.style.width === 8 && p.style.color === "#0066ff"
        && l.text.length === 80 && l.style.options.fontSize === 32 && l.style.options.fontWeight === undefined && /Adjusted/.test(r1);
      record("R10 bad style values clamped/sanitised, model is told", ok, `size=${m.style.options.size} color=${m.style.color} width=${p.style.width} labelLen=${l.text.length} fs=${l.style.options.fontSize}`);
    });

    await guard("R11", async () => {
      const cl = await connect(S.port);
      const r = await call(cl, "createLabel", { location: "Kochi", text: "   " });
      const o = await scene(cl);
      record("R11 blank label text rejected", r.isError === true && ofType(o, "label").length === 0, text(r).slice(0, 80));
    });

    await guard("R12", async () => {
      const cl = await connect(S.port);
      const a = await call(cl, "createMarker", { location: "Nowhere City" });
      const b = await call(cl, "createMarker", { location: "Nowhere City" });
      const n = countLog(S, "q=Nowhere City");
      record("R12 failed lookups are not cached (retry hits network again)", a.isError === true && b.isError === true && n === 2, `isError=${a.isError},${b.isError} network calls=${n}`);
    });

    await guard("R13", async () => {
      // parallel identical calls inside ONE session must still yield one object
      const cl = await connect(S.port);
      await Promise.all([...Array(5)].map(() => call(cl, "createMarker", { location: "Ranchi" })));
      const o = await scene(cl);
      record("R13 5 parallel identical calls -> 1 marker, 1 label", ofType(o, "marker").length === 1 && ofType(o, "label").length === 1, `markers=${ofType(o, "marker").length} labels=${ofType(o, "label").length}`);
    });
  } finally {
    await c.close().catch(() => {});
    await stop(S);
  }

  // R14 object cap, atomic (separate server with tiny cap)
  const Cap = await startServer(3922, { MAX_SCENE_OBJECTS: "5" });
  try {
    await guard("R14", async () => {
      const cl = await connect(Cap.port);
      await call(cl, "createMarker", { location: "Alpha" }); // marker+label = 2
      await call(cl, "createMarker", { location: "Beta" });  // 4
      const r = await call(cl, "createMarker", { location: "Gamma" }); // needs 2 more -> 6 > 5
      const o = await scene(cl);
      record("R14 scene cap enforced atomically (no half-added marker)", r.isError === true && o.length === 4 && /limit/i.test(text(r)), `isError=${r.isError} objects=${o.length}`);
    });
  } finally { await stop(Cap); }

  // R15 Nominatim rate limit (separate server, 300 ms gap)
  const Rate = await startServer(3923, { NOMINATIM_MIN_INTERVAL_MS: "300" });
  try {
    await guard("R15", async () => {
      const cl = await connect(Rate.port);
      await Promise.all(["Rate1", "Rate2", "Rate3", "Rate4"].map((q) => call(cl, "createMarker", { location: q, showLabel: false })));
      const ts = Rate.getLog().split("\n").filter((l) => l.includes("[stub] nominatim")).map((l) => Number(/t=(\d+)/.exec(l)[1])).sort((a, b) => a - b);
      const gaps = ts.slice(1).map((t, i) => t - ts[i]);
      record("R15 Nominatim calls spaced >= configured gap", ts.length === 4 && gaps.every((g) => g >= 270), `gaps(ms)=${gaps.join(",")}`);
    });
  } finally { await stop(Rate); }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });
