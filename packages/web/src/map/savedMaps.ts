export interface SavedMapRecord {
  id: string;
  savedAt: number;
  originalPrompt: string;
  narrative: string;
  conversationId: string;
  scene: unknown;
}

const ACTIVE_MAP_KEY = "gpt-maps-active-map";
/** Legacy keys from the old history dropdown — cleared when saving. */
const LEGACY_LIST_KEY = "gpt-maps-saved-maps";
const LEGACY_ID_KEY = "gpt-maps-active-map-id";

export function loadActiveMap(): SavedMapRecord | undefined {
  try {
    const raw = localStorage.getItem(ACTIVE_MAP_KEY);
    if (!raw) return loadLegacyActiveMap();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return undefined;
    return parsed as SavedMapRecord;
  } catch {
    return undefined;
  }
}

function loadLegacyActiveMap(): SavedMapRecord | undefined {
  try {
    const id = localStorage.getItem(LEGACY_ID_KEY);
    const listRaw = localStorage.getItem(LEGACY_LIST_KEY);
    if (!id || !listRaw) return undefined;
    const list = JSON.parse(listRaw) as SavedMapRecord[];
    if (!Array.isArray(list)) return undefined;
    const hit = list.find((m) => m.id === id);
    if (hit) {
      localStorage.setItem(ACTIVE_MAP_KEY, JSON.stringify(hit));
      localStorage.removeItem(LEGACY_LIST_KEY);
      localStorage.removeItem(LEGACY_ID_KEY);
    }
    return hit;
  } catch {
    return undefined;
  }
}

export function saveMap(
  record: Omit<SavedMapRecord, "savedAt"> & { savedAt?: number }
): SavedMapRecord {
  const entry: SavedMapRecord = {
    id: record.id,
    savedAt: record.savedAt ?? Date.now(),
    originalPrompt: record.originalPrompt,
    narrative: record.narrative,
    conversationId: record.conversationId,
    scene: record.scene,
  };
  localStorage.setItem(ACTIVE_MAP_KEY, JSON.stringify(entry));
  localStorage.removeItem(LEGACY_LIST_KEY);
  localStorage.removeItem(LEGACY_ID_KEY);
  return entry;
}

export function clearActiveMap(): void {
  localStorage.removeItem(ACTIVE_MAP_KEY);
  localStorage.removeItem(LEGACY_ID_KEY);
}
