import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { sanitizePlaces, sanitizeTripRoutes } from "../src/tripMapSanitize.js";

describe("sanitizeTripRoutes", () => {
  test("drops non-adjacent LLM routes", () => {
    const places = ["Pune", "Lonavala", "Mumbai", "Goa"];
    const routes = [
      { start: "Russian Plantation", end: "Goa" },
      { start: "Pune", end: "Lonavala" },
    ];
    const out = sanitizeTripRoutes(places, routes);
    assert.deepEqual(out, [{ start: "Pune", end: "Lonavala" }]);
  });

  test("falls back to consecutive stops when routes are empty", () => {
    const places = ["Delhi", "Agra", "Jaipur"];
    assert.deepEqual(sanitizeTripRoutes(places, []), [
      { start: "Delhi", end: "Agra" },
      { start: "Agra", end: "Jaipur" },
    ]);
  });

  test("ignores routes whose endpoints are not in places", () => {
    const places = ["Goa", "Palolem Beach"];
    const routes = [{ start: "Russian Plantation", end: "Goa" }];
    assert.deepEqual(sanitizeTripRoutes(places, routes), [{ start: "Goa", end: "Palolem Beach" }]);
  });
});

describe("sanitizePlaces", () => {
  test("dedupes by normalized name", () => {
    assert.deepEqual(sanitizePlaces(["Goa", " goa ", "Goa"]), ["Goa"]);
  });
});
