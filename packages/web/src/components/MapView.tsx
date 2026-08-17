import { useEffect, useRef, useState } from "react";

import { Scene } from "@map-renderer/shared";

import { MapRenderer } from "../renderer/MapRenderer.js";
import { SceneDeserializer } from "../SceneDeserializer.js";

interface ChatResponse {
  scene: object;
  message: string;
}

export function MapView() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!mapContainer.current) return;

    const renderer = new MapRenderer(mapContainer.current);
    rendererRef.current = renderer;

    return () => {
      rendererRef.current = null;
      renderer.destroy();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setMessage("");

    try {
      const AI_SERVER_URL =
        import.meta.env.VITE_AI_SERVER_URL || "";

      const response = await fetch(`${AI_SERVER_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const data = (await response.json()) as ChatResponse;

      const sceneDeserializer = new SceneDeserializer();
      const scene: Scene = sceneDeserializer.deserialize(data.scene);

      rendererRef.current?.render(scene);
      setMessage(data.message);
    } catch (error) {
      console.error(error);
      setMessage("Failed to process request. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100vh" }}>
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          right: 16,
          zIndex: 10,
          display: "flex",
          gap: 8,
        }}
      >
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", gap: 8, flex: 1 }}
        >
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe a map scene, e.g. Show Delhi and Mumbai"
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid #ccc",
              fontSize: 14,
            }}
          />
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "none",
              backgroundColor: "#0066ff",
              color: "#fff",
              fontSize: 14,
              cursor: loading ? "default" : "pointer",
              opacity: loading || !prompt.trim() ? 0.6 : 1,
            }}
          >
            {loading ? "Processing..." : "Show"}
          </button>
        </form>
      </div>

      {message && (
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: 16,
            right: 16,
            zIndex: 10,
            padding: "10px 14px",
            borderRadius: 8,
            backgroundColor: "rgba(255, 255, 255, 0.9)",
            border: "1px solid #ccc",
            fontSize: 13,
          }}
        >
          {message}
        </div>
      )}

      <div
        ref={mapContainer}
        style={{
          width: "100%",
          height: "100%",
        }}
      />
    </div>
  );
}