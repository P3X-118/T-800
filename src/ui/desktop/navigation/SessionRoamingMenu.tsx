import React, { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Radio, X } from "lucide-react";
// Lazy-import toast to avoid circular module initialization
const showToast = (type: "success" | "error" | "message", msg: string) =>
  import("sonner").then((m) => m.toast[type](msg));
import {
  getActiveTerminalSessions,
  getSSHHostById,
  type ActiveTerminalSession,
} from "@/ui/main-axios.ts";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext.tsx";

interface UseTabsShape {
  addTab: (tab: Record<string, unknown>) => number;
  setCurrentTab: (id: number) => void;
}

const POLL_MS = 30_000;

export function SessionRoamingMenu() {
  const { addTab, setCurrentTab } = useTabs() as unknown as UseTabsShape;
  const [sessions, setSessions] = useState<ActiveTerminalSession[]>([]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await getActiveTerminalSessions();
      setSessions(list);
    } catch {
      // silently ignore — endpoint may not be available on older builds
    }
  }, []);

  // Initial fetch + poll
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Close popover when clicking outside
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Detached sessions are the ones a user can pick up here.
  const detached = sessions.filter((s) => !s.isAttached && s.isConnected);

  const handleResume = async (session: ActiveTerminalSession) => {
    setBusyId(session.id);
    try {
      const host = await getSSHHostById(session.hostId);
      // Generate a fresh tab instance ID. The server-side session manager
      // is permissive when reattaching from a different tabInstanceId as
      // long as the previous WebSocket has detached.
      const instanceId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const localKey = `t800_session_${host.id}_${instanceId}`;
      try {
        localStorage.setItem(localKey, session.id);
      } catch {
        /* ignore */
      }
      const newTabId = addTab({
        type: "terminal",
        title: session.hostName || host.name || `host ${host.id}`,
        instanceId,
        hostConfig: { ...host, instanceId },
      });
      setCurrentTab(newTabId);
      setOpen(false);
      showToast(
        "success",
        `Resuming session on ${session.hostName || `host ${host.id}`}`,
      );
      // Schedule a refresh shortly so the list updates once attached.
      setTimeout(refresh, 1500);
    } catch (err) {
      showToast(
        "error",
        err instanceof Error
          ? `Failed to resume session: ${err.message}`
          : "Failed to resume session",
      );
    } finally {
      setBusyId(null);
    }
  };

  const detachedCount = detached.length;

  return (
    <div className="relative">
      <Button
        variant="outline"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) refresh();
        }}
        className="w-[30px] h-[30px] border-edge relative"
        title={
          detachedCount > 0
            ? `Resume sessions (${detachedCount} detached)`
            : "Active terminal sessions"
        }
      >
        <Radio className="h-4 w-4" />
        {detachedCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-emerald-500 text-[9px] font-bold text-white flex items-center justify-center leading-none">
            {detachedCount}
          </span>
        )}
      </Button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-[34px] z-[9999] w-[320px] max-h-[400px] overflow-y-auto bg-surface border border-edge rounded-md shadow-lg"
        >
          <div className="px-3 py-2 border-b border-edge flex items-center justify-between">
            <span className="text-[13px] font-semibold text-foreground">
              Active sessions
            </span>
            <button
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setOpen(false)}
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {sessions.length === 0 && (
            <div className="px-3 py-4 text-[12px] text-muted-foreground">
              No active sessions on this server.
            </div>
          )}

          {sessions.length > 0 && (
            <div className="py-1">
              {sessions.map((s) => {
                const isResumable = !s.isAttached && s.isConnected;
                return (
                  <div
                    key={s.id}
                    className="px-3 py-2 flex items-center gap-2 hover:bg-hover"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-foreground truncate">
                        {s.hostName || `host ${s.hostId}`}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {s.isAttached
                          ? "Attached in another tab"
                          : s.isConnected
                            ? `Detached ${
                                s.lastDetachedAt
                                  ? formatRelative(s.lastDetachedAt)
                                  : ""
                              }`
                            : "Disconnected"}
                      </div>
                    </div>
                    {isResumable && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[11px]"
                        disabled={busyId === s.id}
                        onClick={() => handleResume(s)}
                      >
                        {busyId === s.id ? "…" : "Resume"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatRelative(ts: number): string {
  const elapsedMs = Date.now() - ts;
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
