import { test } from "node:test";
import assert from "node:assert/strict";
import type { PathObject } from "@map-renderer/shared";
import { routeCaptionText } from "../src/map/pathLabels.ts";

const base: PathObject = {
  type: "path",
  id: "p",
  name: "p",
  coordinates: [
    [77, 28],
    [78, 29],
  ],
  color: "blue",
  opacity: 1,
  width: 4,
  dash: false,
};

test("routeCaptionText includes distance and duration for road paths", () => {
  const text = routeCaptionText({
    ...base,
    distanceMeters: 142_000,
    durationSeconds: 7_800,
  });
  assert.match(text!, /142.*km/);
  assert.match(text!, /~2 h 10 min/);
});

test("routeCaptionText marks dashed paths as direct", () => {
  const text = routeCaptionText({
    ...base,
    distanceMeters: 87_000,
    dash: true,
  });
  assert.match(text!, /87.*km/);
  assert.match(text!, /direct/);
});
