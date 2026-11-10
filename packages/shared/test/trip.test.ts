import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SCENE_VERSION, emptyScene, parseTripPlanResponse } from "../src/index.ts";

describe("parseTripPlanResponse", () => {
  it("accepts budget breakdown when present", () => {
    const scene = emptyScene();
    const plan = parseTripPlanResponse({
      tripTitle: "Budget trip",
      budgetBreakdown: {
        totalBudget: "₹1,00,000",
        items: [{ category: "Stay", amount: "₹40,000" }],
      },
      overview: { message: "Summary", scene },
      days: [{ day: 1, title: "Day 1", message: "Day one", scene }],
    });
    assert.equal(plan.budgetBreakdown?.items.length, 1);
  });

  it("accepts a minimal valid trip plan", () => {
    const scene = emptyScene();
    const plan = parseTripPlanResponse({
      tripTitle: "Pune to Mumbai",
      overview: { message: "Summary", scene },
      days: [{ day: 1, title: "Depart", message: "Day one", scene }],
    });
    assert.equal(plan.tripTitle, "Pune to Mumbai");
    assert.equal(plan.days.length, 1);
    assert.equal(plan.overview.scene.version, SCENE_VERSION);
  });
});
