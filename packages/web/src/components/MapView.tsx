import { useEffect, useRef, useState } from "react";

import { SceneValidationError, emptyScene, parseScene } from "@map-renderer/shared";

import {
  ChatRequestError,
  endConversation,
  newConversationId,
  sendChat,
} from "../chat/chatClient.js";
import { MapRenderer } from "../renderer/MapRenderer.js";

export function MapView() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState("");
  // One conversation = one map that keeps growing across prompts. `started`
  // is true once the server has seen this id (so a "new map" answer means it expired).
  const conversation = useRef<{ id: string; started: boolean }>({ id: newConversationId(), started: false });

  useEffect(() => {
    if (!mapContainer.current) return;

    const renderer = new MapRenderer(mapContainer.current);
    rendererRef.current = renderer;

    return () => {
      rendererRef.current = null;
      renderer.destroy();
    };
  }, []);

  const AI_SERVER_URL = import.meta.env.VITE_AI_SERVER_URL || "";
  const AUTH_TOKEN = import.meta.env.VITE_AI_AUTH_TOKEN || undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setMessage("");
    setProgress("Sending…");

    try {
      const data = await sendChat({
        baseUrl: AI_SERVER_URL,
        prompt: prompt.trim(),
        conversationId: conversation.current.id,
        authToken: AUTH_TOKEN,
        onProgress: setProgress,
      });

      // Throws SceneValidationError (before touching the map) if the server's
      // scene does not match the shared schema.
      const scene = parseScene(data.scene);

      rendererRef.current?.render(scene);
      const expired = conversation.current.started && data.isNewConversation === true;
      conversation.current.started = true;
      setMessage(
        expired
          ? `${data.message}\n(The previous map had expired, so this is a new map.)`
          : data.message
      );
      setPrompt("");
    } catch (error) {
      console.error(error);
      if (error instanceof SceneValidationError) {
        setMessage(`The server returned an invalid scene: ${error.message.replace(/^Invalid scene: /, "")}`);
      } else if (error instanceof ChatRequestError) {
        setMessage(error.message);
      } else {
        setMessage("Something went wrong while showing the map. Please try again.");
      }
    } finally {
      setLoading(false);
      setProgress("");
    }
  };

  const handleNewMap = async () => {
    if (loading) return;
    const old = conversation.current;
    conversation.current = { id: newConversationId(), started: false };
    rendererRef.current?.render(emptyScene());
    setMessage("");
    setPrompt("");
    if (old.started) {
      await endConversation({ baseUrl: AI_SERVER_URL, conversationId: old.id, authToken: AUTH_TOKEN });
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
            {loading ? "Working…" : "Show"}
          </button>
          <button
            type="button"
            onClick={handleNewMap}
            disabled={loading}
            title="Clear the map and start a new one"
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid #ccc",
              backgroundColor: "#fff",
              color: "#333",
              fontSize: 14,
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            New map
          </button>
        </form>
      </div>

      {(message || (loading && progress)) && (
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
            whiteSpace: "pre-line",
          }}
          role="status"
          aria-live="polite"
        >
          {loading && progress ? progress : message}
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