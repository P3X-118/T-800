import type { SplitLayoutNode } from "@/ui/desktop/navigation/tabs/splitLayout.ts";
import type { SSHHost } from "@/types/index.ts";

const STORAGE_KEY = "t800_savedSplitGroups";

/**
 * Tab snapshot stored inside a saved split group. The runtime `tabId` stored
 * in a SplitLayoutNode leaf is ephemeral, so we instead serialize each tab
 * with enough information to recreate it on load.
 *
 * A saved layout tree references each snapshot by its stable `slotId`
 * (0, 1, 2, …) rather than the runtime tab id.
 */
export interface SavedSplitGroupTab {
  slotId: number;
  type: string;
  title: string;
  hostConfig?: SSHHost;
  connectionConfig?: Record<string, unknown>;
}

export interface SavedSplitGroup {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /**
   * The split layout with leaf `tabId` values pointing at slot IDs (not
   * runtime tab IDs). On load, we map slotIds → newly-created runtime tab IDs.
   */
  layout: SplitLayoutNode;
  tabs: SavedSplitGroupTab[];
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function loadSavedSplitGroups(): SavedSplitGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (g): g is SavedSplitGroup =>
        g &&
        typeof g === "object" &&
        typeof g.id === "string" &&
        typeof g.name === "string" &&
        g.layout &&
        Array.isArray(g.tabs),
    );
  } catch {
    return [];
  }
}

export function persistSavedSplitGroups(groups: SavedSplitGroup[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  } catch {
    /* ignore quota / privacy errors */
  }
}

/**
 * Deep-clone a layout and rewrite every leaf's tabId according to `mapping`.
 */
function remapLayout(
  node: SplitLayoutNode,
  mapping: (id: number) => number,
): SplitLayoutNode {
  if (node.type === "leaf") {
    return { type: "leaf", tabId: mapping(node.tabId) };
  }
  return {
    type: "split",
    direction: node.direction,
    children: node.children.map((c) => remapLayout(c, mapping)),
  };
}

/**
 * Build a saved split group from the current runtime state.
 *
 * - `layout` is the live split tree (leaves hold runtime tab IDs)
 * - `getRuntimeTab` returns the runtime Tab data for a given tab id, or null
 *   if it isn't present (those leaves will be dropped)
 */
export function buildSavedSplitGroup(
  name: string,
  layout: SplitLayoutNode,
  getRuntimeTab: (tabId: number) => {
    type: string;
    title: string;
    hostConfig?: SSHHost;
    connectionConfig?: Record<string, unknown>;
  } | null,
): SavedSplitGroup | null {
  // Collect the leaf ids in traversal order and build slot mapping
  const leafIds: number[] = [];
  function collect(node: SplitLayoutNode) {
    if (node.type === "leaf") leafIds.push(node.tabId);
    else node.children.forEach(collect);
  }
  collect(layout);

  const runtimeToSlot = new Map<number, number>();
  const tabs: SavedSplitGroupTab[] = [];
  for (const id of leafIds) {
    if (runtimeToSlot.has(id)) continue;
    const t = getRuntimeTab(id);
    if (!t) continue;
    const slotId = runtimeToSlot.size;
    runtimeToSlot.set(id, slotId);
    tabs.push({
      slotId,
      type: t.type,
      title: t.title,
      hostConfig: t.hostConfig,
      connectionConfig: t.connectionConfig,
    });
  }

  if (tabs.length < 2) return null; // not a real split

  const remapped = remapLayout(layout, (id) => {
    const s = runtimeToSlot.get(id);
    return s == null ? -1 : s;
  });

  const now = Date.now();
  return {
    id: generateId(),
    name,
    createdAt: now,
    updatedAt: now,
    layout: remapped,
    tabs,
  };
}

/**
 * Instantiate a saved split group into a new live layout by creating real
 * tabs via `addTab`. Returns the new runtime layout tree (with live tab IDs)
 * and the list of newly-created runtime tab IDs in slot order.
 */
export function instantiateSavedSplitGroup(
  group: SavedSplitGroup,
  addTab: (tab: {
    type: string;
    title: string;
    hostConfig?: SSHHost;
    connectionConfig?: Record<string, unknown>;
  }) => number,
): { layout: SplitLayoutNode; tabIds: number[] } {
  const slotToRuntime = new Map<number, number>();
  const tabIds: number[] = [];
  for (const tab of group.tabs) {
    const id = addTab({
      type: tab.type,
      title: tab.title,
      hostConfig: tab.hostConfig,
      connectionConfig: tab.connectionConfig,
    });
    slotToRuntime.set(tab.slotId, id);
    tabIds.push(id);
  }

  const layout = remapLayout(group.layout, (slotId) => {
    const runtime = slotToRuntime.get(slotId);
    return runtime == null ? -1 : runtime;
  });

  return { layout, tabIds };
}
