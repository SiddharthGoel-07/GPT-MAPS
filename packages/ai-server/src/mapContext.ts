/*
 * What the model is told about a map that already exists (B5), and the short
 * progress texts shown to the user (F1). Both are pure functions of data.
 */

const MAX_NAMES_PER_KIND = 30;
const MAX_NAME_CHARS = 60;

type AnyObject = Record<string, unknown>;

const clip = (value: unknown): string => {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > MAX_NAME_CHARS ? `${text.slice(0, MAX_NAME_CHARS - 1)}…` : text;
};

function list(names: string[]): string {
  const unique = [...new Set(names.filter((n) => n.length > 0))];
  const shown = unique.slice(0, MAX_NAMES_PER_KIND).map((n) => `"${n}"`);
  const more = unique.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}

/** One line per kind of object. Empty string when the map is empty. */
export function describeMap(objects: ReadonlyArray<AnyObject>): string {
  const markers: string[] = [];
  const paths: string[] = [];
  const areas: string[] = [];
  const labels: string[] = [];

  for (const o of objects) {
    const name = clip(o.name);
    switch (o.type) {
      case "marker":
        markers.push(name);
        break;
      case "path":
        paths.push(name);
        break;
      case "polygon":
        areas.push(name);
        break;
      case "label": {
        const text = clip(o.text);
        // The automatic name label of a marker adds nothing to the summary.
        if (text && text !== name) labels.push(`"${text}" at "${name}"`);
        break;
      }
    }
  }

  const lines: string[] = [];
  if (markers.length > 0) lines.push(`Markers: ${list(markers)}`);
  if (paths.length > 0) lines.push(`Paths: ${list(paths)}`);
  if (areas.length > 0) lines.push(`Highlighted areas: ${list(areas)}`);
  if (labels.length > 0) lines.push(`Custom labels: ${labels.slice(0, MAX_NAMES_PER_KIND).join(", ")}`);
  return lines.join("\n");
}

/** The user's message, with the existing map in front when there is one. */
export function withMapContext(prompt: string, mapSummary: string): string {
  if (mapSummary === "") return prompt;
  return (
    "[The map already contains these objects, and they stay unless you remove them:\n" +
    `${mapSummary}\n` +
    "Only add or change what the new request asks for; do not recreate existing objects. " +
    "Use removeObject to delete something and clearScene to start over.]\n\n" +
    `User request: ${prompt}`
  );
}

function arg(args: Record<string, unknown>, key: string): string {
  return clip(args[key]);
}

/** Human-readable progress line for a tool call, or null if nothing should be shown. */
export function describeToolCall(name: string, args: Record<string, unknown>): string | null {
  switch (name) {
    case "createMarker":
      return `Finding ${arg(args, "location") || "the place"}…`;
    case "createLabel":
      return `Labelling ${arg(args, "location") || "the place"}…`;
    case "createPath":
      return `Finding a route from ${arg(args, "start") || "the start"} to ${arg(args, "end") || "the end"}…`;
    case "createPolygon":
      return `Fetching the boundary of ${arg(args, "location") || "the area"}…`;
    case "removeObject":
      return `Removing ${arg(args, "name") || "an object"}…`;
    case "clearScene":
      return "Clearing the map…";
    case "renderScene":
      return null;
    default:
      return `Working (${clip(name)})…`;
  }
}
