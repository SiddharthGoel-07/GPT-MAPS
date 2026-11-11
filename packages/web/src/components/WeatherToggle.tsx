import { useState } from "react";

import type { MapRenderer } from "../renderer/MapRenderer.js";

export function WeatherToggle({ renderer }: { renderer: MapRenderer | null }) {
  const [on, setOn] = useState(false);

  const select = (enabled: boolean) => {
    if (enabled === on || !renderer) return;
    renderer.setWeatherEnabled(enabled);
    setOn(enabled);
  };

  return (
    <div role="group" aria-label="Weather layer">
      <div className="segmented">
        <button type="button" aria-selected={!on} onClick={() => select(false)}>
          Weather off
        </button>
        <button type="button" aria-selected={on} onClick={() => select(true)}>
          ☁️ Live
        </button>
      </div>
    </div>
  );
}
