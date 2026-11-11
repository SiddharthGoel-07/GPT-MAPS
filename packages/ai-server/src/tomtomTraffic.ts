import type { ServerResponse } from "node:http";

const FLOW_SEGMENT_BASE =
  "https://api.tomtom.com/traffic/services/4/flowSegmentData/relative/10/json";

export function readTomTomApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = env.TOMTOM_API_KEY?.trim();
  return key && key.length > 0 ? key : undefined;
}

export async function proxyTrafficTile(
  res: ServerResponse,
  z: string,
  x: string,
  y: string,
  apiKey: string
): Promise<void> {
  const url = `https://api.tomtom.com/traffic/map/4/tile/flow/relative/${z}/${x}/${y}.png?key=${encodeURIComponent(apiKey)}`;
  const upstream = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!upstream.ok) {
    res.writeHead(upstream.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "TomTom traffic tile unavailable" }));
    return;
  }
  const body = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(200, {
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=60",
  });
  res.end(body);
}

type FlowBody = {
  flowSegmentData?: {
    currentSpeed?: number;
    freeFlowSpeed?: number;
    confidence?: number;
  };
};

/** Blue = free flow → red = heavy traffic (Google-like). */
export function congestionColor(currentSpeed: number, freeFlowSpeed: number): string {
  if (!Number.isFinite(freeFlowSpeed) || freeFlowSpeed <= 0) return "#2563eb";
  const ratio = Math.min(1, Math.max(0, currentSpeed / freeFlowSpeed));
  if (ratio >= 0.85) return "#1d4ed8";
  if (ratio >= 0.7) return "#3b82f6";
  if (ratio >= 0.55) return "#60a5fa";
  if (ratio >= 0.4) return "#f97316";
  if (ratio >= 0.25) return "#ef4444";
  return "#b91c1c";
}

async function flowAtPoint(lat: number, lon: number, apiKey: string): Promise<FlowBody["flowSegmentData"] | null> {
  const url = `${FLOW_SEGMENT_BASE}?point=${encodeURIComponent(`${lat},${lon}`)}&unit=KMPH&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) return null;
  const data = (await res.json()) as FlowBody;
  return data.flowSegmentData ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function sampleCoordinates(coords: [number, number][], maxSamples: number): [number, number][] {
  if (coords.length <= maxSamples) return coords;
  const picked: [number, number][] = [];
  for (let i = 0; i < maxSamples; i++) {
    const index = Math.round((i / (maxSamples - 1)) * (coords.length - 1));
    picked.push(coords[index]!);
  }
  return picked;
}

export type TrafficPathInput = {
  id: string;
  coordinates: [number, number][];
};

export type TrafficPathSegment = {
  pathId: string;
  coordinates: [number, number][];
  color: string;
};

const MAX_PATHS = 12;
const MAX_SAMPLES = 10;

export async function buildTrafficPathSegments(
  paths: TrafficPathInput[],
  apiKey: string
): Promise<TrafficPathSegment[]> {
  const segments: TrafficPathSegment[] = [];
  const limited = paths.slice(0, MAX_PATHS);

  for (const path of limited) {
    if (path.coordinates.length < 2) continue;
    const samples = sampleCoordinates(path.coordinates, MAX_SAMPLES);
    const colors: string[] = [];

    for (const [lon, lat] of samples) {
      try {
        const flow = await flowAtPoint(lat, lon, apiKey);
        const cur = flow?.currentSpeed ?? 0;
        const free = flow?.freeFlowSpeed ?? (cur || 1);
        colors.push(congestionColor(cur, free));
      } catch {
        colors.push("#6b7280");
      }
      await sleep(40);
    }

    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i]!;
      const b = samples[i + 1]!;
      segments.push({
        pathId: path.id,
        coordinates: [a, b],
        color: colors[i] ?? "#2563eb",
      });
    }
  }

  return segments;
}
