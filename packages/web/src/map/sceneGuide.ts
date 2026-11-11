/** Best-effort line from the assistant narrative that mentions this place. */
export function snippetForPlace(placeName: string, narrative: string, maxLen = 220): string {
  const text = narrative.trim();
  if (!text) return "";
  const lowerName = placeName.toLowerCase();
  const sentences = text.split(/\n+|(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const match = sentences.find((s) => s.toLowerCase().includes(lowerName));
  const chosen = match ?? text;
  return chosen.length > maxLen ? `${chosen.slice(0, maxLen - 1)}…` : chosen;
}
