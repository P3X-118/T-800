import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import type { TabContextTab } from "../../../types/index.js";
import {
  type SplitLayoutNode,
  type DropPosition,
  defaultLayoutFromIds,
  getLeafIds,
  splitLeaf as splitLeafOp,
  swapLeaves as swapLeavesOp,
  removeLeaf as removeLeafOp,
  insertAtRoot as insertAtRootOp,
  insertAdjacentRowOrColumn as insertAdjacentRowOrColumnOp,
  pruneLayout,
} from "./splitLayout.js";
import {
  tabsKey,
  currentTabKey,
  splitLayoutKey,
  startSessionHeartbeat,
  listAllSessionStorageKeys,
} from "./windowId.js";

export type Tab = TabContextTab;
export type { SplitLayoutNode, DropPosition };

// Home and Host Manager are pinned to the leftmost positions of the tab
// bar in this order. enforcePinOrder() is applied after every tabs[]
// mutation so reorder/add/remove can never put a non-pinned tab to the
// left of a pinned one, and the two pinned tabs always appear in the
// Home → ssh_manager order regardless of insertion sequence.
const PIN_ORDER: readonly string[] = ["home", "ssh_manager"];
const pinRank = (type: string) => {
  const i = PIN_ORDER.indexOf(type);
  return i < 0 ? PIN_ORDER.length : i;
};
const enforcePinOrder = (arr: Tab[]): Tab[] => {
  // Stable sort by pin rank — pinned tabs float to their positions, all
  // other tabs retain their relative order.
  const withIdx = arr.map((t, i) => ({ t, i }));
  withIdx.sort((a, b) => {
    const d = pinRank(a.t.type) - pinRank(b.t.type);
    return d !== 0 ? d : a.i - b.i;
  });
  const sorted = withIdx.map((x) => x.t);
  // Avoid creating a new array reference if order didn't actually change.
  for (let k = 0; k < arr.length; k++) {
    if (sorted[k] !== arr[k]) return sorted;
  }
  return arr;
};

export interface TabDragToSplit {
  draggedTabId: number;
  isOverTerminalArea: boolean;
}

interface TabContextType {
  tabs: Tab[];
  currentTab: number | null;
  allSplitScreenTab: number[];
  splitLayout: SplitLayoutNode | null;
  addTab: (tab: Omit<Tab, "id">) => number;
  addTabAfter: (afterTabId: number, tab: Omit<Tab, "id">) => number;
  removeTab: (tabId: number) => void;
  setCurrentTab: (tabId: number) => void;
  setSplitScreenTab: (tabId: number) => void;
  setSplitScreenTabs: (tabIds: number[]) => void;
  setSplitLayout: (layout: SplitLayoutNode | null) => void;
  splitPanelAt: (
    targetTabId: number,
    newTabId: number,
    position: DropPosition,
  ) => void;
  addToSplitRoot: (
    newTabId: number,
    position: "top" | "right" | "bottom" | "left",
  ) => void;
  swapInSplitLayout: (aTabId: number, bTabId: number) => void;
  removeFromSplitLayout: (tabId: number) => void;
  getTab: (tabId: number) => Tab | undefined;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  updateHostConfig: (
    hostId: number,
    newHostConfig: {
      id: number;
      name?: string;
      username: string;
      ip: string;
      port: number;
    },
  ) => void;
  updateTab: (tabId: number, updates: Partial<Omit<Tab, "id">>) => void;
  tabDragToSplit: TabDragToSplit | null;
  startTabDragToSplit: (tabId: number) => void;
  setDragOverTerminalArea: (isOver: boolean) => void;
  executeDragSplit: (
    draggedTabId: number,
    target?: { tabId: number; position: DropPosition },
  ) => void;
  cancelTabDragToSplit: () => void;
}

const TabContext = createContext<TabContextType | undefined>(undefined);

export function useTabs() {
  const context = useContext(TabContext);
  if (context === undefined) {
    throw new Error("useTabs must be used within a TabProvider");
  }
  return context;
}

// Returns the tab context if available, or undefined when used outside
// a TabProvider (e.g. Terminal embedded in dashboard cards). Use this
// when the caller wants to optionally interact with tabs without
// requiring the provider to be present.
export function useTabsOptional() {
  return useContext(TabContext);
}

interface TabProviderProps {
  children: ReactNode;
}

export function isPersistenceEnabled(): boolean {
  // Default to true unless the user has explicitly disabled it
  if (typeof window === "undefined") return true;
  const saved = localStorage.getItem("enableTerminalSessionPersistence");
  return saved !== "false";
}

export function clearT800SessionStorage() {
  // Clear pre-windowId global snapshot in case an upgrade left it around.
  localStorage.removeItem("t800_tabs");
  localStorage.removeItem("t800_currentTab");
  localStorage.removeItem("t800_splitLayout");
  const { tabsKeys, currentTabKeys, splitLayoutKeys, heartbeatKeys } =
    listAllSessionStorageKeys();
  const keysToRemove: string[] = [
    ...tabsKeys,
    ...currentTabKeys,
    ...splitLayoutKeys,
    ...heartbeatKeys,
  ];
  // t800_session_<hostId>_<instanceId> (per-terminal reconnect tokens)
  // are separate from the per-session storage above. Keep them in the
  // same sweep so a logout clear wipes reconnect tokens too.
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (key.startsWith("t800_session_")) keysToRemove.push(key);
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));
}

export function TabProvider({ children }: TabProviderProps) {
  const { t } = useTranslation();
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const shouldRestore = isPersistenceEnabled();

    if (!shouldRestore) {
      return [{ id: 1, type: "home", title: "Home" }];
    }

    try {
      // getSessionId() either reuses this tab's sessionStorage id or
      // claims the most-recently-used free session (see windowId.ts).
      // Either way, tabsKey() points at the authoritative snapshot.
      const perSession = localStorage.getItem(tabsKey());
      if (perSession) {
        const parsed = JSON.parse(perSession) as Tab[];
        const restored: Tab[] = [{ id: 1, type: "home", title: "Home" }];
        for (const tab of parsed) {
          if (tab.type === "home") continue;
          const restoredTab: Tab = {
            ...tab,
            instanceId: tab.instanceId,
            terminalRef:
              tab.type === "terminal"
                ? React.createRef<{ disconnect?: () => void }>()
                : undefined,
            hostConfig: tab.hostConfig
              ? {
                  ...tab.hostConfig,
                  instanceId: tab.instanceId,
                }
              : undefined,
          };
          restored.push(restoredTab);
        }
        if (restored.length > 1) return enforcePinOrder(restored);
      }
    } catch {
      /* ignore corrupt data */
    }
    return [{ id: 1, type: "home", title: "Home" }];
  });
  const [currentTab, setCurrentTab] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(currentTabKey());
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (parsed && tabs.some((t) => t.id === parsed)) return parsed;
      }
    } catch {
      /* ignore */
    }
    return 1;
  });
  const [splitLayout, setSplitLayoutStateRaw] =
    useState<SplitLayoutNode | null>(() => {
      if (!isPersistenceEnabled()) return null;
      try {
        const saved = localStorage.getItem(splitLayoutKey());
        if (!saved) return null;
        const parsed = JSON.parse(saved) as SplitLayoutNode;
        // Persisted single-leaf isn't a real split — discard.
        if (parsed && parsed.type === "leaf") return null;
        return parsed;
      } catch {
        return null;
      }
    });
  // Always normalize: a single-leaf root isn't a real split.
  const setSplitLayoutState = useCallback(
    (
      updater:
        | SplitLayoutNode
        | null
        | ((prev: SplitLayoutNode | null) => SplitLayoutNode | null),
    ) => {
      setSplitLayoutStateRaw((prev) => {
        const next =
          typeof updater === "function"
            ? (
                updater as (p: SplitLayoutNode | null) => SplitLayoutNode | null
              )(prev)
            : updater;
        if (!next) return null;
        if (next.type === "leaf") return null;
        return next;
      });
    },
    [],
  );
  const allSplitScreenTab = useMemo(
    () => getLeafIds(splitLayout),
    [splitLayout],
  );
  const setAllSplitScreenTab = useCallback(
    (updater: number[] | ((prev: number[]) => number[])) => {
      setSplitLayoutState((prevLayout) => {
        const prevIds = getLeafIds(prevLayout);
        const nextIds =
          typeof updater === "function"
            ? (updater as (p: number[]) => number[])(prevIds)
            : updater;
        if (nextIds.length === 0) return null;
        // If the new ID set matches the existing leaves, keep the custom layout
        if (
          prevLayout &&
          nextIds.length === prevIds.length &&
          nextIds.every((id, i) => id === prevIds[i])
        ) {
          return prevLayout;
        }
        // If the new IDs are a subset of existing leaves (only removals), prune
        if (
          prevLayout &&
          nextIds.every((id) => prevIds.includes(id)) &&
          nextIds.length < prevIds.length
        ) {
          return pruneLayout(prevLayout, new Set(nextIds));
        }
        return defaultLayoutFromIds(nextIds);
      });
    },
    [],
  );
  const [initialMaxId] = useState(() => {
    let maxId = 1;
    tabs.forEach((tab) => {
      if (tab.id > maxId) maxId = tab.id;
    });
    return maxId + 1;
  });
  const nextTabId = useRef(initialMaxId);

  useEffect(() => {
    const shouldSave = isPersistenceEnabled();

    if (shouldSave) {
      const serializable = tabs
        .filter((t) => t.type !== "home")
        .map(({ terminalRef, ...rest }) => rest);
      const serialized = JSON.stringify(serializable);
      localStorage.setItem(tabsKey(), serialized);
      localStorage.setItem(currentTabKey(), String(currentTab));
    } else {
      localStorage.removeItem(tabsKey());
      localStorage.removeItem(currentTabKey());
    }
  }, [tabs, currentTab]);

  useEffect(() => {
    if (isPersistenceEnabled() && splitLayout) {
      localStorage.setItem(splitLayoutKey(), JSON.stringify(splitLayout));
    } else {
      localStorage.removeItem(splitLayoutKey());
    }
  }, [splitLayout]);

  // Heartbeat proves this tab is alive, so sibling tabs (duplicate
  // tab / window.open with cloned sessionStorage) can see that this
  // session id is claimed and pick a different one. Also lets fresh
  // tabs know which sessions are available to auto-resume.
  useEffect(() => startSessionHeartbeat(), []);

  // Prune the restored split layout against the actual tab list (drops
  // references to tabs that no longer exist).
  const didPruneRef = useRef(false);
  useEffect(() => {
    if (didPruneRef.current) return;
    if (!splitLayout) {
      didPruneRef.current = true;
      return;
    }
    const validIds = new Set(tabs.map((t) => t.id));
    const leafIds = getLeafIds(splitLayout);
    const hasMissing = leafIds.some((id) => !validIds.has(id));
    if (hasMissing) {
      const keep = leafIds.filter((id) => validIds.has(id));
      if (keep.length === 0) {
        setSplitLayoutState(null);
      } else {
        setSplitLayoutState(pruneLayout(splitLayout, new Set(keep)));
      }
    }
    didPruneRef.current = true;
  }, [tabs, splitLayout]);

  React.useEffect(() => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === 1 && tab.type === "home"
          ? { ...tab, title: t("nav.home") }
          : tab,
      ),
    );
  }, [t]);

  // When hosts are deleted, prune any restored tabs that reference
  // hosts no longer in the database. This prevents stale tabs from
  // polling dead /metrics/ endpoints after a page reload.
  const didHostPruneRef = useRef(false);
  React.useEffect(() => {
    if (didHostPruneRef.current) return;
    const hostTabs = tabs.filter(
      (tab) =>
        tab.hostConfig &&
        typeof (tab.hostConfig as Record<string, unknown>).id === "number",
    );
    if (hostTabs.length === 0) return;

    didHostPruneRef.current = true;

    (async () => {
      try {
        const { getSSHHosts } = await import("@/ui/main-axios.ts");
        const hosts = await getSSHHosts();
        const validIds = new Set(hosts.map((h) => h.id));
        setTabs((prev) => {
          const pruned = prev.filter((tab) => {
            if (!tab.hostConfig) return true;
            const hostId = (tab.hostConfig as Record<string, unknown>)
              .id as number;
            return !hostId || validIds.has(hostId);
          });
          if (pruned.length === prev.length) return prev;
          return enforcePinOrder(pruned);
        });
      } catch {
        // API not available yet — skip pruning
      }
    })();
  }, [tabs]);

  function computeUniqueTitle(
    tabType: Tab["type"],
    desiredTitle: string | undefined,
  ): string {
    const defaultTitle =
      tabType === "server_stats"
        ? t("nav.serverStats")
        : tabType === "file_manager"
          ? t("nav.fileManager")
          : tabType === "tunnel"
            ? t("nav.tunnels")
            : tabType === "docker"
              ? t("nav.docker")
              : t("nav.terminal");
    const baseTitle = (desiredTitle || defaultTitle).trim();
    const match = baseTitle.match(/^(.*) \((\d+)\)$/);
    const root = match ? match[1] : baseTitle;

    const usedNumbers = new Set<number>();
    let rootUsed = false;
    tabs.forEach((t) => {
      if (!t.title) return;
      if (t.title === root) {
        rootUsed = true;
        return;
      }
      const m = t.title.match(
        new RegExp(
          `^${root.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")} \\((\\d+)\\)$`,
        ),
      );
      if (m) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n)) usedNumbers.add(n);
      }
    });

    if (!rootUsed) return root;
    let n = 2;
    while (usedNumbers.has(n)) n += 1;
    return `${root} (${n})`;
  }

  const addTab = (tabData: Omit<Tab, "id">): number => {
    if (tabData.type === "ssh_manager") {
      const existingTab = tabs.find((t) => t.type === "ssh_manager");
      if (existingTab) {
        setTabs((prev) =>
          enforcePinOrder(
            prev.map((t) =>
              t.id === existingTab.id
                ? {
                    ...t,
                    title: existingTab.title,
                    hostConfig: tabData.hostConfig
                      ? { ...tabData.hostConfig }
                      : undefined,
                    initialTab: tabData.initialTab,
                    _updateTimestamp: Date.now(),
                  }
                : t,
            ),
          ),
        );
        setCurrentTab(existingTab.id);
        setAllSplitScreenTab((prev) =>
          prev.filter((tid) => tid !== existingTab.id),
        );
        return existingTab.id;
      }
    }

    const id = nextTabId.current++;
    const instanceId = `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const needsUniqueTitle =
      tabData.type === "terminal" ||
      tabData.type === "server_stats" ||
      tabData.type === "file_manager" ||
      tabData.type === "tunnel" ||
      tabData.type === "docker";
    const effectiveTitle = needsUniqueTitle
      ? computeUniqueTitle(tabData.type, tabData.title)
      : tabData.title || "";
    const newTab: Tab = {
      ...tabData,
      id,
      instanceId,
      title: effectiveTitle,
      terminalRef:
        tabData.type === "terminal"
          ? React.createRef<{ disconnect?: () => void }>()
          : undefined,
      hostConfig: tabData.hostConfig
        ? {
            ...tabData.hostConfig,
            instanceId,
          }
        : undefined,
    };
    setTabs((prev) => enforcePinOrder([...prev, newTab]));
    setCurrentTab(id);
    setAllSplitScreenTab((prev) => prev.filter((tid) => tid !== id));
    return id;
  };

  const addTabAfter = (
    afterTabId: number,
    tabData: Omit<Tab, "id">,
  ): number => {
    // Reuse addTab to create the tab (it appends to the end), then move
    // it just after `afterTabId`. The functional setTabs updater chains,
    // so the second update sees the array produced by addTab.
    const id = addTab(tabData);
    setTabs((prev) => {
      const fromIdx = prev.findIndex((t) => t.id === id);
      const afterIdx = prev.findIndex((t) => t.id === afterTabId);
      if (fromIdx < 0 || afterIdx < 0 || fromIdx === afterIdx + 1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      const adjusted = fromIdx < afterIdx ? afterIdx : afterIdx + 1;
      next.splice(adjusted, 0, moved);
      return enforcePinOrder(next);
    });
    return id;
  };

  const removeTab = (tabId: number) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (
      tab &&
      tab.terminalRef?.current &&
      typeof tab.terminalRef.current.disconnect === "function"
    ) {
      tab.terminalRef.current.disconnect();
    }

    setTabs((prev) => prev.filter((tab) => tab.id !== tabId));

    setAllSplitScreenTab((prev) => {
      const newSplits = prev.filter((id) => id !== tabId);
      if (newSplits.length <= 1) {
        return [];
      }
      return newSplits;
    });

    if (currentTab === tabId) {
      const remainingTabs = tabs.filter((tab) => tab.id !== tabId);
      if (remainingTabs.length > 0) {
        const remainingSplitTabs = allSplitScreenTab.filter(
          (id) => id !== tabId,
        );
        if (remainingSplitTabs.length > 0) {
          setCurrentTab(remainingSplitTabs[0]);
        } else {
          setCurrentTab(remainingTabs[0].id);
        }
      } else {
        setCurrentTab(1);
      }
    }
  };

  const setSplitScreenTab = (tabId: number) => {
    setSplitLayoutState((prevLayout) => {
      const prevIds = getLeafIds(prevLayout);
      if (prevIds.includes(tabId)) {
        const next = prevIds.filter((id) => id !== tabId);
        if (next.length === 0) return null;
        return pruneLayout(prevLayout, new Set(next));
      } else if (prevIds.length < 12) {
        const next = [...prevIds, tabId];
        return defaultLayoutFromIds(next);
      }
      return prevLayout;
    });
  };

  const getTab = (tabId: number) => {
    return tabs.find((tab) => tab.id === tabId);
  };

  const isReorderingRef = useRef(false);

  const reorderTabs = (fromIndex: number, toIndex: number) => {
    if (isReorderingRef.current) return;

    isReorderingRef.current = true;

    setTabs((prev) => {
      const newTabs = [...prev];
      const [movedTab] = newTabs.splice(fromIndex, 1);

      const maxIndex = newTabs.length;
      const safeToIndex = Math.min(toIndex, maxIndex);

      newTabs.splice(safeToIndex, 0, movedTab);

      setTimeout(() => {
        isReorderingRef.current = false;
      }, 100);

      return enforcePinOrder(newTabs);
    });
  };

  const updateHostConfig = useCallback(
    (
      hostId: number,
      newHostConfig: {
        id: number;
        name?: string;
        username: string;
        ip: string;
        port: number;
      },
    ) => {
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.hostConfig && tab.hostConfig.id === hostId) {
            if (tab.type === "ssh_manager") {
              return {
                ...tab,
                hostConfig: {
                  ...newHostConfig,
                  instanceId: tab.hostConfig.instanceId,
                },
              };
            }

            return {
              ...tab,
              hostConfig: {
                ...newHostConfig,
                instanceId: tab.hostConfig.instanceId,
              },
              title: newHostConfig.name?.trim()
                ? newHostConfig.name
                : t("nav.hostTabTitle", {
                    username: newHostConfig.username,
                    ip: newHostConfig.ip,
                    port: newHostConfig.port,
                  }),
            };
          }
          return tab;
        }),
      );
    },
    [t],
  );

  const updateTab = useCallback(
    (tabId: number, updates: Partial<Omit<Tab, "id">>) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === tabId
            ? { ...tab, ...updates, _updateTimestamp: Date.now() }
            : tab,
        ),
      );
    },
    [],
  );

  const setSplitScreenTabs = useCallback((tabIds: number[]) => {
    const limited = tabIds.slice(0, 12);
    setSplitLayoutState((prevLayout) => {
      const prevIds = getLeafIds(prevLayout);
      // If the IDs match exactly, preserve the existing custom layout
      if (
        prevLayout &&
        limited.length === prevIds.length &&
        limited.every((id, i) => id === prevIds[i])
      ) {
        return prevLayout;
      }
      // If only removing leaves, prune to keep custom arrangement
      if (
        prevLayout &&
        limited.every((id) => prevIds.includes(id)) &&
        limited.length <= prevIds.length
      ) {
        const pruned = pruneLayout(prevLayout, new Set(limited));
        if (pruned !== null || limited.length === 0) return pruned;
      }
      return defaultLayoutFromIds(limited);
    });
  }, []);

  const setSplitLayout = useCallback((layout: SplitLayoutNode | null) => {
    setSplitLayoutState(layout);
  }, []);

  const splitPanelAt = useCallback(
    (targetTabId: number, newTabId: number, position: DropPosition) => {
      if (targetTabId === newTabId) return;
      setSplitLayoutState((prevLayout) => {
        const isMax =
          position === "max-top" ||
          position === "max-bottom" ||
          position === "max-left" ||
          position === "max-right";

        if (!prevLayout) {
          // No split yet — start a 2-pane layout in the requested direction
          const newLeaf: SplitLayoutNode = { type: "leaf", tabId: newTabId };
          const targetLeaf: SplitLayoutNode = {
            type: "leaf",
            tabId: targetTabId,
          };
          const dir =
            position === "top" ||
            position === "bottom" ||
            position === "max-top" ||
            position === "max-bottom"
              ? "vertical"
              : "horizontal";
          const insertBefore =
            position === "top" ||
            position === "left" ||
            position === "max-top" ||
            position === "max-left";
          return {
            type: "split",
            direction: dir,
            children: insertBefore
              ? [newLeaf, targetLeaf]
              : [targetLeaf, newLeaf],
          };
        }
        // If the new tab is already in the layout, remove it first then re-insert
        const cleaned = getLeafIds(prevLayout).includes(newTabId)
          ? removeLeafOp(prevLayout, newTabId)
          : prevLayout;
        if (!cleaned) {
          return defaultLayoutFromIds([newTabId]);
        }
        if (!getLeafIds(cleaned).includes(targetTabId)) {
          // Target is not in layout — fall back to appending via default
          return defaultLayoutFromIds([...getLeafIds(cleaned), newTabId]);
        }
        if (isMax) {
          const axis: "row" | "column" =
            position === "max-top" || position === "max-bottom"
              ? "row"
              : "column";
          const side: "before" | "after" =
            position === "max-top" || position === "max-left"
              ? "before"
              : "after";
          return insertAdjacentRowOrColumnOp(
            cleaned,
            targetTabId,
            axis,
            side,
            newTabId,
          );
        }
        return splitLeafOp(cleaned, targetTabId, newTabId, position);
      });
    },
    [],
  );

  const addToSplitRoot = useCallback(
    (newTabId: number, position: "top" | "right" | "bottom" | "left") => {
      setSplitLayoutState((prevLayout) => {
        // Remove the tab first if it's already in the layout, so the
        // outer-edge drop becomes a true reposition.
        const cleaned =
          prevLayout && getLeafIds(prevLayout).includes(newTabId)
            ? removeLeafOp(prevLayout, newTabId)
            : prevLayout;
        return insertAtRootOp(cleaned, newTabId, position);
      });
    },
    [],
  );

  const swapInSplitLayout = useCallback((aTabId: number, bTabId: number) => {
    setSplitLayoutState((prevLayout) => {
      if (!prevLayout) return prevLayout;
      return swapLeavesOp(prevLayout, aTabId, bTabId);
    });
  }, []);

  const removeFromSplitLayout = useCallback((tabId: number) => {
    setSplitLayoutState((prevLayout) => {
      if (!prevLayout) return null;
      return removeLeafOp(prevLayout, tabId);
    });
  }, []);

  const [tabDragToSplit, setTabDragToSplit] = useState<TabDragToSplit | null>(
    null,
  );

  const startTabDragToSplit = useCallback((tabId: number) => {
    setTabDragToSplit({ draggedTabId: tabId, isOverTerminalArea: false });
  }, []);

  const setDragOverTerminalArea = useCallback((isOver: boolean) => {
    setTabDragToSplit((prev) =>
      prev ? { ...prev, isOverTerminalArea: isOver } : prev,
    );
  }, []);

  const cancelTabDragToSplit = useCallback(() => {
    setTabDragToSplit(null);
  }, []);

  const SPLITTABLE_TYPES = [
    "terminal",
    "server_stats",
    "file_manager",
    "tunnel",
    "docker",
    "rdp",
    "vnc",
    "telnet",
  ];

  const executeDragSplit = useCallback(
    (
      draggedTabId: number,
      target?: { tabId: number; position: DropPosition },
    ) => {
      const draggedTab = tabs.find((t) => t.id === draggedTabId);
      if (!draggedTab) {
        setTabDragToSplit(null);
        return;
      }

      // Targeted drop on a specific panel + position
      if (target && target.tabId !== draggedTabId) {
        if (target.position === "center") {
          // Center drop = swap if both already in layout, otherwise replace target
          if (allSplitScreenTab.includes(draggedTabId)) {
            swapInSplitLayout(target.tabId, draggedTabId);
          } else {
            // Replace target with dragged tab (insert dragged then remove target)
            splitPanelAt(target.tabId, draggedTabId, "right");
            removeFromSplitLayout(target.tabId);
          }
        } else {
          splitPanelAt(target.tabId, draggedTabId, target.position);
        }
        setTabDragToSplit(null);
        return;
      }

      const activeTabId = currentTab;

      if (allSplitScreenTab.length === 0) {
        // Not in split mode: create 2-way split
        if (activeTabId && activeTabId !== draggedTabId) {
          const activeTab = tabs.find((t) => t.id === activeTabId);
          if (activeTab && SPLITTABLE_TYPES.includes(activeTab.type)) {
            setSplitScreenTabs([activeTabId, draggedTabId]);
          }
        } else {
          // Dragged tab is the active tab — find another splittable tab
          const other = tabs.find(
            (t) => t.id !== draggedTabId && SPLITTABLE_TYPES.includes(t.type),
          );
          if (other) {
            setCurrentTab(other.id);
            setSplitScreenTabs([other.id, draggedTabId]);
          }
        }
      } else if (
        allSplitScreenTab.length < 12 &&
        !allSplitScreenTab.includes(draggedTabId)
      ) {
        // Already split, add the dragged tab
        setSplitScreenTabs([...allSplitScreenTab, draggedTabId]);
      }

      setTabDragToSplit(null);
    },
    [
      tabs,
      currentTab,
      allSplitScreenTab,
      setSplitScreenTabs,
      splitPanelAt,
      swapInSplitLayout,
      removeFromSplitLayout,
    ],
  );

  const value: TabContextType = useMemo(
    () => ({
      tabs,
      currentTab,
      allSplitScreenTab,
      splitLayout,
      addTab,
      addTabAfter,
      removeTab,
      setCurrentTab,
      setSplitScreenTab,
      setSplitScreenTabs,
      setSplitLayout,
      splitPanelAt,
      addToSplitRoot,
      swapInSplitLayout,
      removeFromSplitLayout,
      getTab,
      reorderTabs,
      updateHostConfig,
      updateTab,
      tabDragToSplit,
      startTabDragToSplit,
      setDragOverTerminalArea,
      executeDragSplit,
      cancelTabDragToSplit,
    }),
    [
      tabs,
      currentTab,
      allSplitScreenTab,
      splitLayout,
      addTab,
      removeTab,
      setSplitScreenTab,
      setSplitScreenTabs,
      setSplitLayout,
      splitPanelAt,
      addToSplitRoot,
      swapInSplitLayout,
      removeFromSplitLayout,
      getTab,
      reorderTabs,
      updateHostConfig,
      updateTab,
      tabDragToSplit,
      startTabDragToSplit,
      setDragOverTerminalArea,
      executeDragSplit,
      cancelTabDragToSplit,
    ],
  );

  return <TabContext.Provider value={value}>{children}</TabContext.Provider>;
}
