import { useEffect, useState } from "react";

import type { Scene } from "@map-renderer/shared";
import { pathsFromScene } from "../traffic/trafficClient.js";
import type { MapRenderer } from "../renderer/MapRenderer.js";
import type { TrafficStatus } from "../renderer/TrafficOverlay.js";

export function TrafficToggle({
  renderer,
  scene,
  status,
}: {
  renderer: MapRenderer | null;
  scene: Scene | null;
  status: TrafficStatus | null;
}) {
  const [on, setOn] = useState(false);
  const pathCount = scene ? pathsFromScene(scene).length : 0;
  const canUse = Boolean(renderer) && pathCount > 0;

  useEffect(() => {
    setOn(false);
    renderer?.setTrafficEnabled(false);
  }, [renderer, scene]);

  const select = (enabled: boolean) => {
    if (enabled === on || !renderer || !canUse) return;
    renderer.setTrafficEnabled(enabled);
    setOn(enabled);
  };

  const busy = Boolean(status?.loading);

  return (
    <div className="trip-traffic-toggle" role="group" aria-label="Live traffic">
      <div className="segmented">
        <button type="button" aria-selected={!on} disabled={!canUse || busy} onClick={() => select(false)}>
          Off
        </button>
        <button
          type="button"
          aria-selected={on}
          disabled={!canUse || busy}
          onClick={() => select(true)}
          title={canUse ? "TomTom live traffic on roads in this day" : "Add a route on this day first"}
        >
          {busy ? "Loading…" : "Live traffic"}
        </button>
      </div>
      {status?.error && on && <span className="muted traffic-toggle-hint">Traffic unavailable</span>}
      {on && !busy && !status?.error && (
        <span className="muted traffic-toggle-hint">Blue = free flow · Red = heavy</span>
      )}
    </div>
  );
}
