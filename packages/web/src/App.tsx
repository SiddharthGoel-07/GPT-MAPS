import { useState } from "react";

import { MapView } from "./components/MapView.jsx";
import { TripPlannerView } from "./components/TripPlannerView.jsx";

type AppMode = "general" | "trip";

function App() {
  const [mode, setMode] = useState<AppMode>("general");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <header className="app-header">
        <span className="app-title">GPT Maps</span>
        <div className="segmented" role="tablist" aria-label="Application mode">
          <button type="button" role="tab" aria-selected={mode === "general"} onClick={() => setMode("general")}>
            Map queries
          </button>
          <button type="button" role="tab" aria-selected={mode === "trip"} onClick={() => setMode("trip")}>
            Trip planner
          </button>
        </div>
      </header>
      <main style={{ flex: 1, minHeight: 0 }}>{mode === "general" ? <MapView /> : <TripPlannerView />}</main>
    </div>
  );
}

export default App;
