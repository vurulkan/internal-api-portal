// Try-it request history, per operation, in this browser only. By default it
// keeps what is harmless (method, path template, status, time); parameter values
// and bodies only when the user turns that on. Header values never.
import { readPref, writePref } from './storage';

export const HISTORY_LIMIT = 20;
const SAVE_DETAILS_KEY = 'portal.history.saveDetails';

export type HistoryEntry = {
  at: string;
  method: string;
  path: string;
  status: number;
  durationMs?: number;
  /** Only with "save details": parameter values and body. */
  values?: Record<string, string>;
  body?: string;
};

const key = (apiId: number, opKey: string) => `portal.history.${apiId}.${opKey}`;

export function saveDetailsEnabled() {
  return readPref(SAVE_DETAILS_KEY) === '1';
}

export function setSaveDetails(on: boolean) {
  writePref(SAVE_DETAILS_KEY, on ? '1' : '0');
}

export function readHistory(apiId: number, opKey: string): HistoryEntry[] {
  try {
    const raw = JSON.parse(readPref(key(apiId, opKey)) ?? '[]');
    return Array.isArray(raw) ? (raw as HistoryEntry[]).slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

export function addHistory(
  apiId: number,
  opKey: string,
  entry: HistoryEntry,
  details: { values: Record<string, string>; body: string },
) {
  const stored: HistoryEntry = {
    at: entry.at,
    method: entry.method,
    path: entry.path,
    status: entry.status,
    durationMs: entry.durationMs,
  };
  if (saveDetailsEnabled()) {
    stored.values = details.values;
    stored.body = details.body;
  }
  const next = [stored, ...readHistory(apiId, opKey)].slice(0, HISTORY_LIMIT);
  writePref(key(apiId, opKey), JSON.stringify(next));
  return next;
}

export function clearHistory(apiId: number, opKey: string) {
  writePref(key(apiId, opKey), '[]');
}
