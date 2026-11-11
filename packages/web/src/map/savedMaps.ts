export interface SavedMapRecord {
  id: string;
  savedAt: number;
  label: string;
  originalPrompt: string;
  narrative: string;
  conversationId: string;
  scene: unknown;
}

const STORAGE_KEY = "gpt-maps-saved-maps";
const ACTIVE_MAP_KEY = "gpt-maps-active-map-id";
const MAX_SAVED = 15;

function readRaw(): SavedMapRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedMapRecord[]) : [];
  } catch {
    return [];
  }
}

export function readActiveMapId(): string | undefined {
  try {
    const id = localStorage.getItem(ACTIVE_MAP_KEY);
    return id && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

export function writeActiveMapId(id: string | undefined): void {
  try {
    if (id) localStorage.setItem(ACTIVE_MAP_KEY, id);
    else localStorage.removeItem(ACTIVE_MAP_KEY);
  } catch {
    /* ignore */
  }
}

export function listSavedMaps(): SavedMapRecord[] {
  return readRaw().sort((a, b) => b.savedAt - a.savedAt);
}

export function loadActiveMap(): SavedMapRecord | undefined {
  const id = readActiveMapId();
  if (!id) return undefined;
  return listSavedMaps().find((m) => m.id === id);
}

export function saveMap(
  record: Omit<SavedMapRecord, "savedAt" | "label"> & { label?: string }
): SavedMapRecord {
  const all = readRaw();
  const existing = all.find((m) => m.id === record.id);
  const label =
    record.label?.trim() ||
    existing?.label ||
    record.originalPrompt.trim().slice(0, 72) ||
    "Saved map";

  const entry: SavedMapRecord = {
    id: record.id,
    savedAt: Date.now(),
    label,
    originalPrompt: existing?.originalPrompt || record.originalPrompt,
    narrative: record.narrative,
    conversationId: record.conversationId,
    scene: record.scene,
  };

  const without = all.filter((m) => m.id !== entry.id);
  const next = [entry, ...without].slice(0, MAX_SAVED);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return entry;
}

export function deleteSavedMap(id: string): void {
  const next = readRaw().filter((m) => m.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  if (readActiveMapId() === id) writeActiveMapId(undefined);
}

export function clearActiveMap(): void {
  writeActiveMapId(undefined);
}
