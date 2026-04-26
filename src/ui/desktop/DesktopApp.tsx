import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  Component,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { LeftSidebar } from "@/ui/desktop/navigation/LeftSidebar.tsx";
import { Dashboard } from "@/ui/desktop/apps/dashboard/Dashboard.tsx";
import { AppView } from "@/ui/desktop/navigation/AppView.tsx";
import { HostManager } from "@/ui/desktop/apps/host-manager/hosts/HostManager.tsx";
import {
  TabProvider,
  useTabs,
} from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import { getLeafIds } from "@/ui/desktop/navigation/tabs/splitLayout.js";
import { TopNavbar } from "@/ui/desktop/navigation/TopNavbar.tsx";
import { CommandHistoryProvider } from "@/ui/desktop/apps/features/terminal/command-history/CommandHistoryContext.tsx";
import { ServerStatusProvider } from "@/ui/contexts/ServerStatusContext";
import { AdminSettings } from "@/ui/desktop/apps/admin/AdminSettings.tsx";
import { UserProfile } from "@/ui/desktop/user/UserProfile.tsx";
import { NetworkGraphCard } from "@/ui/desktop/apps/dashboard/cards/NetworkGraphCard";
import { Toaster } from "@/components/ui/sonner.tsx";
import { toast } from "sonner";
import { CommandPalette } from "@/ui/desktop/apps/command-palette/CommandPalette.tsx";
import { getUserInfo, logoutUser, isElectron } from "@/ui/main-axios.ts";
import { useTheme } from "@/components/theme-provider";
import { dbHealthMonitor } from "@/lib/db-health-monitor.ts";
import { installCtrlLockListener } from "@/hooks/use-ctrl-lock.ts";
import { useTranslation } from "react-i18next";

function AppContent({
  onAuthStateChange,
}: {
  onAuthStateChange?: (isAuthenticated: boolean) => void;
}) {
  const { t } = useTranslation();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [isTopbarOpenPersisted, setIsTopbarOpenPersisted] = useState<boolean>(
    () => {
      const saved = localStorage.getItem("topNavbarOpen");
      return saved !== null ? JSON.parse(saved) : true;
    },
  );
  const [isTopbarHoverOpen, setIsTopbarHoverOpen] = useState<boolean>(false);
  // Effective state — true if persisted-open OR temporarily hover-open. The
  // hover state is never persisted, so a reload returns to the user's last
  // committed toggle state.
  const isTopbarOpen = isTopbarOpenPersisted || isTopbarHoverOpen;
  // Wrapper that the topbar's toggle button uses to lock state. Clicking
  // close while currently hover-open should immediately close the topbar
  // (otherwise the lingering hover state would keep it visible).
  const setIsTopbarOpen = React.useCallback((open: boolean) => {
    setIsTopbarOpenPersisted(open);
    if (!open) setIsTopbarHoverOpen(false);
  }, []);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionPhase, setTransitionPhase] = useState<
    "idle" | "fadeOut" | "fadeIn"
  >("idle");
  const [terminalsCondensed, setTerminalsCondensed] = useState(true);
  const {
    currentTab,
    tabs,
    updateTab,
    addTab,
    setCurrentTab,
    splitLayout,
    removeTab,
    addTabAfter,
    setSplitScreenTabs,
  } = useTabs();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(400);
  const [dbConnectionFailed, setDbConnectionFailed] = useState(false);

  const isDarkMode =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const lineColor = isDarkMode ? "#151517" : "#f9f9f9";

  const lastShiftPressTime = useRef(0);

  const lastAltPressTime = useRef(0);

  // Ctrl+J/K lands on a tab; when Ctrl is released after that landing,
  // move focus to the active terminal so the user can start typing
  // without a click. Set by the Ctrl+J/K handler, cleared on keyup.
  const pendingVimNavFocusRef = useRef(false);

  useEffect(() => {
    const handleDatabaseConnectionLost = () => {
      setDbConnectionFailed(true);
    };

    const handleDatabaseConnectionRestored = () => {
      setDbConnectionFailed(false);
      toast.success(t("common.backendReconnected"));
    };

    const handleSessionExpired = () => {
      setIsAuthenticated(false);
    };

    dbHealthMonitor.on(
      "database-connection-lost",
      handleDatabaseConnectionLost,
    );
    dbHealthMonitor.on(
      "database-connection-restored",
      handleDatabaseConnectionRestored,
    );
    dbHealthMonitor.on("session-expired", handleSessionExpired);

    return () => {
      dbHealthMonitor.off(
        "database-connection-lost",
        handleDatabaseConnectionLost,
      );
      dbHealthMonitor.off(
        "database-connection-restored",
        handleDatabaseConnectionRestored,
      );
      dbHealthMonitor.off("session-expired", handleSessionExpired);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "ShiftLeft") {
        if (event.repeat) {
          return;
        }
        const shortcutEnabled =
          localStorage.getItem("commandPaletteShortcutEnabled") !== "false";
        if (!shortcutEnabled) {
          return;
        }
        const now = Date.now();
        if (now - lastShiftPressTime.current < 300) {
          setIsCommandPaletteOpen((isOpen) => !isOpen);
          lastShiftPressTime.current = 0;
        } else {
          lastShiftPressTime.current = now;
        }
      }

      if (event.code === "AltLeft" && !event.repeat) {
        const now = Date.now();
        if (now - lastAltPressTime.current < 300) {
          const currentIsDark =
            theme === "dark" ||
            (theme === "system" &&
              window.matchMedia("(prefers-color-scheme: dark)").matches);
          const newTheme = currentIsDark ? "light" : "dark";
          setTheme(newTheme);
          lastAltPressTime.current = 0;
        } else {
          lastAltPressTime.current = now;
        }
      }

      if (event.key === "Escape") {
        setIsCommandPaletteOpen(false);
      }

      // Ctrl+D — duplicate the active terminal tab into a split view.
      if (
        event.key === "d" &&
        event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.repeat
      ) {
        if (currentTab != null) {
          const active = tabs.find((t) => t.id === currentTab);
          if (active && active.type === "terminal") {
            event.preventDefault();
            event.stopPropagation();
            const newTabId = addTabAfter(active.id, {
              type: "terminal",
              title: active.title,
              hostConfig: active.hostConfig,
            });
            if (newTabId > 0) {
              const leaves = getLeafIds(splitLayout);
              const base = leaves.includes(active.id) ? leaves : [active.id];
              const merged = [...base, newTabId].slice(0, 12);
              if (merged.length >= 2) setSplitScreenTabs(merged);
            }
          }
        }
        return;
      }

      // Ctrl+; — close the current tab (or focused pane in a split view).
      if (
        event.key === ";" &&
        event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.repeat
      ) {
        if (currentTab != null) {
          event.preventDefault();
          event.stopPropagation();
          removeTab(currentTab);
        }
        return;
      }

      // Ctrl+J / Ctrl+K — cycle top-level tabs in visual order.
      // Split-view directional nav uses a different modifier
      // (Alt+H/J/K/L, in AppView). When the split group is condensed
      // into a single pill, the ring treats the whole group as one
      // entry so the user doesn't have to press through every member.
      if (
        (event.key === "j" || event.key === "k") &&
        event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.repeat
      ) {
        const direction = event.key === "j" ? -1 : 1;
        const splitIds = getLeafIds(splitLayout);
        const shouldCondense = terminalsCondensed && splitIds.length >= 2;

        type RingEntry =
          | { kind: "tab"; id: number }
          | { kind: "split"; firstId: number; ids: Set<number> };
        const ring: RingEntry[] = [];

        if (shouldCondense) {
          const splitSet = new Set(splitIds);
          const splitGroupTabs = tabs.filter((t) => splitSet.has(t.id));
          const normalTabs = tabs.filter((t) => !splitSet.has(t.id));
          // Mirror TopNavbar's pill-injection rule: the condensed pill
          // renders after ssh_manager if present, else after home.
          const pillAnchorType = normalTabs.some(
            (t) => t.type === "ssh_manager",
          )
            ? "ssh_manager"
            : "home";
          const splitEntry: RingEntry = {
            kind: "split",
            firstId: splitGroupTabs[0]?.id ?? splitIds[0],
            ids: splitSet,
          };
          let injected = false;
          for (const t of normalTabs) {
            ring.push({ kind: "tab", id: t.id });
            if (!injected && t.type === pillAnchorType) {
              ring.push(splitEntry);
              injected = true;
            }
          }
          if (!injected) ring.push(splitEntry);
        } else {
          for (const t of tabs) ring.push({ kind: "tab", id: t.id });
        }

        if (ring.length < 2) return;
        const idx =
          currentTab != null
            ? ring.findIndex((e) =>
                e.kind === "tab" ? e.id === currentTab : e.ids.has(currentTab),
              )
            : -1;
        if (idx === -1) return;
        const nextIdx = (idx + direction + ring.length) % ring.length;
        const next = ring[nextIdx];
        const targetId = next.kind === "tab" ? next.id : next.firstId;
        event.preventDefault();
        event.stopPropagation();
        setCurrentTab(targetId);
        pendingVimNavFocusRef.current = true;
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Control") return;
      if (!pendingVimNavFocusRef.current) return;
      pendingVimNavFocusRef.current = false;
      // Terminal components listen for this and focus xterm if they
      // are the visible, non-split-screen pane.
      window.dispatchEvent(new CustomEvent("t800:focus-active-terminal"));
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, {
        capture: true,
      } as EventListenerOptions);
      window.removeEventListener("keyup", handleKeyUp, {
        capture: true,
      } as EventListenerOptions);
    };
  }, [
    theme,
    setTheme,
    tabs,
    currentTab,
    splitLayout,
    setCurrentTab,
    removeTab,
    addTabAfter,
    setSplitScreenTabs,
    terminalsCondensed,
  ]);

  useEffect(() => {
    const path = window.location.pathname;
    const terminalMatch = path.match(/^\/terminal\/([a-zA-Z0-9_-]+)$/);
    const legacyMatch = path.match(/^\/hosts\/([a-zA-Z0-9_-]+)\/terminal$/);
    const hostIdentifier = terminalMatch?.[1] || legacyMatch?.[1];

    if (hostIdentifier) {
      const openTerminal = async () => {
        try {
          const { getSSHHostById, getSSHHosts } =
            await import("@/ui/main-axios.ts");
          let host = null;

          if (/^\d+$/.test(hostIdentifier)) {
            host = await getSSHHostById(parseInt(hostIdentifier, 10));
          } else {
            const hosts = await getSSHHosts();
            host =
              hosts.find((h: { name?: string }) => h.name === hostIdentifier) ||
              null;
          }

          if (host) {
            addTab({
              type: "terminal",
              title: host.name || host.ip,
              data: { host, initialCommand: "" },
            });
            window.history.replaceState({}, "", "/");
          } else {
            toast.error(`Host "${hostIdentifier}" not found`);
          }
        } catch (error) {
          console.error("Failed to open terminal:", error);
          toast.error("Failed to open terminal for host");
        }
      };
      openTerminal();
    }
  }, [addTab]);

  useEffect(() => {
    const checkAuth = () => {
      setAuthLoading(true);
      getUserInfo()
        .then((meRes) => {
          if (typeof meRes === "string" || !meRes.username) {
            setIsAuthenticated(false);
            setIsAdmin(false);
            setUsername(null);
            localStorage.removeItem("jwt");
          } else {
            setIsAuthenticated(true);
            setIsAdmin(!!meRes.is_admin);
            setUsername(meRes.username || null);
          }
        })
        .catch((err) => {
          setIsAuthenticated(false);
          setIsAdmin(false);
          setUsername(null);

          localStorage.removeItem("jwt");

          const errorCode = err?.response?.data?.code;
          if (errorCode === "SESSION_EXPIRED") {
            console.warn("Session expired - please log in again");
          }
        })
        .finally(() => {
          setAuthLoading(false);
        });
    };

    checkAuth();

    // Only re-check auth when the JWT itself changes in another tab.
    // The multi-session heartbeat writes to t800_session_hb:* every few
    // seconds; without this filter it would retrigger checkAuth and a
    // cascade of refetches in every sibling tab on each beat.
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === null || e.key === "jwt") checkAuth();
    };
    window.addEventListener("storage", handleStorageChange);

    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  useEffect(() => {
    localStorage.setItem(
      "topNavbarOpen",
      JSON.stringify(isTopbarOpenPersisted),
    );
  }, [isTopbarOpenPersisted]);

  useEffect(() => {
    onAuthStateChange?.(isAuthenticated);
  }, [isAuthenticated, onAuthStateChange]);

  // Global double-tap-Ctrl listener: toggles both sidebars into a
  // locked-open state where hover handlers are ignored.
  useEffect(() => installCtrlLockListener(), []);

  const handleAuthSuccess = useCallback(
    (authData: {
      isAdmin: boolean;
      username: string | null;
      userId: string | null;
    }) => {
      setIsTransitioning(true);
      setTransitionPhase("fadeOut");

      setTimeout(() => {
        setIsAuthenticated(true);
        setIsAdmin(authData.isAdmin);
        setUsername(authData.username);
        setTransitionPhase("fadeIn");

        setTimeout(() => {
          setIsTransitioning(false);
          setTransitionPhase("idle");
        }, 800);
      }, 1200);
    },
    [],
  );

  const handleLogout = useCallback(async () => {
    setIsTransitioning(true);
    setTransitionPhase("fadeOut");

    setTimeout(async () => {
      try {
        await logoutUser();
      } catch (error) {
        console.error("Logout failed:", error);
      }

      window.location.reload();
    }, 1200);
  }, []);

  const currentTabData = tabs.find((tab) => tab.id === currentTab);
  const showTerminalView =
    currentTabData?.type === "terminal" ||
    currentTabData?.type === "server_stats" ||
    currentTabData?.type === "file_manager" ||
    currentTabData?.type === "rdp" ||
    currentTabData?.type === "vnc" ||
    currentTabData?.type === "telnet" ||
    currentTabData?.type === "tunnel" ||
    currentTabData?.type === "docker" ||
    currentTabData?.type === "network_graph";
  const showHome = currentTabData?.type === "home";
  const showSshManager = currentTabData?.type === "ssh_manager";
  const showAdmin = currentTabData?.type === "admin";
  const showProfile = currentTabData?.type === "user_profile";

  if (authLoading && !dbConnectionFailed) {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{
          background: "var(--bg-elevated)",
          backgroundImage: `repeating-linear-gradient(
            45deg,
            transparent,
            transparent 35px,
            ${lineColor} 35px,
            ${lineColor} 37px
          )`,
        }}
      >
        <div className="w-[420px] max-w-full p-8 flex flex-col backdrop-blur-sm bg-card/50 rounded-2xl shadow-xl border-2 border-edge overflow-y-auto thin-scrollbar my-2 animate-in fade-in zoom-in-95 duration-300">
          <div className="flex items-center justify-center h-32">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">
                {t("common.checkingAuthentication")}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (dbConnectionFailed) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-background">
        <div className="fixed inset-0 flex items-center justify-center z-[10000] bg-background">
          <Dashboard
            isAuthenticated={false}
            authLoading={false}
            onAuthSuccess={handleAuthSuccess}
            isTopbarOpen={isTopbarOpen}
            onSelectView={() => {}}
            initialDbError="Database connection failed"
          />
        </div>
        <Toaster
          position="bottom-right"
          richColors={false}
          closeButton
          duration={5000}
          offset={20}
        />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-background">
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        setIsOpen={setIsCommandPaletteOpen}
      />
      {!isAuthenticated && (
        <div className="fixed inset-0 flex items-center justify-center z-[10000] bg-background">
          <Dashboard
            isAuthenticated={isAuthenticated}
            authLoading={authLoading}
            onAuthSuccess={handleAuthSuccess}
            isTopbarOpen={isTopbarOpen}
          />
        </div>
      )}

      {isAuthenticated && (
        <LeftSidebar
          disabled={!isAuthenticated || authLoading}
          isAdmin={isAdmin}
          username={username}
          onLogout={handleLogout}
        >
          <div
            className="h-screen w-full visible pointer-events-auto static overflow-hidden"
            style={{ display: showTerminalView ? "block" : "none" }}
          >
            <AppView
              isTopbarOpen={isTopbarOpen}
              rightSidebarOpen={rightSidebarOpen}
              rightSidebarWidth={rightSidebarWidth}
            />
          </div>

          {showHome && (
            <div className="h-screen w-full visible pointer-events-auto static overflow-hidden">
              <Dashboard
                isAuthenticated={isAuthenticated}
                authLoading={authLoading}
                onAuthSuccess={handleAuthSuccess}
                isTopbarOpen={isTopbarOpen}
                rightSidebarOpen={rightSidebarOpen}
                rightSidebarWidth={rightSidebarWidth}
              />
            </div>
          )}

          {showSshManager && (
            <div className="h-screen w-full visible pointer-events-auto static overflow-hidden">
              <HostManager
                isTopbarOpen={isTopbarOpen}
                initialTab={currentTabData?.initialTab}
                hostConfig={currentTabData?.hostConfig}
                _updateTimestamp={currentTabData?._updateTimestamp}
                rightSidebarOpen={rightSidebarOpen}
                rightSidebarWidth={rightSidebarWidth}
                currentTabId={currentTab}
                updateTab={updateTab}
              />
            </div>
          )}

          {showAdmin && (
            <div className="h-screen w-full visible pointer-events-auto static overflow-hidden">
              <AdminSettings
                isTopbarOpen={isTopbarOpen}
                rightSidebarOpen={rightSidebarOpen}
                rightSidebarWidth={rightSidebarWidth}
              />
            </div>
          )}

          {showProfile && (
            <div className="h-screen w-full visible pointer-events-auto static overflow-auto thin-scrollbar">
              <UserProfile
                isTopbarOpen={isTopbarOpen}
                rightSidebarOpen={rightSidebarOpen}
                rightSidebarWidth={rightSidebarWidth}
              />
            </div>
          )}

          <TopNavbar
            isTopbarOpen={isTopbarOpen}
            isTopbarPersistedOpen={isTopbarOpenPersisted}
            setIsTopbarOpen={setIsTopbarOpen}
            setIsTopbarHoverOpen={setIsTopbarHoverOpen}
            onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
            onRightSidebarStateChange={(isOpen, width) => {
              setRightSidebarOpen(isOpen);
              setRightSidebarWidth(width);
            }}
            terminalsCondensed={terminalsCondensed}
            setTerminalsCondensed={setTerminalsCondensed}
          />
        </LeftSidebar>
      )}

      {isTransitioning && (
        <div
          className={`fixed inset-0 z-[20000] transition-opacity duration-700 ${
            transitionPhase === "fadeOut" ? "opacity-100" : "opacity-0"
          }`}
          style={{
            background: "var(--bg-elevated)",
            backgroundImage: `repeating-linear-gradient(
              45deg,
              transparent,
              transparent 35px,
              ${lineColor} 35px,
              ${lineColor} 37px
            )`,
          }}
        >
          {transitionPhase === "fadeOut" && (
            <>
              <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                <div
                  className="absolute w-0 h-0 bg-primary/10 rounded-full"
                  style={{
                    animation:
                      "ripple 2.5s cubic-bezier(0.4, 0, 0.2, 1) forwards",
                    animationDelay: "0ms",
                    willChange: "width, height, opacity",
                    transform: "translateZ(0)",
                  }}
                />
                <div
                  className="absolute w-0 h-0 bg-primary/7 rounded-full"
                  style={{
                    animation:
                      "ripple 2.5s cubic-bezier(0.4, 0, 0.2, 1) forwards",
                    animationDelay: "200ms",
                    willChange: "width, height, opacity",
                    transform: "translateZ(0)",
                  }}
                />
                <div
                  className="absolute w-0 h-0 bg-primary/5 rounded-full"
                  style={{
                    animation:
                      "ripple 2.5s cubic-bezier(0.4, 0, 0.2, 1) forwards",
                    animationDelay: "400ms",
                    willChange: "width, height, opacity",
                    transform: "translateZ(0)",
                  }}
                />
                <div
                  className="absolute w-0 h-0 bg-primary/3 rounded-full"
                  style={{
                    animation:
                      "ripple 2.5s cubic-bezier(0.4, 0, 0.2, 1) forwards",
                    animationDelay: "600ms",
                    willChange: "width, height, opacity",
                    transform: "translateZ(0)",
                  }}
                />
                <div
                  className="relative z-10 text-center"
                  style={{
                    animation:
                      "logoFade 1.6s cubic-bezier(0.4, 0, 0.2, 1) forwards",
                    willChange: "opacity, transform",
                  }}
                >
                  <div
                    className="text-7xl font-bold tracking-wider"
                    style={{
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                      animation:
                        "logoGlow 1.6s cubic-bezier(0.4, 0, 0.2, 1) forwards",
                      willChange: "color, text-shadow",
                    }}
                  >
                    {import.meta.env.VITE_APP_NAME || "T-800"}
                  </div>
                  <div
                    className="text-sm text-muted-foreground mt-3 tracking-widest"
                    style={{
                      animation:
                        "subtitleFade 1.6s cubic-bezier(0.4, 0, 0.2, 1) forwards",
                      willChange: "opacity, transform",
                    }}
                  >
                    SSH SERVER MANAGER
                  </div>
                </div>
              </div>
              <style>{`
                @keyframes ripple {
                  0% {
                    width: 0;
                    height: 0;
                    opacity: 1;
                  }
                  30% {
                    opacity: 0.6;
                  }
                  70% {
                    opacity: 0.3;
                  }
                  100% {
                    width: 200vmax;
                    height: 200vmax;
                    opacity: 0;
                  }
                }
                @keyframes logoFade {
                  0% {
                    opacity: 0;
                    transform: scale(0.85) translateZ(0);
                  }
                  25% {
                    opacity: 1;
                    transform: scale(1) translateZ(0);
                  }
                  75% {
                    opacity: 1;
                    transform: scale(1) translateZ(0);
                  }
                  100% {
                    opacity: 0;
                    transform: scale(1.05) translateZ(0);
                  }
                }
                @keyframes logoGlow {
                  0% {
                    color: hsl(var(--primary));
                    text-shadow: none;
                  }
                  25% {
                    color: hsl(var(--primary));
                    text-shadow:
                      0 0 20px hsla(var(--primary), 0.3),
                      0 0 40px hsla(var(--primary), 0.2),
                      0 0 60px hsla(var(--primary), 0.1);
                  }
                  75% {
                    color: hsl(var(--primary));
                    text-shadow:
                      0 0 20px hsla(var(--primary), 0.3),
                      0 0 40px hsla(var(--primary), 0.2),
                      0 0 60px hsla(var(--primary), 0.1);
                  }
                  100% {
                    color: hsl(var(--primary));
                    text-shadow: none;
                  }
                }
                @keyframes subtitleFade {
                  0%, 30% {
                    opacity: 0;
                    transform: translateY(10px) translateZ(0);
                  }
                  50% {
                    opacity: 1;
                    transform: translateY(0) translateZ(0);
                  }
                  75% {
                    opacity: 1;
                    transform: translateY(0) translateZ(0);
                  }
                  100% {
                    opacity: 0;
                    transform: translateY(-5px) translateZ(0);
                  }
                }
              `}</style>
            </>
          )}
        </div>
      )}

      <Toaster
        position="bottom-right"
        richColors={false}
        closeButton
        duration={5000}
        offset={20}
      />
    </div>
  );
}

class TabErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; errorCount: number }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, errorCount: 0 };
  }

  static getDerivedStateFromError(error: Error) {
    if (error.message?.includes("useTabs must be used within a TabProvider")) {
      return { hasError: true };
    }
    throw error;
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (error.message?.includes("useTabs must be used within a TabProvider")) {
      console.warn(
        "TabProvider mounting race condition detected, recovering...",
      );
      this.setState((prev) => ({ errorCount: prev.errorCount + 1 }));
      setTimeout(() => {
        this.setState({ hasError: false });
      }, 0);
    }
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

function DesktopApp() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  return (
    <TabProvider>
      <TabErrorBoundary>
        <ServerStatusProvider isAuthenticated={isAuthenticated}>
          <CommandHistoryProvider>
            <AppContent onAuthStateChange={setIsAuthenticated} />
          </CommandHistoryProvider>
        </ServerStatusProvider>
      </TabErrorBoundary>
    </TabProvider>
  );
}

export default DesktopApp;
