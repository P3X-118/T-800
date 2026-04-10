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
  pruneLayout,
} from "./splitLayout.js";

export type Tab = TabContextTab;
export type { SplitLayoutNode, DropPosition };

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

interface TabProviderProps {
  children: ReactNode;
}

export function clearT800SessionStorage() {
  localStorage.removeItem("t800_tabs");
  localStorage.removeItem("t800_currentTab");
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith("t800_session_")) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));
}

export function TabProvider({ children }: TabProviderProps) {
  const { t } = useTranslation();
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
    const isElectron =
      typeof window !== "undefined" && !!(window as any).electronAPI;
    const persistenceEnabled =
      localStorage.getItem("enableTerminalSessionPersistence") === "true";
    const shouldRestore = isMobile || isElectron || persistenceEnabled;

    if (!shouldRestore) {
      return [{ id: 1, type: "home", title: "Home" }];
    }

    try {
      const saved = localStorage.getItem("t800_tabs");
      if (saved) {
        const parsed = JSON.parse(saved) as Tab[];
        const restored: Tab[] = [{ id: 1, type: "home", title: "Home" }];
        let maxId = 1;
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
          if (tab.id > maxId) maxId = tab.id;
        }
        if (restored.length > 1) return restored;
      }
    } catch {
      /* ignore corrupt data */
    }
    return [{ id: 1, type: "home", title: "Home" }];
  });
  const [currentTab, setCurrentTab] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("t800_currentTab");
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (parsed && tabs.some((t) => t.id === parsed)) return parsed;
      }
    } catch {
      /* ignore */
    }
    return 1;
  });
  const [splitLayout, setSplitLayoutState] =
    useState<SplitLayoutNode | null>(null);
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
    const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
    const isElectron =
      typeof window !== "undefined" && !!(window as any).electronAPI;
    const persistenceEnabled =
      localStorage.getItem("enableTerminalSessionPersistence") === "true";
    const shouldSave = isMobile || isElectron || persistenceEnabled;

    if (shouldSave) {
      const serializable = tabs
        .filter((t) => t.type !== "home")
        .map(({ terminalRef, ...rest }) => rest);
      localStorage.setItem("t800_tabs", JSON.stringify(serializable));
      localStorage.setItem("t800_currentTab", String(currentTab));
    } else {
      localStorage.removeItem("t800_tabs");
      localStorage.removeItem("t800_currentTab");
    }
  }, [tabs, currentTab]);

  React.useEffect(() => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === 1 && tab.type === "home"
          ? { ...tab, title: t("nav.home") }
          : tab,
      ),
    );
  }, [t]);

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
    setTabs((prev) => [...prev, newTab]);
    setCurrentTab(id);
    setAllSplitScreenTab((prev) => prev.filter((tid) => tid !== id));
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

      return newTabs;
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

  const setSplitLayout = useCallback(
    (layout: SplitLayoutNode | null) => {
      setSplitLayoutState(layout);
    },
    [],
  );

  const splitPanelAt = useCallback(
    (targetTabId: number, newTabId: number, position: DropPosition) => {
      if (targetTabId === newTabId) return;
      setSplitLayoutState((prevLayout) => {
        if (!prevLayout) {
          // No split yet — start a 2-pane layout in the requested direction
          const newLeaf: SplitLayoutNode = { type: "leaf", tabId: newTabId };
          const targetLeaf: SplitLayoutNode = {
            type: "leaf",
            tabId: targetTabId,
          };
          const dir =
            position === "top" || position === "bottom"
              ? "vertical"
              : "horizontal";
          const insertBefore = position === "top" || position === "left";
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
          return defaultLayoutFromIds([
            ...getLeafIds(cleaned),
            newTabId,
          ]);
        }
        return splitLeafOp(cleaned, targetTabId, newTabId, position);
      });
    },
    [],
  );

  const addToSplitRoot = useCallback(
    (
      newTabId: number,
      position: "top" | "right" | "bottom" | "left",
    ) => {
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

  const swapInSplitLayout = useCallback(
    (aTabId: number, bTabId: number) => {
      setSplitLayoutState((prevLayout) => {
        if (!prevLayout) return prevLayout;
        return swapLeavesOp(prevLayout, aTabId, bTabId);
      });
    },
    [],
  );

  const removeFromSplitLayout = useCallback((tabId: number) => {
    setSplitLayoutState((prevLayout) => {
      if (!prevLayout) return null;
      return removeLeafOp(prevLayout, tabId);
    });
  }, []);

  const [tabDragToSplit, setTabDragToSplit] =
    useState<TabDragToSplit | null>(null);

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
            (t) =>
              t.id !== draggedTabId && SPLITTABLE_TYPES.includes(t.type),
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
