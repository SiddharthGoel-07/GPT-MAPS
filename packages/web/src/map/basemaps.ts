import type { StyleSpecification } from "maplibre-gl";

export type BasemapMode = "light" | "satellite";

export const LIGHT_BASEMAP_STYLE =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

/** Esri World Imagery — no API key; attribution required in production UIs. */
export const SATELLITE_BASEMAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    satellite: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© Esri",
    },
  },
  layers: [
    {
      id: "satellite",
      type: "raster",
      source: "satellite",
    },
  ],
};

export function styleForBasemap(mode: BasemapMode): string | StyleSpecification {
  return mode === "light" ? LIGHT_BASEMAP_STYLE : SATELLITE_BASEMAP_STYLE;
}
