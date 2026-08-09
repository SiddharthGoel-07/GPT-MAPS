import { MapRenderer } from "./renderer/MapRenderer.js";

export const RendererContext: {
	renderer: MapRenderer | null;
} = {
	renderer: null,
};