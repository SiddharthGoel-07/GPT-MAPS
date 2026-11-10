import type { TripPlanResponse } from "@map-renderer/shared";

export interface TripChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SavedTripRecord {
  id: string;
  savedAt: number;
  originalPrompt: string;
  plan: TripPlanResponse;
  sectionChats: Record<string, TripChatMessage[]>;
}

const STORAGE_KEY = "gpt-maps-saved-trips";
const ACTIVE_TRIP_KEY = "gpt-maps-active-trip-id";
const MAX_SAVED = 20;

export function readActiveTripId(): string | undefined {
  try {
    const id = sessionStorage.getItem(ACTIVE_TRIP_KEY);
    return id && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

export function writeActiveTripId(id: string | undefined): void {
  try {
    if (id) sessionStorage.setItem(ACTIVE_TRIP_KEY, id);
    else sessionStorage.removeItem(ACTIVE_TRIP_KEY);
  } catch {
    /* ignore */
  }
}

/** Restore the trip the user had open in this browser tab session. */
export function loadActiveTrip(): SavedTripRecord | undefined {
  const id = readActiveTripId();
  if (!id) return undefined;
  return listSavedTrips().find((t) => t.id === id);
}

function readRaw(): SavedTripRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedTripRecord[]) : [];
  } catch {
    return [];
  }
}

export function listSavedTrips(): SavedTripRecord[] {
  return readRaw().sort((a, b) => b.savedAt - a.savedAt);
}

export function saveTrip(record: Omit<SavedTripRecord, "id" | "savedAt"> & { id?: string; savedAt?: number }): SavedTripRecord {
  const all = readRaw();
  const entry: SavedTripRecord = {
    id: record.id ?? crypto.randomUUID(),
    savedAt: record.savedAt ?? Date.now(),
    originalPrompt: record.originalPrompt,
    plan: record.plan,
    sectionChats: record.sectionChats,
  };
  const without = all.filter((t) => t.id !== entry.id);
  const next = [entry, ...without].slice(0, MAX_SAVED);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return entry;
}

export function deleteSavedTrip(id: string): void {
  const next = readRaw().filter((t) => t.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function sectionKey(section: "overview" | number): string {
  return section === "overview" ? "overview" : `day-${section}`;
}
