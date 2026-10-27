/*
 * One definition of "valid color", shared by the server (sanitising model
 * input) and the scene schema (validating what crosses the wire).
 */

const NAMED_COLORS = new Set([
  "black", "white", "red", "green", "blue", "yellow", "orange", "purple",
  "pink", "brown", "gray", "grey", "cyan", "magenta", "teal", "navy",
  "maroon", "olive", "lime", "aqua", "silver", "gold", "indigo", "violet",
  "crimson", "coral", "salmon", "turquoise", "darkgreen", "darkblue",
  "darkred", "lightblue", "lightgreen", "transparent",
]);

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC_COLOR = /^(?:rgb|rgba|hsl|hsla)\([0-9.,%\s/-]+\)$/i;

export function isValidColor(value: string): boolean {
  const v = value.trim();
  return HEX_COLOR.test(v) || FUNC_COLOR.test(v) || NAMED_COLORS.has(v.toLowerCase());
}
