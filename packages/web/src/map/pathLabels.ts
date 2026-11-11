import type { PathObject } from "@map-renderer/shared";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  pathMidpoint,
  polylineLengthMeters,
} from "@map-renderer/shared";

export function routeCaptionText(path: PathObject): string | null {
  const meters = path.distanceMeters ?? polylineLengthMeters(path.coordinates);
  const dist = formatDistanceMeters(meters);
  if (!dist) return null;

  if (path.dash) {
    return `${dist} · direct`;
  }

  if (path.durationSeconds != null && path.durationSeconds > 0) {
    const dur = formatDurationSeconds(path.durationSeconds);
    if (dur) return `${dist} · ~${dur}`;
  }

  return dist;
}

export function routeLabelForPath(path: PathObject): {
  position: [number, number];
  text: string;
} | null {
  const text = routeCaptionText(path);
  const position = pathMidpoint(path.coordinates);
  if (!text || !position) return null;
  return { position, text };
}
