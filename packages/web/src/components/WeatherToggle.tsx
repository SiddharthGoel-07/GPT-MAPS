import { useEffect, useState } from "react";

import type { MapRenderer } from "../renderer/MapRenderer.js";

export function WeatherToggle({ renderer }: { renderer: MapRenderer | null }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    setOn(false);
  }, [renderer]);

  const select = (enabled: boolean) => {
    if (enabled === on || !renderer) return;
    renderer.setWeatherEnabled(enabled);
    setOn(enabled);
  };

  return (
    <div className="app-header-weather" role="group" aria-label="Weather layer">
      <div className="segmented">
        <button type="button" aria-selected={!on} disabled={!renderer} onClick={() => select(false)}>
          Off
        </button>
        <button type="button" aria-selected={on} disabled={!renderer} onClick={() => select(true)}>
          Live
        </button>
      </div>
    </div>
  );
}
