/* eslint-disable */
// Test-only: preloaded via `node --import`. Replaces global fetch for Nominatim/OSRM
// so tests are deterministic, offline and fast. Production code is NOT modified.
// Every outgoing call is logged to stderr so tests can count and time them:
//   [stub] nominatim t=<ms> kind=<geocode|boundary> q=<query>
//   [stub] osrm t=<ms>
const realFetch = globalThis.fetch;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function hash(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}
// "Delhi", "New Delhi", "new delhi, India" all resolve to the same spot (like real geocoding).
function canonical(q) {
  return q.toLowerCase().replace(/,\s*india\s*$/, "").replace(/^new\s+/, "").trim();
}
function coords(q) {
  const h = hash(canonical(q));
  return { lat: 8 + (h % 2900) / 100, lon: 68 + ((h >> 8) % 2900) / 100 };
}
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === "string" ? input : input.url ?? input);
  if (url.includes("nominatim.openstreetmap.org")) {
    const u = new URL(url);
    const q = u.searchParams.get("q") ?? "";
    const kind = u.searchParams.get("format") === "geojson" ? "boundary" : "geocode";
    console.error(`[stub] nominatim t=${Date.now()} kind=${kind} q=${q}`);
    await sleep(20 + Math.floor(Math.random() * 40)); // jitter so requests really interleave
    if (q.toLowerCase().includes("nowhere")) {
      return Response.json(kind === "boundary" ? { features: [] } : []);
    }
    const { lat, lon } = coords(q);
    if (kind === "boundary") {
      const d = 0.5;
      return Response.json({ features: [{ geometry: { type: "Polygon", coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]] } }] });
    }
    return Response.json([{ lat: String(lat), lon: String(lon) }]);
  }
  if (url.includes("router.project-osrm.org")) {
    console.error(`[stub] osrm t=${Date.now()}`);
    await sleep(20 + Math.floor(Math.random() * 40));
    return Response.json({ routes: [{ geometry: { coordinates: [[68, 8], [69, 9], [70, 10]] } }] });
  }
  return realFetch(input, init);
};
