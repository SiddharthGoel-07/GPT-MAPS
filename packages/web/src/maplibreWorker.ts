/*
 * MapLibre GL JS v6 loads its web worker as a separate bundle. Vite must emit
 * that worker and we must point MapLibre at it before any Map is constructed.
 */
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(workerUrl);
