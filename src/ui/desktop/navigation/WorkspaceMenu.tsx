import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layers, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import {
  deletePersistedSession,
  getSessionId,
  listPersistedSessions,
  switchToSession,
  type PersistedSession,
} from "@/ui/desktop/navigation/tabs/windowId.ts";

// Peek at a session's persisted tabs snapshot to show a meaningful
// summary (count + first few titles) in the menu, without loading
// the full TabContext for that session.
interface TabSnapshot {
  type: string;
  title?: string;
}

function readSessionSummary(id: string): {
  tabCount: number;
  titles: string[];
} {
  try {
    const raw = localStorage.getItem(`t800_tabs:${id}`);
    if (!raw) return { tabCount: 0, titles: [] };
    const parsed = JSON.parse(raw) as TabSnapshot[];
    if (!Array.isArray(parsed)) return { tabCount: 0, titles: [] };
    const nonHome = parsed.filter((t) => t && t.type !== "home");
    return {
      tabCount: nonHome.length,
      titles: nonHome
        .slice(0, 3)
        .map((t) => t.title?.trim() || t.type)
        .filter(Boolean),
    };
  } catch {
    return { tabCount: 0, titles: [] };
  }
}

function formatRelative(ts: number): string {
  if (!ts) return "never";
  const elapsedMs = Date.now() - ts;
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function WorkspaceMenu() {
  const [sessions, setSessions] = useState<PersistedSession[]>([]);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const currentId = useMemo(() => getSessionId(), []);

  const refresh = useCallback(() => {
    setSessions(listPersistedSessions());
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

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

  const otherCount = sessions.filter((s) => s.id !== currentId).length;

  const handleSwitch = (id: string) => {
    if (id === currentId) return;
    switchToSession(id);
  };

  const handleDelete = (id: string) => {
    if (id === currentId) return;
    if (
      !window.confirm(
        "Delete this workspace's saved tabs and layout? This can't be undone.",
      )
    )
      return;
    deletePersistedSession(id);
    refresh();
  };

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
          otherCount > 0
            ? `Switch workspace (${otherCount} other)`
            : "Workspaces"
        }
      >
        <Layers className="h-4 w-4" />
        {otherCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-sky-500 text-[9px] font-bold text-white flex items-center justify-center leading-none">
            {otherCount}
          </span>
        )}
      </Button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-[34px] z-[9999] w-[360px] max-h-[440px] overflow-y-auto bg-surface border border-edge rounded-md shadow-lg"
        >
          <div className="px-3 py-2 border-b border-edge flex items-center justify-between">
            <span className="text-[13px] font-semibold text-foreground">
              Workspaces
            </span>
            <button
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setOpen(false)}
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="px-3 py-2 text-[11px] text-muted-foreground border-b border-edge">
            Each workspace is a separate set of tabs + layout, scoped to
            one browser tab. Reload restores the current one; switch to
            another to resume its tabs in this browser tab.
          </div>

          {sessions.length === 0 && (
            <div className="px-3 py-4 text-[12px] text-muted-foreground">
              No saved workspaces yet.
            </div>
          )}

          {sessions.length > 0 && (
            <div className="py-1">
              {sessions.map((s) => {
                const isCurrent = s.id === currentId;
                const summary = readSessionSummary(s.id);
                const statusLabel = isCurrent
                  ? "Current"
                  : s.isLive
                    ? "Open in another tab"
                    : `Last used ${formatRelative(s.lastSeenAt)}`;
                const statusClass = isCurrent
                  ? "text-emerald-500"
                  : s.isLive
                    ? "text-amber-500"
                    : "text-muted-foreground";
                return (
                  <div
                    key={s.id}
                    className={`px-3 py-2 flex items-start gap-2 hover:bg-hover ${
                      isCurrent ? "bg-hover/50" : ""
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-foreground truncate">
                        {summary.tabCount === 0
                          ? "Empty workspace"
                          : `${summary.tabCount} tab${
                              summary.tabCount === 1 ? "" : "s"
                            }`}
                        <span className="ml-2 text-[10px] text-muted-foreground font-mono">
                          {s.id.slice(0, 8)}
                        </span>
                      </div>
                      {summary.titles.length > 0 && (
                        <div className="text-[11px] text-muted-foreground truncate">
                          {summary.titles.join(" · ")}
                        </div>
                      )}
                      <div className={`text-[11px] ${statusClass}`}>
                        {statusLabel}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      {!isCurrent && !s.isLive && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-[11px]"
                          onClick={() => handleSwitch(s.id)}
                        >
                          Switch
                        </Button>
                      )}
                      {!isCurrent && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 w-6 p-0"
                          title="Delete workspace"
                          onClick={() => handleDelete(s.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
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
