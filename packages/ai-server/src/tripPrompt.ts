export const TRIP_JSON_SYSTEM_PROMPT = `You are a travel planner for India and worldwide destinations.
Given a user trip request (duration, origin, destination, travelers, budget, preferences), produce a practical itinerary.

Reply with ONLY valid JSON (no markdown fences) matching this shape:
{
  "tripTitle": "short title",
  "budgetSummary": "1-2 sentences on how the plan fits the stated budget",
  "budgetBreakdown": {
    "totalBudget": "e.g. ₹1,00,000",
    "currency": "INR",
    "items": [
      {"category": "Transport", "amount": "₹25,000", "note": "optional"},
      {"category": "Stay", "amount": "₹40,000"}
    ],
    "dailyTotals": [{"day": 1, "amount": "₹18,000"}]
  },
  "overview": {
    "summary": "2-4 paragraph overview of the whole trip",
    "places": ["place names to highlight on an overview map, in visit order"],
    "routes": [{"start": "place A", "end": "place B"}]
  },
  "days": [
    {
      "day": 1,
      "title": "short day title",
      "narrative": "detailed plan for the day: morning/afternoon/evening, stays, food, transport, rough costs",
      "places": ["places visited this day only"],
      "routes": [{"start": "A", "end": "B"}]
    }
  ]
}

Rules:
- Number of days must match what the user asked for (default 3 if unspecified).
- Use real place names geocodable on OpenStreetMap (cities, landmarks, stations).
- routes connect consecutive stops; for a single-city day, routes may be empty.
- Respect budget and party size in narrative and budgetSummary.
- Be specific and actionable, not generic filler.
- budgetBreakdown.items must cover the main cost categories and sum roughly to totalBudget when given.
- dailyTotals should have one entry per trip day when budget is specified.`;

export const TRIP_FOLLOWUP_SYSTEM_PROMPT = `You refine ONE section of an existing trip plan based on the user's follow-up message.
Reply with ONLY valid JSON:
{
  "narrative": "updated full text for this section (not a diff)",
  "title": "optional new short day title when section is a day",
  "places": ["complete list for the map for THIS section only"],
  "routes": [{"start": "A", "end": "B"}]
}

Keep geocodable place names. Include every stop still relevant plus any new ones. routes may be [].`;

export type TripRoutePair = { start: string; end: string };

export interface TripOverviewDraft {
  summary: string;
  places: string[];
  routes: TripRoutePair[];
}

export interface TripDayDraft {
  day: number;
  title: string;
  narrative: string;
  places: string[];
  routes: TripRoutePair[];
}

export interface TripBudgetLine {
  category: string;
  amount: string;
  note?: string;
}

export interface TripBudgetBreakdownDraft {
  totalBudget?: string;
  currency?: string;
  items: TripBudgetLine[];
  dailyTotals?: Array<{ day: number; amount: string }>;
}

export interface TripPlanDraft {
  tripTitle: string;
  budgetSummary?: string;
  budgetBreakdown?: TripBudgetBreakdownDraft;
  overview: TripOverviewDraft;
  days: TripDayDraft[];
}
