import { useState } from "react";

import { MapView } from "./components/MapView.jsx";
import { TripPlannerView } from "./components/TripPlannerView.jsx";
import { applyTheme, effectiveTheme, type Theme } from "./theme.js";

type AppMode = "general" | "trip";

function App() {
  const [mode, setMode] = useState<AppMode>("general");
  const [theme, setTheme] = useState<Theme>(effectiveTheme);

  const toggleTheme = () => {
    const next: Theme = effectiveTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <header className="app-header">
        <span className="app-title">GPT Maps</span>
        <span className="app-tagline muted">Natural language → live map</span>
        <div className="app-header-tools">
          <div className="segmented" role="tablist" aria-label="Application mode">
            <button type="button" role="tab" aria-selected={mode === "general"} onClick={() => setMode("general")}>
              Build a map
            </button>
            <button type="button" role="tab" aria-selected={mode === "trip"} onClick={() => setMode("trip")}>
              Plan a trip
            </button>
          </div>
          <button
            type="button"
            className="btn btn-compact theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Light mode" : "Dark mode"}
          >
            {theme === "dark" ? "☀" : "☽"}
          </button>
        </div>
      </header>
      <main style={{ flex: 1, minHeight: 0 }}>{mode === "general" ? <MapView /> : <TripPlannerView />}</main>
    </div>
  );
}

export default App;
