import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  qualifyPlaceForGeocoding,
  sanitizeOverviewPlaces,
  sanitizePlaces,
  sanitizeTripRoutes,
} from "../src/tripMapSanitize.js";

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

describe("qualifyPlaceForGeocoding", () => {
  test("anchors spice plantation to Goa when trip is in Goa", () => {
    const stops = ["Mumbai CST", "Madgaon", "Calangute Beach"];
    assert.equal(
      qualifyPlaceForGeocoding("Spice Plantation", "India", stops),
      "Spice Plantation, Goa, India"
    );
  });

  test("City Palace resolves to Jaipur when day context mentions Jaipur", () => {
    const ctx = "Jaipur to Delhi: City Palace & Return";
    assert.equal(
      qualifyPlaceForGeocoding("City Palace", "Rajasthan, India", ["City Palace", "Jaipur Junction"], ctx),
      "City Palace, Jaipur, Rajasthan, India"
    );
  });

});

describe("sanitizeOverviewPlaces", () => {
  test("strips vague POIs from a long overview list", () => {
    const raw = [
      "Mumbai CST",
      "Madgaon Railway Station",
      "Baga Beach",
      "Dudhsagar Falls",
      "Spice Plantation",
      "Miramar Beach",
    ];
    assert.deepEqual(sanitizeOverviewPlaces(raw), ["Mumbai CST", "Madgaon Railway Station"]);
  });
});
