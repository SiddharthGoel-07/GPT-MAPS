import type { Scene } from "@map-renderer/shared";
import { parseScene } from "@map-renderer/shared";

import type { CallContext } from "./chatLoop.js";
import type { ChatLimits } from "./config.js";
import { ChatError, deadlineError } from "./errors.js";
import type { McpLike } from "./chatLoop.js";
import { validatePrompt } from "./chatLoop.js";
import type { JsonLlm } from "./groq.js";
import { budgetBreakdownSchema, type BudgetBreakdown } from "@map-renderer/shared";
import { TRIP_FOLLOWUP_SYSTEM_PROMPT, TRIP_JSON_SYSTEM_PROMPT, type TripDayDraft, type TripPlanDraft } from "./tripPrompt.js";

export interface TripPlanResult {
  tripTitle: string;
  budgetSummary?: string;
  budgetBreakdown?: BudgetBreakdown;
  overview: { message: string; scene: Scene };
  days: Array<{ day: number; title: string; message: string; scene: Scene }>;
}

export interface TripFollowUpInput {
  prompt: string;
  tripTitle: string;
  section: "overview" | number;
  sectionTitle?: string | undefined;
  currentNarrative: string;
  history?: ReadonlyArray<{ role: "user" | "assistant"; content: string }> | undefined;
}

export interface TripFollowUpResult {
  message: string;
  scene: Scene;
  title?: string | undefined;
}

export interface RunTripPlannerOptions {
  prompt: string;
  llm: JsonLlm;
  mcp: McpLike;
  limits: ChatLimits;
  context: CallContext;
  onProgress?: (text: string) => void;
  log?: (message: string) => void;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? deadlineError();
}

function parseTripDraft(raw: string): TripPlanDraft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ChatError(502, "The trip planner returned unreadable JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ChatError(502, "The trip planner returned an invalid trip structure.");
  }
  const obj = parsed as Record<string, unknown>;
  const overview = obj.overview;
  const days = obj.days;
  if (
    typeof obj.tripTitle !== "string" ||
    typeof overview !== "object" ||
    overview === null ||
    !Array.isArray(days) ||
    days.length === 0
  ) {
    throw new ChatError(502, "The trip planner response is missing required fields.");
  }
  return obj as unknown as TripPlanDraft;
}

interface FollowUpDraft {
  narrative: string;
  title?: string;
  places: string[];
  routes: Array<{ start: string; end: string }>;
}

function parseFollowUpDraft(raw: string): FollowUpDraft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ChatError(502, "The trip assistant returned unreadable JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ChatError(502, "Invalid follow-up structure.");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.narrative !== "string" || !Array.isArray(obj.places)) {
    throw new ChatError(502, "Follow-up response is missing narrative or places.");
  }
  const routes = Array.isArray(obj.routes) ? (obj.routes as FollowUpDraft["routes"]) : [];
  return {
    narrative: obj.narrative.trim(),
    places: obj.places.filter((p): p is string => typeof p === "string"),
    routes,
    ...(typeof obj.title === "string" ? { title: obj.title.trim() } : {}),
  };
}

async function buildScene(
  mcp: McpLike,
  places: readonly string[],
  routes: readonly { start: string; end: string }[],
  signal: AbortSignal,
  log?: (m: string) => void
): Promise<Scene> {
  throwIfAborted(signal);
  await mcp.callTool("clearScene", {}, signal);

  for (const location of places) {
    throwIfAborted(signal);
    log?.(`[trip] marker: ${location}`);
    await mcp.callTool("createMarker", { location }, signal);
  }
  for (const route of routes) {
    throwIfAborted(signal);
    log?.(`[trip] path: ${route.start} → ${route.end}`);
    await mcp.callTool("createPath", { start: route.start, end: route.end }, signal);
  }

  const rendered = await mcp.callTool("renderScene", {}, signal);
  if (rendered.isError) {
    throw new ChatError(502, `Could not render trip map: ${rendered.text}`);
  }
  let wire: unknown;
  try {
    wire = JSON.parse(rendered.text);
  } catch {
    throw new ChatError(502, "The map server returned an unreadable scene for this trip section.");
  }
  return parseScene(wire);
}

function dayMessage(day: TripDayDraft): string {
  const header = `**Day ${day.day}: ${day.title}**\n\n`;
  return header + day.narrative.trim();
}

export async function runTripPlanner(options: RunTripPlannerOptions): Promise<TripPlanResult> {
  const { llm, mcp, limits, context } = options;
  const { signal } = context;
  const log = options.log ?? (() => undefined);
  const progress = (text: string): void => {
    try {
      options.onProgress?.(text);
    } catch {
      /* best effort */
    }
  };

  const prompt = validatePrompt(options.prompt, limits);

  progress("Planning your trip…");
  const rawJson = await llm.completeJson(
    [
      { role: "system", content: TRIP_JSON_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    context
  );
  const draft = parseTripDraft(rawJson);
  log(`[trip] "${draft.tripTitle}" — ${draft.days.length} day(s)`);

  progress("Building overview map…");
  const overviewScene = await buildScene(
    mcp,
    draft.overview.places ?? [],
    draft.overview.routes ?? [],
    signal,
    log
  );

  const days: TripPlanResult["days"] = [];
  for (const day of draft.days) {
    throwIfAborted(signal);
    progress(`Building map for day ${day.day}…`);
    const scene = await buildScene(mcp, day.places ?? [], day.routes ?? [], signal, log);
    days.push({
      day: day.day,
      title: day.title,
      message: dayMessage(day),
      scene,
    });
  }

  const budgetParsed = draft.budgetBreakdown
    ? budgetBreakdownSchema.safeParse(draft.budgetBreakdown)
    : undefined;
  const budgetBreakdown = budgetParsed?.success ? budgetParsed.data : undefined;

  return {
    tripTitle: draft.tripTitle,
    ...(draft.budgetSummary ? { budgetSummary: draft.budgetSummary } : {}),
    ...(budgetBreakdown ? { budgetBreakdown } : {}),
    overview: {
      message: draft.overview.summary.trim(),
      scene: overviewScene,
    },
    days,
  };
}

export async function runTripFollowUp(
  options: Omit<RunTripPlannerOptions, "prompt"> & { input: TripFollowUpInput }
): Promise<TripFollowUpResult> {
  const { llm, mcp, limits, context, input } = options;
  const { signal } = context;
  const log = options.log ?? (() => undefined);
  const progress = (text: string): void => {
    try {
      options.onProgress?.(text);
    } catch {
      /* best effort */
    }
  };

  const userPrompt = validatePrompt(input.prompt, limits);
  const sectionLabel =
    input.section === "overview"
      ? "overview"
      : `day ${input.section}${input.sectionTitle ? ` (${input.sectionTitle})` : ""}`;

  const contextBlock =
    `Trip: ${input.tripTitle}\nSection: ${sectionLabel}\n\nCurrent plan:\n${input.currentNarrative}`;

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: TRIP_FOLLOWUP_SYSTEM_PROMPT },
    ...(input.history ?? []).flatMap((m) =>
      m.role === "user" || m.role === "assistant" ? [{ role: m.role, content: m.content }] : []
    ),
    { role: "user", content: `${contextBlock}\n\nUser request: ${userPrompt}` },
  ];

  progress("Updating this section…");
  const rawJson = await llm.completeJson(messages, context);
  const draft = parseFollowUpDraft(rawJson);

  progress("Refreshing the map…");
  const scene = await buildScene(mcp, draft.places, draft.routes, signal, log);

  const message =
    input.section === "overview"
      ? draft.narrative
      : `**Day ${input.section}: ${draft.title ?? input.sectionTitle ?? "Updated"}**\n\n${draft.narrative}`;

  return {
    message,
    scene,
    ...(draft.title ? { title: draft.title } : {}),
  };
}
