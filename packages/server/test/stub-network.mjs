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
  // Special names land in longitude bands the OSRM stub treats as unroutable:
  //   "island*" -> NoRoute (HTTP 200), "reef*" -> NoSegment (HTTP 400), "outage*" -> HTTP 500
  const c = canonical(q);
  const band = c.startsWith("island") ? 120 : c.startsWith("reef") ? 130 : c.startsWith("outage") ? 140 : null;
  if (band !== null) return { lat: 5 + (h % 100) / 10, lon: band + (h % 10) / 10 };
  return { lat: 8 + (h % 2900) / 100, lon: 68 + ((h >> 8) % 2900) / 100 };
}
// Deterministic "coastline": a wiggly closed ring with n points (n > cap forces simplification).
function coastline(n, cx, cy, r) {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const ring = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r + 0.3 * Math.sin(a * 40) + (rnd() - 0.5) * 0.02;
    ring.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  ring.push(ring[0]);
  return ring;
}
const square = (x, y, d) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]];
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === "string" ? input : input.url ?? input);
  if (url.includes("nominatim.openstreetmap.org")) {
    const u = new URL(url);
    const q = u.searchParams.get("q") ?? "";
    const kind = u.searchParams.get("format") === "geojson" ? "boundary" : "geocode";
    console.error(`[stub] nominatim t=${Date.now()} kind=${kind} q=${q} thr=${u.searchParams.get("polygon_threshold") ?? ""}`);
    await sleep(20 + Math.floor(Math.random() * 40)); // jitter so requests really interleave
    if (q.toLowerCase().includes("nowhere")) {
      return Response.json(kind === "boundary" ? { features: [] } : []);
    }
    const { lat, lon } = coords(q);
    if (kind === "boundary") {
      const cq = q.toLowerCase();
      // archipelago: mainland WITH a hole + a separate island
      if (cq.startsWith("archipelago")) {
        return Response.json({ features: [{ geometry: { type: "MultiPolygon", coordinates: [
          [square(10, 10, 4), square(11, 11, 1)],
          [square(20, 10, 1)],
        ] } }] });
      }
      // junk rings mixed with good ones: bad hole (2 pts), bad island (2 pts), non-finite point
      if (cq.startsWith("badrings")) {
        return Response.json({ features: [{ geometry: { type: "MultiPolygon", coordinates: [
          [square(10, 10, 4), [[11, 11], [12, 12]]],
          [[[30, 30], [31, 31]]],
          [[[40, 40], [41, 40], [null, 5], [41, 41], [40, 41], [40, 40]]],
        ] } }] });
      }
      if (cq.startsWith("bigland")) {
        return Response.json({ features: [{ geometry: { type: "Polygon", coordinates: [coastline(200000, 80, 20, 5), square(79, 19, 1)] } }] });
      }
      if (cq.startsWith("pointplace")) {
        return Response.json({ features: [{ geometry: { type: "Point", coordinates: [lon, lat] } }] });
      }
      const d = 0.5;
      return Response.json({ features: [{ geometry: { type: "Polygon", coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]] } }] });
    }
    return Response.json([{ lat: String(lat), lon: String(lon) }]);
  }
  if (url.includes("router.project-osrm.org")) {
    console.error(`[stub] osrm t=${Date.now()}`);
    await sleep(20 + Math.floor(Math.random() * 40));
    const lons = (url.match(/driving\/([^?]+)/)?.[1] ?? "").split(";").map((p) => Number(p.split(",")[0]));
    const band = (b) => lons.some((x) => x >= b && x < b + 1);
    if (band(120)) return Response.json({ code: "NoRoute", message: "Impossible route between points" });
    if (band(130)) return Response.json({ code: "NoSegment", message: "Could not find a matching segment for coordinate 0" }, { status: 400 });
    if (band(140)) return new Response("upstream exploded", { status: 500 });
    return Response.json({ code: "Ok", routes: [{ geometry: { coordinates: [[68, 8], [69, 9], [70, 10]] } }] });
  }
  return realFetch(input, init);
};
