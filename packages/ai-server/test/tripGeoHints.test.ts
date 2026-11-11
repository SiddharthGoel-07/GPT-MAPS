import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { cityHintForVagueName, dominantCityHint, parseCityHintFromStop } from "../src/tripGeoHints.js";
import { inferGeoHint, qualifyPlaceForGeocoding } from "../src/tripMapSanitize.js";

describe("tripGeoHints", () => {
  test("parseCityHintFromStop", () => {
    assert.deepEqual(parseCityHintFromStop("Hotel Sagar, Noida, Uttar Pradesh, India"), {
      city: "Noida",
      suffix: "Noida, Uttar Pradesh, India",
    });
  });

  test("dominantCityHint picks the day’s main city", () => {
    const stops = [
      "Shri Digambar Jain Temple, Noida, Uttar Pradesh, India",
      "The Great India Place Mall, Noida, Uttar Pradesh, India",
      "Hotel Sagar, Noida, Uttar Pradesh, India",
    ];
    assert.equal(dominantCityHint(stops), "Noida, Uttar Pradesh, India");
  });

  test("cityHintForVagueName uses Shamli in the place name", () => {
    const stops = ["Shamli Railway Station, Shamli, Uttar Pradesh, India"];
    assert.equal(cityHintForVagueName("Shamli Bus Stand", stops, 0), "Shamli, Uttar Pradesh, India");
  });
});

describe("qualifyPlaceForGeocoding (NCR)", () => {
  test("vague mall name inherits Noida from siblings, not Delhi", () => {
    const stops = [
      "Shri Digambar Jain Temple, Noida, Uttar Pradesh, India",
      "The Great India Place Mall, Noida, Uttar Pradesh, India",
    ];
    const hint = inferGeoHint(stops, "Shamli → Noida 2-day tour");
    assert.equal(
      qualifyPlaceForGeocoding("City Mall", hint, stops, "Day in Noida", 1),
      "City Mall, Noida, Uttar Pradesh, India"
    );
  });
});
