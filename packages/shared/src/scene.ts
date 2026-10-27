import * as z from "zod/v4";
import { isValidColor } from "./colors.js";

/*
 * The scene wire format. This file is the single source of truth: the server
 * builds and validates scenes with it, the web app validates what it receives
 * with it. All fields are required (no silent defaults); unknown extra keys
 * are stripped.
 */

export const SCENE_VERSION = 1;
export const MAX_SCENE_WIRE_OBJECTS = 500;
/** Hard ceiling on the total points of one polygon object (all polygons and rings). */
export const MAX_POLYGON_POINTS = 100_000;

/** [longitude, latitude] (GeoJSON order). */
const lngLat = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

const color = z.string().refine(isValidColor, { message: "not a valid color" });
const opacity = z.number().min(0).max(1);
const name = z.string().max(300);
const id = z.string().min(1).max(100);

const fontWeight = z.union([
  z.enum(["normal", "bold", "lighter", "bolder"]),
  z.string().regex(/^[1-9]00$/, "not a valid font weight"),
]);

const ring = z.array(lngLat).min(3);

export const markerSchema = z.object({
  type: z.literal("marker"),
  id,
  name,
  position: lngLat,
  color,
  opacity,
  size: z.number().min(0.1).max(3),
});

export const labelSchema = z.object({
  type: z.literal("label"),
  id,
  name,
  position: lngLat,
  text: z.string().min(1).max(200),
  color,
  opacity,
  fontSize: z.number().min(6).max(72),
  fontWeight,
  backgroundColor: color.optional(),
});

export const pathSchema = z.object({
  type: z.literal("path"),
  id,
  name,
  coordinates: z.array(lngLat).min(2).max(50_000),
  color,
  opacity,
  width: z.number().min(0.5).max(20),
  dash: z.boolean(),
});

export const polygonSchema = z.object({
  type: z.literal("polygon"),
  id,
  name,
  /** GeoJSON MultiPolygon layout: polygons[i] = [outerRing, ...holes]. */
  polygons: z.array(z.array(ring).min(1)).min(1),
  fillColor: color,
  fillOpacity: opacity,
  borderColor: color.optional(),
  /** 0 = no border. */
  borderWidth: z.number().min(0).max(20),
  borderDash: z.boolean(),
});

export const sceneObjectSchema = z.discriminatedUnion("type", [
  markerSchema,
  labelSchema,
  pathSchema,
  polygonSchema,
]);

export const sceneSchema = z
  .object({
    version: z.literal(SCENE_VERSION),
    objects: z.array(sceneObjectSchema).max(MAX_SCENE_WIRE_OBJECTS),
  })
  .superRefine((scene, ctx) => {
    const seen = new Set<string>();
    scene.objects.forEach((o, i) => {
      if (seen.has(o.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["objects", i, "id"],
          message: `duplicate id "${o.id}"`,
        });
      }
      seen.add(o.id);

      if (o.type === "polygon") {
        let points = 0;
        for (const rings of o.polygons) for (const r of rings) points += r.length;
        if (points > MAX_POLYGON_POINTS) {
          ctx.addIssue({
            code: "custom",
            path: ["objects", i, "polygons"],
            message: `too many points (${points}; the limit is ${MAX_POLYGON_POINTS})`,
          });
        }
      }
    });
  });

export type LngLat = z.infer<typeof lngLat>;
export type MarkerObject = z.infer<typeof markerSchema>;
export type LabelObject = z.infer<typeof labelSchema>;
export type PathObject = z.infer<typeof pathSchema>;
export type PolygonObject = z.infer<typeof polygonSchema>;
export type SceneObject = z.infer<typeof sceneObjectSchema>;
export type Scene = z.infer<typeof sceneSchema>;

export class SceneValidationError extends Error {
  public readonly problems: readonly string[];

  constructor(problems: readonly string[], message: string) {
    super(message);
    this.name = "SceneValidationError";
    this.problems = problems;
  }
}

const MAX_REPORTED_PROBLEMS = 5;

function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const part of path) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out === "" ? String(part) : `.${String(part)}`;
  }
  return out === "" ? "(scene)" : out;
}

export function emptyScene(): Scene {
  return { version: SCENE_VERSION, objects: [] };
}

/** Validates unknown input and returns a clean Scene, or throws SceneValidationError. */
export function parseScene(input: unknown): Scene {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new SceneValidationError(["(scene): expected an object"], "Invalid scene: expected an object.");
  }

  const version = (input as { version?: unknown }).version;
  if (version !== SCENE_VERSION) {
    const got = version === undefined ? "missing" : JSON.stringify(version);
    throw new SceneValidationError(
      [`version: expected ${SCENE_VERSION}, got ${got}`],
      `Scene version mismatch (expected ${SCENE_VERSION}, got ${got}). The server and web are out of sync.`
    );
  }

  const result = sceneSchema.safeParse(input);
  if (result.success) return result.data;

  const all = result.error.issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`);
  const shown = all.slice(0, MAX_REPORTED_PROBLEMS);
  const more = all.length > shown.length ? ` (+${all.length - shown.length} more)` : "";
  throw new SceneValidationError(all, `Invalid scene: ${shown.join("; ")}${more}`);
}
