import { useEffect, useRef, useState } from "react";

import {
  TripPlanValidationError,
  emptyScene,
  parseTripFollowUpResponse,
  parseTripPlanResponse,
  type TripPlanResponse,
} from "@map-renderer/shared";

import { ChatRequestError } from "../chat/chatClient.js";
import { sendTripFollowUp, sendTripPlan } from "../chat/tripClient.js";
import { MapRenderer } from "../renderer/MapRenderer.js";
import {
  deleteSavedTrip,
  listSavedTrips,
  saveTrip,
  sectionKey,
  type SavedTripRecord,
  type TripChatMessage,
} from "../trip/savedTrips.js";
import { BudgetBreakdownView } from "./BudgetBreakdown.jsx";

type TripTab = "overview" | number;

function plainText(message: string): string {
  return message.replace(/^\*\*Day \d+:[^\n]*\*\*\s*/, "").replace(/\*\*/g, "");
}

export function TripPlannerView() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const [prompt, setPrompt] = useState("");
  const [lastPrompt, setLastPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<TripPlanResponse | null>(null);
  const [activeTab, setActiveTab] = useState<TripTab>("overview");
  const [followUpPrompt, setFollowUpPrompt] = useState("");
  const [sectionChats, setSectionChats] = useState<Record<string, TripChatMessage[]>>({});
  const [savedTrips, setSavedTrips] = useState<SavedTripRecord[]>(() => listSavedTrips());
  const [activeSaveId, setActiveSaveId] = useState<string | undefined>();

  const AI_SERVER_URL = import.meta.env.VITE_AI_SERVER_URL || "";
  const AUTH_TOKEN = import.meta.env.VITE_AI_AUTH_TOKEN || undefined;

  useEffect(() => {
    if (!mapContainer.current) return;
    const renderer = new MapRenderer(mapContainer.current);
    rendererRef.current = renderer;
    renderer.render(emptyScene());
    return () => {
      rendererRef.current = null;
      renderer.destroy();
    };
  }, []);

  useEffect(() => {
    if (!plan || !rendererRef.current) return;
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

  const updatePlanSection = (message: string, scene: TripPlanResponse["overview"]["scene"], title?: string): void => {
    setPlan((prev) => {
      if (!prev) return prev;
      if (activeTab === "overview") {
        return { ...prev, overview: { message, scene } };
      }
      return {
        ...prev,
        days: prev.days.map((d) =>
          d.day === activeTab ? { ...d, message, scene, ...(title ? { title } : {}) } : d
        ),
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setError("");
    setProgress("Sending…");

    try {
      const trimmed = prompt.trim();
      const raw = await sendTripPlan({
        baseUrl: AI_SERVER_URL,
        prompt: trimmed,
        authToken: AUTH_TOKEN,
        onProgress: setProgress,
      });
      const validated = parseTripPlanResponse(raw);
      setPlan(validated);
      setLastPrompt(trimmed);
      setSectionChats({});
      setActiveSaveId(undefined);
      setActiveTab("overview");
      setPrompt("");
    } catch (err) {
      console.error(err);
      if (err instanceof TripPlanValidationError) {
        setError(err.message);
      } else if (err instanceof ChatRequestError) {
        setError(err.message);
      } else {
        setError("Something went wrong while planning your trip. Please try again.");
      }
    } finally {
      setLoading(false);
      setProgress("");
    }
  };

  const handleFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!plan || !followUpPrompt.trim() || followUpLoading || loading) return;

    const key = sectionKey(activeTab);
    const userText = followUpPrompt.trim();
    const history = sectionChats[key] ?? [];
    const day = typeof activeTab === "number" ? plan.days.find((d) => d.day === activeTab) : undefined;

    setFollowUpLoading(true);
    setError("");
    setProgress("Updating…");
    setFollowUpPrompt("");

    try {
      const raw = await sendTripFollowUp({
        baseUrl: AI_SERVER_URL,
        prompt: userText,
        authToken: AUTH_TOKEN,
        onProgress: setProgress,
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
      updatePlanSection(result.message, result.scene, result.title);
      const nextHistory = [
        ...history,
        { role: "user" as const, content: userText },
        { role: "assistant" as const, content: assistantText },
      ].slice(-12);
      setSectionChats((prev) => ({ ...prev, [key]: nextHistory }));
    } catch (err) {
      console.error(err);
      if (err instanceof TripPlanValidationError) {
        setError(err.message);
      } else if (err instanceof ChatRequestError) {
        setError(err.message);
      } else {
        setError("Could not update this section. Please try again.");
      }
      setFollowUpPrompt(userText);
    } finally {
      setFollowUpLoading(false);
      setProgress("");
    }
  };

  const handleSave = () => {
    if (!plan) return;
    const saved = saveTrip({
      ...(activeSaveId ? { id: activeSaveId } : {}),
      originalPrompt: lastPrompt || plan.tripTitle,
      plan,
      sectionChats,
    });
    setActiveSaveId(saved.id);
    setSavedTrips(listSavedTrips());
  };

  const handleLoadSaved = (id: string) => {
    const record = savedTrips.find((t) => t.id === id);
    if (!record) return;
    setPlan(record.plan);
    setLastPrompt(record.originalPrompt);
    setSectionChats(record.sectionChats);
    setActiveSaveId(record.id);
    setActiveTab("overview");
    setError("");
  };

  const handleDeleteSaved = (id: string) => {
    deleteSavedTrip(id);
    setSavedTrips(listSavedTrips());
    if (activeSaveId === id) setActiveSaveId(undefined);
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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div ref={mapContainer} style={{ flex: 1, minWidth: 0, height: "100%" }} aria-label="Trip map" />
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
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="submit" className="btn btn-primary" disabled={loading || !prompt.trim()} style={{ flex: 1, minWidth: 120 }}>
                  {loading ? "Planning…" : "Plan trip"}
                </button>
                {plan && (
                  <button type="button" className="btn" onClick={handleSave} disabled={loading}>
                    {activeSaveId ? "Update save" : "Save trip"}
                  </button>
                )}
                <button type="button" className="btn" onClick={handleNewTrip} disabled={loading || followUpLoading}>
                  New trip
                </button>
              </div>
            </form>
            {(error || ((loading || followUpLoading) && progress)) && (
              <p className={error && !loading && !followUpLoading ? "error" : "muted"} style={{ margin: "10px 0 0", fontSize: 13 }} role="status">
                {(loading || followUpLoading) && progress ? progress : error}
              </p>
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
