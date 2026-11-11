import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import type { MapRenderer } from "./renderer/MapRenderer.js";

type MapRendererContextValue = {
  renderer: MapRenderer | null;
  setRenderer: (renderer: MapRenderer | null) => void;
};

const MapRendererContext = createContext<MapRendererContextValue | null>(null);

export function MapRendererProvider({ children }: { children: ReactNode }) {
  const [renderer, setRenderer] = useState<MapRenderer | null>(null);
  const value = useMemo(() => ({ renderer, setRenderer }), [renderer]);
  return <MapRendererContext.Provider value={value}>{children}</MapRendererContext.Provider>;
}

export function useMapRendererContext(): MapRendererContextValue {
  const ctx = useContext(MapRendererContext);
  if (!ctx) {
    throw new Error("useMapRendererContext must be used within MapRendererProvider");
  }
  return ctx;
}

export function useMapRenderer(): MapRenderer | null {
  return useMapRendererContext().renderer;
}
