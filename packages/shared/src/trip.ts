import * as z from "zod/v4";

import { sceneSchema } from "./scene.js";

export const tripSectionSchema = z.object({
  message: z.string().min(1),
  scene: sceneSchema,
});

export const tripDaySectionSchema = tripSectionSchema.extend({
  day: z.number().int().min(1).max(30),
  title: z.string().min(1).max(200),
});

export const budgetLineSchema = z.object({
  category: z.string().min(1).max(100),
  amount: z.string().min(1).max(80),
  note: z.string().max(300).optional(),
});

export const budgetDayTotalSchema = z.object({
  day: z.number().int().min(1).max(30),
  amount: z.string().min(1).max(80),
});

export const budgetBreakdownSchema = z.object({
  totalBudget: z.string().max(80).optional(),
  currency: z.string().max(20).optional(),
  items: z.array(budgetLineSchema).max(30),
  dailyTotals: z.array(budgetDayTotalSchema).max(30).optional(),
});

export const tripPlanResponseSchema = z.object({
  tripTitle: z.string().min(1).max(300),
  budgetSummary: z.string().optional(),
  budgetBreakdown: budgetBreakdownSchema.optional(),
  overview: tripSectionSchema,
  days: z.array(tripDaySectionSchema).min(1).max(30),
});

export const tripFollowUpResponseSchema = z.object({
  message: z.string().min(1),
  scene: sceneSchema,
  /** When refining a day tab, an updated short title. */
  title: z.string().min(1).max(200).optional(),
});

export type TripSection = z.infer<typeof tripSectionSchema>;
export type TripDaySection = z.infer<typeof tripDaySectionSchema>;
export type BudgetBreakdown = z.infer<typeof budgetBreakdownSchema>;
export type BudgetLine = z.infer<typeof budgetLineSchema>;
export type TripPlanResponse = z.infer<typeof tripPlanResponseSchema>;
export type TripFollowUpResponse = z.infer<typeof tripFollowUpResponseSchema>;

export class TripPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TripPlanValidationError";
  }
}

export function parseTripFollowUpResponse(input: unknown): TripFollowUpResponse {
  const result = tripFollowUpResponseSchema.safeParse(input);
  if (result.success) return result.data;
  const msg = result.error.issues.map((i) => i.message).join("; ");
  throw new TripPlanValidationError(`Invalid trip follow-up: ${msg}`);
}

export function parseTripPlanResponse(input: unknown): TripPlanResponse {
  const result = tripPlanResponseSchema.safeParse(input);
  if (result.success) return result.data;
  const msg = result.error.issues.map((i) => i.message).join("; ");
  throw new TripPlanValidationError(`Invalid trip plan: ${msg}`);
}
