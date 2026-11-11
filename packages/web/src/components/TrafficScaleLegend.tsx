import { TRAFFIC_SCALE } from "@map-renderer/shared";

export function TrafficScaleLegend({
  visible,
  loading,
}: {
  visible: boolean;
  loading?: boolean;
}) {
  if (!visible) return null;

  const gradient = TRAFFIC_SCALE.map((s) => s.color).join(", ");

  return (
    <div className="traffic-scale-legend map-legend" aria-label="Traffic color scale">
      <span className="map-legend-title">Traffic</span>
      <div
        className="traffic-scale-bar"
        style={{ background: `linear-gradient(90deg, ${gradient})` }}
        role="img"
        aria-label="Green free flow through red heavy congestion"
      />
      <div className="traffic-scale-labels">
        {TRAFFIC_SCALE.map((step) => (
          <span key={step.label} className="traffic-scale-step">
            <span className="traffic-scale-swatch" style={{ background: step.color }} aria-hidden />
            {step.label}
          </span>
        ))}
      </div>
      <span className="map-legend-hint">
        {loading ? "Updating route traffic…" : "Colors follow TomTom live speed on your routes only."}
      </span>
    </div>
  );
}
