import {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from "react";
import { useXTerm } from "react-xtermjs";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { RobustClipboardProvider } from "@/lib/clipboard-provider";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useTranslation } from "react-i18next";
import { getBasePath } from "@/lib/base-path";
import {
  getCookie,
  isElectron,
  logActivity,
  getSnippets,
  deleteCommandFromHistory,
  getCommandHistory,
} from "@/ui/main-axios.ts";
import { TOTPDialog } from "@/ui/desktop/navigation/dialogs/TOTPDialog.tsx";
import { SSHAuthDialog } from "@/ui/desktop/navigation/dialogs/SSHAuthDialog.tsx";
import { WarpgateDialog } from "@/ui/desktop/navigation/dialogs/WarpgateDialog.tsx";
import { OPKSSHDialog } from "@/ui/desktop/navigation/dialogs/OPKSSHDialog.tsx";
import { HostKeyVerificationDialog } from "@/ui/desktop/navigation/dialogs/HostKeyVerificationDialog.tsx";
import {
  TERMINAL_THEMES,
  DEFAULT_TERMINAL_CONFIG,
  TERMINAL_FONTS,
} from "@/constants/terminal-themes.ts";
import type { TerminalConfig } from "@/types";
import { useTheme } from "@/components/theme-provider.tsx";
import { useCommandTracker } from "@/ui/hooks/useCommandTracker.ts";
import { highlightTerminalOutput } from "@/lib/terminal-syntax-highlighter.ts";
import { useCommandHistory as useCommandHistoryHook } from "@/ui/hooks/useCommandHistory.ts";
import { useCommandHistory } from "@/ui/desktop/apps/features/terminal/command-history/CommandHistoryContext.tsx";
import { CommandAutocomplete } from "./command-history/CommandAutocomplete.tsx";
import { SimpleLoader } from "@/ui/desktop/navigation/animations/SimpleLoader.tsx";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import {
  ConnectionLogProvider,
  useConnectionLog,
} from "@/ui/desktop/navigation/connection-log/ConnectionLogContext.tsx";
import { ConnectionLog } from "@/ui/desktop/navigation/connection-log/ConnectionLog.tsx";
import { useTabsOptional } from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import { toast } from "sonner";

interface HostConfig {
  id?: number;
  instanceId?: string;
  ip: string;
  port: number;
  username: string;
  password?: string;
  key?: string;
  keyPassword?: string;
  keyType?: string;
  authType?: string;
  credentialId?: number;
  terminalConfig?: TerminalConfig;
  [key: string]: unknown;
}

interface TerminalHandle {
  disconnect: () => void;
  fit: () => void;
  focus: () => void;
  sendInput: (data: string) => void;
  notifyResize: () => void;
  refresh: () => void;
  reconnect: () => void;
}

interface SSHTerminalProps {
  hostConfig: HostConfig;
  isVisible: boolean;
  title?: string;
  showTitle?: boolean;
  splitScreen?: boolean;
  onClose?: () => void;
  onTitleChange?: (title: string) => void;
  initialPath?: string;
  executeCommand?: string;
}

const TerminalInner = forwardRef<TerminalHandle, SSHTerminalProps>(
  function SSHTerminal(
    {
      hostConfig,
      isVisible,
      splitScreen = false,
      onClose,
      onTitleChange,
      initialPath,
      executeCommand,
    },
    ref,
  ) {
    if (
      typeof window !== "undefined" &&
      !(window as { testJWT?: () => string | null }).testJWT
    ) {
      (window as { testJWT?: () => string | null }).testJWT = () => {
        const jwt = getCookie("jwt");
        return jwt;
      };
    }

    const { t } = useTranslation();
    const { instance: terminal, ref: xtermRef } = useXTerm();
    const commandHistoryContext = useCommandHistory();
    const { confirmWithToast } = useConfirmation();
    const { theme: appTheme } = useTheme();
    const { addLog, isExpanded: isConnectionLogExpanded } = useConnectionLog();
    const tabsCtx = useTabsOptional();
    // The xterm key handler is attached once per terminal mount with a
    // [terminal] dep array, so it captures `tabsCtx` at attach time.
    // Route through a ref so Ctrl+X always sees the current tabs list
    // and requestRenameTab function.
    const tabsCtxRef = useRef(tabsCtx);
    useEffect(() => {
      tabsCtxRef.current = tabsCtx;
    }, [tabsCtx]);
    const setTabIdle = useCallback(
      (idle: boolean) => {
        if (!tabsCtx) return;
        const match = tabsCtx.tabs.find(
          (t) =>
            t.type === "terminal" &&
            t.hostConfig?.id === hostConfig.id &&
            t.instanceId === hostConfig.instanceId,
        );
        if (!match) return;
        // Suppress pulse for the first 5s after the tab loses focus so
        // quick tab switches don't strobe.
        if (idle && match.lastBlurAt && Date.now() - match.lastBlurAt < 5000) {
          return;
        }
        if (Boolean(match.isIdle) !== idle) {
          tabsCtx.updateTab(match.id, { isIdle: idle });
        }
      },
      [tabsCtx, hostConfig.id, hostConfig.instanceId],
    );

    const config = { ...DEFAULT_TERMINAL_CONFIG, ...hostConfig.terminalConfig };

    const isDarkMode =
      appTheme === "dark" ||
      (appTheme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);

    let themeColors;
    if (config.theme === "t800") {
      themeColors = isDarkMode
        ? TERMINAL_THEMES.t800Dark.colors
        : TERMINAL_THEMES.t800Light.colors;
    } else {
      themeColors =
        TERMINAL_THEMES[config.theme]?.colors ||
        TERMINAL_THEMES.t800Dark.colors;
    }
    const backgroundColor = themeColors.background;
    const fitAddonRef = useRef<FitAddon | null>(null);
    const webSocketRef = useRef<WebSocket | null>(null);
    const resizeTimeout = useRef<NodeJS.Timeout | null>(null);
    const wasDisconnectedBySSH = useRef(false);
    const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isFitted, setIsFitted] = useState(false);
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const connectionErrorRef = useRef<string | null>(null);

    const updateConnectionError = useCallback((error: string | null) => {
      connectionErrorRef.current = error;
      setConnectionError(error);
    }, []);

    const [, setIsAuthenticated] = useState(false);
    const [totpRequired, setTotpRequired] = useState(false);
    const [totpPrompt, setTotpPrompt] = useState<string>("");
    const [isPasswordPrompt, setIsPasswordPrompt] = useState(false);
    const [showAuthDialog, setShowAuthDialog] = useState(false);
    const [authDialogReason, setAuthDialogReason] = useState<
      "no_keyboard" | "auth_failed" | "timeout"
    >("no_keyboard");
    const [keyboardInteractiveDetected, setKeyboardInteractiveDetected] =
      useState(false);
    const [warpgateAuthRequired, setWarpgateAuthRequired] = useState(false);
    const [warpgateAuthUrl, setWarpgateAuthUrl] = useState<string>("");
    const [warpgateSecurityKey, setWarpgateSecurityKey] = useState<string>("");
    const warpgateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const [opksshDialog, setOpksshDialog] = useState<{
      isOpen: boolean;
      authUrl: string;
      requestId: string;
      stage: "chooser" | "waiting" | "authenticating" | "completed" | "error";
      error?: string;
    } | null>(null);
    const opksshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const opksshFailedRef = useRef(false);
    const currentHostIdRef = useRef<number | null>(null);
    const currentHostConfigRef = useRef<any>(null);

    const [hostKeyVerification, setHostKeyVerification] = useState<{
      isOpen: boolean;
      scenario: "new" | "changed";
      data: any;
    } | null>(null);

    const sessionIdRef = useRef<string | null>(null);
    const isAttachingSessionRef = useRef<boolean>(false);

    const isVisibleRef = useRef<boolean>(false);
    const isFittingRef = useRef(false);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectAttempts = useRef(0);
    const maxReconnectAttempts = 3;
    const isUnmountingRef = useRef(false);
    const shouldNotReconnectRef = useRef(false);
    const isReconnectingRef = useRef(false);
    const isConnectingRef = useRef(false);
    const wasConnectedRef = useRef(false);

    useEffect(() => {
      isUnmountingRef.current = false;
      shouldNotReconnectRef.current = false;
      isReconnectingRef.current = false;
      isConnectingRef.current = false;
      reconnectAttempts.current = 0;
      wasConnectedRef.current = false;
      isAttachingSessionRef.current = false;

      return () => {};
    }, [hostConfig.id]);
    const connectionAttemptIdRef = useRef(0);
    const totpTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const activityLoggedRef = useRef(false);
    const keyHandlerAttachedRef = useRef(false);

    const { trackInput, getCurrentCommand, updateCurrentCommand } =
      useCommandTracker({
        hostId: hostConfig.id,
        enabled: true,
        onCommandExecuted: (command) => {
          if (!autocompleteHistory.current.includes(command)) {
            autocompleteHistory.current = [
              command,
              ...autocompleteHistory.current,
            ];
          }
        },
      });

    const getCurrentCommandRef = useRef(getCurrentCommand);
    const updateCurrentCommandRef = useRef(updateCurrentCommand);

    useEffect(() => {
      getCurrentCommandRef.current = getCurrentCommand;
      updateCurrentCommandRef.current = updateCurrentCommand;
    }, [getCurrentCommand, updateCurrentCommand]);

    const [showAutocomplete, setShowAutocomplete] = useState(false);
    const [autocompleteSuggestions, setAutocompleteSuggestions] = useState<
      string[]
    >([]);
    const [autocompleteSelectedIndex, setAutocompleteSelectedIndex] =
      useState(0);
    const [autocompletePosition, setAutocompletePosition] = useState({
      top: 0,
      left: 0,
    });
    const autocompleteHistory = useRef<string[]>([]);
    const currentAutocompleteCommand = useRef<string>("");

    const showAutocompleteRef = useRef(false);
    const autocompleteSuggestionsRef = useRef<string[]>([]);
    const autocompleteSelectedIndexRef = useRef(0);

    const [showHistoryDialog, setShowHistoryDialog] = useState(false);
    const [commandHistory, setCommandHistory] = useState<string[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    const setIsLoadingRef = useRef(commandHistoryContext.setIsLoading);
    const setCommandHistoryContextRef = useRef(
      commandHistoryContext.setCommandHistory,
    );

    useEffect(() => {
      setIsLoadingRef.current = commandHistoryContext.setIsLoading;
      setCommandHistoryContextRef.current =
        commandHistoryContext.setCommandHistory;
    }, [
      commandHistoryContext.setIsLoading,
      commandHistoryContext.setCommandHistory,
    ]);

    useEffect(() => {
      if (showHistoryDialog && hostConfig.id) {
        setIsLoadingHistory(true);
        setIsLoadingRef.current(true);
        getCommandHistory(hostConfig.id!)
          .then((history) => {
            setCommandHistory(history);
            setCommandHistoryContextRef.current(history);
          })
          .catch((error) => {
            console.error("Failed to load command history:", error);
            setCommandHistory([]);
            setCommandHistoryContextRef.current([]);
          })
          .finally(() => {
            setIsLoadingHistory(false);
            setIsLoadingRef.current(false);
          });
      }
    }, [showHistoryDialog, hostConfig.id]);

    useEffect(() => {
      const autocompleteEnabled =
        localStorage.getItem("commandAutocomplete") === "true";

      if (hostConfig.id && autocompleteEnabled) {
        getCommandHistory(hostConfig.id!)
          .then((history) => {
            autocompleteHistory.current = history;
          })
          .catch((error) => {
            console.error("Failed to load autocomplete history:", error);
            autocompleteHistory.current = [];
          });
      } else {
        autocompleteHistory.current = [];
      }
    }, [hostConfig.id]);

    useEffect(() => {
      showAutocompleteRef.current = showAutocomplete;
    }, [showAutocomplete]);

    useEffect(() => {
      autocompleteSuggestionsRef.current = autocompleteSuggestions;
    }, [autocompleteSuggestions]);

    useEffect(() => {
      autocompleteSelectedIndexRef.current = autocompleteSelectedIndex;
    }, [autocompleteSelectedIndex]);

    const activityLoggingRef = useRef(false);
    const sudoPromptShownRef = useRef(false);

    const lastSentSizeRef = useRef<{ cols: number; rows: number } | null>(null);
    const pendingSizeRef = useRef<{ cols: number; rows: number } | null>(null);
    const notifyTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lastFittedSizeRef = useRef<{ cols: number; rows: number } | null>(
      null,
    );
    const DEBOUNCE_MS = 140;

    const logTerminalActivity = async () => {
      if (
        !hostConfig.id ||
        activityLoggedRef.current ||
        activityLoggingRef.current
      ) {
        return;
      }

      activityLoggingRef.current = true;
      activityLoggedRef.current = true;

      try {
        const hostName =
          hostConfig.name || `${hostConfig.username}@${hostConfig.ip}`;
        await logActivity("terminal", hostConfig.id, hostName);
      } catch (err) {
        console.warn("Failed to log terminal activity:", err);
        activityLoggedRef.current = false;
      } finally {
        activityLoggingRef.current = false;
      }
    };

    useEffect(() => {
      isVisibleRef.current = isVisible;
      // Coming back to a previously-hidden tab: reset the reconnect
      // attempt budget so a fresh visible-side reconnection sequence
      // gets the full 3 retries even if there were prior failures
      // while the tab was hidden. shouldNotReconnectRef is left
      // alone — that flag still represents "stop trying" for
      // legitimately fatal cases (auth errors, deleted hosts).
      if (isVisible) {
        reconnectAttempts.current = 0;
      }
    }, [isVisible]);

    // When this terminal tab becomes hidden, stamp lastBlurAt so the
    // idle pulse is suppressed for ~5s after a context switch. When it
    // becomes visible again, clear any stale idle flag.
    useEffect(() => {
      if (!tabsCtx) return;
      const match = tabsCtx.tabs.find(
        (t) =>
          t.type === "terminal" &&
          t.hostConfig?.id === hostConfig.id &&
          t.instanceId === hostConfig.instanceId,
      );
      if (!match) return;
      if (isVisible) {
        if (match.isIdle) tabsCtx.updateTab(match.id, { isIdle: false });
      } else {
        tabsCtx.updateTab(match.id, { lastBlurAt: Date.now() });
      }
    }, [isVisible, tabsCtx, hostConfig.id, hostConfig.instanceId]);

    useEffect(() => {
      const checkAuth = () => {
        const jwtToken = getCookie("jwt");
        const isAuth = !!(jwtToken && jwtToken.trim() !== "");

        setIsAuthenticated((prev) => {
          if (prev !== isAuth) {
            return isAuth;
          }
          return prev;
        });
      };

      checkAuth();

      const authCheckInterval = setInterval(checkAuth, 5000);

      return () => clearInterval(authCheckInterval);
    }, []);

    function hardRefresh() {
      try {
        if (
          terminal &&
          typeof (
            terminal as { refresh?: (start: number, end: number) => void }
          ).refresh === "function"
        ) {
          (
            terminal as { refresh?: (start: number, end: number) => void }
          ).refresh(0, terminal.rows - 1);
        }
      } catch (error) {
        console.error("Terminal operation failed:", error);
      }
    }

    // Measure the actual drawable cell area, not the xterm wrapper —
    // wrapper clientWidth/Height includes padding + scrollbar, which
    // inflates ws_xpixel on TIOCGWINSZ and makes chafa pick wrong-
    // aspect symbols. `.xterm-screen` is the element cells render into.
    function getRenderPixelDims(): {
      pixelWidth: number | undefined;
      pixelHeight: number | undefined;
    } {
      const root = xtermRef.current;
      if (!root) return { pixelWidth: undefined, pixelHeight: undefined };
      const screen = root.querySelector(".xterm-screen") as HTMLElement | null;
      const el = screen ?? root;
      return {
        pixelWidth: el.clientWidth || undefined,
        pixelHeight: el.clientHeight || undefined,
      };
    }

    function performFit() {
      if (
        !fitAddonRef.current ||
        !terminal ||
        !isVisible ||
        isFittingRef.current
      ) {
        return;
      }

      const lastSize = lastFittedSizeRef.current;
      if (
        lastSize &&
        lastSize.cols === terminal.cols &&
        lastSize.rows === terminal.rows
      ) {
        return;
      }

      isFittingRef.current = true;

      try {
        fitAddonRef.current?.fit();
        if (terminal && terminal.cols > 0 && terminal.rows > 0) {
          scheduleNotify(terminal.cols, terminal.rows);
          lastFittedSizeRef.current = {
            cols: terminal.cols,
            rows: terminal.rows,
          };
        }
        setIsFitted(true);
      } finally {
        isFittingRef.current = false;
      }
    }

    function handleTotpSubmit(code: string) {
      if (webSocketRef.current && code) {
        if (totpTimeoutRef.current) {
          clearTimeout(totpTimeoutRef.current);
          totpTimeoutRef.current = null;
        }
        webSocketRef.current.send(
          JSON.stringify({
            type: isPasswordPrompt ? "password_response" : "totp_response",
            data: { code },
          }),
        );
        setTotpRequired(false);
        setTotpPrompt("");
        setIsPasswordPrompt(false);
      }
    }

    function handleTotpCancel() {
      if (totpTimeoutRef.current) {
        clearTimeout(totpTimeoutRef.current);
        totpTimeoutRef.current = null;
      }
      setTotpRequired(false);
      setTotpPrompt("");
      if (onClose) onClose();
    }

    function handleWarpgateContinue() {
      if (webSocketRef.current) {
        if (warpgateTimeoutRef.current) {
          clearTimeout(warpgateTimeoutRef.current);
          warpgateTimeoutRef.current = null;
        }
        webSocketRef.current.send(
          JSON.stringify({
            type: "warpgate_auth_continue",
            data: {},
          }),
        );
        setWarpgateAuthRequired(false);
        setWarpgateAuthUrl("");
        setWarpgateSecurityKey("");
      }
    }

    function handleWarpgateCancel() {
      if (warpgateTimeoutRef.current) {
        clearTimeout(warpgateTimeoutRef.current);
        warpgateTimeoutRef.current = null;
      }
      setWarpgateAuthRequired(false);
      setWarpgateAuthUrl("");
      setWarpgateSecurityKey("");
      if (onClose) onClose();
    }

    function handleWarpgateOpenUrl() {
      if (warpgateAuthUrl) {
        window.open(warpgateAuthUrl, "_blank", "noopener,noreferrer");
      }
    }

    function handleAuthDialogSubmit(credentials: {
      password?: string;
      sshKey?: string;
      keyPassword?: string;
    }) {
      if (webSocketRef.current && terminal) {
        webSocketRef.current.send(
          JSON.stringify({
            type: "reconnect_with_credentials",
            data: {
              cols: terminal.cols,
              rows: terminal.rows,
              password: credentials.password,
              sshKey: credentials.sshKey,
              keyPassword: credentials.keyPassword,
              hostConfig: {
                ...hostConfig,
                password: credentials.password,
                key: credentials.sshKey,
                keyPassword: credentials.keyPassword,
              },
            },
          }),
        );
        setShowAuthDialog(false);
        setIsConnecting(true);
      }
    }

    function handleAuthDialogCancel() {
      setShowAuthDialog(false);
      if (onClose) onClose();
    }

    function scheduleNotify(cols: number, rows: number) {
      if (!(cols > 0 && rows > 0)) return;
      pendingSizeRef.current = { cols, rows };
      if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
      notifyTimerRef.current = setTimeout(() => {
        const next = pendingSizeRef.current;
        const last = lastSentSizeRef.current;
        if (!next) return;
        if (last && last.cols === next.cols && last.rows === next.rows) return;
        if (webSocketRef.current?.readyState === WebSocket.OPEN) {
          const dims = getRenderPixelDims();
          webSocketRef.current.send(
            JSON.stringify({
              type: "resize",
              data: {
                ...next,
                // Include pixel dims so the PTY's winsize carries
                // ws_xpixel/ws_ypixel — lets chafa read accurate
                // pixel sizing via TIOCGWINSZ.
                pixelWidth: dims.pixelWidth,
                pixelHeight: dims.pixelHeight,
              },
            }),
          );
          lastSentSizeRef.current = next;
        }
      }, DEBOUNCE_MS);
    }

    useImperativeHandle(
      ref,
      () => ({
        disconnect: () => {
          isUnmountingRef.current = true;
          shouldNotReconnectRef.current = true;
          isReconnectingRef.current = false;
          if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;
          }
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
          if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
            connectionTimeoutRef.current = null;
          }
          if (totpTimeoutRef.current) {
            clearTimeout(totpTimeoutRef.current);
            totpTimeoutRef.current = null;
          }
          if (warpgateTimeoutRef.current) {
            clearTimeout(warpgateTimeoutRef.current);
            warpgateTimeoutRef.current = null;
          }
          if (webSocketRef.current?.readyState === WebSocket.OPEN) {
            webSocketRef.current.send(JSON.stringify({ type: "disconnect" }));
          }
          const tabId = hostConfig.id ?? "default";
          localStorage.removeItem(`t800_session_${tabId}`);
          sessionIdRef.current = null;
          webSocketRef.current?.close();
          setIsConnected(false);
          setIsConnecting(false);
        },
        fit: () => {
          fitAddonRef.current?.fit();
          if (terminal) scheduleNotify(terminal.cols, terminal.rows);
          hardRefresh();
        },
        focus: () => {
          // xterm's own focus() targets the helper textarea, but it
          // silently no-ops if the terminal isn't fully open yet
          // (single-terminal Ctrl+Tab path: tab swap → fresh mount →
          // focus called before xterm finished opening). Fall back to
          // the helper textarea directly via the DOM, and if even that
          // isn't ready yet, retry on the next paint until it mounts
          // or we give up. Capped at a handful of frames so a closed
          // tab can't loop forever.
          const tryFocus = (attempt: number) => {
            terminal?.focus();
            const ta = xtermRef.current?.querySelector(
              "textarea",
            ) as HTMLTextAreaElement | null;
            if (ta) {
              ta.focus();
              return;
            }
            if (attempt < 10) {
              requestAnimationFrame(() => tryFocus(attempt + 1));
            }
          };
          tryFocus(0);
        },
        sendInput: (data: string) => {
          if (webSocketRef.current?.readyState === 1) {
            webSocketRef.current.send(JSON.stringify({ type: "input", data }));
          }
        },
        notifyResize: () => {
          try {
            const cols = terminal?.cols ?? undefined;
            const rows = terminal?.rows ?? undefined;
            if (typeof cols === "number" && typeof rows === "number") {
              scheduleNotify(cols, rows);
              hardRefresh();
            }
          } catch (error) {
            console.error("Terminal operation failed:", error);
          }
        },
        refresh: () => hardRefresh(),
        // Force a fresh connection without remounting the component.
        // Clears every "give up" guard, kills any pending reconnect
        // timer, closes the current socket if present, then opens a
        // new one. Used by the right-click "Refresh" menu so a tab
        // that landed in "Connection rejected" can recover without a
        // page reload.
        reconnect: () => {
          shouldNotReconnectRef.current = false;
          isReconnectingRef.current = false;
          isConnectingRef.current = false;
          wasDisconnectedBySSH.current = false;
          reconnectAttempts.current = 0;
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
          if (
            webSocketRef.current &&
            webSocketRef.current.readyState !== WebSocket.CLOSED
          ) {
            try {
              webSocketRef.current.close();
            } catch {
              /* ignore */
            }
          }
          webSocketRef.current = null;
          if (terminal) {
            const cols = terminal.cols || 80;
            const rows = terminal.rows || 24;
            connectToHost(cols, rows);
          }
        },
      }),
      [terminal],
    );

    function getUseRightClickCopyPaste() {
      return getCookie("rightClickCopyPaste") === "true";
    }

    function attemptReconnection() {
      if (
        isUnmountingRef.current ||
        shouldNotReconnectRef.current ||
        isReconnectingRef.current ||
        isConnectingRef.current ||
        wasDisconnectedBySSH.current ||
        reconnectTimeoutRef.current !== null
      ) {
        return;
      }

      // Don't burn reconnect attempts on a hidden tab. xterm is
      // display:none in the background, so cols/rows read as 0 and
      // the new PTY would be created with bad geometry; three quick
      // failures then flip shouldNotReconnectRef and the tab is dead
      // forever. Bail without incrementing the attempt counter — the
      // visibility-gated connect effect (search isVisible in this
      // file) will open a fresh connection the moment the tab is
      // shown again.
      if (!isVisibleRef.current) {
        return;
      }

      if (reconnectAttempts.current >= maxReconnectAttempts) {
        updateConnectionError(t("terminal.maxReconnectAttemptsReached"));
        setIsConnecting(false);
        shouldNotReconnectRef.current = true;
        addLog({
          type: "error",
          stage: "connection",
          message: t("terminal.maxReconnectAttemptsReached"),
        });
        return;
      }

      isReconnectingRef.current = true;

      if (terminal && !isAttachingSessionRef.current) {
        terminal.clear();
      }

      reconnectAttempts.current++;

      addLog({
        type: "info",
        stage: "connection",
        message: t("terminal.reconnecting", {
          attempt: reconnectAttempts.current,
          max: maxReconnectAttempts,
        }),
      });

      const delay = Math.min(
        2000 * Math.pow(2, reconnectAttempts.current - 1),
        8000,
      );

      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectTimeoutRef.current = null;

        if (
          isUnmountingRef.current ||
          shouldNotReconnectRef.current ||
          wasDisconnectedBySSH.current
        ) {
          isReconnectingRef.current = false;
          return;
        }

        if (reconnectAttempts.current > maxReconnectAttempts) {
          isReconnectingRef.current = false;
          return;
        }

        const jwtToken = getCookie("jwt");
        if (!jwtToken || jwtToken.trim() === "") {
          console.warn("Reconnection cancelled - no authentication token");
          isReconnectingRef.current = false;
          updateConnectionError(t("terminal.authenticationRequired"));
          setIsConnecting(false);
          shouldNotReconnectRef.current = true;
          addLog({
            type: "error",
            stage: "auth",
            message: t("terminal.authenticationRequired"),
          });
          return;
        }

        if (terminal && hostConfig) {
          if (!isAttachingSessionRef.current) {
            terminal.clear();
          }
          const cols = terminal.cols;
          const rows = terminal.rows;
          connectToHost(cols, rows);
        }

        isReconnectingRef.current = false;
      }, delay);
    }

    function connectToHost(cols: number, rows: number) {
      if (isConnectingRef.current) {
        return;
      }

      isConnectingRef.current = true;
      connectionAttemptIdRef.current++;
      wasConnectedRef.current = false;

      if (!isReconnectingRef.current) {
        reconnectAttempts.current = 0;
        shouldNotReconnectRef.current = false;
      }

      const isDev =
        !isElectron() &&
        process.env.NODE_ENV === "development" &&
        (window.location.port === "3000" ||
          window.location.port === "5173" ||
          window.location.port === "");

      const jwtToken = getCookie("jwt");

      if (!jwtToken || jwtToken.trim() === "") {
        console.error("No JWT token available for WebSocket connection");
        setIsConnected(false);
        setIsConnecting(false);
        updateConnectionError("Authentication required");
        isConnectingRef.current = false;
        return;
      }

      const baseWsUrl = isDev
        ? import.meta.env.VITE_DEV_PROXY === "true"
          ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ssh/websocket/`
          : `${window.location.protocol === "https:" ? "wss" : "ws"}://localhost:30002`
        : isElectron()
          ? (() => {
              const baseUrl =
                (window as { configuredServerUrl?: string })
                  .configuredServerUrl || "http://127.0.0.1:30001";
              const wsProtocol = baseUrl.startsWith("https://")
                ? "wss://"
                : "ws://";
              const wsHost = baseUrl.replace(/^https?:\/\//, "");
              return `${wsProtocol}${wsHost}/ssh/websocket/`;
            })()
          : `${getBasePath()}/ssh/websocket/`;

      if (
        webSocketRef.current &&
        webSocketRef.current.readyState !== WebSocket.CLOSED
      ) {
        webSocketRef.current.close();
      }

      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }

      const wsUrl = `${baseWsUrl}?token=${encodeURIComponent(jwtToken)}`;

      const ws = new WebSocket(wsUrl);
      webSocketRef.current = ws;
      wasDisconnectedBySSH.current = false;
      updateConnectionError(null);
      shouldNotReconnectRef.current = false;
      isReconnectingRef.current = false;
      setIsConnecting(true);

      setupWebSocketListeners(ws, cols, rows);
    }

    function setupWebSocketListeners(
      ws: WebSocket,
      cols: number,
      rows: number,
    ) {
      ws.addEventListener("open", () => {
        connectionTimeoutRef.current = setTimeout(() => {
          if (
            !isConnected &&
            !totpRequired &&
            !isPasswordPrompt &&
            !connectionErrorRef.current
          ) {
            if (terminal) {
              terminal.clear();
            }
            const timeoutMessage = t("terminal.connectionTimeout");
            updateConnectionError(timeoutMessage);
            addLog({
              type: "error",
              stage: "connection",
              message: timeoutMessage,
            });
            if (webSocketRef.current) {
              webSocketRef.current.close();
            }
            if (reconnectAttempts.current > 0) {
              attemptReconnection();
            } else {
              setIsConnecting(false);
              shouldNotReconnectRef.current = true;
            }
          }
        }, 35000);

        currentHostIdRef.current = hostConfig.id;
        currentHostConfigRef.current = hostConfig;

        const persistenceEnabled =
          localStorage.getItem("enableTerminalSessionPersistence") !== "false";
        const tabId = hostConfig.instanceId
          ? `${hostConfig.id}_${hostConfig.instanceId}`
          : `${hostConfig.id}_${Date.now()}`;
        const savedSessionId = persistenceEnabled
          ? localStorage.getItem(`t800_session_${tabId}`)
          : null;
        const { pixelWidth, pixelHeight } = getRenderPixelDims();
        if (savedSessionId && !isReconnectingRef.current) {
          sessionIdRef.current = savedSessionId;
          isAttachingSessionRef.current = true;

          ws.send(
            JSON.stringify({
              type: "attachSession",
              data: {
                sessionId: savedSessionId,
                cols,
                rows,
                pixelWidth,
                pixelHeight,
                tabInstanceId: hostConfig.instanceId,
              },
            }),
          );
        } else {
          isAttachingSessionRef.current = false;
          ws.send(
            JSON.stringify({
              type: "connectToHost",
              data: {
                cols,
                rows,
                pixelWidth,
                pixelHeight,
                hostConfig,
                initialPath,
                executeCommand,
              },
            }),
          );
        }
        // BEL (\x07) from a TUI is a strong "I want attention" signal —
        // some installers/prompts ring it when waiting on input, so
        // promote a bell into an idle pulse even if output is still
        // flowing.
        terminal.onBell(() => {
          setTabIdle(true);
        });
        terminal.onData((data) => {
          // Pass everything through, including CSI size report
          // responses (\x1b[<n>;<h>;<w>t) that xterm emits when a
          // remote program sends `\x1b[14t` / `\x1b[16t` / `\x1b[18t`.
          // Filtering them here breaks neofetch and chafa, which
          // block for ~50ms waiting for the pixel-size reply and
          // fall back to ASCII if it doesn't arrive.
          trackInput(data);
          ws.send(JSON.stringify({ type: "input", data }));
        });

        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 30000);
      });

      ws.addEventListener("message", (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "data") {
            if (typeof msg.data === "string") {
              // Binary data (sixel, images) is base64-encoded by the
              // backend to survive JSON/UTF-8 transport losslessly.
              // Decode it back to a Uint8Array so xterm's ImageAddon
              // can process the raw bytes.
              if (msg.encoding === "base64") {
                const binaryStr = atob(msg.data);
                const bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) {
                  bytes[i] = binaryStr.charCodeAt(i);
                }
                terminal.write(bytes);
              } else {
                const syntaxHighlightingEnabled =
                  localStorage.getItem("terminalSyntaxHighlighting") === "true";

                const outputData = syntaxHighlightingEnabled
                  ? highlightTerminalOutput(msg.data)
                  : msg.data;

                terminal.write(outputData);
              }
              const sudoPasswordPattern =
                /(?:\[sudo\][^\n]*:\s*$|sudo:[^\n]*password[^\n]*required)/i;
              const passwordToFill =
                hostConfig.terminalConfig?.sudoPassword || hostConfig.password;
              if (
                config.sudoPasswordAutoFill &&
                sudoPasswordPattern.test(msg.data) &&
                passwordToFill &&
                !sudoPromptShownRef.current
              ) {
                sudoPromptShownRef.current = true;
                confirmWithToast(
                  t("terminal.sudoPasswordPopupTitle"),
                  async () => {
                    if (
                      webSocketRef.current &&
                      webSocketRef.current.readyState === WebSocket.OPEN
                    ) {
                      webSocketRef.current.send(
                        JSON.stringify({
                          type: "input",
                          data: passwordToFill + "\n",
                        }),
                      );
                    }
                    setTimeout(() => {
                      sudoPromptShownRef.current = false;
                    }, 3000);
                  },
                  t("common.confirm"),
                  t("common.cancel"),
                  { confirmOnEnter: true },
                );
                setTimeout(() => {
                  sudoPromptShownRef.current = false;
                }, 15000);
              }
            } else {
              const syntaxHighlightingEnabled =
                localStorage.getItem("terminalSyntaxHighlighting") === "true";

              const stringData = String(msg.data);
              const outputData = syntaxHighlightingEnabled
                ? highlightTerminalOutput(stringData)
                : stringData;

              terminal.write(outputData);
            }
          } else if (msg.type === "error") {
            const errorMessage = msg.message || t("terminal.unknownError");

            addLog({
              type: "error",
              stage: "connection",
              message: errorMessage,
            });

            if (
              errorMessage.toLowerCase().includes("connection") ||
              errorMessage.toLowerCase().includes("timeout") ||
              errorMessage.toLowerCase().includes("network")
            ) {
              updateConnectionError(errorMessage);
              setIsConnected(false);
              if (terminal) {
                terminal.clear();
              }
              setIsConnecting(false);
              wasDisconnectedBySSH.current = false;
              return;
            }

            if (
              (errorMessage.toLowerCase().includes("auth") &&
                errorMessage.toLowerCase().includes("failed")) ||
              errorMessage.toLowerCase().includes("permission denied") ||
              (errorMessage.toLowerCase().includes("invalid") &&
                (errorMessage.toLowerCase().includes("password") ||
                  errorMessage.toLowerCase().includes("key"))) ||
              errorMessage.toLowerCase().includes("incorrect password")
            ) {
              updateConnectionError(errorMessage);
              setIsConnecting(false);
              shouldNotReconnectRef.current = true;
              if (webSocketRef.current) {
                webSocketRef.current.close();
              }
              return;
            }

            updateConnectionError(errorMessage);
            setIsConnecting(false);
          } else if (msg.type === "connected") {
            opksshFailedRef.current = false;
            wasConnectedRef.current = true;
            setIsConnected(true);
            setIsConnecting(false);
            isConnectingRef.current = false;
            updateConnectionError(null);
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
            if (reconnectAttempts.current > 0) {
              addLog({
                type: "success",
                stage: "connection",
                message: t("terminal.reconnected"),
              });
            } else {
              addLog({
                type: "success",
                stage: "connection",
                message: t("terminal.connected"),
              });
            }
            reconnectAttempts.current = 0;
            isReconnectingRef.current = false;

            logTerminalActivity();

            setTimeout(async () => {
              const terminalConfig = {
                ...DEFAULT_TERMINAL_CONFIG,
                ...hostConfig.terminalConfig,
              };

              if (
                terminalConfig.environmentVariables &&
                terminalConfig.environmentVariables.length > 0
              ) {
                for (const envVar of terminalConfig.environmentVariables) {
                  if (envVar.key && envVar.value && ws.readyState === 1) {
                    ws.send(
                      JSON.stringify({
                        type: "input",
                        data: `export ${envVar.key}="${envVar.value}"\n`,
                      }),
                    );
                  }
                }
              }

              if (terminalConfig.startupSnippetId) {
                try {
                  const snippets = await getSnippets();
                  const snippet = snippets.find(
                    (s: { id: number }) =>
                      s.id === terminalConfig.startupSnippetId,
                  );
                  if (snippet && ws.readyState === 1) {
                    ws.send(
                      JSON.stringify({
                        type: "input",
                        data: snippet.content + "\n",
                      }),
                    );
                  }
                } catch (err) {
                  console.warn("Failed to execute startup snippet:", err);
                }
              }

              if (terminalConfig.autoMosh && ws.readyState === 1) {
                ws.send(
                  JSON.stringify({
                    type: "input",
                    data: terminalConfig.moshCommand + "\n",
                  }),
                );
              }
            }, 100);
          } else if (msg.type === "idle") {
            setTabIdle(true);
          } else if (msg.type === "active") {
            setTabIdle(false);
          } else if (msg.type === "disconnected") {
            setTabIdle(false);
            wasDisconnectedBySSH.current = true;
            setIsConnected(false);
            if (terminal) {
              terminal.clear();
            }
            setIsConnecting(false);
            if (wasConnectedRef.current) {
              wasConnectedRef.current = false;
              if (
                onClose &&
                !connectionErrorRef.current &&
                !opksshFailedRef.current
              ) {
                onClose();
              }
            } else if (!connectionErrorRef.current) {
              updateConnectionError(
                msg.message || t("terminal.connectionRejected"),
              );
            }
          } else if (msg.type === "totp_required") {
            setTotpRequired(true);
            setTotpPrompt(msg.prompt || t("terminal.totpCodeLabel"));
            setIsPasswordPrompt(false);
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
            if (totpTimeoutRef.current) {
              clearTimeout(totpTimeoutRef.current);
            }
            totpTimeoutRef.current = setTimeout(() => {
              setTotpRequired(false);
              if (webSocketRef.current) {
                webSocketRef.current.close();
              }
            }, 180000);
          } else if (msg.type === "totp_retry") {
          } else if (msg.type === "password_required") {
            setTotpRequired(true);
            setTotpPrompt(msg.prompt || t("common.password"));
            setIsPasswordPrompt(true);
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
            if (totpTimeoutRef.current) {
              clearTimeout(totpTimeoutRef.current);
            }
            totpTimeoutRef.current = setTimeout(() => {
              setTotpRequired(false);
              if (webSocketRef.current) {
                webSocketRef.current.close();
              }
            }, 180000);
          } else if (msg.type === "warpgate_auth_required") {
            setWarpgateAuthRequired(true);
            setWarpgateAuthUrl(msg.url || "");
            setWarpgateSecurityKey(msg.securityKey || "N/A");
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
            if (warpgateTimeoutRef.current) {
              clearTimeout(warpgateTimeoutRef.current);
            }
            warpgateTimeoutRef.current = setTimeout(() => {
              setWarpgateAuthRequired(false);
              if (webSocketRef.current) {
                webSocketRef.current.close();
              }
            }, 300000);
          } else if (msg.type === "opkssh_auth_required") {
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
            if (opksshFailedRef.current) {
              setOpksshDialog(null);
              if (opksshTimeoutRef.current) {
                clearTimeout(opksshTimeoutRef.current);
                opksshTimeoutRef.current = null;
              }
              updateConnectionError(t("terminal.opksshAuthFailed"));
              addLog({
                type: "error",
                stage: "auth",
                message: t("terminal.opksshAuthFailed"),
              });
            } else {
              opksshFailedRef.current = true;
              if (webSocketRef.current) {
                webSocketRef.current.send(
                  JSON.stringify({
                    type: "opkssh_start_auth",
                    data: { hostId: msg.hostId },
                  }),
                );
              }
            }
          } else if (msg.type === "opkssh_status") {
            if (connectionErrorRef.current) return;
            if (msg.stage === "chooser") {
              setOpksshDialog({
                isOpen: true,
                authUrl: msg.url || "",
                requestId: msg.requestId || "",
                stage: "chooser",
              });
              if (opksshTimeoutRef.current) {
                clearTimeout(opksshTimeoutRef.current);
              }
              opksshTimeoutRef.current = setTimeout(() => {
                setOpksshDialog(null);
                if (webSocketRef.current) {
                  webSocketRef.current.close();
                }
              }, 300000);
            } else {
              setOpksshDialog((prev) =>
                prev ? { ...prev, stage: msg.stage } : null,
              );
            }
          } else if (msg.type === "opkssh_completed") {
            if (opksshTimeoutRef.current) {
              clearTimeout(opksshTimeoutRef.current);
              opksshTimeoutRef.current = null;
            }
            setOpksshDialog(null);
            if (webSocketRef.current && terminal) {
              webSocketRef.current.send(
                JSON.stringify({
                  type: "opkssh_auth_completed",
                  data: {
                    hostId: currentHostIdRef.current,
                    cols: terminal.cols || 80,
                    rows: terminal.rows || 24,
                    hostConfig: currentHostConfigRef.current,
                  },
                }),
              );
            }
          } else if (msg.type === "opkssh_error") {
            if (connectionErrorRef.current) return;
            opksshFailedRef.current = true;
            if (opksshDialog) {
              setOpksshDialog((prev) =>
                prev ? { ...prev, stage: "error", error: msg.error } : null,
              );
            } else {
              setOpksshDialog({
                isOpen: true,
                authUrl: "",
                requestId: msg.requestId || "",
                stage: "error",
                error: msg.error,
              });
            }
            setIsConnecting(false);
          } else if (msg.type === "opkssh_timeout") {
            if (connectionErrorRef.current) return;
            opksshFailedRef.current = true;
            if (opksshDialog) {
              setOpksshDialog((prev) =>
                prev
                  ? {
                      ...prev,
                      stage: "error",
                      error: t("terminal.opksshTimeout"),
                    }
                  : null,
              );
            } else {
              setOpksshDialog({
                isOpen: true,
                authUrl: "",
                requestId: msg.requestId || "",
                stage: "error",
                error: t("terminal.opksshTimeout"),
              });
            }
            setIsConnecting(false);
          } else if (msg.type === "opkssh_config_error") {
            setOpksshDialog({
              isOpen: true,
              authUrl: "",
              requestId: msg.requestId || "",
              stage: "error",
              error: msg.instructions || msg.error,
            });
          } else if (msg.type === "keyboard_interactive_available") {
            setKeyboardInteractiveDetected(true);
            setIsConnecting(false);
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
          } else if (msg.type === "auth_method_not_available") {
            setAuthDialogReason("no_keyboard");
            setShowAuthDialog(true);
            setIsConnecting(false);
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
          } else if (msg.type === "host_key_verification_required") {
            setHostKeyVerification({
              isOpen: true,
              scenario: "new",
              data: msg.data,
            });
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
          } else if (msg.type === "host_key_changed") {
            setHostKeyVerification({
              isOpen: true,
              scenario: "changed",
              data: msg.data,
            });
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
          } else if (msg.type === "sessionCreated") {
            sessionIdRef.current = msg.sessionId;
            const persistenceEnabled =
              localStorage.getItem("enableTerminalSessionPersistence") !==
              "false";
            if (persistenceEnabled && hostConfig.instanceId) {
              const tabId = `${hostConfig.id}_${hostConfig.instanceId}`;
              localStorage.setItem(`t800_session_${tabId}`, msg.sessionId);
            }
          } else if (msg.type === "sessionAttached") {
            isAttachingSessionRef.current = false;
            opksshFailedRef.current = false;
            wasConnectedRef.current = true;
            setIsConnected(true);
            setIsConnecting(false);
            isConnectingRef.current = false;
            shouldNotReconnectRef.current = false;
            updateConnectionError(null);
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
            if (reconnectTimeoutRef.current) {
              clearTimeout(reconnectTimeoutRef.current);
              reconnectTimeoutRef.current = null;
            }
            reconnectAttempts.current = 0;
            isReconnectingRef.current = false;

            logTerminalActivity();

            addLog({
              type: "success",
              stage: "connection",
              message: t("terminal.reconnected"),
            });
          } else if (msg.type === "sessionExpired") {
            isAttachingSessionRef.current = false;
            shouldNotReconnectRef.current = false;
            if (hostConfig.instanceId) {
              const tabId = `${hostConfig.id}_${hostConfig.instanceId}`;
              localStorage.removeItem(`t800_session_${tabId}`);
            }
            sessionIdRef.current = null;

            if (webSocketRef.current) {
              webSocketRef.current.close();
            }
          } else if (msg.type === "sessionTakenOver") {
            if (sessionIdRef.current && hostConfig.instanceId) {
              const tabId = `${hostConfig.id}_${hostConfig.instanceId}`;
              localStorage.removeItem(`t800_session_${tabId}`);
              sessionIdRef.current = null;
            }

            if (terminal) {
              terminal.clear();
            }
            setIsConnected(false);
            setIsConnecting(true);

            addLog({
              type: "warning",
              stage: "connection",
              message: t("terminal.sessionTakenOver"),
            });

            const cols = terminal?.cols || 80;
            const rows = terminal?.rows || 24;
            connectToHost(cols, rows);
          } else if (msg.type === "connection_log") {
            if (msg.data) {
              addLog({
                type: msg.data.level || "info",
                stage: msg.data.stage || "auth",
                message: msg.data.message,
                details: msg.data.details,
              });
            }
          }
        } catch (error) {
          console.error("WebSocket message handler error:", error);
        }
      });

      const currentAttemptId = connectionAttemptIdRef.current;

      ws.addEventListener("close", (event) => {
        if (currentAttemptId !== connectionAttemptIdRef.current) {
          return;
        }

        setIsConnected(false);
        isConnectingRef.current = false;
        if (terminal) {
          terminal.clear();
        }

        if (totpTimeoutRef.current) {
          clearTimeout(totpTimeoutRef.current);
          totpTimeoutRef.current = null;
        }

        if (event.code === 1006) {
          console.error(
            "[WebSocket] Abnormal closure detected - possible HTTPS/proxy issue",
          );
          addLog({
            type: "error",
            stage: "connection",
            message: t("terminal.websocketAbnormalClose"),
          });
          updateConnectionError(t("terminal.websocketAbnormalClose"));
          setIsConnecting(false);
          shouldNotReconnectRef.current = true;
          return;
        }

        if (event.code === 1008) {
          console.error("WebSocket authentication failed:", event.reason);
          addLog({
            type: "error",
            stage: "auth",
            message: "Authentication failed - please re-login",
          });
          updateConnectionError("Authentication failed - please re-login");
          setIsConnecting(false);
          shouldNotReconnectRef.current = true;

          localStorage.removeItem("jwt");

          setTimeout(() => {
            window.location.reload();
          }, 1000);

          return;
        }

        if (
          !wasConnectedRef.current &&
          !isAttachingSessionRef.current &&
          event.wasClean &&
          (event.code === 1005 || event.code === 1000)
        ) {
          // This branch was historically labelled "Connection rejected
          // by server", but in practice it almost always fires because
          // we *self-closed* the socket after receiving a {type:"error"}
          // frame — the auth-fail handler upstream calls
          // webSocketRef.current.close() with no args (→ code 1000,
          // wasClean: true). If a specific error message is already
          // surfaced, leave it alone instead of replacing it with the
          // misleading generic line.
          if (!connectionErrorRef.current) {
            console.error("[WebSocket] Clean close before connect", {
              code: event.code,
              reason: event.reason,
            });
            addLog({
              type: "error",
              stage: "connection",
              message: t("terminal.connectionRejected"),
            });
            updateConnectionError(t("terminal.connectionRejected"));
          } else {
            console.warn(
              "[WebSocket] Clean close after surfaced error",
              connectionErrorRef.current,
            );
          }
          setIsConnecting(false);
          shouldNotReconnectRef.current = true;
          return;
        }

        const shouldAttemptReconnection =
          !wasDisconnectedBySSH.current &&
          !isUnmountingRef.current &&
          !shouldNotReconnectRef.current &&
          !isConnectingRef.current;

        if (shouldAttemptReconnection) {
          wasDisconnectedBySSH.current = false;
          attemptReconnection();
        } else {
          setIsConnecting(false);
        }
      });

      ws.addEventListener("error", (event) => {
        if (currentAttemptId !== connectionAttemptIdRef.current) {
          return;
        }

        console.error("[WebSocket] Error:", event);

        setIsConnected(false);
        isConnectingRef.current = false;
        updateConnectionError(t("terminal.websocketError"));
        if (terminal) {
          terminal.clear();
        }
        setIsConnecting(false);

        if (totpTimeoutRef.current) {
          clearTimeout(totpTimeoutRef.current);
          totpTimeoutRef.current = null;
        }
      });
    }

    async function writeTextToClipboard(text: string): Promise<boolean> {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch {
        // fall through to legacy method
      }
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        return true;
      } catch {
        toast.error(t("terminal.clipboardWriteFailed"));
        return false;
      }
    }

    async function readTextFromClipboard(): Promise<string> {
      try {
        if (navigator.clipboard && navigator.clipboard.readText) {
          return await navigator.clipboard.readText();
        }
      } catch {
        // fall through
      }
      if (window.location.protocol !== "https:" && !isElectron()) {
        toast.error(t("terminal.clipboardHttpWarning"));
      }
      return "";
    }

    const handleSelectCommand = useCallback(
      (command: string) => {
        if (!terminal || !webSocketRef.current) return;

        for (const char of command) {
          webSocketRef.current.send(
            JSON.stringify({ type: "input", data: char }),
          );
        }

        setTimeout(() => {
          terminal.focus();
        }, 100);
      },
      [terminal],
    );

    useEffect(() => {
      commandHistoryContext.setOnSelectCommand(handleSelectCommand);
    }, [handleSelectCommand]);

    const handleAutocompleteSelect = useCallback(
      (selectedCommand: string) => {
        if (!webSocketRef.current) return;

        const currentCmd = currentAutocompleteCommand.current;
        const completion = selectedCommand.substring(currentCmd.length);

        for (const char of completion) {
          webSocketRef.current.send(
            JSON.stringify({ type: "input", data: char }),
          );
        }

        updateCurrentCommand(selectedCommand);

        setShowAutocomplete(false);
        setAutocompleteSuggestions([]);
        currentAutocompleteCommand.current = "";

        setTimeout(() => {
          terminal?.focus();
        }, 50);
      },
      [terminal, updateCurrentCommand],
    );

    const handleDeleteCommand = useCallback(
      async (command: string) => {
        if (!hostConfig.id) return;

        try {
          await deleteCommandFromHistory(hostConfig.id, command);

          setCommandHistory((prev) => {
            const newHistory = prev.filter((cmd) => cmd !== command);
            setCommandHistoryContextRef.current(newHistory);
            return newHistory;
          });

          autocompleteHistory.current = autocompleteHistory.current.filter(
            (cmd) => cmd !== command,
          );
        } catch (error) {
          console.error("Failed to delete command from history:", error);
        }
      },
      [hostConfig.id],
    );

    useEffect(() => {
      commandHistoryContext.setOnDeleteCommand(handleDeleteCommand);
    }, [handleDeleteCommand]);

    useEffect(() => {
      if (!terminal || !xtermRef.current) return;

      const config = {
        ...DEFAULT_TERMINAL_CONFIG,
        ...hostConfig.terminalConfig,
      };

      let themeColors;
      if (config.theme === "t800") {
        themeColors = isDarkMode
          ? TERMINAL_THEMES.t800Dark.colors
          : TERMINAL_THEMES.t800Light.colors;
      } else {
        themeColors =
          TERMINAL_THEMES[config.theme]?.colors ||
          TERMINAL_THEMES.t800Dark.colors;
      }

      const fontConfig = TERMINAL_FONTS.find(
        (f) => f.value === config.fontFamily,
      );
      const fontFamily = fontConfig?.fallback || TERMINAL_FONTS[0].fallback;

      terminal.options = {
        cursorBlink: config.cursorBlink,
        cursorStyle: config.cursorStyle,
        cursorInactiveStyle: "none",
        scrollback: config.scrollback,
        fontSize: config.fontSize,
        fontFamily,
        allowTransparency: true,
        convertEol: false,
        windowsMode: false,
        macOptionIsMeta: false,
        macOptionClickForcesSelection: false,
        rightClickSelectsWord: config.rightClickSelectsWord,
        fastScrollModifier: config.fastScrollModifier,
        fastScrollSensitivity: config.fastScrollSensitivity,
        allowProposedApi: true,
        minimumContrastRatio: config.minimumContrastRatio,
        letterSpacing: config.letterSpacing,
        lineHeight: config.lineHeight,
        bellStyle: config.bellStyle as "none" | "sound" | "visual" | "both",

        theme: {
          background: themeColors.background,
          foreground: themeColors.foreground,
          cursor: themeColors.cursor,
          cursorAccent: themeColors.cursorAccent,
          selectionBackground: themeColors.selectionBackground,
          selectionForeground: themeColors.selectionForeground,
          black: themeColors.black,
          red: themeColors.red,
          green: themeColors.green,
          yellow: themeColors.yellow,
          blue: themeColors.blue,
          magenta: themeColors.magenta,
          cyan: themeColors.cyan,
          white: themeColors.white,
          brightBlack: themeColors.brightBlack,
          brightRed: themeColors.brightRed,
          brightGreen: themeColors.brightGreen,
          brightYellow: themeColors.brightYellow,
          brightBlue: themeColors.brightBlue,
          brightMagenta: themeColors.brightMagenta,
          brightCyan: themeColors.brightCyan,
          brightWhite: themeColors.brightWhite,
        },
      };

      const fitAddon = new FitAddon();
      const clipboardProvider = new RobustClipboardProvider();
      const clipboardAddon = new ClipboardAddon(undefined, clipboardProvider);
      const unicode11Addon = new Unicode11Addon();
      const webLinksAddon = new WebLinksAddon();
      const imageAddon = new ImageAddon({
        sixelSupport: true,
        sixelScrolling: true,
        sixelPaletteLimit: 4096,
        enableSizeReports: true,
        showPlaceholder: true,
      });

      fitAddonRef.current = fitAddon;
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(clipboardAddon);
      terminal.loadAddon(unicode11Addon);
      terminal.loadAddon(webLinksAddon);
      try {
        terminal.loadAddon(imageAddon);
      } catch {
        // ImageAddon failed to load — sixel won't render but terminal
        // still works.
      }

      terminal.unicode.activeVersion = "11";

      terminal.open(xtermRef.current);

      fitAddonRef.current?.fit();
      if (terminal.cols < 10 || terminal.rows < 3) {
        requestAnimationFrame(() => {
          fitAddonRef.current?.fit();
          setIsFitted(true);
        });
      } else {
        setIsFitted(true);
      }

      const element = xtermRef.current;
      const handleContextMenu = async (e: MouseEvent) => {
        if (!getUseRightClickCopyPaste()) return;
        e.preventDefault();
        e.stopPropagation();
        if (terminal.hasSelection()) {
          const selection = terminal.getSelection();
          if (selection) {
            await writeTextToClipboard(selection);
            terminal.clearSelection();
          }
        } else {
          const text = await readTextFromClipboard();
          if (text) terminal.paste(text);
        }
      };
      element?.addEventListener("contextmenu", handleContextMenu);

      const handleBackspaceMode = (e: KeyboardEvent) => {
        if (e.key !== "Backspace") return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (config.backspaceMode !== "control-h") return;

        e.preventDefault();
        e.stopPropagation();

        if (webSocketRef.current?.readyState === 1) {
          webSocketRef.current.send(
            JSON.stringify({ type: "input", data: "\x08" }),
          );
        }
        return false;
      };

      element?.addEventListener("keydown", handleBackspaceMode, true);

      const resizeObserver = new ResizeObserver(() => {
        if (resizeTimeout.current) clearTimeout(resizeTimeout.current);
        resizeTimeout.current = setTimeout(() => {
          // Fit whenever dimensions change while visible — including
          // the FIRST time the element gains non-zero dimensions (e.g.
          // a terminal that was mounted into a split-view pane whose
          // wrapper was briefly display:none). Without this, the
          // initial fit against a zero-dim element leaves cols at 0
          // forever, which makes chafa/neofetch sixel pixel reports
          // fire with stale dimensions and leak into the bash prompt.
          if (isVisible && xtermRef.current) {
            const el = xtermRef.current;
            if (el.offsetWidth > 0 && el.offsetHeight > 0) {
              performFit();
            }
          }
        }, 50);
      });

      resizeObserver.observe(xtermRef.current);

      return () => {
        isFittingRef.current = false;
        resizeObserver.disconnect();
        clipboardProvider.dispose();
        element?.removeEventListener("contextmenu", handleContextMenu);
        element?.removeEventListener("keydown", handleBackspaceMode, true);
        if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
        if (resizeTimeout.current) clearTimeout(resizeTimeout.current);
      };
    }, [xtermRef, terminal, hostConfig, isDarkMode]);

    const isMountedRef = useRef(false);

    useEffect(() => {
      isMountedRef.current = true;

      const currentHostId = hostConfig.id;
      const currentInstanceId = hostConfig.instanceId;

      return () => {
        if (!isMountedRef.current) {
          return;
        }

        if (
          currentHostIdRef.current !== currentHostId &&
          currentHostIdRef.current !== null
        ) {
          isUnmountingRef.current = true;
          shouldNotReconnectRef.current = true;
          isReconnectingRef.current = false;
          setIsConnecting(false);
          if (reconnectTimeoutRef.current)
            clearTimeout(reconnectTimeoutRef.current);
          if (connectionTimeoutRef.current)
            clearTimeout(connectionTimeoutRef.current);
          if (totpTimeoutRef.current) clearTimeout(totpTimeoutRef.current);
          if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;
          }

          const persistenceEnabled =
            localStorage.getItem("enableTerminalSessionPersistence") !==
            "false";
          if (
            !persistenceEnabled &&
            sessionIdRef.current &&
            currentInstanceId
          ) {
            const tabId = `${currentHostId}_${currentInstanceId}`;
            localStorage.removeItem(`t800_session_${tabId}`);
          }

          if (webSocketRef.current) {
            webSocketRef.current.close();
          }

          isMountedRef.current = false;
        }
      };
    }, [hostConfig.id, hostConfig.instanceId]);

    useEffect(() => {
      if (!terminal) return;

      const handleCustomKey = (e: KeyboardEvent): boolean => {
        if (e.type !== "keydown") {
          return true;
        }

        // Alt+H/J/K/L is reserved for vim-style split-pane navigation
        // (AppView listens for it). Match on e.code so the physical
        // key wins even when Alt produces a dead-key char on macOS
        // Option / Compose layouts. Returning false tells xterm not to
        // consume the key or emit an ESC+letter sequence into the
        // shell, so the nav handler can take it cleanly.
        if (
          e.altKey &&
          !e.ctrlKey &&
          !e.shiftKey &&
          !e.metaKey &&
          (e.code === "KeyH" ||
            e.code === "KeyJ" ||
            e.code === "KeyK" ||
            e.code === "KeyL")
        ) {
          return false;
        }

        if (
          e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey &&
          !e.metaKey &&
          e.key.toLowerCase() === "c" &&
          terminal.hasSelection()
        ) {
          const selection = terminal.getSelection();
          if (selection) {
            e.preventDefault();
            e.stopPropagation();
            writeTextToClipboard(selection);
            terminal.clearSelection();
            return false;
          }
        }

        if (
          ((e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) ||
            (e.metaKey && !e.ctrlKey && !e.altKey) ||
            (e.ctrlKey &&
              !e.shiftKey &&
              !e.altKey &&
              !e.metaKey &&
              e.key === "Insert")) &&
          (e.key.toLowerCase() === "c" || e.key === "Insert")
        ) {
          const selection = terminal.getSelection();
          if (selection) {
            e.preventDefault();
            e.stopPropagation();
            writeTextToClipboard(selection);
            return false;
          }
        }

        // Paste: Ctrl+Shift+V, Cmd+V, or Shift+Insert. Plain Ctrl+V is
        // intentionally NOT bound to paste so vim's visual-block (^V),
        // bash's literal-next, etc. work — those need the raw 0x16 byte
        // delivered to the PTY. The browser would otherwise auto-paste
        // via the hidden textarea's paste event, so we preventDefault
        // and inject ^V ourselves.
        if (
          ((e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) ||
            (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) ||
            (e.shiftKey &&
              !e.ctrlKey &&
              !e.altKey &&
              !e.metaKey &&
              e.key === "Insert")) &&
          (e.key.toLowerCase() === "v" || e.key === "Insert")
        ) {
          e.preventDefault();
          e.stopPropagation();
          readTextFromClipboard().then((text) => {
            if (text) terminal.paste(text);
          });
          return false;
        }

        if (
          e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey &&
          !e.metaKey &&
          e.key.toLowerCase() === "v"
        ) {
          if (e.type !== "keydown") return false;
          e.preventDefault();
          e.stopPropagation();
          if (webSocketRef.current?.readyState === 1) {
            webSocketRef.current.send(
              JSON.stringify({ type: "input", data: "\x16" }),
            );
          }
          return false;
        }

        // Ctrl+X (no other modifiers) inside a focused terminal opens
        // the tab's rename input. This shadows readline/emacs/nano's
        // Ctrl+X — accepted tradeoff per the user's explicit request.
        // Shift+Ctrl+X / Alt+Ctrl+X still pass through to the PTY.
        if (
          e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey &&
          !e.metaKey &&
          e.key.toLowerCase() === "x"
        ) {
          if (e.type !== "keydown") return false;
          e.preventDefault();
          e.stopPropagation();
          const ctx = tabsCtxRef.current;
          if (ctx) {
            const match = ctx.tabs.find(
              (tt) =>
                tt.type === "terminal" &&
                tt.hostConfig?.id === hostConfig.id &&
                tt.instanceId === hostConfig.instanceId,
            );
            if (match) ctx.requestRenameTab(match.id);
          }
          return false;
        }

        if (e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey) {
          const key = e.key.toLowerCase();
          const blockedKeys = ["w", "t", "n", "q"];
          if (blockedKeys.includes(key)) {
            e.preventDefault();
            e.stopPropagation();
            const ctrlCode = key.charCodeAt(0) - 96;
            if (webSocketRef.current?.readyState === 1) {
              webSocketRef.current.send(
                JSON.stringify({
                  type: "input",
                  data: String.fromCharCode(ctrlCode),
                }),
              );
            }
            return false;
          }
        }

        if (showAutocompleteRef.current) {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setShowAutocomplete(false);
            setAutocompleteSuggestions([]);
            currentAutocompleteCommand.current = "";
            return false;
          }

          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();

            const currentIndex = autocompleteSelectedIndexRef.current;
            const suggestionsLength = autocompleteSuggestionsRef.current.length;

            if (e.key === "ArrowDown") {
              const newIndex =
                currentIndex < suggestionsLength - 1 ? currentIndex + 1 : 0;
              setAutocompleteSelectedIndex(newIndex);
            } else if (e.key === "ArrowUp") {
              const newIndex =
                currentIndex > 0 ? currentIndex - 1 : suggestionsLength - 1;
              setAutocompleteSelectedIndex(newIndex);
            }
            return false;
          }

          if (
            e.key === "Enter" &&
            autocompleteSuggestionsRef.current.length > 0
          ) {
            e.preventDefault();
            e.stopPropagation();

            const selectedCommand =
              autocompleteSuggestionsRef.current[
                autocompleteSelectedIndexRef.current
              ];
            const currentCmd = currentAutocompleteCommand.current;
            const completion = selectedCommand.substring(currentCmd.length);

            if (webSocketRef.current?.readyState === 1) {
              for (const char of completion) {
                webSocketRef.current.send(
                  JSON.stringify({ type: "input", data: char }),
                );
              }
            }

            updateCurrentCommandRef.current(selectedCommand);

            setShowAutocomplete(false);
            setAutocompleteSuggestions([]);
            currentAutocompleteCommand.current = "";

            return false;
          }

          if (
            e.key === "Tab" &&
            !e.ctrlKey &&
            !e.altKey &&
            !e.metaKey &&
            !e.shiftKey
          ) {
            e.preventDefault();
            e.stopPropagation();
            const currentIndex = autocompleteSelectedIndexRef.current;
            const suggestionsLength = autocompleteSuggestionsRef.current.length;
            const newIndex =
              currentIndex < suggestionsLength - 1 ? currentIndex + 1 : 0;
            setAutocompleteSelectedIndex(newIndex);
            return false;
          }

          setShowAutocomplete(false);
          setAutocompleteSuggestions([]);
          currentAutocompleteCommand.current = "";
          return true;
        }

        if (
          e.key === "Tab" &&
          e.shiftKey &&
          !e.ctrlKey &&
          !e.altKey &&
          !e.metaKey
        ) {
          e.preventDefault();
          e.stopPropagation();
          if (webSocketRef.current?.readyState === 1) {
            webSocketRef.current.send(
              JSON.stringify({ type: "input", data: "\x1b[Z" }),
            );
          }
          return false;
        }

        if (
          e.key === "Tab" &&
          !e.ctrlKey &&
          !e.altKey &&
          !e.metaKey &&
          !e.shiftKey
        ) {
          e.preventDefault();
          e.stopPropagation();

          const autocompleteEnabled =
            localStorage.getItem("commandAutocomplete") === "true";

          if (!autocompleteEnabled) {
            if (webSocketRef.current?.readyState === 1) {
              webSocketRef.current.send(
                JSON.stringify({ type: "input", data: "\t" }),
              );
            }
            return false;
          }

          const currentCmd = getCurrentCommandRef.current().trim();
          if (currentCmd.length > 0 && webSocketRef.current?.readyState === 1) {
            const matches = autocompleteHistory.current
              .filter(
                (cmd) =>
                  cmd.startsWith(currentCmd) &&
                  cmd !== currentCmd &&
                  cmd.length > currentCmd.length,
              )
              .slice(0, 5);

            if (matches.length === 1) {
              const completedCommand = matches[0];
              const completion = completedCommand.substring(currentCmd.length);

              for (const char of completion) {
                webSocketRef.current.send(
                  JSON.stringify({ type: "input", data: char }),
                );
              }

              updateCurrentCommandRef.current(completedCommand);
            } else if (matches.length > 1) {
              currentAutocompleteCommand.current = currentCmd;
              setAutocompleteSuggestions(matches);
              setAutocompleteSelectedIndex(0);

              const cursorY = terminal.buffer.active.cursorY;
              const cursorX = terminal.buffer.active.cursorX;
              const rect = xtermRef.current?.getBoundingClientRect();

              if (rect) {
                const cellHeight =
                  terminal.rows > 0 ? rect.height / terminal.rows : 20;
                const cellWidth =
                  terminal.cols > 0 ? rect.width / terminal.cols : 10;

                const itemHeight = 32;
                const footerHeight = 32;
                const maxMenuHeight = 240;
                const estimatedMenuHeight = Math.min(
                  matches.length * itemHeight + footerHeight,
                  maxMenuHeight,
                );
                const cursorBottomY = rect.top + (cursorY + 1) * cellHeight;
                const cursorTopY = rect.top + cursorY * cellHeight;
                const spaceBelow = window.innerHeight - cursorBottomY;
                const spaceAbove = cursorTopY;

                const showAbove =
                  spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow;

                setAutocompletePosition({
                  top: showAbove
                    ? Math.max(0, cursorTopY - estimatedMenuHeight)
                    : cursorBottomY,
                  left: Math.max(0, rect.left + cursorX * cellWidth),
                });
              }

              setShowAutocomplete(true);
            }
          }
          return false;
        }

        return true;
      };

      terminal.attachCustomKeyEventHandler(handleCustomKey);
    }, [terminal]);

    useEffect(() => {
      if (!terminal || !hostConfig || !isVisible) return;
      if (isConnected || isConnecting) return;

      if (isReconnectingRef.current || reconnectTimeoutRef.current !== null) {
        return;
      }

      if (shouldNotReconnectRef.current) {
        return;
      }

      if (
        webSocketRef.current &&
        (webSocketRef.current.readyState === WebSocket.OPEN ||
          webSocketRef.current.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      if (terminal.cols < 10 || terminal.rows < 3) {
        requestAnimationFrame(() => {
          // Fit FIRST — duplicate tabs enter this branch with cols=0
          // because xterm was opened while the split-view pane was
          // briefly display:none. Measuring after rAF (when the
          // wrapper is display:block) gives real cols/rows so the
          // connection starts with correct dimensions.
          fitAddonRef.current?.fit();
          if (terminal.cols > 0 && terminal.rows > 0) {
            setIsConnecting(true);
            scheduleNotify(terminal.cols, terminal.rows);
            connectToHost(terminal.cols, terminal.rows);
          }
        });
        return;
      }

      setIsConnecting(true);
      fitAddonRef.current?.fit();
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
        if (terminal.cols > 0 && terminal.rows > 0) {
          scheduleNotify(terminal.cols, terminal.rows);
          connectToHost(terminal.cols, terminal.rows);
        }
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [terminal, hostConfig.id, isVisible, isConnected, isConnecting]);

    useEffect(() => {
      if (!terminal || !fitAddonRef.current || !isVisible) return;

      const fitTimeoutId = setTimeout(() => {
        if (!isFittingRef.current && terminal.cols > 0 && terminal.rows > 0) {
          performFit();
          if (!splitScreen && !isConnecting) {
            requestAnimationFrame(() => terminal.focus());
          }
        }
      }, 0);

      return () => clearTimeout(fitTimeoutId);
    }, [terminal, isVisible, splitScreen, isConnecting]);

    // Auto-focus the terminal when it first connects so the user can
    // start typing immediately without clicking. Fires once per connect
    // transition; works in both single-tab and split-view modes
    // (isVisible gates split-pane focus to the pane actually shown).
    const didAutoFocusRef = useRef(false);
    useEffect(() => {
      if (!terminal || !isConnected || !isVisible) {
        if (!isConnected) didAutoFocusRef.current = false;
        return;
      }
      if (didAutoFocusRef.current) return;
      didAutoFocusRef.current = true;
      requestAnimationFrame(() => terminal.focus());
    }, [terminal, isConnected, isVisible]);

    const hasConnectionError = !!connectionError;

    return (
      <div className="h-full w-full relative" style={{ backgroundColor }}>
        <div
          ref={xtermRef}
          className="h-full w-full"
          style={{
            pointerEvents: isVisible ? "auto" : "none",
            visibility:
              isConnected && isFitted && !connectionError
                ? "visible"
                : "hidden",
          }}
          onClick={() => {
            if (terminal && !splitScreen) {
              terminal.focus();
            }
          }}
        />

        <SimpleLoader
          visible={isConnecting && !isConnectionLogExpanded}
          message={t("terminal.connecting")}
          backgroundColor={backgroundColor}
        />

        <ConnectionLog
          isConnecting={isConnecting}
          isConnected={isConnected}
          hasConnectionError={hasConnectionError}
          position={hasConnectionError ? "top" : "bottom"}
        />

        <TOTPDialog
          isOpen={totpRequired}
          prompt={totpPrompt}
          onSubmit={handleTotpSubmit}
          onCancel={handleTotpCancel}
          backgroundColor={backgroundColor}
        />

        <SSHAuthDialog
          isOpen={showAuthDialog}
          reason={authDialogReason}
          onSubmit={handleAuthDialogSubmit}
          onCancel={handleAuthDialogCancel}
          hostInfo={{
            ip: hostConfig.ip,
            port: hostConfig.port,
            username: hostConfig.username,
            name: hostConfig.name,
          }}
          backgroundColor={backgroundColor}
        />

        <WarpgateDialog
          isOpen={warpgateAuthRequired}
          url={warpgateAuthUrl}
          securityKey={warpgateSecurityKey}
          onContinue={handleWarpgateContinue}
          onCancel={handleWarpgateCancel}
          onOpenUrl={handleWarpgateOpenUrl}
          backgroundColor={backgroundColor}
        />

        {opksshDialog?.isOpen && (
          <OPKSSHDialog
            isOpen={opksshDialog.isOpen}
            authUrl={opksshDialog.authUrl}
            requestId={opksshDialog.requestId}
            stage={opksshDialog.stage}
            error={opksshDialog.error}
            onCancel={() => {
              if (webSocketRef.current) {
                webSocketRef.current.send(
                  JSON.stringify({
                    type: "opkssh_cancel",
                    data: { requestId: opksshDialog.requestId },
                  }),
                );
              }
              setOpksshDialog(null);
              if (opksshTimeoutRef.current) {
                clearTimeout(opksshTimeoutRef.current);
                opksshTimeoutRef.current = null;
              }
            }}
            onOpenUrl={() => {
              window.open(opksshDialog.authUrl, "_blank");
              if (webSocketRef.current) {
                webSocketRef.current.send(
                  JSON.stringify({
                    type: "opkssh_browser_opened",
                    data: { requestId: opksshDialog.requestId },
                  }),
                );
              }
            }}
            backgroundColor={backgroundColor}
          />
        )}

        {hostKeyVerification?.isOpen && (
          <HostKeyVerificationDialog
            isOpen={true}
            scenario={hostKeyVerification.scenario}
            {...hostKeyVerification.data}
            onAccept={() => {
              if (webSocketRef.current) {
                webSocketRef.current.send(
                  JSON.stringify({
                    type: "host_key_verification_response",
                    data: { action: "accept" },
                  }),
                );
              }
              setHostKeyVerification(null);
            }}
            onReject={() => {
              if (webSocketRef.current) {
                webSocketRef.current.send(
                  JSON.stringify({
                    type: "host_key_verification_response",
                    data: { action: "reject" },
                  }),
                );
              }
              setHostKeyVerification(null);
              setIsConnecting(false);
              updateConnectionError(t("terminal.hostKeyRejected"));
            }}
            backgroundColor={backgroundColor}
          />
        )}

        <CommandAutocomplete
          visible={showAutocomplete}
          suggestions={autocompleteSuggestions}
          selectedIndex={autocompleteSelectedIndex}
          position={autocompletePosition}
          onSelect={handleAutocompleteSelect}
        />
      </div>
    );
  },
);

export const Terminal = forwardRef<TerminalHandle, SSHTerminalProps>(
  function Terminal(props, ref) {
    return (
      <ConnectionLogProvider>
        <TerminalInner {...props} ref={ref} />
      </ConnectionLogProvider>
    );
  },
);

const style = document.createElement("style");
style.innerHTML = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Source+Code+Pro:ital,wght@0,400;0,700;1,400;1,700&display=swap');

@font-face {
  font-family: 'Caskaydia Cove Nerd Font Mono';
  src: url('./fonts/CaskaydiaCoveNerdFontMono-Regular.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Caskaydia Cove Nerd Font Mono';
  src: url('./fonts/CaskaydiaCoveNerdFontMono-Bold.ttf') format('truetype');
  font-weight: bold;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Caskaydia Cove Nerd Font Mono';
  src: url('./fonts/CaskaydiaCoveNerdFontMono-Italic.ttf') format('truetype');
  font-weight: normal;
  font-style: italic;
  font-display: swap;
}

@font-face {
  font-family: 'Caskaydia Cove Nerd Font Mono';
  src: url('./fonts/CaskaydiaCoveNerdFontMono-BoldItalic.ttf') format('truetype');
  font-weight: bold;
  font-style: italic;
  font-display: swap;
}

.xterm .xterm-viewport::-webkit-scrollbar {
  width: 8px;
  background: transparent;
}
.xterm .xterm-viewport::-webkit-scrollbar-thumb {
  background: rgba(0,0,0,0.3);
  border-radius: 4px;
}
.xterm .xterm-viewport::-webkit-scrollbar-thumb:hover {
  background: rgba(0,0,0,0.5);
}
.xterm .xterm-viewport {
  scrollbar-width: thin;
  scrollbar-color: rgba(0,0,0,0.3) transparent;
}

.dark .xterm .xterm-viewport::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.3);
}
.dark .xterm .xterm-viewport::-webkit-scrollbar-thumb:hover {
  background: rgba(255,255,255,0.5);
}
.dark .xterm .xterm-viewport {
  scrollbar-color: rgba(255,255,255,0.3) transparent;
}

.xterm {
  font-feature-settings: "liga" 0, "calt" 0;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.xterm .xterm-screen {
  font-family: 'Caskaydia Cove Nerd Font Mono', 'SF Mono', Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace !important;
  font-variant-ligatures: none;
}

.xterm .xterm-screen .xterm-char {
  font-feature-settings: "liga" 0, "calt" 0;
}
`;
document.head.appendChild(style);
