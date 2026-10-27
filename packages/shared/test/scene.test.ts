import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SCENE_VERSION, SceneValidationError, emptyScene, isValidColor, parseScene,
} from "../src/index.ts";

const marker = (over: Record<string, unknown> = {}) => ({
  type: "marker", id: "m1", name: "Delhi", position: [77.2, 28.6], color: "#ff0000", opacity: 1, size: 1, ...over,
});
const label = (over: Record<string, unknown> = {}) => ({
  type: "label", id: "l1", name: "Delhi", position: [77.2, 28.6], text: "Delhi", color: "#000000",
  opacity: 1, fontSize: 14, fontWeight: "normal", ...over,
});
const path = (over: Record<string, unknown> = {}) => ({
  type: "path", id: "p1", name: "a → b", coordinates: [[77, 28], [78, 29]], color: "#0066ff",
  opacity: 1, width: 4, dash: false, ...over,
});
const square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
const polygon = (over: Record<string, unknown> = {}) => ({
  type: "polygon", id: "g1", name: "Box", polygons: [[square]], fillColor: "#00aa00",
  fillOpacity: 0.4, borderWidth: 0, borderDash: false, ...over,
});
const scene = (objects: unknown[], version: unknown = SCENE_VERSION) => ({ version, objects });

function rejects(input: unknown, pattern: RegExp): void {
  assert.throws(() => parseScene(input), (e: unknown) => {
    assert.ok(e instanceof SceneValidationError, "expected SceneValidationError");
    assert.match(e.message, pattern);
    return true;
  });
}

test("valid scene with every object type passes", () => {
  const s = parseScene(scene([marker(), label(), path(), polygon({ borderColor: "red", borderWidth: 2 })]));
  assert.equal(s.objects.length, 4);
  assert.equal(s.version, 1);
});

test("emptyScene is valid", () => {
  assert.deepEqual(parseScene(emptyScene()), emptyScene());
});

test("polygon with holes and several polygons (MultiPolygon) passes", () => {
  const hole = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.2]];
  parseScene(scene([polygon({ polygons: [[square, hole], [square]] })]));
});

test("unknown extra keys are stripped, not rejected", () => {
  const s = parseScene(scene([marker({ visible: true, metadata: { name: "x" } })]));
  assert.deepEqual(Object.keys(s.objects[0]!).sort(), ["color", "id", "name", "opacity", "position", "size", "type"]);
});

test("missing coordinate: path names objects[1].position", () => {
  rejects(scene([marker(), marker({ id: "m2", position: undefined })]), /objects\[1\]\.position/);
});

test("single coordinate component missing", () => {
  rejects(scene([marker({ position: [77.2] })]), /objects\[0\]\.position/);
});

test("NaN and null numbers fail", () => {
  rejects(scene([marker({ opacity: NaN })]), /objects\[0\]\.opacity/);
  rejects(scene([marker({ size: null })]), /objects\[0\]\.size/);
  rejects(scene([marker({ position: [NaN, 1] })]), /objects\[0\]\.position\[0\]/);
});

test("latitude / longitude out of range fail with exact index", () => {
  rejects(scene([marker({ position: [77, 91] })]), /objects\[0\]\.position\[1\]/);
  rejects(scene([marker({ position: [181, 0] })]), /objects\[0\]\.position\[0\]/);
  rejects(scene([path({ coordinates: [[0, 0], [0, -91]] })]), /objects\[0\]\.coordinates\[1\]\[1\]/);
});

test("bad colors fail, good colors pass", () => {
  rejects(scene([marker({ color: "reddish" })]), /objects\[0\]\.color/);
  rejects(scene([marker({ color: "javascript:alert(1)" })]), /objects\[0\]\.color/);
  rejects(scene([label({ backgroundColor: "nope" })]), /objects\[0\]\.backgroundColor/);
  for (const c of ["#fff", "#ffff", "#ff0000", "#ff000080", "rgb(1,2,3)", "rgba(1, 2, 3, 0.5)", "hsl(10, 50%, 50%)", "Red", "transparent"]) {
    assert.ok(isValidColor(c), c);
  }
});

test("unknown type fails", () => {
  rejects(scene([{ type: "circle", id: "c" }]), /objects\[0\]\.type|objects\[0\]/);
});

test("missing or wrong version gives out-of-sync message", () => {
  rejects({ objects: [] }, /version mismatch.*out of sync/i);
  rejects(scene([], 2), /version mismatch.*out of sync/i);
  rejects(scene([], "1"), /version mismatch/i);
});

test("non-object input fails", () => {
  rejects(null, /expected an object/);
  rejects([], /expected an object/);
  rejects("scene", /expected an object/);
});

test("duplicate ids fail and name the second object", () => {
  rejects(scene([marker(), label({ id: "m1" })]), /objects\[1\]\.id: duplicate id "m1"/);
});

test("too many objects fail", () => {
  const many = Array.from({ length: 501 }, (_, i) => marker({ id: `m${i}` }));
  rejects(scene(many), /objects/);
  parseScene(scene(many.slice(0, 500)));
});

test("polygon ring with fewer than 3 points fails", () => {
  rejects(scene([polygon({ polygons: [[[[0, 0], [1, 1]]]] })]), /objects\[0\]\.polygons\[0\]\[0\]/);
});

test("polygon with too many points fails (counted over all polygons and rings)", () => {
  const ring = (n: number) => Array.from({ length: n }, (_, i) => [i % 180, (i % 90)]);
  parseScene(scene([polygon({ polygons: [[ring(50_000)], [ring(50_000)]] })]));
  rejects(scene([polygon({ polygons: [[ring(50_000)], [ring(50_001)]] })]), /objects\[0\]\.polygons: too many points/);
});

test("empty polygon list / path with 1 point fail", () => {
  rejects(scene([polygon({ polygons: [] })]), /objects\[0\]\.polygons/);
  rejects(scene([path({ coordinates: [[0, 0]] })]), /objects\[0\]\.coordinates/);
});

test("range limits: opacity, size, width, fontSize, borderWidth, text", () => {
  rejects(scene([marker({ opacity: 1.5 })]), /opacity/);
  rejects(scene([marker({ size: 50 })]), /size/);
  rejects(scene([path({ width: 100 })]), /width/);
  rejects(scene([label({ fontSize: 500 })]), /fontSize/);
  rejects(scene([label({ fontWeight: "ultra" })]), /fontWeight/);
  rejects(scene([label({ text: "" })]), /text/);
  rejects(scene([polygon({ borderWidth: 99 })]), /borderWidth/);
  parseScene(scene([label({ fontWeight: "700" }), label({ id: "l2", fontWeight: "bold" })]));
});

test("a required field that is absent fails (no silent defaults)", () => {
  const noColor: Record<string, unknown> = marker();
  delete noColor.color;
  rejects(scene([noColor]), /objects\[0\]\.color/);
});

test("message lists at most 5 problems and counts the rest", () => {
  const bad = Array.from({ length: 8 }, (_, i) => marker({ id: `m${i}`, color: "bad" }));
  try {
    parseScene(scene(bad));
    assert.fail("should throw");
  } catch (e) {
    assert.ok(e instanceof SceneValidationError);
    assert.equal(e.message.split("; ").length, 5);
    assert.match(e.message, /\(\+3 more\)/);
    assert.equal(e.problems.length, 8);
  }
});
