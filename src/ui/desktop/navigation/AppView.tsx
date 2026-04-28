import React, { useEffect, useRef, useState, useMemo } from "react";
import { Terminal } from "@/ui/desktop/apps/features/terminal/Terminal.tsx";
import { ServerStats as ServerView } from "@/ui/desktop/apps/features/server-stats/ServerStats.tsx";
import { FileManager } from "@/ui/desktop/apps/features/file-manager/FileManager.tsx";
import {
  GuacamoleDisplay,
  type GuacamoleConnectionConfig,
} from "@/ui/desktop/apps/features/guacamole/GuacamoleDisplay.tsx";
import { TunnelManager } from "@/ui/desktop/apps/features/tunnel/TunnelManager.tsx";
import { DockerManager } from "@/ui/desktop/apps/features/docker/DockerManager.tsx";
import { NetworkGraphCard } from "@/ui/desktop/apps/dashboard/cards/NetworkGraphCard";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import type {
  SplitLayoutNode,
  DropPosition,
} from "@/ui/desktop/navigation/tabs/splitLayout.ts";
import {
  getRowLeafIds,
  getLeafIds,
  findLeaf,
} from "@/ui/desktop/navigation/tabs/splitLayout.ts";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable.tsx";
import * as ResizablePrimitive from "react-resizable-panels";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import {
  RefreshCcw,
  Columns2,
  Rows2,
  X,
  Pencil,
  Maximize2,
  Minimize2,
  Copy,
  SeparatorVertical,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import {
  TERMINAL_THEMES,
  DEFAULT_TERMINAL_CONFIG,
} from "@/constants/terminal-themes";
import { useTheme } from "@/components/theme-provider";
import { SSHAuthDialog } from "@/ui/desktop/navigation/dialogs/SSHAuthDialog.tsx";

interface TabData {
  id: number;
  type: string;
  title: string;
  terminalRef?: {
    current?: {
      fit?: () => void;
      notifyResize?: () => void;
      refresh?: () => void;
    };
  };
  hostConfig?: any;
  connectionConfig?: GuacamoleConnectionConfig;
  [key: string]: unknown;
}

type LayoutNode =
  | number // leaf: index into layoutTabs[]
  | { direction: "horizontal" | "vertical"; children: LayoutNode[] };

// Legacy preset layouts — only used as a fallback if splitLayout is unset.
const SPLIT_LAYOUTS: Record<number, LayoutNode> = {
  2: { direction: "horizontal", children: [0, 1] },
  3: {
    direction: "vertical",
    children: [{ direction: "horizontal", children: [0, 1] }, 2],
  },
  4: {
    direction: "vertical",
    children: [
      { direction: "horizontal", children: [0, 1] },
      { direction: "horizontal", children: [2, 3] },
    ],
  },
  5: {
    direction: "vertical",
    children: [
      { direction: "horizontal", children: [0, 1] },
      { direction: "horizontal", children: [2, 3, 4] },
    ],
  },
  6: {
    direction: "vertical",
    children: [
      { direction: "horizontal", children: [0, 1, 2] },
      { direction: "horizontal", children: [3, 4, 5] },
    ],
  },
  7: {
    direction: "vertical",
    children: [
      { direction: "horizontal", children: [0, 1, 2] },
      { direction: "horizontal", children: [3, 4, 5] },
      6,
    ],
  },
  8: {
    direction: "vertical",
    children: [
      { direction: "horizontal", children: [0, 1, 2] },
      { direction: "horizontal", children: [3, 4, 5] },
      { direction: "horizontal", children: [6, 7] },
    ],
  },
  9: {
    direction: "vertical",
    children: [
      { direction: "horizontal", children: [0, 1, 2] },
      { direction: "horizontal", children: [3, 4, 5] },
      { direction: "horizontal", children: [6, 7, 8] },
    ],
  },
  10: {
    direction: "vertical",
    children: [
      { direction: "horizontal", children: [0, 1, 2, 3] },
      { direction: "horizontal", children: [4, 5, 6] },
      { direction: "horizontal", children: [7, 8, 9] },
    ],
  },
  11: {
    direction: "vertical",
    children: [
      { direction: "horizontal", children: [0, 1, 2, 3] },
      { direction: "horizontal", children: [4, 5, 6, 7] },
      { direction: "horizontal", children: [8, 9, 10] },
    ],
  },
  12: {
    direction: "vertical",
    children: [
      { direction: "horizontal", children: [0, 1, 2, 3] },
      { direction: "horizontal", children: [4, 5, 6, 7] },
      { direction: "horizontal", children: [8, 9, 10, 11] },
    ],
  },
};

interface TerminalViewProps {
  isTopbarOpen?: boolean;
  rightSidebarOpen?: boolean;
  rightSidebarWidth?: number;
}

export function AppView({
  isTopbarOpen = true,
  rightSidebarOpen = false,
  rightSidebarWidth = 400,
}: TerminalViewProps): React.ReactElement {
  const {
    tabs,
    currentTab,
    setCurrentTab,
    allSplitScreenTab,
    splitLayout,
    removeTab,
    updateTab,
    addTab,
    tabDragToSplit,
    setDragOverTerminalArea,
    executeDragSplit,
    setSplitScreenTabs,
    setSplitLayout,
    splitPanelAt,
    swapInSplitLayout,
    addToSplitRoot,
    cancelTabDragToSplit,
    removeFromSplitLayout,
    setNodeSizes,
  } = useTabs() as {
    tabs: TabData[];
    currentTab: number;
    setCurrentTab: (id: number) => void;
    allSplitScreenTab: number[];
    splitLayout: SplitLayoutNode | null;
    removeTab: (id: number) => void;
    updateTab: (tabId: number, updates: Partial<Omit<TabData, "id">>) => void;
    addTab: (tab: {
      type: string;
      title?: string;
      hostConfig?: unknown;
      connectionConfig?: unknown;
      [key: string]: unknown;
    }) => number;
    setSplitScreenTabs: (tabIds: number[]) => void;
    setSplitLayout: (layout: SplitLayoutNode | null) => void;
    splitPanelAt: (
      targetTabId: number,
      newTabId: number,
      position: DropPosition,
    ) => void;
    tabDragToSplit: {
      draggedTabId: number;
      isOverTerminalArea: boolean;
    } | null;
    setDragOverTerminalArea: (isOver: boolean) => void;
    executeDragSplit: (
      draggedTabId: number,
      target?: { tabId: number; position: DropPosition },
    ) => void;
    swapInSplitLayout: (a: number, b: number) => void;
    addToSplitRoot: (
      newTabId: number,
      position: "top" | "right" | "bottom" | "left",
    ) => void;
    cancelTabDragToSplit: () => void;
    removeFromSplitLayout: (tabId: number) => void;
    setNodeSizes: (path: string, sizes: number[]) => void;
  };
  const { state: sidebarState } = useSidebar();
  const { theme: appTheme } = useTheme();

  const isDarkMode = useMemo(() => {
    if (appTheme === "dark") return true;
    if (appTheme === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }, [appTheme]);

  const terminalTabs = useMemo(
    () =>
      tabs.filter(
        (tab: TabData) =>
          tab.type === "terminal" ||
          tab.type === "server_stats" ||
          tab.type === "file_manager" ||
          tab.type === "rdp" ||
          tab.type === "vnc" ||
          tab.type === "telnet" ||
          tab.type === "tunnel" ||
          tab.type === "docker" ||
          tab.type === "network_graph",
      ),
    [tabs],
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [panelRects, setPanelRects] = useState<Record<string, DOMRect | null>>(
    {},
  );
  const [ready, setReady] = useState<boolean>(true);

  const [panelDrag, setPanelDrag] = useState<{
    sourceTabId: number;
    hoverTabId: number | null;
  } | null>(null);

  // Refs for the native document-level dragstart handler below — it
  // needs current `tabs` / `allSplitScreenTab` without being
  // re-installed on every render.
  // Titlebar drag for panel snapping is handled inline via React props
  // on the titlebar element in renderPanelTitlebarsLayer — no
  // document-level shim needed now that the titlebar lives in a
  // pointer-events:auto layer (see renderPanelTitlebarsLayer).

  const [panelContextMenu, setPanelContextMenu] = useState<{
    tabId: number;
    x: number;
    y: number;
  } | null>(null);

  const [panelEditingTabId, setPanelEditingTabId] = useState<number | null>(
    null,
  );
  const [panelEditValue, setPanelEditValue] = useState("");
  const panelEditInputRef = useRef<HTMLInputElement | null>(null);

  // "Focus mode" — a single terminal zooms to fill the container on top of
  // the split layout. Escape or the toggle button exits.
  const [focusedTabId, setFocusedTabId] = useState<number | null>(null);

  useEffect(() => {
    if (focusedTabId === null) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFocusedTabId(null);
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [focusedTabId]);

  // Alt+H/J/K/L — vim-style directional pane navigation inside a split
  // view. User-specified mapping: h=left, j=up, k=down, l=right.
  // Geometry-based (panel bounding rects) so it handles arbitrarily
  // nested splits correctly. Alt (not Ctrl) so xterm.js doesn't swallow
  // the keystroke inside the focused terminal.
  useEffect(() => {
    const handleVimNav = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey || e.repeat) {
        return;
      }
      const key = e.key;
      if (key !== "h" && key !== "j" && key !== "k" && key !== "l") return;

      const leafIds = getLeafIds(splitLayout);
      if (leafIds.length < 2 || currentTab == null) return;
      if (!leafIds.includes(currentTab)) return;

      const activeEl = panelRefs.current[String(currentTab)];
      if (!activeEl) return;
      const active = activeEl.getBoundingClientRect();

      const dir: "left" | "right" | "up" | "down" =
        key === "h"
          ? "left"
          : key === "l"
            ? "right"
            : key === "j"
              ? "up"
              : "down";

      let bestId: number | null = null;
      let bestDist = Infinity;
      const EPS = 2;

      for (const id of leafIds) {
        if (id === currentTab) continue;
        const el = panelRefs.current[String(id)];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        let primary: number;
        let overlaps: boolean;
        if (dir === "left") {
          if (r.right > active.left - EPS) continue;
          primary = active.left - r.right;
          overlaps = r.bottom > active.top + EPS && r.top < active.bottom - EPS;
        } else if (dir === "right") {
          if (r.left < active.right + EPS) continue;
          primary = r.left - active.right;
          overlaps = r.bottom > active.top + EPS && r.top < active.bottom - EPS;
        } else if (dir === "up") {
          if (r.bottom > active.top - EPS) continue;
          primary = active.top - r.bottom;
          overlaps = r.right > active.left + EPS && r.left < active.right - EPS;
        } else {
          if (r.top < active.bottom + EPS) continue;
          primary = r.top - active.bottom;
          overlaps = r.right > active.left + EPS && r.left < active.right - EPS;
        }
        if (!overlaps) continue;
        // Tie-break by center-axis offset so neighbors sharing an edge
        // pick the one most aligned with the active pane.
        const activeCenter =
          dir === "left" || dir === "right"
            ? (active.top + active.bottom) / 2
            : (active.left + active.right) / 2;
        const rCenter =
          dir === "left" || dir === "right"
            ? (r.top + r.bottom) / 2
            : (r.left + r.right) / 2;
        const dist = primary + 0.01 * Math.abs(rCenter - activeCenter);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = id;
        }
      }
      if (bestId != null) {
        e.preventDefault();
        e.stopPropagation();
        setCurrentTab(bestId);
      }
    };
    window.addEventListener("keydown", handleVimNav, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleVimNav, {
        capture: true,
      } as EventListenerOptions);
  }, [splitLayout, currentTab, setCurrentTab]);

  useEffect(() => {
    if (panelEditingTabId !== null && panelEditInputRef.current) {
      panelEditInputRef.current.focus();
      panelEditInputRef.current.select();
    }
  }, [panelEditingTabId]);

  useEffect(() => {
    if (!panelContextMenu) return;
    const close = () => setPanelContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [panelContextMenu]);

  const _leaf = (id: number): SplitLayoutNode => ({
    type: "leaf" as const,
    tabId: id,
  });
  const _vStack = (ids: number[]): SplitLayoutNode =>
    ids.length === 1
      ? _leaf(ids[0])
      : { type: "split", direction: "vertical", children: ids.map(_leaf) };
  const _hStack = (ids: number[]): SplitLayoutNode =>
    ids.length === 1
      ? _leaf(ids[0])
      : { type: "split", direction: "horizontal", children: ids.map(_leaf) };

  // Max Column: selected tab becomes a full-height column.
  // Works on any tree shape: finds which top-level column the tab lives in,
  // removes it, makes it a standalone column, and pushes displaced siblings
  // to the nearest neighbour column.
  // Duplicate a split-view panel: opens a new terminal to the same host
  // and inserts it directly adjacent to the source panel in the layout.
  const duplicateTerminalForTab = (tabId: number) => {
    const source = tabs.find((t: TabData) => t.id === tabId);
    if (!source) return;
    // Strip runtime-only fields so the new tab doesn't inherit a stale
    // terminal ref or instanceId.
    const { id: _id, terminalRef: _ref, instanceId: _inst, ...rest } = source;
    void _id;
    void _ref;
    void _inst;
    const newTabId = addTab({
      ...(rest as Record<string, unknown>),
      type: source.type,
      title: source.title,
      hostConfig: source.hostConfig,
      connectionConfig: source.connectionConfig,
    });
    if (newTabId <= 0) return;
    // Insert the duplicate adjacent to the original. splitPanelAt handles
    // the case where the layout doesn't exist yet by creating a 2-pane one.
    splitPanelAt(tabId, newTabId, "right");
    setCurrentTab(newTabId);
  };

  const maxColumnForTab = (tabId: number) => {
    if (!splitLayout || splitLayout.type === "leaf") return;

    // Strategy: normalize the current layout into a list of columns,
    // where each "column" is a list of tab IDs stacked vertically.
    // Then replace the column containing tabId with just tabId,
    // pushing displaced tabs to the nearest neighbour.
    const columns: number[][] = [];

    if (splitLayout.direction === "horizontal") {
      // Root is already column-based (e.g. result of a prior Max Column)
      for (const child of splitLayout.children) {
        columns.push(getLeafIds(child));
      }
    } else {
      // Root is vertical (row-major grid). Transpose rows → columns.
      const rows: number[][] = [];
      for (const child of splitLayout.children) {
        if (child.type === "leaf") {
          rows.push([child.tabId]);
        } else if (child.direction === "horizontal") {
          rows.push(getLeafIds(child));
        } else {
          rows.push(getLeafIds(child));
        }
      }
      const maxCols = Math.max(...rows.map((r) => r.length));
      for (let c = 0; c < maxCols; c++) {
        const col: number[] = [];
        for (const row of rows) {
          if (c < row.length) col.push(row[c]);
        }
        columns.push(col);
      }
    }

    // Find which column contains the target
    let targetColIdx = columns.findIndex((col) => col.includes(tabId));
    if (targetColIdx < 0) targetColIdx = 0;

    // Collect displaced tabs (others in the same column)
    const displaced = columns[targetColIdx].filter((id) => id !== tabId);

    // Push displaced to nearest neighbour
    const neighborIdx =
      targetColIdx > 0
        ? targetColIdx - 1
        : targetColIdx < columns.length - 1
          ? targetColIdx + 1
          : -1;

    // Build new columns
    const newColumns: number[][] = [];
    for (let c = 0; c < columns.length; c++) {
      if (c === targetColIdx) {
        newColumns.push([tabId]);
      } else {
        const base = columns[c].filter((id) => id !== tabId);
        if (c === neighborIdx) {
          newColumns.push([...base, ...displaced]);
        } else {
          newColumns.push(base);
        }
      }
    }

    // Build the tree
    const hChildren: SplitLayoutNode[] = newColumns
      .filter((col) => col.length > 0)
      .map((col) => _vStack(col));

    if (hChildren.length <= 1) {
      setSplitLayout(_leaf(tabId));
    } else {
      setSplitLayout({
        type: "split",
        direction: "horizontal",
        children: hChildren,
      });
    }
    setResetKey((k) => k + 1);
    requestAnimationFrame(() => scheduleMeasureAndFit());
  };

  // Max Row: selected tab becomes a full-width row.
  // Normalizes into rows, replaces the target row with just tabId,
  // pushes displaced siblings to the nearest neighbour row.
  const maxRowForTab = (tabId: number) => {
    if (!splitLayout || splitLayout.type === "leaf") return;

    const rows: number[][] = [];

    if (splitLayout.direction === "vertical") {
      // Root is already row-based
      for (const child of splitLayout.children) {
        rows.push(getLeafIds(child));
      }
    } else {
      // Root is horizontal (column-major). Transpose columns → rows.
      const columns: number[][] = [];
      for (const child of splitLayout.children) {
        columns.push(getLeafIds(child));
      }
      const maxRows = Math.max(...columns.map((c) => c.length));
      for (let r = 0; r < maxRows; r++) {
        const row: number[] = [];
        for (const col of columns) {
          if (r < col.length) row.push(col[r]);
        }
        rows.push(row);
      }
    }

    let targetRowIdx = rows.findIndex((row) => row.includes(tabId));
    if (targetRowIdx < 0) targetRowIdx = 0;

    const displaced = rows[targetRowIdx].filter((id) => id !== tabId);
    const neighborIdx =
      targetRowIdx > 0
        ? targetRowIdx - 1
        : targetRowIdx < rows.length - 1
          ? targetRowIdx + 1
          : -1;

    const newRows: number[][] = [];
    for (let r = 0; r < rows.length; r++) {
      if (r === targetRowIdx) {
        newRows.push([tabId]);
      } else {
        const base = rows[r].filter((id) => id !== tabId);
        if (r === neighborIdx) {
          newRows.push([...base, ...displaced]);
        } else {
          newRows.push(base);
        }
      }
    }

    const vChildren: SplitLayoutNode[] = newRows
      .filter((row) => row.length > 0)
      .map((row) => _hStack(row));

    if (vChildren.length <= 1) {
      setSplitLayout(_leaf(tabId));
    } else {
      setSplitLayout({
        type: "split",
        direction: "vertical",
        children: vChildren,
      });
    }
    setResetKey((k) => k + 1);
    requestAnimationFrame(() => scheduleMeasureAndFit());
  };

  const [externalDropTarget, setExternalDropTarget] = useState<{
    tabId: number;
    position: DropPosition;
  } | null>(null);

  const [outerDropEdge, setOuterDropEdge] = useState<
    "top" | "right" | "bottom" | "left" | null
  >(null);

  // Manual mouse-based drag for panel titlebars. Titlebar onMouseDown
  // sets panelDrag; this effect installs window mousemove/mouseup that
  // hit-test against panelRects + container edges and execute the
  // drop. Hit-priority matches the visual z-order users expect:
  // container outer edges (Max Row / Max Column) > per-panel inner
  // directional zones > panel-body swap.
  const panelDragTargetRef = useRef<{
    kind: "outer" | "inner" | "swap" | null;
    outerEdge?: "top" | "right" | "bottom" | "left";
    innerTabId?: number;
    innerPos?: DropPosition;
    swapTabId?: number;
  }>({ kind: null });
  useEffect(() => {
    if (!panelDrag) {
      panelDragTargetRef.current = { kind: null };
      return;
    }
    const sourceTabId = panelDrag.sourceTabId;
    const OUTER_THICKNESS = 56;
    const SPLIT_OUTER = 0.25;

    const handleMove = (e: MouseEvent) => {
      const cr = containerRef.current?.getBoundingClientRect();
      if (!cr) return;
      const x = e.clientX;
      const y = e.clientY;

      // Outside the container — clear any target.
      if (x < cr.left || x > cr.right || y < cr.top || y > cr.bottom) {
        setOuterDropEdge(null);
        setExternalDropTarget(null);
        setPanelDrag((p) => (p ? { ...p, hoverTabId: null } : p));
        panelDragTargetRef.current = { kind: null };
        return;
      }

      const localX = x - cr.left;
      const localY = y - cr.top;

      // Outer container edges first (user preference: outer on top).
      let outerEdge: "top" | "right" | "bottom" | "left" | null = null;
      if (localY <= OUTER_THICKNESS) outerEdge = "top";
      else if (localY >= cr.height - OUTER_THICKNESS) outerEdge = "bottom";
      else if (localX <= OUTER_THICKNESS) outerEdge = "left";
      else if (localX >= cr.width - OUTER_THICKNESS) outerEdge = "right";

      if (outerEdge) {
        setOuterDropEdge(outerEdge);
        setExternalDropTarget(null);
        setPanelDrag((p) => (p ? { ...p, hoverTabId: null } : p));
        panelDragTargetRef.current = { kind: "outer", outerEdge };
        return;
      }

      // Locate which panel the pointer is over (excluding source).
      let hoveredTabId: number | null = null;
      let hoveredRect: DOMRect | null = null;
      for (const tid of allSplitScreenTab) {
        if (tid === sourceTabId) continue;
        const r = panelRects[String(tid)];
        if (!r) continue;
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          hoveredTabId = tid;
          hoveredRect = r;
          break;
        }
      }

      if (hoveredTabId === null || !hoveredRect) {
        setOuterDropEdge(null);
        setExternalDropTarget(null);
        setPanelDrag((p) => (p ? { ...p, hoverTabId: null } : p));
        panelDragTargetRef.current = { kind: null };
        return;
      }

      const px = x - hoveredRect.left;
      const py = y - hoveredRect.top;
      const edgeH = hoveredRect.height * SPLIT_OUTER;
      const edgeW = hoveredRect.width * SPLIT_OUTER;

      let innerPos: DropPosition | null = null;
      if (py <= edgeH) innerPos = "top";
      else if (py >= hoveredRect.height - edgeH) innerPos = "bottom";
      else if (px <= edgeW) innerPos = "left";
      else if (px >= hoveredRect.width - edgeW) innerPos = "right";

      if (innerPos) {
        setExternalDropTarget({ tabId: hoveredTabId, position: innerPos });
        setOuterDropEdge(null);
        setPanelDrag((p) => (p ? { ...p, hoverTabId: null } : p));
        panelDragTargetRef.current = {
          kind: "inner",
          innerTabId: hoveredTabId,
          innerPos,
        };
        return;
      }

      // Center of the panel — swap target.
      setPanelDrag((p) => (p ? { ...p, hoverTabId: hoveredTabId } : p));
      setOuterDropEdge(null);
      setExternalDropTarget(null);
      panelDragTargetRef.current = { kind: "swap", swapTabId: hoveredTabId };
    };

    const handleUp = () => {
      const target = panelDragTargetRef.current;
      if (target.kind === "outer" && target.outerEdge) {
        addToSplitRoot(sourceTabId, target.outerEdge);
      } else if (
        target.kind === "inner" &&
        target.innerTabId !== undefined &&
        target.innerPos
      ) {
        executeDragSplit(sourceTabId, {
          tabId: target.innerTabId,
          position: target.innerPos,
        });
      } else if (target.kind === "swap" && target.swapTabId !== undefined) {
        swapInSplitLayout(sourceTabId, target.swapTabId);
      }
      setPanelDrag(null);
      setOuterDropEdge(null);
      setExternalDropTarget(null);
      panelDragTargetRef.current = { kind: null };
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [
    panelDrag,
    allSplitScreenTab,
    panelRects,
    addToSplitRoot,
    executeDragSplit,
    swapInSplitLayout,
  ]);

  const [resetKey, setResetKey] = useState<number>(0);
  const previousStylesRef = useRef<Record<number, React.CSSProperties>>({});

  const updatePanelRects = React.useCallback(() => {
    const next: Record<string, DOMRect | null> = {};
    Object.entries(panelRefs.current).forEach(([id, el]) => {
      if (el) next[id] = el.getBoundingClientRect();
    });
    setPanelRects(next);
  }, []);

  const fitActiveAndNotify = React.useCallback(() => {
    const visibleIds: number[] = [];
    const currentTabInSplit =
      currentTab !== null && allSplitScreenTab.includes(currentTab);
    if (allSplitScreenTab.length === 0 || !currentTabInSplit) {
      if (currentTab) visibleIds.push(currentTab);
    } else {
      const splitIds = allSplitScreenTab as number[];
      visibleIds.push(currentTab, ...splitIds.filter((i) => i !== currentTab));
    }

    const operations = terminalTabs
      .filter((t: TabData) => visibleIds.includes(t.id))
      .map((t: TabData) => t.terminalRef?.current)
      .filter((ref) => ref?.fit);

    requestAnimationFrame(() => {
      operations.forEach((ref) => {
        ref.fit?.();
        ref.notifyResize?.();
        ref.refresh?.();
      });
    });
  }, [allSplitScreenTab, currentTab, terminalTabs]);

  const layoutScheduleRef = useRef<number | null>(null);
  const scheduleMeasureAndFit = React.useCallback(() => {
    if (layoutScheduleRef.current)
      cancelAnimationFrame(layoutScheduleRef.current);
    layoutScheduleRef.current = requestAnimationFrame(() => {
      updatePanelRects();
      fitActiveAndNotify();
    });
  }, [updatePanelRects, fitActiveAndNotify]);

  const hideThenFit = React.useCallback(() => {
    requestAnimationFrame(() => {
      updatePanelRects();
      fitActiveAndNotify();
    });
  }, [updatePanelRects, fitActiveAndNotify]);

  const prevStateRef = useRef({
    terminalTabsLength: terminalTabs.length,
    currentTab,
    splitScreenTabsStr: allSplitScreenTab.join(","),
    terminalTabIds: terminalTabs.map((t) => t.id).join(","),
  });

  useEffect(() => {
    const prev = prevStateRef.current;
    const currentTabIds = terminalTabs.map((t) => t.id).join(",");

    const lengthChanged = prev.terminalTabsLength !== terminalTabs.length;
    const currentTabChanged = prev.currentTab !== currentTab;
    const splitChanged =
      prev.splitScreenTabsStr !== allSplitScreenTab.join(",");
    const tabIdsChanged = prev.terminalTabIds !== currentTabIds;

    const isJustReorder =
      !lengthChanged && tabIdsChanged && !currentTabChanged && !splitChanged;

    if (
      (lengthChanged || currentTabChanged || splitChanged) &&
      !isJustReorder
    ) {
      hideThenFit();
    }

    prevStateRef.current = {
      terminalTabsLength: terminalTabs.length,
      currentTab,
      splitScreenTabsStr: allSplitScreenTab.join(","),
      terminalTabIds: currentTabIds,
    };
  }, [
    currentTab,
    terminalTabs.length,
    allSplitScreenTab.join(","),
    terminalTabs,
    hideThenFit,
  ]);

  useEffect(() => {
    scheduleMeasureAndFit();
  }, [
    scheduleMeasureAndFit,
    allSplitScreenTab.length,
    isTopbarOpen,
    sidebarState,
    resetKey,
    rightSidebarOpen,
    rightSidebarWidth,
  ]);

  // Re-fit terminals when focus mode changes. Delay to let the 250ms
  // CSS animation finish so .fit() measures the final dimensions.
  // Also auto-focus the terminal so the cursor is active.
  useEffect(() => {
    // Fit once immediately (good enough for most cases)
    requestAnimationFrame(() => fitActiveAndNotify());

    // Fit again after the animation completes (250ms) to get exact sizing
    const timer = setTimeout(() => {
      fitActiveAndNotify();

      // Auto-focus the terminal
      if (focusedTabId !== null) {
        const focusedTab = terminalTabs.find(
          (t: { id: number }) => t.id === focusedTabId,
        );
        if (focusedTab?.terminalRef?.current) {
          const ref = focusedTab.terminalRef.current;
          ref.focus?.();
          ref.fit?.();
        }
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [focusedTabId, fitActiveAndNotify, terminalTabs]);

  useEffect(() => {
    const roContainer = containerRef.current
      ? new ResizeObserver(() => {
          updatePanelRects();
          fitActiveAndNotify();
        })
      : null;
    if (containerRef.current && roContainer)
      roContainer.observe(containerRef.current);
    return () => roContainer?.disconnect();
  }, [updatePanelRects, fitActiveAndNotify]);

  useEffect(() => {
    const onWinResize = () => {
      updatePanelRects();
      fitActiveAndNotify();
    };
    window.addEventListener("resize", onWinResize);
    return () => window.removeEventListener("resize", onWinResize);
  }, [updatePanelRects, fitActiveAndNotify]);

  const HEADER_H = 28;

  const terminalIdMapRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    terminalTabs.forEach((t) => terminalIdMapRef.current.add(t.id));
  }, [terminalTabs]);

  // Render the layered drop-zone overlay for a single panel.
  // Includes max-row/column zones (outer 10%) and split zones (inner 15%).
  const renderPanelDropZones = (params: {
    keyPrefix: string;
    top: number;
    left: number;
    width: number;
    height: number;
    isSamePanel: (pos: DropPosition) => boolean;
    handleEnter: (pos: DropPosition) => void;
    handleLeave: (pos: DropPosition) => void;
    handleDrop: (pos: DropPosition) => void;
    centerLabel: string;
    baseZIndex: number;
  }) => {
    const {
      keyPrefix,
      top,
      left,
      width,
      height,
      isSamePanel,
      handleEnter,
      handleLeave,
      handleDrop,
      centerLabel,
      baseZIndex,
    } = params;

    const SPLIT_OUTER = 0.25; // edge zones span 25% of the panel

    const edgeH = height * SPLIT_OUTER;
    const edgeW = width * SPLIT_OUTER;
    const centerH = height * (1 - 2 * SPLIT_OUTER);
    const centerW = width * (1 - 2 * SPLIT_OUTER);

    const zoneBase =
      "absolute pointer-events-auto transition-colors duration-100 flex items-center justify-center";
    const splitInactive =
      "bg-blue-500/5 border border-dashed border-blue-500/30";
    const splitActive = "bg-blue-500/30 border-2 border-blue-400";

    const zone = (
      pos: DropPosition,
      style: React.CSSProperties,
      label: string,
    ) => {
      const active = isSamePanel(pos);
      const cls = `${zoneBase} ${active ? splitActive : splitInactive}`;
      return (
        <div
          key={`${keyPrefix}-${pos}`}
          className={cls}
          style={{ ...style, zIndex: baseZIndex }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            handleEnter(pos);
          }}
          onDragLeave={() => handleLeave(pos)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleDrop(pos);
          }}
        >
          {active && (
            <span className="text-white text-[11px] font-semibold bg-blue-600/75 px-2 py-0.5 rounded whitespace-nowrap">
              {label}
            </span>
          )}
        </div>
      );
    };

    return (
      <React.Fragment key={keyPrefix}>
        {/* Outline */}
        <div
          className="absolute pointer-events-none border-2 border-dashed border-blue-400/40 rounded"
          style={{ top, left, width, height, zIndex: baseZIndex - 1 }}
        />
        {/* TOP */}
        {zone("top", { top, left, width, height: edgeH }, "Split top")}
        {/* BOTTOM */}
        {zone(
          "bottom",
          { top: top + height - edgeH, left, width, height: edgeH },
          "Split bottom",
        )}
        {/* LEFT */}
        {zone(
          "left",
          { top: top + edgeH, left, width: edgeW, height: centerH },
          "Split left",
        )}
        {/* RIGHT */}
        {zone(
          "right",
          {
            top: top + edgeH,
            left: left + width - edgeW,
            width: edgeW,
            height: centerH,
          },
          "Split right",
        )}
        {/* CENTER */}
        {zone(
          "center",
          {
            top: top + edgeH,
            left: left + edgeW,
            width: centerW,
            height: centerH,
          },
          centerLabel,
        )}
      </React.Fragment>
    );
  };

  const renderTerminalsLayer = () => {
    const styles: Record<number, React.CSSProperties> = {};
    const layoutTabs = allSplitScreenTab
      .map((tabId) => terminalTabs.find((tab: TabData) => tab.id === tabId))
      .filter((t): t is TabData => t !== null && t !== undefined);

    const mainTab = terminalTabs.find((tab: TabData) => tab.id === currentTab);

    // If the current tab is NOT part of the active split view, show it full-screen
    // instead of the split layout so navigating to a non-split tab actually works.
    const currentTabInSplit =
      currentTab !== null && allSplitScreenTab.includes(currentTab);
    const showFullScreenSingle =
      (allSplitScreenTab.length === 0 || !currentTabInSplit) && !!mainTab;

    if (showFullScreenSingle && mainTab) {
      const isFileManagerTab =
        mainTab.type === "file_manager" ||
        mainTab.type === "tunnel" ||
        mainTab.type === "docker" ||
        mainTab.type === "network_graph";
      const newStyle = {
        position: "absolute" as const,
        top: isFileManagerTab ? 0 : 4,
        left: isFileManagerTab ? 0 : 4,
        right: isFileManagerTab ? 0 : 4,
        bottom: isFileManagerTab ? 0 : 4,
        zIndex: 20,
        display: "block" as const,
        pointerEvents: "auto" as const,
        opacity: 1,
      };
      styles[mainTab.id] = newStyle;
      previousStylesRef.current[mainTab.id] = newStyle;
    } else {
      layoutTabs.forEach((t: TabData) => {
        const rect = panelRects[String(t.id)];
        const parentRect = containerRef.current?.getBoundingClientRect();
        if (rect && parentRect) {
          const newStyle = {
            position: "absolute" as const,
            top: rect.top - parentRect.top + HEADER_H + 4,
            left: rect.left - parentRect.left + 4,
            width: rect.width - 8,
            height: rect.height - HEADER_H - 8,
            zIndex: 20,
            display: "block" as const,
            pointerEvents: "auto" as const,
            opacity: 1,
          };
          styles[t.id] = newStyle;
          previousStylesRef.current[t.id] = newStyle;
        }
      });
    }

    const sortedTerminalTabs = [...terminalTabs].sort((a, b) => a.id - b.id);

    return (
      <div
        className={`absolute inset-0 ${focusedTabId !== null ? "z-[10]" : "z-[1]"}`}
      >
        {sortedTerminalTabs.map((t: TabData) => {
          const hasStyle = !!styles[t.id];
          const isFocused = focusedTabId === t.id;
          const isVisible =
            hasStyle || (showFullScreenSingle && t.id === currentTab);

          const effectiveVisible = isVisible;

          const previousStyle = previousStylesRef.current[t.id];

          const isFileManagerTab =
            t.type === "file_manager" ||
            t.type === "tunnel" ||
            t.type === "docker" ||
            t.type === "network_graph";
          const standardStyle = {
            position: "absolute" as const,
            top: isFileManagerTab ? 0 : 4,
            left: isFileManagerTab ? 0 : 4,
            right: isFileManagerTab ? 0 : 4,
            bottom: isFileManagerTab ? 0 : 4,
          };

          let finalStyle: React.CSSProperties;

          const animTransition =
            "top 250ms ease, left 250ms ease, right 250ms ease, bottom 250ms ease, width 250ms ease, height 250ms ease, opacity 200ms ease";

          if (isFocused) {
            // Focused: expand to fill the container below the 28px title bar
            finalStyle = {
              position: "absolute",
              top: 28,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 99,
              display: "block",
              pointerEvents: "auto",
              opacity: 1,
              overflow: "hidden",
              transition: animTransition,
            };
          } else if (focusedTabId !== null) {
            // Another terminal is focused — dim this one
            finalStyle = hasStyle
              ? {
                  ...styles[t.id],
                  overflow: "hidden",
                  opacity: 0.15,
                  transition: animTransition,
                }
              : effectiveVisible
                ? {
                    ...(previousStyle || standardStyle),
                    opacity: 0.15,
                    pointerEvents: "none",
                    zIndex: 20,
                    display: "block",
                    overflow: "hidden",
                    transition: animTransition,
                  }
                : ({
                    ...(previousStyle || standardStyle),
                    opacity: 0,
                    pointerEvents: "none",
                    zIndex: 0,
                    display: "none",
                    overflow: "hidden",
                  } as React.CSSProperties);
          } else if (hasStyle) {
            finalStyle = {
              ...styles[t.id],
              overflow: "hidden",
              transition: animTransition,
            };
          } else if (effectiveVisible) {
            finalStyle = {
              ...(previousStyle || standardStyle),
              opacity: 1,
              pointerEvents: "auto",
              zIndex: 20,
              display: "block",
              overflow: "hidden",
              transition: animTransition,
            };
          } else {
            finalStyle = {
              ...(previousStyle || standardStyle),
              opacity: 0,
              pointerEvents: "none",
              zIndex: 0,
              display: "none",
              overflow: "hidden",
            } as React.CSSProperties;
          }

          const isTerminal = t.type === "terminal";
          const terminalConfig = {
            ...DEFAULT_TERMINAL_CONFIG,
            ...(t.hostConfig as any)?.terminalConfig,
          };

          let themeColors;
          if (terminalConfig.theme === "t800") {
            themeColors = isDarkMode
              ? TERMINAL_THEMES.t800Dark.colors
              : TERMINAL_THEMES.t800Light.colors;
          } else {
            themeColors =
              TERMINAL_THEMES[terminalConfig.theme]?.colors ||
              TERMINAL_THEMES.t800Dark.colors;
          }
          const backgroundColor = themeColors.background;

          return (
            <div
              key={t.id}
              data-pane-id={t.id}
              style={{
                ...finalStyle,
                pointerEvents:
                  panelDrag || tabDragToSplit
                    ? "none"
                    : finalStyle.pointerEvents,
              }}
            >
              <div
                className="absolute inset-0 rounded-md overflow-hidden"
                style={{
                  backgroundColor: isTerminal
                    ? backgroundColor
                    : "var(--bg-base)",
                }}
              >
                {t.type === "terminal" ? (
                  <Terminal
                    key={`term-${t.id}-${t.instanceId || ""}`}
                    ref={t.terminalRef}
                    hostConfig={t.hostConfig}
                    isVisible={effectiveVisible}
                    title={t.title}
                    showTitle={false}
                    splitScreen={allSplitScreenTab.length > 0}
                    onClose={() => removeTab(t.id)}
                    onTitleChange={(title) => updateTab(t.id, { title })}
                  />
                ) : t.type === "server_stats" ? (
                  <ServerView
                    key={`stats-${t.id}-${t.instanceId || ""}`}
                    hostConfig={t.hostConfig}
                    title={t.title}
                    isVisible={effectiveVisible}
                    isTopbarOpen={isTopbarOpen}
                    embedded
                  />
                ) : t.type === "rdp" ||
                  t.type === "vnc" ||
                  t.type === "telnet" ? (
                  t.connectionConfig ? (
                    <GuacamoleDisplay
                      key={`guac-${t.id}-${t.instanceId || ""}`}
                      connectionConfig={t.connectionConfig}
                      isVisible={effectiveVisible}
                      onDisconnect={() => removeTab(t.id)}
                      onError={(err) => {
                        toast.error(err);
                        removeTab(t.id);
                      }}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-red-500">
                      Missing connection configuration
                    </div>
                  )
                ) : t.type === "network_graph" ? (
                  <NetworkGraphCard
                    key={`netgraph-${t.id}-${t.instanceId || ""}`}
                    isTopbarOpen={isTopbarOpen}
                    rightSidebarOpen={rightSidebarOpen}
                    rightSidebarWidth={rightSidebarWidth}
                    embedded={false}
                  />
                ) : t.type === "tunnel" ? (
                  <TunnelManager
                    key={`tunnel-${t.id}-${t.instanceId || ""}`}
                    hostConfig={t.hostConfig}
                    title={t.title}
                    isVisible={effectiveVisible}
                    isTopbarOpen={isTopbarOpen}
                    embedded
                  />
                ) : t.type === "docker" ? (
                  <DockerManager
                    key={`docker-${t.id}-${t.instanceId || ""}`}
                    hostConfig={t.hostConfig}
                    title={t.title}
                    isVisible={effectiveVisible}
                    isTopbarOpen={isTopbarOpen}
                    embedded
                    onClose={() => removeTab(t.id)}
                  />
                ) : (
                  <FileManager
                    key={`filemgr-${t.id}-${t.instanceId || ""}`}
                    embedded
                    initialHost={t.hostConfig}
                    onClose={() => removeTab(t.id)}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const ResetButton = ({ onClick }: { onClick: () => void }) => (
    <Button
      type="button"
      variant="ghost"
      draggable={false}
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      aria-label="Reset split sizes"
      className="absolute top-0 right-0 h-[28px] w-[28px] !rounded-none border-l-1 border-b-1 border-edge-panel bg-surface hover:bg-surface-hover text-foreground flex items-center justify-center p-0"
    >
      <RefreshCcw className="h-4 w-4" />
    </Button>
  );

  const handleReset = () => {
    setResetKey((k) => k + 1);
    requestAnimationFrame(() => scheduleMeasureAndFit());
  };

  // Titlebars for each split panel. Rendered as independent
  // absolute-positioned children of the container — NOT wrapped in any
  // outer div. The HTML5 drag API was silently failing for these
  // titlebars (multiple suspect interactions with the nested overlay
  // structure / react-resizable-panels), so we use plain mousedown-
  // based drag tracking: onMouseDown sets panelDrag, then a window
  // mousemove/mouseup effect hit-tests zones and executes the drop.
  const renderPanelTitlebars = (): React.ReactNode => {
    if (!splitLayout || allSplitScreenTab.length === 0) return null;
    if (splitLayout.type === "leaf") return null;
    if (currentTab !== null && !allSplitScreenTab.includes(currentTab)) {
      return null;
    }
    const parentRect = containerRef.current?.getBoundingClientRect();
    if (!parentRect) return null;
    const firstLeafId = allSplitScreenTab[0];
    const canDrag = allSplitScreenTab.length > 1;

    return allSplitScreenTab.map((tabId) => {
      const tab = terminalTabs.find((t: TabData) => t.id === tabId);
      const rect = panelRects[String(tabId)];
      if (!tab || !rect) return null;
      const isFirst = tabId === firstLeafId;
      return (
        <div
          key={`titlebar-${tabId}`}
          className={`absolute bg-surface text-foreground text-[13px] leading-[28px] px-[10px] border-b border-edge-panel tracking-[1px] select-none flex items-center ${
            canDrag ? "cursor-grab active:cursor-grabbing" : ""
          }`}
          style={{
            top: rect.top - parentRect.top,
            left: rect.left - parentRect.left,
            width: rect.width,
            height: 28,
            zIndex: 30,
          }}
          data-panel-titlebar-tab-id={tab.id}
          onMouseDown={(e) => {
            if (!canDrag) return;
            if (e.button !== 0) return;
            // The mouseup handler on the same element fires the rename
            // path via panelEditingTabId; don't interfere with that.
            if (panelEditingTabId === tab.id) return;
            e.preventDefault();
            setPanelDrag({ sourceTabId: tab.id, hoverTabId: null });
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setPanelContextMenu({
              tabId: tab.id,
              x: e.clientX,
              y: e.clientY,
            });
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setFocusedTabId(focusedTabId === tab.id ? null : tab.id);
          }}
        >
          {panelEditingTabId === tab.id ? (
            <input
              ref={panelEditInputRef}
              className="bg-transparent border-b border-foreground/40 outline-none text-foreground text-[13px] h-[22px] leading-[22px] w-[200px] tracking-[1px]"
              value={panelEditValue}
              onChange={(e) => setPanelEditValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  const trimmed = panelEditValue.trim();
                  if (trimmed) updateTab(tab.id, { title: trimmed });
                  setPanelEditingTabId(null);
                } else if (e.key === "Escape") {
                  setPanelEditingTabId(null);
                }
              }}
              onBlur={() => {
                const trimmed = panelEditValue.trim();
                if (trimmed) updateTab(tab.id, { title: trimmed });
                setPanelEditingTabId(null);
              }}
            />
          ) : (
            <span className="truncate flex-1">{tab.title}</span>
          )}
          <div className="absolute right-0 top-0 flex items-center h-[28px]">
            <button
              draggable={false}
              className="h-[28px] w-[28px] flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setFocusedTabId(focusedTabId === tab.id ? null : tab.id);
              }}
              title={
                focusedTabId === tab.id
                  ? "Restore split view"
                  : "Maximize terminal"
              }
            >
              {focusedTabId === tab.id ? (
                <Minimize2 className="h-3 w-3" />
              ) : (
                <Maximize2 className="h-3 w-3" />
              )}
            </button>
            {isFirst && <ResetButton onClick={handleReset} />}
          </div>
        </div>
      );
    });
  };

  const renderSplitOverlays = () => {
    if (!splitLayout || allSplitScreenTab.length === 0) return null;
    // A single-leaf root isn't a real split — render nothing so the terminal
    // shows in normal full-tab mode (and we avoid emitting a bare
    // ResizablePanel without a ResizablePanelGroup parent, which throws).
    if (splitLayout.type === "leaf") return null;
    // If the user is viewing a tab that isn't part of the split, hide the
    // split panel structure so we don't overlay it on top of the single-tab
    // view.
    if (currentTab !== null && !allSplitScreenTab.includes(currentTab)) {
      return null;
    }

    const handleStyle = {
      pointerEvents: "auto",
      zIndex: 12,
      background: "var(--border-base)",
    } as React.CSSProperties;

    const firstLeafId = (() => {
      const ids = allSplitScreenTab;
      return ids.length > 0 ? ids[0] : null;
    })();

    // Build the per-group onLayout handler. We bind the path so the
    // store knows which split node to update. The handler is invoked
    // on every drag tick by react-resizable-panels — setNodeSizes
    // short-circuits when the values haven't actually changed, so the
    // re-render storm during drag is bounded to one update per
    // distinct layout.
    const makeOnLayout = (groupPath: string) => (sizes: number[]) => {
      setNodeSizes(groupPath, sizes);
      scheduleMeasureAndFit();
    };

    const renderNode = (
      node: SplitLayoutNode,
      path: string,
      siblingCount: number,
      orderIndex: number,
      isRoot: boolean,
      parentSizes: number[] | undefined,
      indexInParent: number,
    ): React.ReactNode => {
      // Prefer the parent's persisted size for this child; fall back
      // to even split for new layouts that haven't been resized yet.
      const defaultSize =
        parentSizes && parentSizes[indexInParent] != null
          ? parentSizes[indexInParent]
          : Math.round(100 / siblingCount);

      if (node.type === "leaf") {
        const tab = terminalTabs.find((t: TabData) => t.id === node.tabId);
        if (!tab) return null;
        // The titlebar lives in renderPanelTitlebarsLayer (a sibling
        // layer with a clean pointer-events:auto ancestor chain) so
        // native HTML5 drag actually initiates. This ResizablePanel
        // only provides sizing for react-resizable-panels; its inner
        // div is a ref target for geometry measurement.
        return (
          <ResizablePanel
            key={`panel-${tab.id}`}
            id={`panel-${tab.id}`}
            defaultSize={defaultSize}
            minSize={8}
            className="!overflow-hidden h-full w-full"
            order={orderIndex}
          >
            <div
              ref={(el) => {
                panelRefs.current[String(tab.id)] = el;
              }}
              className="h-full w-full"
            />
          </ResizablePanel>
        );
      }

      const groupKey = isRoot ? String(resetKey) : `${path}-${resetKey}`;
      const groupId = isRoot ? `main-${node.direction}` : `group-${path}`;
      const groupPath = isRoot ? "" : path;
      const childSizes = node.sizes;

      const groupContent = (
        <ResizablePrimitive.PanelGroup
          key={groupKey}
          direction={node.direction}
          className="h-full w-full"
          id={groupId}
          onLayout={makeOnLayout(groupPath)}
        >
          {node.children.flatMap((child, i) => {
            const childPath = isRoot ? String(i) : `${path}-${i}`;
            const panel = renderNode(
              child,
              childPath,
              node.children.length,
              i + 1,
              false,
              childSizes,
              i,
            );
            if (i === 0) return [panel];
            return [
              <ResizableHandle
                key={`handle-${childPath}`}
                style={handleStyle}
              />,
              panel,
            ];
          })}
        </ResizablePrimitive.PanelGroup>
      );

      if (isRoot) return groupContent;

      return (
        <ResizablePanel
          key={`container-${path}`}
          id={`container-${path}`}
          defaultSize={defaultSize}
          minSize={8}
          className="!overflow-hidden h-full w-full"
          order={orderIndex}
        >
          {groupContent}
        </ResizablePanel>
      );
    };

    return (
      <div className="absolute inset-0 z-[10] pointer-events-none">
        {renderNode(splitLayout, "", 1, 1, true, undefined, 0)}
      </div>
    );
  };

  const currentTabData = tabs.find((tab: TabData) => tab.id === currentTab);
  const isFileManager = currentTabData?.type === "file_manager";
  const isTunnel = currentTabData?.type === "tunnel";
  const isDocker = currentTabData?.type === "docker";
  const isTerminal = currentTabData?.type === "terminal";
  const isSplitScreen = allSplitScreenTab.length > 0;

  const terminalConfig = {
    ...DEFAULT_TERMINAL_CONFIG,
    ...(currentTabData?.hostConfig as any)?.terminalConfig,
  };
  let containerThemeColors;
  if (terminalConfig.theme === "t800") {
    containerThemeColors = isDarkMode
      ? TERMINAL_THEMES.t800Dark.colors
      : TERMINAL_THEMES.t800Light.colors;
  } else {
    containerThemeColors =
      TERMINAL_THEMES[terminalConfig.theme]?.colors ||
      TERMINAL_THEMES.t800Dark.colors;
  }
  const terminalBackgroundColor = containerThemeColors.background;

  const topMarginPx = isTopbarOpen ? 74 : 26;
  const leftMarginPx = sidebarState === "collapsed" ? 26 : 8;
  const bottomMarginPx = 8;

  let containerBackground = "var(--color-canvas)";
  if ((isFileManager || isTunnel || isDocker) && !isSplitScreen) {
    containerBackground = "var(--color-deepest)";
  } else if (isTerminal) {
    containerBackground = terminalBackgroundColor;
  }

  return (
    <div
      ref={containerRef}
      className="border-2 border-edge rounded-lg overflow-hidden overflow-x-hidden relative"
      style={{
        background: containerBackground,
        marginLeft: leftMarginPx,
        marginRight: rightSidebarOpen
          ? `calc(var(--right-sidebar-width, ${rightSidebarWidth}px) + 8px)`
          : 17,
        marginTop: topMarginPx,
        marginBottom: bottomMarginPx,
        height: `calc(100vh - ${topMarginPx + bottomMarginPx}px)`,
        transition:
          "margin-left 200ms linear, margin-right 200ms linear, margin-top 200ms linear",
      }}
      onDragOver={(e) => {
        // Always attached so the listener is never detached between
        // renders when `tabDragToSplit` flips — React re-rendering the
        // handler slot to `undefined` and back has caused the drop
        // quadrants to miss the first dragover events during a
        // top-navbar drag.
        if (!tabDragToSplit) return;
        e.preventDefault();
        setDragOverTerminalArea(true);
      }}
      onDragLeave={(e) => {
        if (!tabDragToSplit) return;
        if (!containerRef.current?.contains(e.relatedTarget as Node)) {
          setDragOverTerminalArea(false);
          setExternalDropTarget(null);
          setOuterDropEdge(null);
        }
      }}
      onDrop={(e) => {
        if (!tabDragToSplit) return;
        e.preventDefault();
        executeDragSplit(tabDragToSplit.draggedTabId);
        setExternalDropTarget(null);
        setOuterDropEdge(null);
      }}
    >
      {renderTerminalsLayer()}
      <div
        className="relative z-[2]"
        style={{ height: "100%", pointerEvents: "none" }}
      >
        {renderSplitOverlays()}
      </div>
      {renderPanelTitlebars()}

      {/* Title bar for the focused/zoomed terminal */}
      {focusedTabId !== null &&
        (() => {
          const focusedTab = terminalTabs.find(
            (t: TabData) => t.id === focusedTabId,
          );
          if (!focusedTab) return null;
          return (
            <div
              className="absolute top-0 left-0 right-0 z-[15] bg-surface text-foreground text-[13px] h-[28px] leading-[28px] px-[10px] border-b border-edge-panel tracking-[1px] flex items-center justify-between select-none animate-in fade-in duration-200"
              onDoubleClick={() => setFocusedTabId(null)}
            >
              <span className="truncate flex-1">{focusedTab.title}</span>
              <button
                className="h-[28px] w-[28px] flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
                onClick={() => setFocusedTabId(null)}
                title="Restore split view (Esc)"
              >
                <Minimize2 className="h-3 w-3" />
              </button>
            </div>
          );
        })()}

      {panelDrag &&
        allSplitScreenTab.length > 1 &&
        (() => {
          const parentRect = containerRef.current?.getBoundingClientRect();
          if (!parentRect) return null;
          return allSplitScreenTab
            .filter((tabId) => tabId !== panelDrag.sourceTabId)
            .map((tabId) => {
              const rect = panelRects[String(tabId)];
              if (!rect) return null;
              const isHovered = panelDrag.hoverTabId === tabId;
              return (
                <div
                  key={`drop-zone-${tabId}`}
                  className={`absolute transition-colors duration-150 ${
                    isHovered
                      ? "bg-blue-500/15 border-2 border-dashed border-blue-500"
                      : "bg-transparent border-2 border-transparent"
                  } rounded flex items-center justify-center`}
                  style={{
                    top: rect.top - parentRect.top,
                    left: rect.left - parentRect.left,
                    width: rect.width,
                    height: rect.height,
                    zIndex: 60,
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (panelDrag.hoverTabId !== tabId) {
                      setPanelDrag((prev) =>
                        prev ? { ...prev, hoverTabId: tabId } : prev,
                      );
                    }
                  }}
                  onDragLeave={() => {
                    if (panelDrag.hoverTabId === tabId) {
                      setPanelDrag((prev) =>
                        prev ? { ...prev, hoverTabId: null } : prev,
                      );
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    swapInSplitLayout(panelDrag.sourceTabId, tabId);
                    setPanelDrag(null);
                  }}
                >
                  {isHovered && (
                    <span className="text-blue-400 text-sm font-medium bg-surface/80 px-3 py-1 rounded">
                      Drop to swap
                    </span>
                  )}
                </div>
              );
            });
        })()}

      {/* Source panel dim overlay */}
      {panelDrag &&
        (() => {
          const parentRect = containerRef.current?.getBoundingClientRect();
          const rect = panelRects[String(panelDrag.sourceTabId)];
          if (!parentRect || !rect) return null;
          return (
            <div
              className="absolute bg-black/30 rounded pointer-events-none"
              style={{
                top: rect.top - parentRect.top,
                left: rect.left - parentRect.left,
                width: rect.width,
                height: rect.height,
                zIndex: 60,
              }}
            />
          );
        })()}

      {/* Directional drop zones for panel drag (top/right/bottom/left/center) */}
      {panelDrag &&
        allSplitScreenTab.length > 1 &&
        (() => {
          const parentRect = containerRef.current?.getBoundingClientRect();
          if (!parentRect) return null;

          return (
            // Must stack above the outer drop-zones wrapper at z-[65] so
            // edge-adjacent panels' directional zones can still receive
            // drops where they overlap the container-edge outer zones.
            // Inner baseZIndex values only apply within this wrapper's
            // stacking context, so the wrapper itself has to win.
            <div className="absolute inset-0 z-[66] pointer-events-none">
              {allSplitScreenTab
                .filter((tabId) => tabId !== panelDrag.sourceTabId)
                .map((tabId) => {
                  const rect = panelRects[String(tabId)];
                  if (!rect) return null;

                  const top = rect.top - parentRect.top;
                  const left = rect.left - parentRect.left;
                  const width = rect.width;
                  const height = rect.height;

                  const isSamePanel = (pos: DropPosition) =>
                    externalDropTarget?.tabId === tabId &&
                    externalDropTarget.position === pos;

                  const handleEnter = (pos: DropPosition) =>
                    setExternalDropTarget({ tabId, position: pos });
                  const handleLeave = (pos: DropPosition) => {
                    if (
                      externalDropTarget?.tabId === tabId &&
                      externalDropTarget.position === pos
                    ) {
                      setExternalDropTarget(null);
                    }
                  };
                  const handleDrop = (pos: DropPosition) => {
                    executeDragSplit(panelDrag.sourceTabId, {
                      tabId,
                      position: pos,
                    });
                    setExternalDropTarget(null);
                    setPanelDrag(null);
                  };

                  return renderPanelDropZones({
                    keyPrefix: `pdrop-${tabId}`,
                    top,
                    left,
                    width,
                    height,
                    isSamePanel,
                    handleEnter,
                    handleLeave,
                    handleDrop,
                    centerLabel: "Swap",
                    // Must sit above the outer edge zones (z-[65]) so that
                    // edge-adjacent panels — the top row, bottom row, and
                    // left/right columns — can still receive panel-level
                    // snap drops where their own edge zones overlap the
                    // container-edge outer zones.
                    baseZIndex: 70,
                  });
                })}
            </div>
          );
        })()}

      {tabDragToSplit?.isOverTerminalArea &&
        (() => {
          const parentRect = containerRef.current?.getBoundingClientRect();
          if (!parentRect) return null;

          // When not in split mode yet, the active tab is the only "panel"
          const targetIds =
            allSplitScreenTab.length > 0
              ? allSplitScreenTab
              : currentTab
                ? [currentTab]
                : [];

          if (targetIds.length === 0) return null;

          return (
            <div className="absolute inset-0 z-[55] pointer-events-none">
              {targetIds.map((tabId) => {
                if (tabId === tabDragToSplit.draggedTabId) return null;

                let rect: DOMRect | null = null;
                if (allSplitScreenTab.length === 0) {
                  // Use container bounds for the single active panel
                  rect = parentRect;
                } else {
                  rect = panelRects[String(tabId)] ?? null;
                }
                if (!rect) return null;

                const isSamePanel = (pos: DropPosition) =>
                  externalDropTarget?.tabId === tabId &&
                  externalDropTarget.position === pos;

                const top = rect === parentRect ? 0 : rect.top - parentRect.top;
                const left =
                  rect === parentRect ? 0 : rect.left - parentRect.left;
                const width = rect.width;
                const height = rect.height;

                const handleEnter = (pos: DropPosition) =>
                  setExternalDropTarget({ tabId, position: pos });
                const handleLeave = (pos: DropPosition) => {
                  if (
                    externalDropTarget?.tabId === tabId &&
                    externalDropTarget.position === pos
                  ) {
                    setExternalDropTarget(null);
                  }
                };
                const handleDrop = (pos: DropPosition) => {
                  executeDragSplit(tabDragToSplit.draggedTabId, {
                    tabId,
                    position: pos,
                  });
                  setExternalDropTarget(null);
                };

                return renderPanelDropZones({
                  keyPrefix: `drop-${tabId}`,
                  top,
                  left,
                  width,
                  height,
                  isSamePanel,
                  handleEnter,
                  handleLeave,
                  handleDrop,
                  centerLabel: "Replace",
                  baseZIndex: 56,
                });
              })}
            </div>
          );
        })()}

      {/* Outer drop zones — Max Row / Max Column at the splitview edges.
          Visible while dragging an external tab into split view OR while
          repositioning a panel that's already in the split view. */}
      {(tabDragToSplit?.isOverTerminalArea || panelDrag) &&
        (() => {
          const OUTER_THICKNESS = 56; // px strip along each container edge

          const draggedId =
            tabDragToSplit?.draggedTabId ?? panelDrag?.sourceTabId;
          if (draggedId == null) return null;

          const isActive = (edge: "top" | "right" | "bottom" | "left") =>
            outerDropEdge === edge;

          const baseClass =
            "absolute pointer-events-auto transition-colors duration-100 flex items-center justify-center";
          const inactiveClass =
            "bg-violet-500/15 border border-dashed border-violet-400/60";
          const activeClass = "bg-violet-500/45 border-2 border-violet-300";

          const handleEnter = (edge: "top" | "right" | "bottom" | "left") =>
            setOuterDropEdge(edge);
          const handleLeave = (edge: "top" | "right" | "bottom" | "left") => {
            if (outerDropEdge === edge) setOuterDropEdge(null);
          };
          const handleDrop = (edge: "top" | "right" | "bottom" | "left") => {
            addToSplitRoot(draggedId, edge);
            setOuterDropEdge(null);
            setExternalDropTarget(null);
            if (tabDragToSplit) cancelTabDragToSplit();
            if (panelDrag) setPanelDrag(null);
          };

          return (
            <div className="absolute inset-0 z-[71] pointer-events-none">
              {/* TOP edge — new row at top */}
              <div
                className={`${baseClass} ${
                  isActive("top") ? activeClass : inactiveClass
                }`}
                style={{
                  top: 0,
                  left: 0,
                  right: 0,
                  height: OUTER_THICKNESS,
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  handleEnter("top");
                }}
                onDragLeave={() => handleLeave("top")}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDrop("top");
                }}
              >
                {isActive("top") && (
                  <span className="text-violet-50 text-xs font-semibold bg-violet-700/85 px-2 py-0.5 rounded">
                    ↑ Max Row (top)
                  </span>
                )}
              </div>
              {/* BOTTOM edge — new row at bottom */}
              <div
                className={`${baseClass} ${
                  isActive("bottom") ? activeClass : inactiveClass
                }`}
                style={{
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: OUTER_THICKNESS,
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  handleEnter("bottom");
                }}
                onDragLeave={() => handleLeave("bottom")}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDrop("bottom");
                }}
              >
                {isActive("bottom") && (
                  <span className="text-violet-50 text-xs font-semibold bg-violet-700/85 px-2 py-0.5 rounded">
                    ↓ Max Row (bottom)
                  </span>
                )}
              </div>
              {/* LEFT edge — new column at left */}
              <div
                className={`${baseClass} ${
                  isActive("left") ? activeClass : inactiveClass
                }`}
                style={{
                  top: OUTER_THICKNESS,
                  bottom: OUTER_THICKNESS,
                  left: 0,
                  width: OUTER_THICKNESS,
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  handleEnter("left");
                }}
                onDragLeave={() => handleLeave("left")}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDrop("left");
                }}
              >
                {isActive("left") && (
                  <span className="text-violet-50 text-[10px] font-semibold bg-violet-700/85 px-1.5 py-0.5 rounded -rotate-90 whitespace-nowrap">
                    Max Column
                  </span>
                )}
              </div>
              {/* RIGHT edge — new column at right */}
              <div
                className={`${baseClass} ${
                  isActive("right") ? activeClass : inactiveClass
                }`}
                style={{
                  top: OUTER_THICKNESS,
                  bottom: OUTER_THICKNESS,
                  right: 0,
                  width: OUTER_THICKNESS,
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  handleEnter("right");
                }}
                onDragLeave={() => handleLeave("right")}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDrop("right");
                }}
              >
                {isActive("right") && (
                  <span className="text-violet-50 text-[10px] font-semibold bg-violet-700/85 px-1.5 py-0.5 rounded -rotate-90 whitespace-nowrap">
                    Max Column
                  </span>
                )}
              </div>
            </div>
          );
        })()}

      {panelContextMenu && (
        <div
          className="fixed z-[9999] bg-surface border border-edge rounded-md shadow-lg py-1 min-w-[160px]"
          style={{
            left: panelContextMenu.x,
            top: panelContextMenu.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-foreground hover:bg-hover cursor-pointer"
            onClick={() => {
              const tab = tabs.find(
                (t: TabData) => t.id === panelContextMenu.tabId,
              );
              if (tab) {
                setPanelEditValue(tab.title);
                setPanelEditingTabId(panelContextMenu.tabId);
              }
              setPanelContextMenu(null);
            }}
          >
            <Pencil className="w-3.5 h-3.5" />
            Rename
          </button>
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-foreground hover:bg-hover cursor-pointer"
            onClick={() => {
              duplicateTerminalForTab(panelContextMenu.tabId);
              setPanelContextMenu(null);
            }}
          >
            <Copy className="w-3.5 h-3.5" />
            Duplicate
          </button>
          <div className="border-t border-edge my-1" />
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-foreground hover:bg-hover cursor-pointer"
            onClick={() => {
              maxColumnForTab(panelContextMenu.tabId);
              setPanelContextMenu(null);
            }}
          >
            <Columns2 className="w-3.5 h-3.5" />
            Max Column
          </button>
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-foreground hover:bg-hover cursor-pointer"
            onClick={() => {
              maxRowForTab(panelContextMenu.tabId);
              setPanelContextMenu(null);
            }}
          >
            <Rows2 className="w-3.5 h-3.5" />
            Max Row
          </button>
          <div className="border-t border-edge my-1" />
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-foreground hover:bg-hover cursor-pointer"
            onClick={() => {
              // Remove this terminal from the split layout but keep it
              // as a regular top-level tab; focus it so it becomes the
              // single-pane view.
              const detachedId = panelContextMenu.tabId;
              removeFromSplitLayout(detachedId);
              setCurrentTab(detachedId);
              setPanelContextMenu(null);
            }}
          >
            <SeparatorVertical className="w-3.5 h-3.5" />
            Detach
          </button>
          <div className="border-t border-edge my-1" />
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-red-400 hover:bg-hover cursor-pointer"
            onClick={() => {
              removeTab(panelContextMenu.tabId);
              setPanelContextMenu(null);
            }}
          >
            <X className="w-3.5 h-3.5" />
            Close Terminal
          </button>
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-red-400 hover:bg-hover cursor-pointer"
            onClick={() => {
              if (splitLayout) {
                const rowIds = getRowLeafIds(
                  splitLayout,
                  panelContextMenu.tabId,
                );
                rowIds.forEach((id) => removeTab(id));
              } else {
                removeTab(panelContextMenu.tabId);
              }
              setPanelContextMenu(null);
            }}
          >
            <Rows2 className="w-3.5 h-3.5" />
            Close Row
          </button>
        </div>
      )}
    </div>
  );
}
