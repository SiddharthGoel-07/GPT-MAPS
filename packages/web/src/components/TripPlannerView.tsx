import { useEffect, useRef, useState } from "react";

import {
  TripPlanValidationError,
  emptyScene,
  parseTripFollowUpResponse,
  parseTripPlanResponse,
  type Scene,
  type TripPlanResponse,
} from "@map-renderer/shared";

import { ChatRequestError } from "../chat/chatClient.js";
import { sendTripFollowUp, sendTripPlan } from "../chat/tripClient.js";
import { MapRenderer } from "../renderer/MapRenderer.js";
import {
  deleteSavedTrip,
  listSavedTrips,
  loadActiveTrip,
  saveTrip,
  sectionKey,
  writeActiveTripId,
  type SavedTripRecord,
  type TripChatMessage,
} from "../trip/savedTrips.js";
import { BudgetBreakdownView } from "./BudgetBreakdown.jsx";
import { SceneLegend } from "./SceneLegend.jsx";

type TripTab = "overview" | number;

function plainText(message: string): string {
  return message.replace(/^\*\*Day \d+:[^\n]*\*\*\s*/, "").replace(/\*\*/g, "");
}

function applySectionUpdate(
  prev: TripPlanResponse,
  activeTab: TripTab,
  message: string,
  scene: TripPlanResponse["overview"]["scene"],
  title?: string
): TripPlanResponse {
  if (activeTab === "overview") {
    return { ...prev, overview: { message, scene } };
  }
  return {
    ...prev,
    days: prev.days.map((d) =>
      d.day === activeTab ? { ...d, message, scene, ...(title ? { title } : {}) } : d
    ),
  };
}

function formatSavedAt(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function TripPlannerView() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [mapLoading, setMapLoading] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [retryAction, setRetryAction] = useState<"plan" | "followup" | null>(null);
  const [retryPlanPrompt, setRetryPlanPrompt] = useState("");
  const [plan, setPlan] = useState<TripPlanResponse | null>(() => loadActiveTrip()?.plan ?? null);
  const [activeTab, setActiveTab] = useState<TripTab>("overview");
  const [followUpPrompt, setFollowUpPrompt] = useState("");
  const [sectionChats, setSectionChats] = useState<Record<string, TripChatMessage[]>>(() => loadActiveTrip()?.sectionChats ?? {});
  const [savedTrips, setSavedTrips] = useState<SavedTripRecord[]>(() => listSavedTrips());
  const [activeSaveId, setActiveSaveId] = useState<string | undefined>(() => loadActiveTrip()?.id);
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>(() => loadActiveTrip()?.savedAt);
  const [lastPrompt, setLastPrompt] = useState(() => loadActiveTrip()?.originalPrompt ?? "");

  const AI_SERVER_URL = import.meta.env.VITE_AI_SERVER_URL || "";
  const AUTH_TOKEN = import.meta.env.VITE_AI_AUTH_TOKEN || undefined;

  useEffect(() => {
    if (!mapContainer.current) return;
    const renderer = new MapRenderer(mapContainer.current, { onReady: () => setMapLoading(false) });
    rendererRef.current = renderer;
    renderer.render(emptyScene());
    return () => {
      rendererRef.current = null;
      renderer.destroy();
    };
  }, []);

  useEffect(() => {
    if (!plan || !rendererRef.current) return;
    const raw =
      activeTab === "overview"
        ? plan.overview.message
        : (plan.days.find((d) => d.day === activeTab)?.message ?? "");
    rendererRef.current.setNarrative(plainText(raw));
    if (activeTab === "overview") {
      rendererRef.current.render(plan.overview.scene);
      return;
    }
    const day = plan.days.find((d) => d.day === activeTab);
    if (day) rendererRef.current.render(day.scene);
  }, [plan, activeTab]);

  useEffect(() => {
    setFollowUpPrompt("");
    setError("");
  }, [activeTab]);

  const currentSectionMessage = (): string => {
    if (!plan) return "";
    if (activeTab === "overview") return plan.overview.message;
    return plan.days.find((d) => d.day === activeTab)?.message ?? "";
  };

  const persistTrip = (
    tripPlan: TripPlanResponse,
    originalPrompt: string,
    chats: Record<string, TripChatMessage[]>,
    saveId: string | undefined
  ): void => {
    const saved = saveTrip({
      ...(saveId ? { id: saveId } : {}),
      originalPrompt: originalPrompt || tripPlan.tripTitle,
      plan: tripPlan,
      sectionChats: chats,
    });
    writeActiveTripId(saved.id);
    setActiveSaveId(saved.id);
    setLastSavedAt(saved.savedAt);
    setSavedTrips(listSavedTrips());
  };

  const runTripPlan = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError("");
    setRetryAction(null);
    setProgress("Sending…");

    try {
      const raw = await sendTripPlan({
        baseUrl: AI_SERVER_URL,
        prompt: trimmed,
        authToken: AUTH_TOKEN,
        onProgress: setProgress,
        signal: controller.signal,
      });
      const validated = parseTripPlanResponse(raw);
      setPlan(validated);
      setLastPrompt(trimmed);
      setSectionChats({});
      persistTrip(validated, trimmed, {}, undefined);
      setActiveTab("overview");
      setPrompt("");
    } catch (err) {
      if (controller.signal.aborted) {
        setProgress("Cancelled.");
        return;
      }
      console.error(err);
      if (err instanceof TripPlanValidationError) {
        setError(err.message);
      } else if (err instanceof ChatRequestError) {
        setError(err.message);
      } else {
        setError("Something went wrong while planning your trip. Please try again.");
      }
      setRetryAction("plan");
      setRetryPlanPrompt(trimmed);
    } finally {
      setLoading(false);
      if (abortRef.current === controller) abortRef.current = null;
      setProgress("");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runTripPlan(prompt);
  };

  const handleFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!plan || !followUpPrompt.trim() || followUpLoading || loading) return;

    const key = sectionKey(activeTab);
    const userText = followUpPrompt.trim();
    const history = sectionChats[key] ?? [];
    const day = typeof activeTab === "number" ? plan.days.find((d) => d.day === activeTab) : undefined;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setFollowUpLoading(true);
    setError("");
    setRetryAction(null);
    setProgress("Updating…");
    setFollowUpPrompt("");

    try {
      const raw = await sendTripFollowUp({
        baseUrl: AI_SERVER_URL,
        prompt: userText,
        authToken: AUTH_TOKEN,
        onProgress: setProgress,
        signal: controller.signal,
        body: {
          prompt: userText,
          tripTitle: plan.tripTitle,
          section: activeTab,
          sectionTitle: day?.title,
          currentNarrative: currentSectionMessage(),
          history,
        },
      });
      const result = parseTripFollowUpResponse(raw);
      const assistantText = plainText(result.message);
      const nextPlan = applySectionUpdate(plan, activeTab, result.message, result.scene, result.title);
      const nextHistory = [
        ...history,
        { role: "user" as const, content: userText },
        { role: "assistant" as const, content: assistantText },
      ].slice(-12);
      const nextChats = { ...sectionChats, [key]: nextHistory };
      setPlan(nextPlan);
      setSectionChats(nextChats);
      persistTrip(nextPlan, lastPrompt, nextChats, activeSaveId);
    } catch (err) {
      if (controller.signal.aborted) {
        setProgress("Cancelled.");
        return;
      }
      console.error(err);
      if (err instanceof TripPlanValidationError) {
        setError(err.message);
      } else if (err instanceof ChatRequestError) {
        setError(err.message);
      } else {
        setError("Could not update this section. Please try again.");
      }
      setFollowUpPrompt(userText);
      setRetryAction("followup");
    } finally {
      setFollowUpLoading(false);
      if (abortRef.current === controller) abortRef.current = null;
      setProgress("");
    }
  };

  const handleCancelAi = () => {
    abortRef.current?.abort();
  };

  const activeScene = (): Scene | null => {
    if (!plan) return null;
    if (activeTab === "overview") return plan.overview.scene;
    return plan.days.find((d) => d.day === activeTab)?.scene ?? null;
  };

  const handleLoadSaved = (id: string) => {
    const record = savedTrips.find((t) => t.id === id);
    if (!record) return;
    setPlan(record.plan);
    setLastPrompt(record.originalPrompt);
    setSectionChats(record.sectionChats);
    setActiveSaveId(record.id);
    setLastSavedAt(record.savedAt);
    writeActiveTripId(record.id);
    setActiveTab("overview");
    setError("");
  };

  const handleDeleteSaved = (id: string) => {
    deleteSavedTrip(id);
    setSavedTrips(listSavedTrips());
    if (activeSaveId === id) {
      setActiveSaveId(undefined);
      setLastSavedAt(undefined);
      writeActiveTripId(undefined);
    }
  };

  const handleNewTrip = () => {
    if (loading || followUpLoading) return;
    setPlan(null);
    setActiveTab("overview");
    setError("");
    setPrompt("");
    setFollowUpPrompt("");
    setSectionChats({});
    setActiveSaveId(undefined);
    setLastSavedAt(undefined);
    writeActiveTripId(undefined);
    rendererRef.current?.render(emptyScene());
  };

  const chatKey = sectionKey(activeTab);
  const chatThread = sectionChats[chatKey] ?? [];

  const rightBody = () => {
    if (!plan) return null;
    if (activeTab === "overview") {
      return (
        <>
          <h3>Overview</h3>
          {plainText(plan.overview.message)}
          {plan.budgetBreakdown ? (
            <BudgetBreakdownView breakdown={plan.budgetBreakdown} summary={plan.budgetSummary} />
          ) : (
            plan.budgetSummary && (
              <div className="budget-card">
                <strong>Budget</strong>
                <div>{plainText(plan.budgetSummary)}</div>
              </div>
            )
          )}
        </>
      );
    }
    const day = plan.days.find((d) => d.day === activeTab);
    if (!day) return null;
    return (
      <>
        <h3>
          Day {day.day}: {day.title}
        </h3>
        {plainText(day.message)}
      </>
    );
  };

  return (
    <div className="trip-layout" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="trip-layout-main" style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div className="map-stage" style={{ flex: 1, minWidth: 0, height: "100%" }}>
          {mapLoading && (
            <div className="map-loading" role="status">
              Loading map…
            </div>
          )}
          <div ref={mapContainer} className="map-canvas" aria-label="Trip map" />
          <SceneLegend scene={activeScene()} />
        </div>
        <div className="trip-panel">
          <div className="trip-section" style={{ flexShrink: 0 }}>
            {savedTrips.length > 0 && (
              <div className="saved-trips">
                <label className="muted" htmlFor="saved-trip-select">
                  Saved trips
                </label>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <select
                    id="saved-trip-select"
                    className="field"
                    value={activeSaveId ?? ""}
                    onChange={(e) => {
                      const id = e.target.value;
                      if (id) handleLoadSaved(id);
                    }}
                  >
                    <option value="">Load a saved trip…</option>
                    {savedTrips.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.plan.tripTitle}
                      </option>
                    ))}
                  </select>
                  {activeSaveId && (
                    <button type="button" className="btn" onClick={() => handleDeleteSaved(activeSaveId)} title="Delete saved trip">
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: savedTrips.length ? 12 : 0 }}>
              <textarea
                id="trip-prompt"
                className="field"
                aria-label="Describe your trip"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. I have 3 days to travel from Pune to Mumbai with 3 people and a budget of ₹1 lakh. Plan the trip within budget."
                rows={3}
                style={{ resize: "vertical" }}
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button type="submit" className="btn btn-primary" disabled={loading || !prompt.trim()} style={{ flex: 1, minWidth: 120 }}>
                  {loading ? "Planning…" : "Plan trip"}
                </button>
                <button type="button" className="btn" onClick={handleNewTrip} disabled={loading || followUpLoading}>
                  New trip
                </button>
              </div>
              {plan && lastSavedAt && (
                <p className="muted" style={{ margin: 0, fontSize: 12 }} role="status">
                  Auto-saved {formatSavedAt(lastSavedAt)}
                </p>
              )}
            </form>
            {((loading || followUpLoading) || progress) && (
              <div className="ai-activity" role="status" aria-live="polite">
                {(loading || followUpLoading) && <p className="ai-activity-bar" aria-hidden="true" />}
                <div className="ai-activity-row">
                  <span className="ai-activity-text">{progress || "Working…"}</span>
                  {(loading || followUpLoading) && (
                    <button type="button" className="btn btn-compact" onClick={handleCancelAi}>
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            )}
            {error && !loading && !followUpLoading && (
              <div className="inline-alert error-block" role="alert" style={{ marginTop: 10 }}>
                <p className="error" style={{ margin: 0, fontSize: 13 }}>
                  {error}
                </p>
                {retryAction === "plan" && retryPlanPrompt && (
                  <button type="button" className="btn btn-compact" style={{ marginTop: 8 }} onClick={() => void runTripPlan(retryPlanPrompt)}>
                    Retry
                  </button>
                )}
                {retryAction === "followup" && followUpPrompt.trim() && (
                  <button
                    type="button"
                    className="btn btn-compact"
                    style={{ marginTop: 8 }}
                    onClick={() => void handleFollowUp({ preventDefault: () => {} } as React.FormEvent)}
                  >
                    Retry
                  </button>
                )}
              </div>
            )}
          </div>

          {plan && (
            <>
              <div className="trip-section" style={{ flexShrink: 0 }}>
                <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>{plan.tripTitle}</h2>
                <div className="trip-tabs" role="tablist" aria-label="Trip sections">
                  <button
                    type="button"
                    role="tab"
                    className="trip-tab"
                    aria-selected={activeTab === "overview"}
                    onClick={() => setActiveTab("overview")}
                  >
                    Overview
                  </button>
                  {plan.days.map((d) => (
                    <button
                      key={d.day}
                      type="button"
                      role="tab"
                      className="trip-tab"
                      aria-selected={activeTab === d.day}
                      onClick={() => setActiveTab(d.day)}
                    >
                      Day {d.day}
                    </button>
                  ))}
                </div>
              </div>

              <div className="trip-body">
                {rightBody()}
                {chatThread.length > 0 && (
                  <div className="trip-chat-thread" aria-label="Follow-up conversation">
                    <h4>Follow-up</h4>
                    {chatThread.map((m, i) => (
                      <div key={i} className={`trip-chat-bubble trip-chat-${m.role}`}>
                        <span className="trip-chat-role">{m.role === "user" ? "You" : "Assistant"}</span>
                        {m.content}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="trip-followup-section">
                <form onSubmit={handleFollowUp} className="trip-followup-form">
                  <input
                    type="text"
                    className="field"
                    value={followUpPrompt}
                    onChange={(e) => setFollowUpPrompt(e.target.value)}
                    placeholder={
                      activeTab === "overview"
                        ? "Ask to change the overview (e.g. add Lonavala stop)…"
                        : `Refine day ${activeTab} (e.g. cheaper lunch, later start)…`
                    }
                    disabled={followUpLoading || loading}
                    aria-label="Follow-up message for this section"
                  />
                  <button type="submit" className="btn btn-primary" disabled={followUpLoading || loading || !followUpPrompt.trim()}>
                    {followUpLoading ? "…" : "Send"}
                  </button>
                </form>
              </div>
            </>
          )}

          {!plan && !loading && (
            <div className="trip-body muted">
              Describe your trip duration, origin, destination, group size, and budget. The planner will build an overview plus a
              day-by-day itinerary, each with its own map. You can refine each section with follow-up chat and save trips in this browser.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
