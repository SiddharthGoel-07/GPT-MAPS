import { MAX_SCENE_WIRE_OBJECTS, isValidColor } from "@map-renderer/shared";
import type { RouteResult } from "./services/RoutingService.js";
import type { LabelObject, LngLat, MarkerObject, PathObject, PolygonObject } from "@map-renderer/shared";
import type { RequestContext } from "./RequestContext.js";

/*
 * Every rule about what a valid scene looks like lives HERE, in code, instead
 * of in the LLM prompt:
 *  - idempotency: the same feature added twice is added once
 *  - one label per physical spot (explicit text overrides auto text)
 *  - style values are clamped / sanitised so a bad value can never break the map
 *  - hard cap on scene size
 * All functions return a short text for the model describing what happened.
 */

const envInt = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// Never allow more than the wire format accepts, whatever the env says.
export const MAX_SCENE_OBJECTS = Math.min(envInt("MAX_SCENE_OBJECTS", 100), MAX_SCENE_WIRE_OBJECTS);
const MAX_LABEL_LENGTH = 80;
const MAX_NAME_LENGTH = 300;
const name = (value: string): string => value.slice(0, MAX_NAME_LENGTH);

/* ----------------------------- sanitising ------------------------------ */

function color(value: string | undefined, fallback: string, name: string, notes: string[]): string {
  if (value === undefined) return fallback;
  if (isValidColor(value)) return value.trim();
  notes.push(`${name} "${value}" is not a valid color, used ${fallback}`);
  return fallback;
}

function optionalColor(value: string | undefined, name: string, notes: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (isValidColor(value)) return value.trim();
  notes.push(`${name} "${value}" is not a valid color, ignored`);
  return undefined;
}

function clamp(value: number | undefined, min: number, max: number, name: string, notes: string[]): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) {
    notes.push(`${name} was not a number, ignored`);
    return undefined;
  }
  const clamped = Math.min(max, Math.max(min, value));
  if (clamped !== value) notes.push(`${name} ${value} adjusted to ${clamped}`);
  return clamped;
}

function labelText(text: string, notes: string[]): string {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (cleaned.length === 0) throw new Error("Label text must not be empty.");
  if (cleaned.length > MAX_LABEL_LENGTH) {
    notes.push(`label text shortened to ${MAX_LABEL_LENGTH} characters`);
    return cleaned.slice(0, MAX_LABEL_LENGTH);
  }
  return cleaned;
}

function fontWeight(value: string | undefined, notes: string[]): string | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (["normal", "bold", "lighter", "bolder"].includes(v) || /^[1-9]00$/.test(v)) return v;
  notes.push(`fontWeight "${value}" is not valid, ignored`);
  return undefined;
}

/* ------------------------------- helpers ------------------------------- */

const coordKey = (p: LngLat): string => `${p[1].toFixed(4)},${p[0].toFixed(4)}`;
const markerKey = (p: LngLat): string => `marker:${coordKey(p)}`;
const labelKey = (p: LngLat): string => `label:${coordKey(p)}`;
const pathKey = (a: LngLat, b: LngLat): string => `path:${coordKey(a)}->${coordKey(b)}`;
const polygonKey = (polygons: LngLat[][][]): string => {
  const ring = polygons[0]?.[0];
  const first = ring?.[0];
  return `polygon:${first ? coordKey(first) : "none"}:${ring?.length ?? 0}`;
};

function assertCapacity(ctx: RequestContext, adding: number): void {
  const current = ctx.count();
  if (current + adding > MAX_SCENE_OBJECTS) {
    throw new Error(
      `Scene limit reached (${MAX_SCENE_OBJECTS} objects). Nothing was added. Call renderScene now.`
    );
  }
}

function summary(ctx: RequestContext, parts: string[], notes: string[]): string {
  const adjusted = notes.length > 0 ? ` Adjusted: ${notes.join("; ")}.` : "";
  return `${parts.join(" ")}${adjusted} Scene now has ${ctx.count()} object(s).`;
}

/* -------------------------------- labels ------------------------------- */

export interface LabelStyleInput {
  color?: string | undefined;
  fontSize?: number | undefined;
  fontWeight?: string | undefined;
  opacity?: number | undefined;
  backgroundColor?: string | undefined;
}

type LabelPlan =
  | { action: "create"; key: string }
  | { action: "replace"; key: string; existingId: string }
  | { action: "keep"; key: string };

function planLabel(ctx: RequestContext, point: LngLat, text: string, explicit: boolean): LabelPlan {
  const key = labelKey(point);
  const existingId = ctx.keys.get(key);
  if (!existingId) return { action: "create", key };

  const existing = ctx.get(existingId);
  const sameText = existing?.type === "label" && existing.text === text;
  // Auto labels never overwrite anything; explicit text overrides unless identical.
  if (!explicit || sameText) return { action: "keep", key };
  return { action: "replace", key, existingId };
}

function applyLabel(
  ctx: RequestContext,
  plan: LabelPlan,
  point: LngLat,
  location: string,
  text: string,
  style: LabelStyleInput | undefined,
  notes: string[]
): void {
  if (plan.action === "keep") return;
  if (plan.action === "replace") ctx.remove(plan.existingId);

  const label: LabelObject = {
    type: "label",
    id: crypto.randomUUID(),
    name: name(location),
    position: point,
    text,
    color: color(style?.color, "#000000", "label color", notes),
    opacity: clamp(style?.opacity, 0, 1, "opacity", notes) ?? 1,
    fontSize: clamp(style?.fontSize, 8, 32, "fontSize", notes) ?? 14,
    fontWeight: fontWeight(style?.fontWeight, notes) ?? "normal",
  };
  const background = optionalColor(style?.backgroundColor, "backgroundColor", notes);
  if (background !== undefined) label.backgroundColor = background;
  ctx.add(label);
  ctx.keys.set(plan.key, label.id);
}

export function addLabel(
  ctx: RequestContext,
  location: string,
  point: LngLat,
  text: string,
  style?: LabelStyleInput
): string {
  const notes: string[] = [];
  const cleaned = labelText(text, notes);
  const plan = planLabel(ctx, point, cleaned, true);

  assertCapacity(ctx, plan.action === "create" ? 1 : 0);
  applyLabel(ctx, plan, point, location, cleaned, style, notes);

  const what =
    plan.action === "create" ? `Created label "${cleaned}".`
    : plan.action === "replace" ? `Updated the label at "${location}" to "${cleaned}".`
    : `A label "${cleaned}" already exists at "${location}"; nothing added.`;
  return summary(ctx, [what], notes);
}

/* ------------------------------- markers ------------------------------- */

export interface MarkerInput {
  style?: { color?: string | undefined; size?: number | undefined; opacity?: number | undefined } | undefined;
  label?: string | undefined;
  showLabel?: boolean | undefined;
}

export function addMarker(ctx: RequestContext, location: string, point: LngLat, input: MarkerInput): string {
  const notes: string[] = [];
  const key = markerKey(point);
  const markerExists = ctx.keys.has(key);

  let plan: LabelPlan | null = null;
  let text = "";
  if (input.showLabel !== false) {
    const explicit = input.label !== undefined;
    text = labelText(explicit ? (input.label as string) : location, notes);
    plan = planLabel(ctx, point, text, explicit);
  }

  const adding = (markerExists ? 0 : 1) + (plan?.action === "create" ? 1 : 0);
  assertCapacity(ctx, adding);

  const parts: string[] = [];
  if (markerExists) {
    parts.push(`Marker for "${location}" already exists; not duplicated.`);
  } else {
    const marker: MarkerObject = {
      type: "marker",
      id: crypto.randomUUID(),
      name: name(location),
      position: point,
      color: color(input.style?.color, "#ff0000", "marker color", notes),
      opacity: clamp(input.style?.opacity, 0, 1, "opacity", notes) ?? 1,
      size: clamp(input.style?.size, 0.4, 1.5, "size", notes) ?? 1,
    };
    ctx.add(marker);
    ctx.keys.set(key, marker.id);
    parts.push(`Created marker "${location}".`);
  }

  if (plan) {
    applyLabel(ctx, plan, point, location, text, undefined, notes);
    if (plan.action === "create") parts.push(`Added label "${text}".`);
    else if (plan.action === "replace") parts.push(`Updated label to "${text}".`);
  }
  return summary(ctx, parts, notes);
}

/* -------------------------------- paths -------------------------------- */

export function hasPath(ctx: RequestContext, start: LngLat, end: LngLat): boolean {
  return ctx.keys.has(pathKey(start, end));
}

export interface PathInput {
  color?: string | undefined;
  width?: number | undefined;
  opacity?: number | undefined;
  dash?: boolean | undefined;
}

export function addPath(
  ctx: RequestContext,
  startName: string,
  endName: string,
  start: LngLat,
  end: LngLat,
  route: RouteResult | null,
  style?: PathInput
): string {
  const notes: string[] = [];
  const key = pathKey(start, end);
  if (ctx.keys.has(key)) {
    return summary(ctx, [`Path ${startName} → ${endName} already exists; not duplicated.`], notes);
  }
  if (route === null) throw new Error("Internal error: route missing for a new path.");
  assertCapacity(ctx, 1);

  const path: PathObject = {
    type: "path",
    id: crypto.randomUUID(),
    name: name(`${startName} → ${endName}`),
    coordinates: route.coordinates,
    color: color(style?.color, "#0066ff", "path color", notes),
    opacity: clamp(style?.opacity, 0, 1, "opacity", notes) ?? 1,
    width: clamp(style?.width, 1, 8, "width", notes) ?? 4,
    // A straight line is not a road: dashed by default so it does not look like one.
    dash: style?.dash ?? route.straight,
  };
  if (route.straight) {
    notes.push(
      `No road route exists between ${startName} and ${endName} (for example across water), ` +
        "so a straight line was drawn instead of a driving route."
    );
  }
  ctx.add(path);
  ctx.keys.set(key, path.id);
  return summary(ctx, [`Created path ${startName} → ${endName}.`], notes);
}

/* ------------------------------- polygons ------------------------------ */

export interface PolygonInput {
  fillColor?: string | undefined;
  fillOpacity?: number | undefined;
  borderColor?: string | undefined;
  borderWidth?: number | undefined;
  borderDash?: boolean | undefined;
}

export function addPolygon(
  ctx: RequestContext,
  location: string,
  polygons: LngLat[][][],
  style?: PolygonInput
): string {
  const notes: string[] = [];
  const key = polygonKey(polygons);
  if (ctx.keys.has(key)) {
    return summary(ctx, [`Polygon for "${location}" already exists; not duplicated.`], notes);
  }
  assertCapacity(ctx, 1);

  const fillColor = color(style?.fillColor, "#00aa00", "fillColor", notes);
  const fillOpacity = clamp(style?.fillOpacity, 0, 1, "fillOpacity", notes) ?? 0.4;
  const borderColor = optionalColor(style?.borderColor, "borderColor", notes);
  const borderWidth = clamp(style?.borderWidth, 0, 10, "borderWidth", notes);

  // Border rule (kept from the old renderer): no border unless the model asked
  // for one; if it asked without giving a width, use 1.
  const borderRequested =
    borderColor !== undefined || borderWidth !== undefined || style?.borderDash !== undefined;

  const polygon: PolygonObject = {
    type: "polygon",
    id: crypto.randomUUID(),
    name: name(location),
    polygons,
    fillColor,
    fillOpacity,
    borderWidth: borderWidth ?? (borderRequested ? 1 : 0),
    borderDash: style?.borderDash ?? false,
  };
  if (borderColor !== undefined) polygon.borderColor = borderColor;
  ctx.add(polygon);
  ctx.keys.set(key, polygon.id);
  return summary(ctx, [`Created polygon "${location}".`], notes);
}
