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
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable.tsx";
import * as ResizablePrimitive from "react-resizable-panels";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { RefreshCcw } from "lucide-react";
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
    allSplitScreenTab,
    splitLayout,
    removeTab,
    updateTab,
    tabDragToSplit,
    setDragOverTerminalArea,
    executeDragSplit,
    setSplitScreenTabs,
    swapInSplitLayout,
    addToSplitRoot,
    cancelTabDragToSplit,
  } = useTabs() as {
    tabs: TabData[];
    currentTab: number;
    allSplitScreenTab: number[];
    splitLayout: SplitLayoutNode | null;
    removeTab: (id: number) => void;
    updateTab: (
      tabId: number,
      updates: Partial<Omit<TabData, "id">>,
    ) => void;
    setSplitScreenTabs: (tabIds: number[]) => void;
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

  const [externalDropTarget, setExternalDropTarget] = useState<{
    tabId: number;
    position: DropPosition;
  } | null>(null);

  const [outerDropEdge, setOuterDropEdge] = useState<
    "top" | "right" | "bottom" | "left" | null
  >(null);

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
    if (allSplitScreenTab.length === 0) {
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

  const renderTerminalsLayer = () => {
    const styles: Record<number, React.CSSProperties> = {};
    const layoutTabs = allSplitScreenTab
      .map((tabId) => terminalTabs.find((tab: TabData) => tab.id === tabId))
      .filter((t): t is TabData => t !== null && t !== undefined);

    const mainTab = terminalTabs.find((tab: TabData) => tab.id === currentTab);

    if (allSplitScreenTab.length === 0 && mainTab) {
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
      <div className="absolute inset-0 z-[1]">
        {sortedTerminalTabs.map((t: TabData) => {
          const hasStyle = !!styles[t.id];
          const isVisible =
            hasStyle || (allSplitScreenTab.length === 0 && t.id === currentTab);

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

          const finalStyle: React.CSSProperties = hasStyle
            ? { ...styles[t.id], overflow: "hidden" }
            : effectiveVisible
              ? {
                  ...(previousStyle || standardStyle),
                  opacity: 1,
                  pointerEvents: "auto",
                  zIndex: 20,
                  display: "block",
                  overflow: "hidden",
                }
              : ({
                  ...(previousStyle || standardStyle),
                  opacity: 0,
                  pointerEvents: "none",
                  zIndex: 0,
                  display: "none",
                  overflow: "hidden",
                } as React.CSSProperties);

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
              style={{
                ...finalStyle,
                pointerEvents: panelDrag ? "none" : finalStyle.pointerEvents,
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
      onClick={onClick}
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

  const renderSplitOverlays = () => {
    if (!splitLayout || allSplitScreenTab.length === 0) return null;

    const handleStyle = {
      pointerEvents: "auto",
      zIndex: 12,
      background: "var(--border-base)",
    } as React.CSSProperties;
    const commonGroupProps: {
      onLayout: () => void;
      onResize: () => void;
    } = {
      onLayout: scheduleMeasureAndFit,
      onResize: scheduleMeasureAndFit,
    };

    const firstLeafId = (() => {
      const ids = allSplitScreenTab;
      return ids.length > 0 ? ids[0] : null;
    })();

    const renderNode = (
      node: SplitLayoutNode,
      path: string,
      siblingCount: number,
      orderIndex: number,
      isRoot: boolean,
    ): React.ReactNode => {
      const defaultSize = Math.round(100 / siblingCount);

      if (node.type === "leaf") {
        const tab = terminalTabs.find((t: TabData) => t.id === node.tabId);
        if (!tab) return null;
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
              className="h-full w-full flex flex-col relative"
            >
              <div
                className={`bg-surface text-foreground text-[13px] h-[28px] leading-[28px] px-[10px] border-b border-edge-panel tracking-[1px] m-0 pointer-events-auto z-[31] relative select-none ${
                  allSplitScreenTab.length > 1 ? "cursor-grab active:cursor-grabbing" : ""
                }`}
                draggable={allSplitScreenTab.length > 1}
                onDragStart={(e) => {
                  // Create opaque drag image
                  const dragEl = document.createElement("div");
                  dragEl.textContent = tab.title;
                  dragEl.style.cssText =
                    "position:fixed;top:-1000px;left:-1000px;padding:6px 16px;background:var(--color-surface,#1e1e2e);color:var(--color-foreground,#cdd6f4);border:2px solid #89b4fa;border-radius:6px;font-size:13px;white-space:nowrap;z-index:99999;opacity:0.9;";
                  document.body.appendChild(dragEl);
                  e.dataTransfer.setDragImage(dragEl, dragEl.offsetWidth / 2, dragEl.offsetHeight / 2);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(tab.id));
                  setTimeout(() => document.body.removeChild(dragEl), 0);
                  setPanelDrag({ sourceTabId: tab.id, hoverTabId: null });
                }}
                onDragEnd={() => setPanelDrag(null)}
              >
                {tab.title}
                {tab.id === firstLeafId && (
                  <ResetButton onClick={handleReset} />
                )}
              </div>
            </div>
          </ResizablePanel>
        );
      }

      const groupKey = isRoot ? String(resetKey) : `${path}-${resetKey}`;
      const groupId = isRoot ? `main-${node.direction}` : `group-${path}`;

      const groupContent = (
        <ResizablePrimitive.PanelGroup
          key={groupKey}
          direction={node.direction}
          className="h-full w-full"
          id={groupId}
          {...commonGroupProps}
        >
          {node.children.flatMap((child, i) => {
            const childPath = isRoot ? String(i) : `${path}-${i}`;
            const panel = renderNode(
              child,
              childPath,
              node.children.length,
              i + 1,
              false,
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
        {renderNode(splitLayout, "", 1, 1, true)}
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
      onDragOver={
        tabDragToSplit
          ? (e) => {
              e.preventDefault();
              setDragOverTerminalArea(true);
            }
          : undefined
      }
      onDragLeave={
        tabDragToSplit
          ? (e) => {
              if (
                !containerRef.current?.contains(
                  e.relatedTarget as Node,
                )
              ) {
                setDragOverTerminalArea(false);
                setExternalDropTarget(null);
                setOuterDropEdge(null);
              }
            }
          : undefined
      }
      onDrop={
        tabDragToSplit
          ? (e) => {
              e.preventDefault();
              // If a directional zone handled the drop, externalDropTarget
              // will already be null. Otherwise fall back to the legacy
              // append-to-split behavior.
              executeDragSplit(tabDragToSplit.draggedTabId);
              setExternalDropTarget(null);
              setOuterDropEdge(null);
            }
          : undefined
      }
    >
      {renderTerminalsLayer()}
      {renderSplitOverlays()}

      {panelDrag && allSplitScreenTab.length > 1 && (() => {
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
      {panelDrag && (() => {
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

      {tabDragToSplit?.isOverTerminalArea && (() => {
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

              const top =
                rect === parentRect ? 0 : rect.top - parentRect.top;
              const left =
                rect === parentRect ? 0 : rect.left - parentRect.left;
              const width = rect.width;
              const height = rect.height;

              const zoneBase =
                "absolute pointer-events-auto transition-colors duration-100 flex items-center justify-center";
              const zoneInactive =
                "bg-blue-500/5 border border-dashed border-blue-500/30";
              const zoneActive =
                "bg-blue-500/30 border-2 border-blue-400";

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

              const edgeRatio = 0.25; // top/bottom/left/right zones
              const centerWidth = width * (1 - 2 * edgeRatio);
              const centerHeight = height * (1 - 2 * edgeRatio);
              const edgeH = height * edgeRatio;
              const edgeW = width * edgeRatio;

              return (
                <React.Fragment key={`drop-${tabId}`}>
                  {/* Outline of target panel */}
                  <div
                    className="absolute pointer-events-none border-2 border-dashed border-blue-400/40 rounded"
                    style={{ top, left, width, height, zIndex: 55 }}
                  />
                  {/* TOP */}
                  <div
                    className={`${zoneBase} ${
                      isSamePanel("top") ? zoneActive : zoneInactive
                    } rounded-t`}
                    style={{
                      top,
                      left,
                      width,
                      height: edgeH,
                      zIndex: 56,
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
                    {isSamePanel("top") && (
                      <span className="text-blue-100 text-xs font-medium bg-blue-600/70 px-2 py-0.5 rounded">
                        Split top
                      </span>
                    )}
                  </div>
                  {/* BOTTOM */}
                  <div
                    className={`${zoneBase} ${
                      isSamePanel("bottom") ? zoneActive : zoneInactive
                    } rounded-b`}
                    style={{
                      top: top + height - edgeH,
                      left,
                      width,
                      height: edgeH,
                      zIndex: 56,
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
                    {isSamePanel("bottom") && (
                      <span className="text-blue-100 text-xs font-medium bg-blue-600/70 px-2 py-0.5 rounded">
                        Split bottom
                      </span>
                    )}
                  </div>
                  {/* LEFT */}
                  <div
                    className={`${zoneBase} ${
                      isSamePanel("left") ? zoneActive : zoneInactive
                    }`}
                    style={{
                      top: top + edgeH,
                      left,
                      width: edgeW,
                      height: centerHeight,
                      zIndex: 56,
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
                    {isSamePanel("left") && (
                      <span className="text-blue-100 text-xs font-medium bg-blue-600/70 px-2 py-0.5 rounded">
                        Split left
                      </span>
                    )}
                  </div>
                  {/* RIGHT */}
                  <div
                    className={`${zoneBase} ${
                      isSamePanel("right") ? zoneActive : zoneInactive
                    }`}
                    style={{
                      top: top + edgeH,
                      left: left + width - edgeW,
                      width: edgeW,
                      height: centerHeight,
                      zIndex: 56,
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
                    {isSamePanel("right") && (
                      <span className="text-blue-100 text-xs font-medium bg-blue-600/70 px-2 py-0.5 rounded">
                        Split right
                      </span>
                    )}
                  </div>
                  {/* CENTER (replace/swap) */}
                  <div
                    className={`${zoneBase} ${
                      isSamePanel("center") ? zoneActive : zoneInactive
                    }`}
                    style={{
                      top: top + edgeH,
                      left: left + edgeW,
                      width: centerWidth,
                      height: centerHeight,
                      zIndex: 56,
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = "move";
                      handleEnter("center");
                    }}
                    onDragLeave={() => handleLeave("center")}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDrop("center");
                    }}
                  >
                    {isSamePanel("center") && (
                      <span className="text-blue-100 text-xs font-medium bg-blue-600/70 px-2 py-0.5 rounded">
                        Replace
                      </span>
                    )}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        );
      })()}

      {/* Outer drop zones — create new outermost rows/columns */}
      {tabDragToSplit?.isOverTerminalArea && (() => {
        const OUTER_THICKNESS = 28; // px strip along each container edge

        const isActive = (edge: "top" | "right" | "bottom" | "left") =>
          outerDropEdge === edge;

        const baseClass =
          "absolute pointer-events-auto transition-colors duration-100 flex items-center justify-center";
        const inactiveClass =
          "bg-emerald-500/10 border border-dashed border-emerald-400/50";
        const activeClass =
          "bg-emerald-500/40 border-2 border-emerald-300";

        const handleEnter = (edge: "top" | "right" | "bottom" | "left") =>
          setOuterDropEdge(edge);
        const handleLeave = (edge: "top" | "right" | "bottom" | "left") => {
          if (outerDropEdge === edge) setOuterDropEdge(null);
        };
        const handleDrop = (edge: "top" | "right" | "bottom" | "left") => {
          addToSplitRoot(tabDragToSplit.draggedTabId, edge);
          setOuterDropEdge(null);
          setExternalDropTarget(null);
          cancelTabDragToSplit();
        };

        return (
          <div className="absolute inset-0 z-[58] pointer-events-none">
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
                <span className="text-emerald-50 text-xs font-semibold bg-emerald-700/80 px-2 py-0.5 rounded">
                  + New row (top)
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
                <span className="text-emerald-50 text-xs font-semibold bg-emerald-700/80 px-2 py-0.5 rounded">
                  + New row (bottom)
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
                <span className="text-emerald-50 text-[10px] font-semibold bg-emerald-700/80 px-1.5 py-0.5 rounded -rotate-90 whitespace-nowrap">
                  + New column
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
                <span className="text-emerald-50 text-[10px] font-semibold bg-emerald-700/80 px-1.5 py-0.5 rounded -rotate-90 whitespace-nowrap">
                  + New column
                </span>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
