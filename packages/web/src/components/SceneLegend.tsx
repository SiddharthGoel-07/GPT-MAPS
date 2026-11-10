import type { Scene } from "@map-renderer/shared";

export function SceneLegend({ scene }: { scene: Scene | null }) {
  if (!scene || scene.objects.length === 0) return null;

  let markers = 0;
  let paths = 0;
  let polygons = 0;
  let dashedPaths = 0;

  for (const object of scene.objects) {
    switch (object.type) {
      case "marker":
      case "label":
        markers += 1;
        break;
      case "path":
        paths += 1;
        if (object.dash) dashedPaths += 1;
        break;
      case "polygon":
        polygons += 1;
        break;
    }
  }

  const parts: string[] = [];
  if (markers) parts.push(`${markers} marker${markers === 1 ? "" : "s"}`);
  if (paths) parts.push(`${paths} route${paths === 1 ? "" : "s"}`);
  if (polygons) parts.push(`${polygons} region${polygons === 1 ? "" : "s"}`);

  return (
    <div className="map-legend" aria-label="Map legend">
      <span className="map-legend-title">Scene</span>
      <span>{parts.join(" · ")}</span>
      {dashedPaths > 0 && <span className="map-legend-hint">Dashed lines = no road route</span>}
    </div>
  );
}
