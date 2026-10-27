/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScene } from "@map-renderer/shared";
import type { Scene } from "@map-renderer/shared";
import { applyScene, drawScene, labelCss, disposeState } from "../src/renderer/drawScene.ts";
import type { MapLike, MarkerFactories } from "../src/renderer/drawScene.ts";
import { computeSceneBounds, FIT_MAX_ZOOM, FIT_PADDING } from "../src/renderer/camera.ts";

/* ----------------------------- fakes ----------------------------- */

class FakeMap implements MapLike {
  sources = new Map<string, any>();
  layers = new Map<string, any>();
  fits: any[] = [];
  addLayerCalls = 0;
  /** throw on the Nth addLayer call (1-based), to simulate a mid-draw failure */
  failOnAddLayer: number | null = null;
  failOnAddSource: number | null = null;
  addSourceCalls = 0;
  addSource(id: string, source: any) {
    this.addSourceCalls++;
    if (this.failOnAddSource === this.addSourceCalls) throw new Error("boom source");
    if (this.sources.has(id)) throw new Error(`Source "${id}" already exists.`);
    this.sources.set(id, source);
  }
  addLayer(layer: any) {
    this.addLayerCalls++;
    if (this.failOnAddLayer === this.addLayerCalls) throw new Error("boom layer");
    if (this.layers.has(layer.id)) throw new Error(`Layer "${layer.id}" already exists.`);
    if (!this.sources.has(layer.source)) throw new Error(`Source "${layer.source}" not found.`);
    this.layers.set(layer.id, layer);
  }
  removeLayer(id: string) { this.layers.delete(id); }
  removeSource(id: string) { this.sources.delete(id); }
  getLayer(id: string) { return this.layers.get(id); }
  getSource(id: string) { return this.sources.get(id); }
  fitBounds(bounds: any, options: any) { this.fits.push({ bounds, options }); }
}

class FakeFactories implements MarkerFactories {
  live = new Set<string>();
  failOnMarker: string | null = null;
  createMarker(m: any) {
    if (this.failOnMarker === m.id) throw new Error("boom marker");
    this.live.add(`m:${m.id}`);
    return { remove: () => void this.live.delete(`m:${m.id}`) };
  }
  createLabel(l: any) {
    this.live.add(`l:${l.id}`);
    return { remove: () => void this.live.delete(`l:${l.id}`) };
  }
}

const marker = (id: string, position: [number, number] = [77, 28]) => ({
  type: "marker", id, name: id, position, color: "red", opacity: 1, size: 1,
});
const label = (id: string) => ({
  type: "label", id, name: id, position: [77, 28], text: id, color: "#000", opacity: 1, fontSize: 14, fontWeight: "normal",
});
const path = (id: string) => ({
  type: "path", id, name: id, coordinates: [[70, 10], [71, 11], [72, 12]], color: "blue", opacity: 1, width: 4, dash: false,
});
const square = [[0, 0], [1, 0], [1, 1], [0, 1]]; // NOT closed on purpose
const polygon = (id: string, over: Record<string, unknown> = {}) => ({
  type: "polygon", id, name: id, polygons: [[square]], fillColor: "#00aa00", fillOpacity: 0.4,
  borderWidth: 0, borderDash: false, ...over,
});
const mk = (...objects: unknown[]): Scene => parseScene({ version: 1, objects });

const snapshot = (map: FakeMap, f: FakeFactories) =>
  JSON.stringify({ s: [...map.sources.keys()], l: [...map.layers.keys()], o: [...f.live].sort() });

/* ------------------------- transactional render ------------------------- */

test("valid scene draws every object type", () => {
  const map = new FakeMap(), f = new FakeFactories();
  const state = applyScene(map, f, null, mk(marker("m"), label("l"), path("p"), polygon("g", { borderWidth: 2 })), 1);
  assert.deepEqual([...map.sources.keys()].sort(), ["r1-g", "r1-p"]);
  assert.deepEqual([...map.layers.keys()].sort(), ["r1-g", "r1-g-border", "r1-p"]);
  assert.deepEqual([...f.live].sort(), ["l:l", "m:m"]);
  assert.equal(state.generation, 1);
});

test("invalid scene never touches the map (rejected at parse time)", () => {
  const map = new FakeMap(), f = new FakeFactories();
  const before = snapshot(map, f);
  assert.throws(() => mk(marker("m"), { ...marker("m2"), position: [1] }));
  // parse failed, so nothing was ever handed to the renderer
  assert.equal(snapshot(map, f), before);
  assert.equal(map.addSourceCalls + map.addLayerCalls, 0);
});

test("failure injected mid-draw rolls back and keeps the previous scene", () => {
  const map = new FakeMap(), f = new FakeFactories();
  const first = applyScene(map, f, null, mk(marker("a"), path("p1"), polygon("g1", { borderWidth: 2 })), 1);
  const good = snapshot(map, f);

  // Second scene: marker + path draw fine, then the polygon's layer fails.
  const second = mk(marker("b"), label("lb"), path("p2"), polygon("g2", { borderWidth: 2 }));
  map.failOnAddLayer = map.addLayerCalls + 2; // p2 layer = +1, g2 fill = +2
  assert.throws(() => applyScene(map, f, first, second, 2), /boom layer/);

  assert.equal(snapshot(map, f), good, "map must be exactly as before the failed render");
  assert.equal(first.layerIds.length, 3, "previous state must still own its layers");
  assert.equal(map.fits.length, 1, "camera not moved by the failed render");
});

test("failure in a marker factory and in addSource also roll back", () => {
  const map = new FakeMap(), f = new FakeFactories();
  const first = applyScene(map, f, null, mk(marker("a"), path("p1")), 1);
  const good = snapshot(map, f);

  f.failOnMarker = "z";
  assert.throws(() => applyScene(map, f, first, mk(path("p2"), polygon("g"), marker("z")), 2), /boom marker/);
  assert.equal(snapshot(map, f), good);

  f.failOnMarker = null;
  map.failOnAddSource = map.addSourceCalls + 2;
  assert.throws(() => applyScene(map, f, first, mk(path("p3"), polygon("g3")), 3), /boom source/);
  assert.equal(snapshot(map, f), good);
});

test("successful render replaces the old scene completely", () => {
  const map = new FakeMap(), f = new FakeFactories();
  const s1 = applyScene(map, f, null, mk(marker("a"), path("p1"), polygon("g1", { borderWidth: 1 })), 1);
  const s2 = applyScene(map, f, s1, mk(marker("b"), label("lb")), 2);
  assert.equal(map.sources.size, 0);
  assert.equal(map.layers.size, 0);
  assert.deepEqual([...f.live].sort(), ["l:lb", "m:b"]);
  assert.equal(s1.layerIds.length + s1.sourceIds.length + s1.overlays.length, 0, "old state emptied");
  assert.equal(s2.generation, 2);
});

test("repeated renders of the SAME ids do not collide", () => {
  const map = new FakeMap(), f = new FakeFactories();
  const scene = mk(path("same"), polygon("same2", { borderWidth: 2 }));
  let state = null as ReturnType<typeof applyScene> | null;
  for (let gen = 1; gen <= 5; gen++) state = applyScene(map, f, state, scene, gen);
  assert.deepEqual([...map.layers.keys()].sort(), ["r5-same", "r5-same2", "r5-same2-border"]);
  assert.equal(map.sources.size, 2);
});

test("a failed render followed by a good one works", () => {
  const map = new FakeMap(), f = new FakeFactories();
  const s1 = applyScene(map, f, null, mk(path("p")), 1);
  map.failOnAddLayer = map.addLayerCalls + 1;
  assert.throws(() => applyScene(map, f, s1, mk(path("p")), 2));
  map.failOnAddLayer = null;
  const s3 = applyScene(map, f, s1, mk(path("p")), 3);
  assert.deepEqual([...map.layers.keys()], ["r3-p"]);
  assert.equal(s3.generation, 3);
});

test("empty scene clears the map and does not move the camera", () => {
  const map = new FakeMap(), f = new FakeFactories();
  const s1 = applyScene(map, f, null, mk(marker("a"), path("p")), 1);
  const fits = map.fits.length;
  applyScene(map, f, s1, mk(), 2);
  assert.equal(map.layers.size + map.sources.size + f.live.size, 0);
  assert.equal(map.fits.length, fits);
});

test("a throwing fitBounds does not undo a drawn scene", () => {
  const map = new FakeMap(), f = new FakeFactories();
  map.fitBounds = () => { throw new Error("camera"); };
  const s = applyScene(map, f, null, mk(marker("a")), 1);
  assert.equal(f.live.size, 1);
  assert.equal(s.overlays.length, 1);
});

test("disposeState is best-effort and never throws", () => {
  const map = new FakeMap();
  map.removeLayer = () => { throw new Error("x"); };
  const state = { generation: 1, layerIds: ["a"], sourceIds: ["b"], overlays: [{ remove: () => { throw new Error("y"); } }] };
  map.layers.set("a", {}); map.sources.set("b", {});
  disposeState(map, state);
  assert.equal(map.sources.size, 0, "later steps still ran");
});

/* ------------------------------ polygons ------------------------------ */

test("polygon border rule: only when borderWidth > 0, color falls back to fill", () => {
  const map = new FakeMap(), f = new FakeFactories();
  drawScene(map, f, mk(
    polygon("none"),
    polygon("w", { borderWidth: 3 }),
    polygon("c", { borderWidth: 1, borderColor: "red", borderDash: true }),
  ), 1);
  assert.ok(!map.layers.has("r1-none-border"));
  assert.equal(map.layers.get("r1-w-border").paint["line-color"], "#00aa00");
  assert.equal(map.layers.get("r1-w-border").paint["line-width"], 3);
  assert.equal(map.layers.get("r1-w-border").paint["line-dasharray"], undefined);
  assert.equal(map.layers.get("r1-c-border").paint["line-color"], "red");
  assert.deepEqual(map.layers.get("r1-c-border").paint["line-dasharray"], [4, 2]);
});

test("polygon is drawn as MultiPolygon with all polygons and holes; rings get closed; scene not mutated", () => {
  const hole = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4]];
  const scene = mk(polygon("g", { polygons: [[square, hole], [square]] }));
  const before = JSON.stringify(scene);
  const map = new FakeMap();
  drawScene(map, new FakeFactories(), scene, 1);
  const geom = map.sources.get("r1-g").data.geometry;
  assert.equal(geom.type, "MultiPolygon");
  assert.equal(geom.coordinates.length, 2);
  assert.equal(geom.coordinates[0].length, 2, "outer + hole kept");
  for (const poly of geom.coordinates) for (const r of poly) assert.deepEqual(r[0], r[r.length - 1]);
  assert.equal(JSON.stringify(scene), before);
});

test("already-closed ring is not closed twice", () => {
  const closed = [[0, 0], [1, 0], [1, 1], [0, 0]];
  const map = new FakeMap();
  drawScene(map, new FakeFactories(), mk(polygon("g", { polygons: [[closed]] })), 1);
  assert.equal(map.sources.get("r1-g").data.geometry.coordinates[0][0].length, 4);
});

test("path styling is passed through, dash only when requested", () => {
  const map = new FakeMap();
  drawScene(map, new FakeFactories(), mk({ ...path("a"), dash: true, width: 6, opacity: 0.5 }, path("b")), 1);
  const a = map.layers.get("r1-a").paint, b = map.layers.get("r1-b").paint;
  assert.deepEqual([a["line-width"], a["line-opacity"], a["line-dasharray"]], [6, 0.5, [4, 2]]);
  assert.equal(b["line-dasharray"], undefined);
});

test("labelCss uses the flat label fields and a default background", () => {
  const l = parseScene({ version: 1, objects: [label("l"), { ...label("l2"), backgroundColor: "yellow", fontSize: 20, fontWeight: "bold" }] }).objects;
  const [a, b] = [labelCss(l[0] as any), labelCss(l[1] as any)];
  assert.equal(a.backgroundColor, "rgba(255, 255, 255, 0.7)");
  assert.equal(a.fontSize, "14px");
  assert.deepEqual([b.backgroundColor, b.fontSize, b.fontWeight], ["yellow", "20px", "bold"]);
});

/* -------------------------------- camera -------------------------------- */

test("computeSceneBounds: empty scene -> null", () => {
  assert.equal(computeSceneBounds(mk()), null);
});

test("computeSceneBounds: single marker -> degenerate box", () => {
  assert.deepEqual(computeSceneBounds(mk(marker("a", [77.2, 28.6]))), [[77.2, 28.6], [77.2, 28.6]]);
});

test("computeSceneBounds covers markers, labels, paths and every polygon (outer rings)", () => {
  const b = computeSceneBounds(mk(
    marker("a", [10, 20]),
    { ...label("l"), position: [-5, 30] },
    path("p"),
    polygon("g", { polygons: [[[[50, -10], [51, -10], [51, -9]]], [[[100, 5], [101, 5], [101, 6]]]] }),
  ));
  assert.deepEqual(b, [[-5, -10], [101, 30]]);
});

test("single marker fits with maxZoom 12 and padding 50 (no max zoom-in)", () => {
  const map = new FakeMap();
  applyScene(map, new FakeFactories(), null, mk(marker("a", [77.2, 28.6])), 1);
  assert.equal(map.fits.length, 1);
  assert.equal(map.fits[0].options.maxZoom, FIT_MAX_ZOOM);
  assert.equal(map.fits[0].options.padding, FIT_PADDING);
  assert.equal(FIT_MAX_ZOOM, 12);
  assert.equal(FIT_PADDING, 50);
  assert.deepEqual(map.fits[0].bounds, [[77.2, 28.6], [77.2, 28.6]]);
});
