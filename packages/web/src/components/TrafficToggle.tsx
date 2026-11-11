import { useEffect } from "react";

import type { Scene } from "@map-renderer/shared";
import { pathsFromScene } from "../traffic/trafficClient.js";
import type { MapRenderer } from "../renderer/MapRenderer.js";
import type { TrafficStatus } from "../renderer/TrafficOverlay.js";

export function TrafficToggle({
  renderer,
  scene,
  status,
  enabled,
  onChange,
}: {
  renderer: MapRenderer | null;
  scene: Scene | null;
  status: TrafficStatus | null;
  enabled: boolean;
  onChange: (on: boolean) => void;
}) {
  const pathCount = scene ? pathsFromScene(scene).length : 0;
  const canUse = Boolean(renderer) && pathCount > 0;

  useEffect(() => {
    if (!renderer) return;
    if (enabled && canUse) {
      renderer.setTrafficEnabled(true);
    } else if (!enabled) {
      renderer.setTrafficEnabled(false);
    }
  }, [renderer, enabled, canUse, scene]);

  const select = (next: boolean) => {
    if (next === enabled || !renderer) return;
    if (next && !canUse) return;
    renderer.setTrafficEnabled(next);
    onChange(next);
  };

  const busy = Boolean(status?.loading);

  return (
    <div className="trip-traffic-toggle" role="group" aria-label="Live traffic">
      <div className="segmented">
        <button type="button" aria-selected={!enabled} disabled={busy} onClick={() => select(false)}>
          Off
        </button>
        <button
          type="button"
          aria-selected={enabled}
          disabled={!canUse || busy}
          onClick={() => select(true)}
          title={canUse ? "TomTom live traffic on roads in this day" : "Add a route on this day first"}
        >
          {busy ? "Loading…" : "Live traffic"}
        </button>
      </div>
      {status?.error && enabled && <span className="muted traffic-toggle-hint">Traffic unavailable</span>}
    </div>
  );
}
