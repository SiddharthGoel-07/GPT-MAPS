import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  polylineLengthMeters,
  samplePolyline,
} from "../src/geo.js";

test("formatDistanceMeters", () => {
  assert.equal(formatDistanceMeters(850), "850 m");
  assert.equal(formatDistanceMeters(8_450), "8.4 km");
  assert.equal(formatDistanceMeters(9_400), "9.4 km");
});

test("formatDurationSeconds", () => {
  assert.equal(formatDurationSeconds(45 * 60), "45 min");
  assert.equal(formatDurationSeconds(2 * 3600 + 10 * 60), "2 h 10 min");
  assert.equal(formatDurationSeconds(3 * 3600), "3 h");
});

test("samplePolyline keeps endpoints and caps count", () => {
  const coords = Array.from({ length: 100 }, (_, i) => [0, i] as [number, number]);
  const sampled = samplePolyline(coords, 5);
  assert.equal(sampled.length, 5);
  assert.deepEqual(sampled[0], [0, 0]);
  assert.deepEqual(sampled[4], [0, 99]);
});

test("polylineLengthMeters is sum of segments", () => {
  const len = polylineLengthMeters([
    [0, 0],
    [0, 0.01],
    [0, 0.02],
  ]);
  assert.ok(len > 2000 && len < 2500);
});
