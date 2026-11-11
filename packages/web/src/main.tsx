import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import { initTheme } from "./theme.js";
import "./maplibreWorker.js";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

initTheme();

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing root element");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);