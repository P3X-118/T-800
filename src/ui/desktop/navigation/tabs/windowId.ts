// Per-browser-tab session identity.
//
// Each open browser tab owns exactly one persisted session. The live
// session's ID is stored in sessionStorage (per-tab, so reloads keep
// it but a brand new tab gets its own slot). The persisted data for
// each session lives in localStorage under "t800_tabs:<id>" etc.
//
// Two problems this file solves:
//
// 1. sessionStorage cloning. When Chrome "Duplicate Tab" copies the
//    parent tab's sessionStorage into a new tab, or when an app uses
//    window.open() to a same-origin URL, both tabs initially read the
//    same session id. Without protection, they would restore the same
//    tabs list and the same instanceIds, and the backend's WebSocket
//    attach logic (terminal-session-manager.ts) would hand a live
//    session from one tab to the other. A heartbeat in localStorage
//    ("t800_session_hb:<id>" = Date.now(), refreshed every few seconds
//    while the tab is alive) lets the later-loading tab detect that
//    its id is already claimed and pick a different one.
//
// 2. Resuming after a close. A genuinely fresh tab (no sessionStorage)
//    still wants to resume the user's work. On first load we scan
//    localStorage for sessions whose heartbeat has gone stale (meaning
//    no other live tab is holding them) and auto-claim the most
//    recent one. If no free session exists, we create a new empty
//    one. listPersistedSessions() + switchToSession() back a session
//    switcher UI for picking a different session manually.

const SESSION_ID_KEY = "t800_session_id";
const TABS_PREFIX = "t800_tabs:";
const CURRENT_TAB_PREFIX = "t800_currentTab:";
const SPLIT_LAYOUT_PREFIX = "t800_splitLayout:";
const GROUPS_PREFIX = "t800_groups:";
const HEARTBEAT_PREFIX = "t800_session_hb:";
const LEGACY_TABS_KEY = "t800_tabs";
const LEGACY_CURRENT_TAB_KEY = "t800_currentTab";
const LEGACY_SPLIT_LAYOUT_KEY = "t800_splitLayout";

const HEARTBEAT_INTERVAL_MS = 3000;
// Must be > HEARTBEAT_INTERVAL_MS with margin for paused timers
// (background tabs throttle setInterval). 10s = ~3 missed ticks.
const HEARTBEAT_STALE_MS = 10000;

let cachedSessionId: string | null = null;

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function heartbeatKey(id: string): string {
  return `${HEARTBEAT_PREFIX}${id}`;
}

function readHeartbeat(id: string): number {
  try {
    const raw = localStorage.getItem(heartbeatKey(id));
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

function isSessionLive(id: string): boolean {
  const ts = readHeartbeat(id);
  if (!ts) return false;
  return Date.now() - ts < HEARTBEAT_STALE_MS;
}

export interface PersistedSession {
  id: string;
  lastSeenAt: number;
  isLive: boolean;
}

export function listPersistedSessions(): PersistedSession[] {
  const out: PersistedSession[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(TABS_PREFIX)) continue;
      const id = key.slice(TABS_PREFIX.length);
      const lastSeenAt = readHeartbeat(id);
      out.push({ id, lastSeenAt, isLive: isSessionLive(id) });
    }
  } catch {
    /* ignore */
  }
  return out.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

// One-time move of the pre-windowId global snapshot into a new
// per-session slot, so users who upgrade while having open tabs
// don't lose their work. No-op if any per-session keys already exist.
function migrateLegacy(): string | null {
  try {
    const legacyTabs = localStorage.getItem(LEGACY_TABS_KEY);
    if (!legacyTabs) return null;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(TABS_PREFIX)) return null;
    }
    const newId = generateId();
    localStorage.setItem(`${TABS_PREFIX}${newId}`, legacyTabs);
    const legacyCurrent = localStorage.getItem(LEGACY_CURRENT_TAB_KEY);
    if (legacyCurrent) {
      localStorage.setItem(`${CURRENT_TAB_PREFIX}${newId}`, legacyCurrent);
    }
    const legacySplit = localStorage.getItem(LEGACY_SPLIT_LAYOUT_KEY);
    if (legacySplit) {
      localStorage.setItem(`${SPLIT_LAYOUT_PREFIX}${newId}`, legacySplit);
    }
    localStorage.removeItem(LEGACY_TABS_KEY);
    localStorage.removeItem(LEGACY_CURRENT_TAB_KEY);
    localStorage.removeItem(LEGACY_SPLIT_LAYOUT_KEY);
    return newId;
  } catch {
    return null;
  }
}

function pickFreeSessionOrCreate(): string {
  migrateLegacy();
  const free = listPersistedSessions().filter((s) => !s.isLive);
  if (free.length > 0) return free[0].id;
  return generateId();
}

export function getSessionId(): string {
  if (cachedSessionId) return cachedSessionId;
  if (typeof window === "undefined") {
    cachedSessionId = generateId();
    return cachedSessionId;
  }
  try {
    const existing = window.sessionStorage.getItem(SESSION_ID_KEY);
    if (existing && !isSessionLive(existing)) {
      cachedSessionId = existing;
      return existing;
    }
    // Either no sessionStorage entry (fresh tab), or a live sibling
    // tab is already holding this id (sessionStorage was cloned).
    const picked = pickFreeSessionOrCreate();
    window.sessionStorage.setItem(SESSION_ID_KEY, picked);
    cachedSessionId = picked;
    return picked;
  } catch {
    cachedSessionId = generateId();
    return cachedSessionId;
  }
}

export function tabsKey(): string {
  return `${TABS_PREFIX}${getSessionId()}`;
}

export function currentTabKey(): string {
  return `${CURRENT_TAB_PREFIX}${getSessionId()}`;
}

export function splitLayoutKey(): string {
  return `${SPLIT_LAYOUT_PREFIX}${getSessionId()}`;
}

export function groupsKey(): string {
  return `${GROUPS_PREFIX}${getSessionId()}`;
}

// Switch this tab to a different persisted session. Reload so React
// state is rebuilt from the new session's localStorage keys.
export function switchToSession(id: string): void {
  try {
    window.sessionStorage.setItem(SESSION_ID_KEY, id);
    cachedSessionId = id;
    window.location.reload();
  } catch {
    /* ignore */
  }
}

// Removes all persisted data for a session (tabs, currentTab, split
// layout, heartbeat, and any terminal session keys associated with
// the instanceIds it owned). Safe to call from a session switcher.
export function deletePersistedSession(id: string): void {
  try {
    localStorage.removeItem(`${TABS_PREFIX}${id}`);
    localStorage.removeItem(`${CURRENT_TAB_PREFIX}${id}`);
    localStorage.removeItem(`${SPLIT_LAYOUT_PREFIX}${id}`);
    localStorage.removeItem(`${GROUPS_PREFIX}${id}`);
    localStorage.removeItem(heartbeatKey(id));
  } catch {
    /* ignore */
  }
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

// Starts (once) the recurring write of this tab's heartbeat. Returns
// a stop function for React cleanup; calling it removes the heartbeat
// key so siblings can immediately claim this session.
export function startSessionHeartbeat(): () => void {
  if (typeof window === "undefined") return () => {};
  if (heartbeatTimer) return () => {};
  const id = getSessionId();
  const write = () => {
    try {
      localStorage.setItem(heartbeatKey(id), String(Date.now()));
    } catch {
      /* ignore */
    }
  };
  const clear = () => {
    try {
      localStorage.removeItem(heartbeatKey(id));
    } catch {
      /* ignore */
    }
  };
  write();
  heartbeatTimer = setInterval(write, HEARTBEAT_INTERVAL_MS);
  window.addEventListener("beforeunload", clear);
  return () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    window.removeEventListener("beforeunload", clear);
    clear();
  };
}

// Exported for clearT800SessionStorage() so a logout/clear wipes
// heartbeats of this and any other sessions too.
export function listAllSessionStorageKeys(): {
  tabsKeys: string[];
  currentTabKeys: string[];
  splitLayoutKeys: string[];
  groupsKeys: string[];
  heartbeatKeys: string[];
} {
  const tabsKeys: string[] = [];
  const currentTabKeys: string[] = [];
  const splitLayoutKeys: string[] = [];
  const groupsKeys: string[] = [];
  const heartbeatKeys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith(TABS_PREFIX)) tabsKeys.push(key);
      else if (key.startsWith(CURRENT_TAB_PREFIX)) currentTabKeys.push(key);
      else if (key.startsWith(SPLIT_LAYOUT_PREFIX)) splitLayoutKeys.push(key);
      else if (key.startsWith(GROUPS_PREFIX)) groupsKeys.push(key);
      else if (key.startsWith(HEARTBEAT_PREFIX)) heartbeatKeys.push(key);
    }
  } catch {
    /* ignore */
  }
  return {
    tabsKeys,
    currentTabKeys,
    splitLayoutKeys,
    groupsKeys,
    heartbeatKeys,
  };
}
