import type { LngLat, Scene } from "@map-renderer/shared";
import * as maplibregl from "maplibre-gl";

import { polygonCentroid } from "../map/polygonCentroid.js";
import { fetchCurrentWeather, type WeatherReading } from "../weather/weatherClient.js";
import { wmoToEmoji, wmoToLabel } from "../weather/wmoEmoji.js";

const MAX_TARGETS = 30;

export type WeatherStatus = {
  enabled: boolean;
  loading: boolean;
  updatedAt: number | null;
  targetCount: number;
};

type Target = {
  id: string;
  name: string;
  position: LngLat;
  kind: "marker" | "region";
};

type OverlayRow = {
  target: Target;
  marker: maplibregl.Marker;
  element: HTMLDivElement;
};

export class WeatherOverlay {
  private readonly rows: OverlayRow[] = [];
  private readonly readings = new Map<string, WeatherReading>();
  private enabled = false;
  private loading = false;
  private updatedAt: number | null = null;
  private fetchGen = 0;
  private abort: AbortController | null = null;

  constructor(
    private readonly map: maplibregl.Map,
    private readonly onStatus: (status: WeatherStatus) => void
  ) {}

  private emit(): void {
    this.onStatus({
      enabled: this.enabled,
      loading: this.loading,
      updatedAt: this.updatedAt,
      targetCount: this.rows.length,
    });
  }

  public setEnabled(on: boolean, scene: Scene | null): void {
    this.enabled = on;
    if (!on) {
      this.abort?.abort();
      this.clear();
      this.emit();
      return;
    }
    if (scene) void this.sync(scene);
    else this.emit();
  }

  public clear(): void {
    this.abort?.abort();
    this.abort = null;
    for (const row of this.rows) row.marker.remove();
    this.rows.length = 0;
    this.readings.clear();
    this.loading = false;
    this.updatedAt = null;
  }

  public destroy(): void {
    this.enabled = false;
    this.clear();
  }

  public getReading(targetId: string): WeatherReading | undefined {
    return this.readings.get(targetId);
  }

  public formatPopupBlock(_name: string, targetId: string): string {
    const r = this.readings.get(targetId);
    if (!r || r.weatherCode < 0) return "";
    const emoji = wmoToEmoji(r.weatherCode);
    const label = wmoToLabel(r.weatherCode);
    const ago = formatAgo(r.fetchedAt);
    return (
      `<div style="margin-top:10px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:13px;line-height:1.45">` +
      `<strong>Now</strong> · ${emoji} ${escapeHtml(label)}<br>` +
      `${r.temperature}°C · 💨 ${r.windSpeed} km/h<br>` +
      `<span style="color:#6b7280;font-size:12px">Updated ${escapeHtml(ago)}</span>` +
      `</div>`
    );
  }

  private targetsFromScene(scene: Scene): Target[] {
    const targets: Target[] = [];
    for (const object of scene.objects) {
      if (object.type === "marker") {
        targets.push({
          id: object.id,
          name: object.name,
          position: object.position,
          kind: "marker",
        });
      } else if (object.type === "polygon") {
        const position = polygonCentroid(object.polygons);
        if (!position) continue;
        targets.push({
          id: object.id,
          name: object.name,
          position,
          kind: "region",
        });
      }
    }
    return targets.slice(0, MAX_TARGETS);
  }

  public async sync(scene: Scene): Promise<void> {
    if (!this.enabled) return;

    this.abort?.abort();
    const controller = new AbortController();
    this.abort = controller;
    const gen = ++this.fetchGen;

    const targets = this.targetsFromScene(scene);
    this.clear();
    this.enabled = true;
    this.loading = true;
    this.emit();

    for (const target of targets) {
      const element = document.createElement("div");
      element.className =
        target.kind === "region" ? "weather-badge weather-badge--region" : "weather-badge";
      element.classList.add("weather-badge--loading");
      element.textContent = "⏳";
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", `Loading weather for ${target.name}`);

      const offset: [number, number] = target.kind === "marker" ? [0, -44] : [0, 0];
      const marker = new maplibregl.Marker({ element, anchor: "bottom" })
        .setLngLat(target.position)
        .setOffset(offset)
        .addTo(this.map);

      this.rows.push({ target, marker, element });
    }

    if (targets.length === 0) {
      this.loading = false;
      this.emit();
      return;
    }

    try {
      const points = targets.map((t) => ({ lat: t.position[1], lon: t.position[0] }));
      const readings = await fetchCurrentWeather(points, controller.signal);
      if (gen !== this.fetchGen || controller.signal.aborted) return;

      readings.forEach((reading, i) => {
        const row = this.rows[i];
        if (!row) return;
        this.readings.set(row.target.id, reading);
        this.paintBadge(row.element, row.target, reading);
      });

      this.updatedAt = Date.now();
      this.loading = false;
      this.emit();
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn("Weather fetch failed", error);
      for (const row of this.rows) {
        row.element.classList.remove("weather-badge--loading");
        row.element.innerHTML = `<span aria-hidden="true">⚠️</span> <span>--°</span>`;
        row.element.setAttribute("aria-label", `Weather unavailable for ${row.target.name}`);
        row.element.title = "Weather unavailable";
      }
      this.loading = false;
      this.emit();
    }
  }

  private paintBadge(element: HTMLDivElement, target: Target, reading: WeatherReading): void {
    const emoji = wmoToEmoji(reading.weatherCode);
    const temp = `${reading.temperature}°`;
    const label = wmoToLabel(reading.weatherCode);
    element.classList.remove("weather-badge--loading");
    element.innerHTML = `<span class="weather-badge-emoji" aria-hidden="true">${emoji}</span>` +
      `<span class="weather-badge-temp">${temp}</span>`;
    element.setAttribute(
      "aria-label",
      `${target.name}: ${label}, ${reading.temperature} degrees Celsius`
    );
    element.title = `${target.name} · ${label} · ${reading.temperature}°C`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatAgo(ms: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} min ago`;
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
