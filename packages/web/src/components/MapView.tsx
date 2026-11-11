import { useCallback, useEffect, useRef, useState } from "react";

import { SceneValidationError, emptyScene, parseScene, type Scene } from "@map-renderer/shared";

import { clearActiveMap, loadActiveMap, saveMap, type SavedMapRecord } from "../map/savedMaps.js";

import {
  ChatRequestError,
  endConversation,
  newConversationId,
  sendChat,
} from "../chat/chatClient.js";
import { MapRenderer } from "../renderer/MapRenderer.js";
import type { WeatherStatus } from "../renderer/WeatherOverlay.js";
import { useMapRendererContext } from "../mapRendererContext.jsx";
import { BasemapToggle } from "./BasemapToggle.jsx";
import { SceneLegend } from "./SceneLegend.jsx";

const EXAMPLE_PROMPTS = [
  "Show Delhi, Mumbai, and Bangalore",
  "Mark Paris and draw a path to Lyon",
  "Show the border of Rajasthan",
];

export function MapView() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [mapLoading, setMapLoading] = useState(true);
  const [narrative, setNarrative] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [progress, setProgress] = useState("");
  const [scene, setScene] = useState<Scene | null>(null);
  const [renderer, setRenderer] = useState<MapRenderer | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<WeatherStatus | null>(null);
  const [retryPrompt, setRetryPrompt] = useState<string | null>(null);
  const conversation = useRef<{ id: string; started: boolean; firstPrompt: string }>({
    id: newConversationId(),
    started: false,
    firstPrompt: "",
  });
  const restoredRef = useRef(false);
  const { setRenderer: setSharedRenderer } = useMapRendererContext();

  const AI_SERVER_URL = import.meta.env.VITE_AI_SERVER_URL || "";
  const AUTH_TOKEN = import.meta.env.VITE_AI_AUTH_TOKEN || undefined;

  useEffect(() => {
    if (!mapContainer.current) return;

    const renderer = new MapRenderer(mapContainer.current, {
      onReady: () => setMapLoading(false),
      onWeatherStatus: setWeatherStatus,
    });
    rendererRef.current = renderer;
    setRenderer(renderer);
    setSharedRenderer(renderer);

    return () => {
      rendererRef.current = null;
      setRenderer(null);
      setSharedRenderer(null);
      setWeatherStatus(null);
      renderer.destroy();
    };
  }, [setSharedRenderer]);

  const applyMapRecord = useCallback((record: SavedMapRecord) => {
    const nextScene = parseScene(record.scene);
    conversation.current = {
      id: record.conversationId,
      started: true,
      firstPrompt: record.originalPrompt,
    };
    rendererRef.current?.setNarrative(record.narrative);
    rendererRef.current?.render(nextScene);
    setScene(nextScene);
    setNarrative(record.narrative);
    setStatusMessage("");
    setRetryPrompt(null);
  }, []);

  useEffect(() => {
    if (mapLoading || !rendererRef.current || restoredRef.current) return;
    restoredRef.current = true;
    const active = loadActiveMap();
    if (!active) return;
    try {
      const nextScene = parseScene(active.scene);
      if (nextScene.objects.length === 0) return;
      applyMapRecord(active);
    } catch (error) {
      console.warn("Failed to restore saved map", error);
      clearActiveMap();
    }
  }, [applyMapRecord, mapLoading]);

  const persistScene = (nextScene: Scene, reply: string, promptText: string) => {
    if (nextScene.objects.length === 0) {
      clearActiveMap();
      return;
    }
    if (!conversation.current.firstPrompt) {
      conversation.current.firstPrompt = promptText;
    }
    saveMap({
      id: conversation.current.id,
      originalPrompt: conversation.current.firstPrompt,
      narrative: reply,
      conversationId: conversation.current.id,
      scene: nextScene,
    });
  };

  const runPrompt = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setStatusMessage("");
    setRetryPrompt(null);
    setProgress("Sending…");

    try {
      const data = await sendChat({
        baseUrl: AI_SERVER_URL,
        prompt: trimmed,
        conversationId: conversation.current.id,
        authToken: AUTH_TOKEN,
        onProgress: setProgress,
        signal: controller.signal,
      });

      const nextScene = parseScene(data.scene);
      const expired = conversation.current.started && data.isNewConversation === true;
      const reply = expired
        ? `${data.message}\n(The previous map had expired, so this is a new map.)`
        : data.message;
      rendererRef.current?.setNarrative(reply);
      rendererRef.current?.render(nextScene);
      setScene(nextScene);
      conversation.current.started = true;
      setNarrative(reply);
      persistScene(nextScene, reply, trimmed);
      setPrompt("");
    } catch (err) {
      if (controller.signal.aborted) {
        setStatusMessage("Cancelled.");
        return;
      }
      console.error(err);
      let text: string;
      if (err instanceof SceneValidationError) {
        text = `The server returned an invalid scene: ${err.message.replace(/^Invalid scene: /, "")}`;
      } else if (err instanceof ChatRequestError) {
        text = err.message;
      } else {
        text = "Something went wrong while showing the map. Please try again.";
      }
      setStatusMessage(text);
      setRetryPrompt(trimmed);
    } finally {
      setLoading(false);
      if (abortRef.current === controller) abortRef.current = null;
      setProgress("");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runPrompt(prompt);
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const handleClear = () => {
    if (loading) return;
    rendererRef.current?.render(emptyScene());
    rendererRef.current?.setNarrative("");
    setScene(null);
    setNarrative("");
    setStatusMessage("");
    setRetryPrompt(null);
    clearActiveMap();
  };

  const handleNewMap = async () => {
    if (loading) return;
    const old = conversation.current;
    conversation.current = { id: newConversationId(), started: false, firstPrompt: "" };
    handleClear();
    setPrompt("");
    clearActiveMap();
    if (old.started) {
      await endConversation({ baseUrl: AI_SERVER_URL, conversationId: old.id, authToken: AUTH_TOKEN });
    }
  };

  const showExamples = scene === null && !loading && !narrative && !statusMessage;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div className="map-floating-stack">
        <form onSubmit={handleSubmit} className="floating-bar" style={{ flex: 1, maxWidth: 760, width: "100%", margin: "0 auto" }}>
          <input
            type="text"
            className="field"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe a map scene, e.g. Show Delhi and Mumbai"
            style={{ flex: 1 }}
            disabled={loading}
            aria-label="Map prompt"
          />
          <button type="submit" className="btn btn-primary" disabled={loading || !prompt.trim()}>
            {loading ? "Working…" : "Show"}
          </button>
          {loading && (
            <button type="button" className="btn" onClick={handleCancel}>
              Cancel
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={handleClear}
            disabled={loading || scene === null}
            title="Remove all markers and shapes from the map"
          >
            Clear
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleNewMap}
            disabled={loading}
            title="Clear the map and start a new conversation"
          >
            New map
          </button>
        </form>

        {showExamples && (
          <div className="floating-examples" aria-label="Example prompts">
            {EXAMPLE_PROMPTS.map((example) => (
              <button
                key={example}
                type="button"
                className="example-chip-inline"
                onClick={() => setPrompt(example)}
              >
                {example}
              </button>
            ))}
          </div>
        )}
      </div>

      {(narrative || (loading && progress) || statusMessage) && (
        <div className="map-status-toast" role="status" aria-live="polite">
          {loading && progress ? progress : statusMessage || narrative}
          {!loading && retryPrompt && (
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-compact" onClick={() => void runPrompt(retryPrompt)}>
                Retry
              </button>
            </div>
          )}
        </div>
      )}

      <div className="map-stage" style={{ width: "100%", height: "100%" }}>
        {mapLoading && (
          <div className="map-loading" role="status">
            Loading map…
          </div>
        )}
        <div ref={mapContainer} className="map-canvas" aria-label="Interactive map" />
        <div className="map-layer-toggles">
          <BasemapToggle renderer={renderer} />
        </div>
        <SceneLegend scene={scene} weatherStatus={weatherStatus} />
      </div>
    </div>
  );
}
