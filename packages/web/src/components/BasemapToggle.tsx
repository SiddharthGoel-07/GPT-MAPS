import { useState } from "react";

import type { BasemapMode } from "../map/basemaps.js";
import type { MapRenderer } from "../renderer/MapRenderer.js";

export function BasemapToggle({ renderer }: { renderer: MapRenderer | null }) {
  const [mode, setMode] = useState<BasemapMode>("light");

  const select = (next: BasemapMode) => {
    if (next === mode || !renderer) return;
    renderer.setBasemap(next);
    setMode(next);
  };

  return (
    <div role="group" aria-label="Basemap">
      <div className="segmented">
        <button type="button" aria-selected={mode === "light"} onClick={() => select("light")}>
          Map
        </button>
        <button type="button" aria-selected={mode === "satellite"} onClick={() => select("satellite")}>
          Satellite
        </button>
      </div>
    </div>
  );
}
