import React, { useState } from "react";
import { flushSync } from "react-dom";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  ChevronDown,
  ChevronUpIcon,
  Zap,
  X,
  Terminal,
  Maximize2,
  Pencil,
  Plus,
  Save,
  Server as ServerIcon,
} from "lucide-react";
import { Tab } from "@/ui/desktop/navigation/tabs/Tab.tsx";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import { useTranslation } from "react-i18next";
import { TabDropdown } from "@/ui/desktop/navigation/tabs/TabDropdown.tsx";
import { SessionRoamingMenu } from "@/ui/desktop/navigation/SessionRoamingMenu.tsx";
import { WorkspaceMenu } from "@/ui/desktop/navigation/WorkspaceMenu.tsx";
import { SSHToolsSidebar } from "@/ui/desktop/apps/tools/SSHToolsSidebar.tsx";
import { useCommandHistory } from "@/ui/desktop/apps/features/terminal/command-history/CommandHistoryContext.tsx";
import { QuickConnectDialog } from "@/ui/desktop/navigation/dialogs/QuickConnectDialog.tsx";
import { unlockCtrlLock, useCtrlLockMode } from "@/hooks/use-ctrl-lock.ts";

interface TabData {
  id: number;
  type: string;
  title: string;
  terminalRef?: {
    current?: {
      sendInput?: (data: string) => void;
    };
  };
  [key: string]: unknown;
}

interface TopNavbarProps {
  isTopbarOpen: boolean;
  isTopbarPersistedOpen?: boolean;
  setIsTopbarOpen: (open: boolean) => void;
  setIsTopbarHoverOpen?: (open: boolean) => void;
  onOpenCommandPalette: () => void;
  onRightSidebarStateChange?: (isOpen: boolean, width: number) => void;
  terminalsCondensed: boolean;
  setTerminalsCondensed: (condensed: boolean) => void;
}

export function TopNavbar({
  isTopbarOpen,
  isTopbarPersistedOpen,
  setIsTopbarOpen,
  setIsTopbarHoverOpen,
  onOpenCommandPalette,
  onRightSidebarStateChange,
  terminalsCondensed,
  setTerminalsCondensed,
}: TopNavbarProps): React.ReactElement {
  // Whether the persistent toggle is closed. Falls back to the legacy
  // single-state behavior when the parent doesn't pass the persisted state.
  const isPersistedClosed =
    isTopbarPersistedOpen != null ? !isTopbarPersistedOpen : !isTopbarOpen;
  const { state } = useSidebar();
  const {
    tabs,
    currentTab,
    setCurrentTab,
    setSplitScreenTab,
    removeTab,
    allSplitScreenTab,
    reorderTabs,
    updateTab,
    tabDragToSplit,
    startTabDragToSplit,
    cancelTabDragToSplit,
    setSplitScreenTabs,
    splitLayout,
    setSplitLayout,
    executeDragSplit,
    addTabAfter,
    renameRequest,
    groups,
    activeGroupId,
    switchGroup,
    createGroup,
    deleteGroup,
    renameGroup,
  } = useTabs() as {
    tabs: TabData[];
    currentTab: number;
    setCurrentTab: (id: number) => void;
    setSplitScreenTab: (id: number) => void;
    removeTab: (id: number) => void;
    allSplitScreenTab: number[];
    reorderTabs: (fromIndex: number, toIndex: number) => void;
    updateTab: (tabId: number, updates: Record<string, unknown>) => void;
    tabDragToSplit: {
      draggedTabId: number;
      isOverTerminalArea: boolean;
    } | null;
    startTabDragToSplit: (tabId: number) => void;
    cancelTabDragToSplit: () => void;
    setSplitScreenTabs: (tabIds: number[]) => void;
    splitLayout: unknown;
    setSplitLayout: (layout: unknown) => void;
    executeDragSplit: (id: number) => void;
    addTabAfter: (
      afterTabId: number,
      tab: { type: string; [key: string]: unknown },
    ) => number;
    renameRequest: { tabId: number; nonce: number } | null;
    groups: { id: string; name: string; tabIds: number[] }[];
    activeGroupId: string | null;
    switchGroup: (groupId: string) => void;
    createGroup: (tabIds: number[]) => void;
    deleteGroup: (groupId: string) => void;
    renameGroup: (groupId: string, name: string) => void;
  };
  const leftPosition =
    state === "collapsed" ? "26px" : "calc(var(--sidebar-width) + 8px)";
  const { t } = useTranslation();
  const commandHistory = useCommandHistory();

  // Right sidebar (tools) state — follows the same pattern as the left
  // sidebar: persisted open/closed plus transient hover-open. Effective
  // state is persisted || hover. Defaults to closed; hover over the strip
  // opens temporarily, clicking the toggle pins it open.
  const [isToolsPersistedOpen, setIsToolsPersistedOpen] = useState(false);
  const [isToolsHoverOpen, setIsToolsHoverOpen] = useState(false);
  const ctrlLockMode = useCtrlLockMode("right");
  const ctrlLocked = ctrlLockMode !== "none";
  // Effective visibility: Ctrl-lock forces open/closed in either direction;
  // otherwise fall back to persisted OR transient hover.
  const toolsSidebarOpen =
    ctrlLockMode === "open"
      ? true
      : ctrlLockMode === "closed"
        ? false
        : isToolsPersistedOpen || isToolsHoverOpen;
  // Manual toggle — also clears the Ctrl lock (the canonical exit path).
  const setToolsSidebarOpen = React.useCallback((open: boolean) => {
    unlockCtrlLock("right");
    setIsToolsPersistedOpen(open);
    if (!open) setIsToolsHoverOpen(false);
  }, []);

  // Pin-open without touching the Ctrl lock. Used for incidental opens
  // (programmatic opens like "show command history", or double-click-
  // to-pin gestures inside the sidebar). Going through
  // setToolsSidebarOpen would silently drop the lock as a side effect,
  // and the next hover-leave would then collapse the sidebar.
  const pinToolsSidebarOpen = React.useCallback(() => {
    setIsToolsPersistedOpen(true);
    setIsToolsHoverOpen(false);
  }, []);

  // Hover-open handling for the closed right tools sidebar — identical
  // grace-timeout pattern as the topbar hover. Gated off while
  // Ctrl-locked in either direction.
  const toolsHoverCloseTimeoutRef = React.useRef<number | null>(null);
  const handleToolsHoverEnter = React.useCallback(() => {
    if (ctrlLocked) return;
    if (toolsHoverCloseTimeoutRef.current != null) {
      window.clearTimeout(toolsHoverCloseTimeoutRef.current);
      toolsHoverCloseTimeoutRef.current = null;
    }
    setIsToolsHoverOpen(true);
  }, [ctrlLocked]);
  const handleToolsHoverLeave = React.useCallback(() => {
    if (ctrlLocked) return;
    if (toolsHoverCloseTimeoutRef.current != null) {
      window.clearTimeout(toolsHoverCloseTimeoutRef.current);
    }
    toolsHoverCloseTimeoutRef.current = window.setTimeout(() => {
      setIsToolsHoverOpen(false);
      toolsHoverCloseTimeoutRef.current = null;
    }, 120);
  }, [ctrlLocked]);
  React.useEffect(
    () => () => {
      if (toolsHoverCloseTimeoutRef.current != null) {
        window.clearTimeout(toolsHoverCloseTimeoutRef.current);
      }
    },
    [],
  );

  const [commandHistoryTabActive, setCommandHistoryTabActive] = useState(false);
  const [quickConnectOpen, setQuickConnectOpen] = useState(false);
  const [splitDropdownGroupId, setSplitDropdownGroupId] = useState<
    string | null
  >(null);
  const [emptyAreaContextMenu, setEmptyAreaContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [emptyAreaHosts, setEmptyAreaHosts] = useState<any[]>([]);
  const [emptyAreaHostsLoading, setEmptyAreaHostsLoading] = useState(false);
  const [emptyAreaHostsError, setEmptyAreaHostsError] = useState<string | null>(
    null,
  );
  const [emptyAreaFilter, setEmptyAreaFilter] = useState("");
  const emptyAreaFilterInputRef = React.useRef<HTMLInputElement | null>(null);
  const filteredEmptyAreaHosts = React.useMemo(() => {
    const q = emptyAreaFilter.trim().toLowerCase();
    if (!q) return emptyAreaHosts;
    return emptyAreaHosts.filter((host) => {
      const label = host.name?.trim()
        ? host.name
        : `${host.username}@${host.ip}:${host.port}`;
      return (
        label.toLowerCase().includes(q) ||
        String(host.ip || "")
          .toLowerCase()
          .includes(q) ||
        String(host.username || "")
          .toLowerCase()
          .includes(q) ||
        String(host.name || "")
          .toLowerCase()
          .includes(q)
      );
    });
  }, [emptyAreaHosts, emptyAreaFilter]);

  React.useEffect(() => {
    if (!emptyAreaContextMenu) return;
    const close = () => setEmptyAreaContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [emptyAreaContextMenu]);

  const openEmptyAreaContextMenu = React.useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setEmptyAreaContextMenu({ x: e.clientX, y: e.clientY });
      setEmptyAreaHostsLoading(true);
      setEmptyAreaHostsError(null);
      setEmptyAreaFilter("");
      // Focus the filter input after the menu mounts so typing starts
      // narrowing the list immediately.
      setTimeout(() => emptyAreaFilterInputRef.current?.focus(), 0);
      try {
        const { getSSHHosts } = await import("@/ui/main-axios.ts");
        const hosts = await getSSHHosts();
        setEmptyAreaHosts(hosts);
      } catch (err) {
        setEmptyAreaHostsError(
          err instanceof Error ? err.message : "Failed to load hosts",
        );
      } finally {
        setEmptyAreaHostsLoading(false);
      }
    },
    [],
  );

  const handleOpenHostInNewTab = React.useCallback(
    (host: any) => {
      const title = host.name?.trim()
        ? host.name
        : `${host.username}@${host.ip}:${host.port}`;
      const newTabId =
        currentTab != null
          ? addTabAfter(currentTab, {
              type: "terminal",
              title,
              hostConfig: host,
            })
          : 0;
      if (newTabId > 0) {
        setCurrentTab(newTabId);
      }
      setEmptyAreaContextMenu(null);
    },
    [currentTab, addTabAfter, setCurrentTab],
  );

  // ── Hover-open handling for the closed top bar ───────────────────────
  // The strip and the topbar each fire enter/leave events. We use a small
  // grace timeout on leave so brief crossings between the two elements don't
  // collapse the bar back closed.
  const topbarHoverCloseTimeoutRef = React.useRef<number | null>(null);
  const handleTopbarHoverEnter = React.useCallback(() => {
    if (!setIsTopbarHoverOpen) return;
    if (topbarHoverCloseTimeoutRef.current != null) {
      window.clearTimeout(topbarHoverCloseTimeoutRef.current);
      topbarHoverCloseTimeoutRef.current = null;
    }
    setIsTopbarHoverOpen(true);
  }, [setIsTopbarHoverOpen]);
  const handleTopbarHoverLeave = React.useCallback(() => {
    if (!setIsTopbarHoverOpen) return;
    if (topbarHoverCloseTimeoutRef.current != null) {
      window.clearTimeout(topbarHoverCloseTimeoutRef.current);
    }
    topbarHoverCloseTimeoutRef.current = window.setTimeout(() => {
      setIsTopbarHoverOpen(false);
      topbarHoverCloseTimeoutRef.current = null;
    }, 120);
  }, [setIsTopbarHoverOpen]);
  React.useEffect(
    () => () => {
      if (topbarHoverCloseTimeoutRef.current != null) {
        window.clearTimeout(topbarHoverCloseTimeoutRef.current);
      }
    },
    [],
  );

  const [splitViewName, setSplitViewName] = useState<string>(() => {
    try {
      return localStorage.getItem("t800_splitViewName") || "Split View";
    } catch {
      return "Split View";
    }
  });
  const [splitPillContextMenu, setSplitPillContextMenu] = useState<{
    x: number;
    y: number;
    groupId: string;
  } | null>(null);
  const [splitPillEditing, setSplitPillEditing] = useState(false);
  const [splitPillEditValue, setSplitPillEditValue] = useState("");
  const splitPillInputRef = React.useRef<HTMLInputElement | null>(null);
  // Per-group pill state (multiview bar).
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  React.useEffect(() => {
    if (splitPillEditing && splitPillInputRef.current) {
      splitPillInputRef.current.focus();
      splitPillInputRef.current.select();
    }
  }, [splitPillEditing]);

  React.useEffect(() => {
    if (!splitPillContextMenu) return;
    const close = () => setSplitPillContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [splitPillContextMenu]);

  const persistSplitViewName = React.useCallback((name: string) => {
    setSplitViewName(name);
    try {
      localStorage.setItem("t800_splitViewName", name);
    } catch {
      /* ignore */
    }
  }, []);

  // Tabs that are part of the active split-view group, in tab-bar order.
  // Must be defined before handleSaveSplitView which references it.
  const splitGroupTabs = React.useMemo(() => {
    if (!Array.isArray(allSplitScreenTab) || allSplitScreenTab.length === 0)
      return [];
    const idSet = new Set(allSplitScreenTab);
    return tabs.filter((t: TabData) => idSet.has(t.id));
  }, [tabs, allSplitScreenTab]);
  const splitGroupIdSet = React.useMemo(
    () => new Set(splitGroupTabs.map((t: TabData) => t.id)),
    [splitGroupTabs],
  );
  const shouldCondense = splitGroupTabs.length >= 2 && terminalsCondensed;
  // Every multiview group's member tabs are hidden from the normal strip
  // and represented by their group's pill instead.
  const allGroupMemberIds = React.useMemo(() => {
    const s = new Set<number>();
    for (const g of groups) for (const id of g.tabIds) s.add(id);
    return s;
  }, [groups]);
  const displayTabs = {
    condensedSplit: splitGroupTabs,
    normalTabs: tabs.filter((t: TabData) => !allGroupMemberIds.has(t.id)),
  };

  const handleSaveSplitView = React.useCallback(() => {
    const isDefaultName =
      splitViewName === "Split View" || splitViewName === "";

    const doSave = (name: string) => {
      // Build host metadata for each leaf so the view can be restored
      // even when tab IDs differ (e.g. after a page reload).
      const hostMeta = splitGroupTabs.map((t: TabData) => ({
        tabId: t.id,
        name: t.title,
        ip: (t as any).hostConfig?.ip || "",
        port: (t as any).hostConfig?.port || 22,
        username: (t as any).hostConfig?.username || "",
        hostId: (t as any).hostConfig?.id,
      }));

      const saved = {
        id: `sv_${Date.now()}`,
        name,
        createdAt: new Date().toISOString(),
        layout: splitLayout,
        hosts: hostMeta,
        tabIds: allSplitScreenTab,
      };

      try {
        const existing = JSON.parse(
          localStorage.getItem("t800_savedSplitViews") || "[]",
        );
        existing.push(saved);
        localStorage.setItem("t800_savedSplitViews", JSON.stringify(existing));
        import("sonner").then((m) =>
          m.toast.success(`Split view "${name}" saved`),
        );
      } catch {
        import("sonner").then((m) =>
          m.toast.error("Failed to save split view"),
        );
      }
    };

    if (isDefaultName) {
      // Prompt the user for a name — use the pill inline edit mechanism
      setSplitPillEditValue("");
      setSplitPillEditing(true);
      // Override the persist handler temporarily to save after naming
      pendingSaveRef.current = true;
    } else {
      doSave(splitViewName);
    }
  }, [splitViewName, splitGroupTabs, splitLayout, allSplitScreenTab]);

  const pendingSaveRef = React.useRef(false);

  // Intercept the name persist to also save the view if triggered by Save
  const originalPersistRef = React.useRef(persistSplitViewName);
  originalPersistRef.current = persistSplitViewName;

  const persistSplitViewNameWithSave = React.useCallback(
    (name: string) => {
      persistSplitViewName(name);
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false;
        // Save after a tick so the name state updates
        setTimeout(() => {
          const hostMeta = splitGroupTabs.map((t: TabData) => ({
            tabId: t.id,
            name: t.title,
            ip: (t as any).hostConfig?.ip || "",
            port: (t as any).hostConfig?.port || 22,
            username: (t as any).hostConfig?.username || "",
            hostId: (t as any).hostConfig?.id,
          }));
          const saved = {
            id: `sv_${Date.now()}`,
            name,
            createdAt: new Date().toISOString(),
            layout: splitLayout,
            hosts: hostMeta,
            tabIds: allSplitScreenTab,
          };
          try {
            const existing = JSON.parse(
              localStorage.getItem("t800_savedSplitViews") || "[]",
            );
            existing.push(saved);
            localStorage.setItem(
              "t800_savedSplitViews",
              JSON.stringify(existing),
            );
            import("sonner").then((m) =>
              m.toast.success(`Split view "${name}" saved`),
            );
          } catch {
            import("sonner").then((m) =>
              m.toast.error("Failed to save split view"),
            );
          }
        }, 50);
      }
    },
    [persistSplitViewName, splitGroupTabs, splitLayout, allSplitScreenTab],
  );
  const [rightSidebarWidth, setRightSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem("rightSidebarWidth");
    const defaultWidth = 400;
    const savedWidth = saved !== null ? parseInt(saved, 10) : defaultWidth;
    const minWidth = Math.min(300, Math.floor(window.innerWidth * 0.2));
    const maxWidth = Math.floor(window.innerWidth * 0.3);
    return Math.min(savedWidth, Math.max(minWidth, maxWidth));
  });

  React.useEffect(() => {
    localStorage.setItem("rightSidebarWidth", String(rightSidebarWidth));
  }, [rightSidebarWidth]);

  React.useEffect(() => {
    const handleResize = () => {
      const minWidth = Math.min(300, Math.floor(window.innerWidth * 0.2));
      const maxWidth = Math.floor(window.innerWidth * 0.3);
      if (rightSidebarWidth > maxWidth) {
        setRightSidebarWidth(Math.max(minWidth, maxWidth));
      } else if (rightSidebarWidth < minWidth) {
        setRightSidebarWidth(minWidth);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [rightSidebarWidth]);

  React.useEffect(() => {
    if (onRightSidebarStateChange) {
      onRightSidebarStateChange(toolsSidebarOpen, rightSidebarWidth);
    }
  }, [toolsSidebarOpen, rightSidebarWidth, onRightSidebarStateChange]);

  const openCommandHistorySidebar = React.useCallback(() => {
    pinToolsSidebarOpen();
    setCommandHistoryTabActive(true);
  }, [pinToolsSidebarOpen]);

  React.useEffect(() => {
    commandHistory.setOpenCommandHistory(openCommandHistorySidebar);
  }, [commandHistory, openCommandHistorySidebar]);

  const rightPosition = toolsSidebarOpen
    ? `calc(var(--right-sidebar-width, ${rightSidebarWidth}px) + 8px)`
    : "17px";
  const [justDroppedTabId, setJustDroppedTabId] = useState<number | null>(null);
  const [isInDropAnimation, setIsInDropAnimation] = useState(false);
  const [dragState, setDragState] = useState<{
    draggedId: number | null;
    draggedIndex: number | null;
    currentX: number;
    startX: number;
    targetIndex: number | null;
  }>({
    draggedId: null,
    draggedIndex: null,
    currentX: 0,
    startX: 0,
    targetIndex: null,
  });
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const tabRefs = React.useRef<Map<number, HTMLDivElement>>(new Map());
  const isProcessingDropRef = React.useRef(false);

  const prevTabsRef = React.useRef<TabData[]>([]);

  // ── Multi-tab selection (Ctrl+click) ──────────────────────────────
  // A set of non-split top-row tab IDs the user has ctrl-clicked. Visible
  // as a white underline. Right-clicking any selected tab shows a menu to
  // add them all to the split view or close them.
  const [selectedTabIds, setSelectedTabIds] = useState<Set<number>>(new Set());
  const [multiSelectContextMenu, setMultiSelectContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Close the multi-select menu on outside click
  React.useEffect(() => {
    if (!multiSelectContextMenu) return;
    const close = () => setMultiSelectContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [multiSelectContextMenu]);

  // Whenever the user's set of tabs changes, prune any missing IDs so the
  // selection never points at deleted tabs.
  React.useEffect(() => {
    setSelectedTabIds((prev) => {
      const valid = new Set<number>();
      const tabIdSet = new Set(tabs.map((t: TabData) => t.id));
      for (const id of prev) {
        if (
          tabIdSet.has(id) &&
          !(Array.isArray(allSplitScreenTab) && allSplitScreenTab.includes(id))
        ) {
          valid.add(id);
        }
      }
      return valid.size === prev.size ? prev : valid;
    });
  }, [tabs, allSplitScreenTab]);

  const handleTabActivate = (tabId: number, ctrlKey = false) => {
    // Ctrl-click on a non-split terminal tab: toggle its membership in the
    // multi-selection instead of activating it. Home/admin/etc. tabs and
    // split-view tabs are excluded below at the callsite.
    if (ctrlKey) {
      setSelectedTabIds((prev) => {
        const next = new Set(prev);
        if (next.has(tabId)) next.delete(tabId);
        else next.add(tabId);
        return next;
      });
      return;
    }
    // Plain click clears any multi-selection before activating.
    if (selectedTabIds.size > 0) setSelectedTabIds(new Set());
    setCurrentTab(tabId);
  };

  const openMultiSelectContextMenu = (e: React.MouseEvent, tabId: number) => {
    // If the right-clicked tab isn't in the selection yet, add it so the
    // menu actions target a sensible set.
    if (!selectedTabIds.has(tabId)) {
      setSelectedTabIds((prev) => {
        const next = new Set(prev);
        next.add(tabId);
        return next;
      });
    }
    e.preventDefault();
    e.stopPropagation();
    setMultiSelectContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleAddSelectedToSplit = () => {
    // Order the selected tabs by their position in the tab bar so the
    // resulting split layout is predictable regardless of the order the
    // user ctrl-clicked them in.
    const orderedIds = tabs
      .filter((t: TabData) => selectedTabIds.has(t.id))
      .map((t: TabData) => t.id)
      .slice(0, 12);
    if (orderedIds.length < 2) {
      // A split view requires at least 2 tabs — just activate a single
      // selection instead of creating a 1-pane split.
      if (orderedIds.length === 1) setCurrentTab(orderedIds[0]);
      setSelectedTabIds(new Set());
      setMultiSelectContextMenu(null);
      return;
    }
    // Replace any existing split layout with a fresh one built from just
    // the selected tabs. `setSplitScreenTabs` rebuilds the layout tree via
    // `defaultLayoutFromIds` whenever the id set changes.
    setSplitScreenTabs(orderedIds);
    // Focus the first selected tab so the split view actually renders —
    // otherwise currentTab might still point at a non-split tab and the
    // split overlay stays hidden.
    setCurrentTab(orderedIds[0]);
    setSelectedTabIds(new Set());
    setMultiSelectContextMenu(null);
  };

  const handleCloseSelected = () => {
    const ids = Array.from(selectedTabIds);
    ids.forEach((id) => removeTab(id));
    setSelectedTabIds(new Set());
    setMultiSelectContextMenu(null);
  };

  const handleTabSplit = (tabId: number) => {
    // Directly add the tab to the active split view (or start a new 2-pane
    // split with the current tab + this one). The Split Screen tools panel
    // has been removed in favor of the drag-and-drop / right-click flows.
    if (allSplitScreenTab.includes(tabId)) return;
    executeDragSplit(tabId);
  };

  const handleTabClose = (tabId: number) => {
    removeTab(tabId);
  };

  const handleSnippetExecute = (content: string) => {
    const tab = tabs.find((t: TabData) => t.id === currentTab);
    if (tab?.terminalRef?.current?.sendInput) {
      tab.terminalRef.current.sendInput(content + "\n");
    }
  };

  React.useEffect(() => {
    if (prevTabsRef.current.length > 0 && tabs !== prevTabsRef.current) {
      prevTabsRef.current = [];
    }
  }, [tabs]);

  React.useEffect(() => {
    if (justDroppedTabId !== null) {
      const timer = setTimeout(() => setJustDroppedTabId(null), 50);
      return () => clearTimeout(timer);
    }
  }, [justDroppedTabId]);

  const handleDragStart = (e: React.DragEvent, tabId: number) => {
    const img = new Image();
    img.src =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    e.dataTransfer.setDragImage(img, 0, 0);
    // Required for HTML5 DnD to dispatch `dragover` on external drop
    // targets (AppView's container). Without setData + effectAllowed,
    // Chromium treats the drag as "invalid" for cross-subtree drops, so
    // the split drop quadrants never appear when dragging a navbar tab
    // down into the terminal area.
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(tabId));

    // Use the tab's actual position in `tabs[]` (not the displayTabs.normalTabs
    // index) so that drag-to-split and reordering see the correct tab even
    // while the split-view tabs are condensed into a pill.
    const realIndex = tabs.findIndex((t: TabData) => t.id === tabId);
    if (realIndex < 0) return;

    setDragState({
      draggedId: tabId,
      draggedIndex: realIndex,
      startX: e.clientX,
      currentX: e.clientX,
      targetIndex: realIndex,
    });
  };

  const SPLIT_THRESHOLD_PX = 40;
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

  const handleDrag = (e: React.DragEvent) => {
    if (e.clientX === 0 && e.clientY === 0) return;
    if (dragState.draggedIndex === null) return;

    const containerRect = containerRef.current?.getBoundingClientRect();
    if (containerRect) {
      const distanceBelow = e.clientY - containerRect.bottom;
      const draggedTab = tabs[dragState.draggedIndex];

      if (
        distanceBelow > SPLIT_THRESHOLD_PX &&
        draggedTab &&
        SPLITTABLE_TYPES.includes(draggedTab.type) &&
        tabs.filter((t) => SPLITTABLE_TYPES.includes(t.type)).length >= 2
      ) {
        if (!tabDragToSplit) {
          startTabDragToSplit(draggedTab.id);
        }
        return;
      } else if (tabDragToSplit) {
        cancelTabDragToSplit();
      }
    }

    setDragState((prev) => ({
      ...prev,
      currentX: e.clientX,
    }));
  };

  const calculateTargetIndex = () => {
    if (!containerRef.current || dragState.draggedIndex === null) return null;

    const draggedIndex = dragState.draggedIndex;

    const tabBoundaries: {
      index: number;
      start: number;
      end: number;
      mid: number;
    }[] = [];
    let accumulatedX = 0;

    tabs.forEach((tab, i) => {
      const tabEl = tabRefs.current.get(i);
      if (!tabEl) return;

      const tabWidth = tabEl.getBoundingClientRect().width;
      tabBoundaries.push({
        index: i,
        start: accumulatedX,
        end: accumulatedX + tabWidth,
        mid: accumulatedX + tabWidth / 2,
      });
      accumulatedX += tabWidth + 4;
    });

    if (tabBoundaries.length === 0) return null;

    const containerRect = containerRef.current.getBoundingClientRect();
    const draggedTab = tabBoundaries[draggedIndex];
    const currentX = dragState.currentX - containerRect.left;
    const startX = dragState.startX - containerRect.left;
    const offset = currentX - startX;
    const draggedCenter = draggedTab.mid + offset;

    let newTargetIndex = draggedIndex;

    if (offset < 0) {
      for (let i = draggedIndex - 1; i >= 0; i--) {
        if (draggedCenter < tabBoundaries[i].mid) {
          newTargetIndex = i;
        } else {
          break;
        }
      }
    } else if (offset > 0) {
      for (let i = draggedIndex + 1; i < tabBoundaries.length; i++) {
        if (draggedCenter > tabBoundaries[i].mid) {
          newTargetIndex = i;
        } else {
          break;
        }
      }
      const lastTabIndex = tabBoundaries.length - 1;
      if (lastTabIndex >= 0) {
        const lastTabEl = tabRefs.current.get(lastTabIndex);
        if (lastTabEl) {
          const lastTabRect = lastTabEl.getBoundingClientRect();
          const containerRect = containerRef.current.getBoundingClientRect();
          const lastTabEndInContainer = lastTabRect.right - containerRect.left;
          if (currentX > lastTabEndInContainer) {
            newTargetIndex = lastTabIndex;
          }
        }
      }
    }

    return newTargetIndex;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();

    if (dragState.draggedIndex === null) return;

    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    if (e.clientX !== 0) {
      setDragState((prev) => ({
        ...prev,
        currentX: e.clientX,
      }));
    }

    const newTargetIndex = calculateTargetIndex();
    if (newTargetIndex !== null && newTargetIndex !== dragState.targetIndex) {
      setDragState((prev) => ({
        ...prev,
        targetIndex: newTargetIndex,
      }));
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();

    if (tabDragToSplit) {
      // Split mode — AppView handles the drop
      return;
    }

    if (isProcessingDropRef.current) return;
    isProcessingDropRef.current = true;

    const fromIndex = dragState.draggedIndex;
    const toIndex = dragState.targetIndex;
    const draggedId = dragState.draggedId;

    if (fromIndex !== null && toIndex !== null && fromIndex !== toIndex) {
      prevTabsRef.current = tabs;

      flushSync(() => {
        setIsInDropAnimation(true);
        setDragState({
          draggedId: null,
          draggedIndex: null,
          startX: 0,
          currentX: 0,
          targetIndex: null,
        });
      });

      reorderTabs(fromIndex, toIndex);

      if (draggedId !== null) {
        setJustDroppedTabId(draggedId);
      }
    } else {
      setDragState({
        draggedId: null,
        draggedIndex: null,
        startX: 0,
        currentX: 0,
        targetIndex: null,
      });
    }

    setTimeout(() => {
      isProcessingDropRef.current = false;
      setIsInDropAnimation(false);
    }, 50);
  };

  const handleDragEnd = () => {
    cancelTabDragToSplit();
    setIsInDropAnimation(false);
    setDragState({
      draggedId: null,
      draggedIndex: null,
      startX: 0,
      currentX: 0,
      targetIndex: null,
    });
  };

  const isSplitScreenActive =
    Array.isArray(allSplitScreenTab) && allSplitScreenTab.length > 0;
  const currentTabObj = tabs.find((t: TabData) => t.id === currentTab);
  const currentTabIsHome = currentTabObj?.type === "home";
  const currentTabIsSshManager = currentTabObj?.type === "ssh_manager";
  const currentTabIsAdmin = currentTabObj?.type === "admin";
  const currentTabIsUserProfile = currentTabObj?.type === "user_profile";

  // splitGroupTabs, splitGroupIdSet, shouldCondense, displayTabs moved earlier
  // (before handleSaveSplitView which references splitGroupTabs)

  return (
    <div>
      <div
        className="fixed z-10 h-[50px] border-2 border-edge rounded-lg flex flex-row transform-none m-0 p-0"
        style={{
          top: isTopbarOpen ? "0.5rem" : "-3rem",
          left: leftPosition,
          right: rightPosition,
          backgroundColor: "var(--bg-base)",
          transition: "top 200ms linear, left 200ms linear, right 200ms linear",
        }}
        onMouseEnter={handleTopbarHoverEnter}
        onMouseLeave={handleTopbarHoverLeave}
        onDoubleClick={(e) => {
          // Double-click on empty space pins the topbar open
          if (isPersistedClosed && e.target === e.currentTarget) {
            setIsTopbarOpen(true);
          }
        }}
      >
        <div
          ref={containerRef}
          className="h-full p-1 pr-2 border-r-2 border-edge w-[calc(100%-6rem)] flex items-center overflow-x-auto overflow-y-hidden skinny-scrollbar gap-1"
          onDoubleClick={(e) => {
            if (isPersistedClosed && e.target === e.currentTarget) {
              setIsTopbarOpen(true);
            }
          }}
          onContextMenu={(e) => {
            // Only fire when the click is on the empty container itself, not
            // on a child tab element.
            if (e.target === e.currentTarget) {
              openEmptyAreaContextMenu(e);
            }
          }}
        >
          {/* Per-group member dropdowns render inside each group pill below. */}
          {displayTabs.normalTabs.flatMap((tab: TabData, index: number) => {
            const elements: React.ReactNode[] = [];

            // When the condensed split pill is the active focus, suppress the
            // active/split highlight on individual non-split tabs.
            const splitPillIsFocus =
              shouldCondense &&
              currentTab !== null &&
              splitGroupIdSet.has(currentTab) &&
              displayTabs.condensedSplit.length >= 2;
            const isActive = !splitPillIsFocus && tab.id === currentTab;
            const isSplit =
              !splitPillIsFocus &&
              Array.isArray(allSplitScreenTab) &&
              allSplitScreenTab.includes(tab.id);
            const isTerminal = tab.type === "terminal";
            const isServer = tab.type === "server_stats";
            const isFileManager = tab.type === "file_manager";
            const isTunnel = tab.type === "tunnel";
            const isDocker = tab.type === "docker";
            const isSshManager = tab.type === "ssh_manager";
            const isAdmin = tab.type === "admin";
            const isUserProfile = tab.type === "user_profile";
            const isRdp = tab.type === "rdp";
            const isVnc = tab.type === "vnc";
            const isSplittable =
              isTerminal || isServer || isFileManager || isTunnel || isDocker;
            const disableSplit = !isSplittable;
            const disableActivate = false;
            const isHome = tab.type === "home";
            const disableClose = isHome;

            const isDraggingThisTab = dragState.draggedIndex === index;
            const isTheDraggedTab = tab.id === dragState.draggedId;
            const isDroppedAndSnapping = tab.id === justDroppedTabId;
            const dragOffset = isDraggingThisTab
              ? dragState.currentX - dragState.startX
              : 0;

            let transform = "";

            if (!isInDropAnimation && !tabDragToSplit) {
              if (isDraggingThisTab) {
                transform = `translateX(${dragOffset}px)`;
              } else if (
                dragState.draggedIndex !== null &&
                dragState.targetIndex !== null
              ) {
                const draggedOriginalIndex = dragState.draggedIndex;
                const currentTargetIndex = dragState.targetIndex;

                if (
                  draggedOriginalIndex < currentTargetIndex &&
                  index > draggedOriginalIndex &&
                  index <= currentTargetIndex
                ) {
                  const draggedTabWidth =
                    tabRefs.current
                      .get(draggedOriginalIndex)
                      ?.getBoundingClientRect().width || 0;
                  const gap = 4;
                  transform = `translateX(-${draggedTabWidth + gap}px)`;
                } else if (
                  draggedOriginalIndex > currentTargetIndex &&
                  index >= currentTargetIndex &&
                  index < draggedOriginalIndex
                ) {
                  const draggedTabWidth =
                    tabRefs.current
                      .get(draggedOriginalIndex)
                      ?.getBoundingClientRect().width || 0;
                  const gap = 4;
                  transform = `translateX(${draggedTabWidth + gap}px)`;
                }
              }
            }

            elements.push(
              <div
                key={tab.id}
                ref={(el) => {
                  if (el) {
                    tabRefs.current.set(index, el);
                  } else {
                    tabRefs.current.delete(index);
                  }
                }}
                draggable={true}
                onDragStart={(e) => {
                  e.stopPropagation();
                  handleDragStart(e, tab.id);
                }}
                onDrag={handleDrag}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                onMouseDown={(e) => {
                  if (e.button === 1 && !disableClose) {
                    e.preventDefault();
                    handleTabClose(tab.id);
                  }
                }}
                style={{
                  transform,
                  transition:
                    isDraggingThisTab ||
                    isDroppedAndSnapping ||
                    isInDropAnimation
                      ? "none"
                      : "transform 200ms ease-out",
                  zIndex: isDraggingThisTab ? 1000 : 1,
                  position: "relative",
                  cursor: isDraggingThisTab ? "grabbing" : "grab",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  flex: tab.type === "home" ? "0 0 auto" : "1 1 150px",
                  flexShrink: tab.type === "home" ? 0 : undefined,
                  minWidth: tab.type === "home" ? "auto" : "150px",
                  maxWidth: tab.type === "home" ? "auto" : "450px",
                  // Home has z-10 when active and a right border; the
                  // flex gap is being swallowed in some layouts, causing
                  // the next tab (Host Manager after pin order) to clip
                  // the Home tab's right edge. Force a visible gap.
                  marginRight: tab.type === "home" ? 4 : undefined,
                  display: "flex",
                }}
              >
                <Tab
                  tabType={tab.type}
                  title={tab.title}
                  isActive={isActive}
                  isSplit={isSplit}
                  isMultiSelected={
                    isSplittable && !isSplit && selectedTabIds.has(tab.id)
                  }
                  onActivate={(ctrlKey?: boolean) =>
                    handleTabActivate(tab.id, !!ctrlKey)
                  }
                  onMultiSelectContextMenu={
                    isSplittable && !isSplit && selectedTabIds.size > 0
                      ? (e: React.MouseEvent) =>
                          openMultiSelectContextMenu(e, tab.id)
                      : undefined
                  }
                  onClose={
                    isTerminal ||
                    isServer ||
                    isFileManager ||
                    isTunnel ||
                    isDocker ||
                    isSshManager ||
                    isAdmin ||
                    isUserProfile ||
                    isRdp ||
                    isVnc ||
                    tab.type === "network_graph"
                      ? () => handleTabClose(tab.id)
                      : undefined
                  }
                  onSplit={
                    isSplittable ? () => handleTabSplit(tab.id) : undefined
                  }
                  canSplit={isSplittable}
                  canClose={
                    isTerminal ||
                    isServer ||
                    isFileManager ||
                    isTunnel ||
                    isDocker ||
                    isSshManager ||
                    isAdmin ||
                    isUserProfile ||
                    isRdp ||
                    isVnc ||
                    tab.type === "network_graph"
                  }
                  disableActivate={disableActivate}
                  disableSplit={disableSplit}
                  disableClose={disableClose}
                  isDragging={isDraggingThisTab}
                  isDragOver={false}
                  hostConfig={tab.hostConfig}
                  isIdle={tab.isIdle}
                  renameSignal={
                    renameRequest && renameRequest.tabId === tab.id
                      ? renameRequest.nonce
                      : 0
                  }
                  onRename={
                    tab.type !== "home"
                      ? (newTitle: string) =>
                          updateTab(tab.id, { title: newTitle })
                      : undefined
                  }
                  onAddToSplit={
                    isSplittable && !allSplitScreenTab.includes(tab.id)
                      ? () => {
                          executeDragSplit(tab.id);
                        }
                      : undefined
                  }
                  onSplitAll={
                    isSplittable
                      ? () => {
                          // Collect every splittable tab not already in
                          // the split view and fold them all in at once.
                          const splittable = [
                            "terminal",
                            "server_stats",
                            "file_manager",
                            "tunnel",
                            "docker",
                            "rdp",
                            "vnc",
                            "telnet",
                          ];
                          const candidateIds = tabs
                            .filter(
                              (t: TabData) =>
                                splittable.includes(t.type) &&
                                !allSplitScreenTab.includes(t.id),
                            )
                            .map((t: TabData) => t.id);
                          const merged = [
                            ...allSplitScreenTab,
                            ...candidateIds,
                          ].slice(0, 12);
                          if (merged.length >= 2) {
                            setSplitScreenTabs(merged);
                          }
                        }
                      : undefined
                  }
                  onDuplicate={
                    isTerminal
                      ? () => {
                          const newTabId = addTabAfter(tab.id, {
                            type: "terminal",
                            title: tab.title,
                            hostConfig: tab.hostConfig,
                          });
                          if (newTabId <= 0) return;
                          // Fold the original and its duplicate into a split
                          // view. If the original is already in a split, add
                          // the duplicate alongside the existing group.
                          const existing = allSplitScreenTab.includes(tab.id)
                            ? allSplitScreenTab
                            : [tab.id];
                          const merged = [...existing, newTabId].slice(0, 12);
                          if (merged.length >= 2) {
                            setSplitScreenTabs(merged);
                          }
                        }
                      : undefined
                  }
                />
              </div>,
            );

            // Inject the condensed split-view pill after the Host Manager
            // tab if it's open, otherwise after Home. The pinned tabs must
            // always stay leftmost — the split pill must never push Host
            // Manager to the right of it.
            const pillAnchorType = displayTabs.normalTabs.some(
              (t: TabData) => t.type === "ssh_manager",
            )
              ? "ssh_manager"
              : "home";
            if (tab.type === pillAnchorType && groups.length > 0) {
              groups.forEach((g) => {
                const pillIsActive = g.id === activeGroupId;
                elements.push(
                  <div
                    key={`group-pill-${g.id}`}
                    style={{
                      flex: "1 1 150px",
                      minWidth: "150px",
                      maxWidth: "450px",
                      display: "flex",
                      position: "relative",
                    }}
                  >
                    <div
                      className="relative flex items-center gap-1.5 px-3 w-full min-w-0 rounded-t-lg border-t-2 border-l-2 border-r-2 transition-all duration-150 h-[42px] bg-background text-foreground border-border z-10"
                      style={{
                        marginBottom: "-2px",
                        borderBottom: pillIsActive
                          ? "2px solid var(--foreground)"
                          : "none",
                        cursor: "pointer",
                      }}
                      onClick={() => switchGroup(g.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSplitPillContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          groupId: g.id,
                        });
                      }}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <Terminal className="h-4 w-4 flex-shrink-0" />
                        {editingGroupId === g.id ? (
                          <input
                            ref={splitPillInputRef}
                            className="bg-transparent border-b border-foreground/40 outline-none text-foreground text-sm flex-1 min-w-0 h-[22px] leading-[22px]"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Enter") {
                                const trimmed = editValue.trim();
                                if (trimmed) renameGroup(g.id, trimmed);
                                setEditingGroupId(null);
                              } else if (e.key === "Escape") {
                                setEditingGroupId(null);
                              }
                            }}
                            onBlur={() => {
                              const trimmed = editValue.trim();
                              if (trimmed) renameGroup(g.id, trimmed);
                              setEditingGroupId(null);
                            }}
                          />
                        ) : (
                          <span className="truncate text-sm flex-1 min-w-0">
                            {g.name}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          {g.tabIds.length}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSplitDropdownGroupId(
                            splitDropdownGroupId === g.id ? null : g.id,
                          );
                        }}
                        title={t("nav.splitViewTabs")}
                      >
                        {splitDropdownGroupId === g.id ? (
                          <ChevronUpIcon className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    {splitDropdownGroupId === g.id && (
                      <div className="absolute top-[42px] left-0 z-[9999] bg-surface border border-edge rounded-md shadow-lg py-1 min-w-[200px] max-h-[300px] overflow-y-auto">
                        {g.tabIds.map((tid) => {
                          const mt = tabs.find((x: TabData) => x.id === tid);
                          if (!mt) return null;
                          return (
                            <div
                              key={tid}
                              className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-foreground hover:bg-hover cursor-pointer"
                              onClick={() => {
                                setCurrentTab(tid);
                                setSplitDropdownGroupId(null);
                              }}
                            >
                              <Terminal className="h-3.5 w-3.5 flex-shrink-0" />
                              <span className="truncate flex-1 min-w-0">
                                {mt.title}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeTab(tid);
                                }}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {splitPillContextMenu?.groupId === g.id && (
                      <div
                        className="fixed z-[9999] bg-surface border border-edge rounded-md shadow-lg py-1 min-w-[140px]"
                        style={{
                          left: splitPillContextMenu.x,
                          top: splitPillContextMenu.y,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-foreground hover:bg-hover cursor-pointer"
                          onClick={() => {
                            setEditValue(g.name);
                            setEditingGroupId(g.id);
                            setSplitPillContextMenu(null);
                          }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Rename
                        </button>
                        <div className="border-t border-edge my-1" />
                        <button
                          className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-red-400 hover:bg-hover cursor-pointer"
                          onClick={() => {
                            // Tear down the whole multiview — close every pane.
                            const ids = [...g.tabIds];
                            setSplitPillContextMenu(null);
                            for (const id of ids) removeTab(id);
                          }}
                        >
                          <X className="w-3.5 h-3.5" />
                          Close Multiview
                        </button>
                      </div>
                    )}
                  </div>,
                );
              });
            }

            return elements;
          })}
        </div>

        <div
          className="flex items-center justify-center gap-2 flex-1 px-2"
          onDoubleClick={(e) => {
            if (isPersistedClosed && e.target === e.currentTarget) {
              setIsTopbarOpen(true);
            }
          }}
        >
          <TabDropdown />
          <Button
            variant="outline"
            onClick={() => {
              const cur = tabs.find((x: TabData) => x.id === currentTab);
              if (!cur) return;
              const splittable = [
                "terminal",
                "server_stats",
                "file_manager",
                "tunnel",
                "docker",
              ].includes(cur.type);
              if (!splittable) return;
              const dupId = addTabAfter(currentTab, {
                type: cur.type,
                title: cur.title,
                hostConfig: (cur as { hostConfig?: unknown }).hostConfig,
                connectionConfig: (cur as { connectionConfig?: unknown })
                  .connectionConfig,
              });
              if (dupId > 0) createGroup([currentTab, dupId]);
            }}
            className="w-[30px] h-[30px] border-edge"
            title={t("nav.newMultiview", "New multiview")}
          >
            <Plus className="h-4 w-4" />
          </Button>
          {splitGroupTabs.length >= 2 && !terminalsCondensed && (
            <Button
              variant="outline"
              onClick={() => setTerminalsCondensed(true)}
              className="w-[30px] h-[30px] border-edge"
              title={t("nav.condenseTerminals")}
            >
              <Terminal className="h-4 w-4" />
            </Button>
          )}

          <SessionRoamingMenu />
          <WorkspaceMenu />

          <Button
            variant="outline"
            onClick={() => setQuickConnectOpen(true)}
            className="w-[30px] h-[30px] border-edge"
            title={t("quickConnect.title")}
          >
            <Zap className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            onClick={() => setIsTopbarOpen(isPersistedClosed)}
            className="w-[30px] h-[30px]"
            title={isPersistedClosed ? "Pin top bar open" : "Hide top bar"}
          >
            {isPersistedClosed ? <ChevronDown /> : <ChevronUpIcon />}
          </Button>
        </div>
      </div>

      {isPersistedClosed && (
        <div
          onClick={() => setIsTopbarOpen(true)}
          onMouseEnter={handleTopbarHoverEnter}
          onMouseLeave={handleTopbarHoverLeave}
          className="fixed top-0 cursor-pointer flex items-center justify-center rounded-bl-md rounded-br-md"
          style={{
            left: leftPosition,
            right: rightPosition,
            height: "10px",
            zIndex: 9999,
            // Keep the strip mounted while the topbar is hover-open so the
            // cursor can move continuously between the strip and the topbar
            // without losing hover; just make it invisible so it doesn't
            // paint over the topbar's bottom edge.
            opacity: isTopbarOpen ? 0 : 1,
            backgroundColor: "var(--bg-base)",
            border: "2px solid var(--border-base)",
            borderTop: "none",
          }}
        >
          <ChevronDown size={10} />
        </div>
      )}

      <SSHToolsSidebar
        isOpen={toolsSidebarOpen}
        isPersistedOpen={isToolsPersistedOpen}
        onTogglePersisted={setToolsSidebarOpen}
        onPinPersistedOpen={pinToolsSidebarOpen}
        onHoverEnter={handleToolsHoverEnter}
        onHoverLeave={handleToolsHoverLeave}
        onSnippetExecute={handleSnippetExecute}
        sidebarWidth={rightSidebarWidth}
        setSidebarWidth={setRightSidebarWidth}
        initialTab={commandHistoryTabActive ? "command-history" : undefined}
        onTabChange={() => {
          setCommandHistoryTabActive(false);
        }}
      />

      <QuickConnectDialog
        open={quickConnectOpen}
        onOpenChange={setQuickConnectOpen}
      />

      {multiSelectContextMenu && selectedTabIds.size > 0 && (
        <div
          className="fixed z-[9999] bg-surface border border-edge rounded-md shadow-lg py-1 min-w-[200px]"
          style={{
            left: multiSelectContextMenu.x,
            top: multiSelectContextMenu.y,
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
            {selectedTabIds.size} tab
            {selectedTabIds.size === 1 ? "" : "s"} selected
          </div>
          <div className="border-t border-edge my-1" />
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-foreground hover:bg-hover cursor-pointer text-left"
            onClick={handleAddSelectedToSplit}
          >
            Open selected in new Split View
          </button>
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-red-400 hover:bg-hover cursor-pointer text-left"
            onClick={handleCloseSelected}
          >
            Close selected tabs
          </button>
        </div>
      )}

      {emptyAreaContextMenu && (
        <div
          className="fixed z-[9999] bg-surface border border-edge rounded-md shadow-lg py-1 min-w-[220px] max-h-[400px] overflow-y-auto thin-scrollbar"
          style={{
            left: emptyAreaContextMenu.x,
            top: emptyAreaContextMenu.y,
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
            {t("nav.openHostInNewTab", "Open host in new tab")}
          </div>
          <div className="border-t border-edge" />
          <div className="px-2 py-1.5 border-b border-edge">
            <input
              ref={emptyAreaFilterInputRef}
              type="text"
              value={emptyAreaFilter}
              onChange={(e) => setEmptyAreaFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setEmptyAreaContextMenu(null);
                } else if (e.key === "Enter") {
                  const first = filteredEmptyAreaHosts[0];
                  if (first) handleOpenHostInNewTab(first);
                }
              }}
              placeholder={t("common.filter", "Filter hosts…")}
              className="w-full text-[13px] px-2 py-1 rounded-sm bg-input border border-edge text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {emptyAreaHostsLoading && (
            <div className="px-3 py-2 text-[13px] text-muted-foreground">
              {t("common.loading", "Loading…")}
            </div>
          )}
          {!emptyAreaHostsLoading && emptyAreaHostsError && (
            <div className="px-3 py-2 text-[13px] text-red-400">
              {emptyAreaHostsError}
            </div>
          )}
          {!emptyAreaHostsLoading &&
            !emptyAreaHostsError &&
            emptyAreaHosts.length === 0 && (
              <div className="px-3 py-2 text-[13px] text-muted-foreground">
                {t("nav.noHosts", "No hosts available")}
              </div>
            )}
          {!emptyAreaHostsLoading &&
            !emptyAreaHostsError &&
            emptyAreaHosts.length > 0 &&
            filteredEmptyAreaHosts.length === 0 && (
              <div className="px-3 py-2 text-[13px] text-muted-foreground">
                {t("common.noMatches", "No matches")}
              </div>
            )}
          {!emptyAreaHostsLoading &&
            !emptyAreaHostsError &&
            filteredEmptyAreaHosts.map((host) => {
              const label = host.name?.trim()
                ? host.name
                : `${host.username}@${host.ip}:${host.port}`;
              return (
                <button
                  key={host.id}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-foreground hover:bg-hover cursor-pointer text-left"
                  onClick={() => handleOpenHostInNewTab(host)}
                >
                  <ServerIcon className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                  <span className="truncate flex-1 min-w-0">{label}</span>
                  <Plus className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
