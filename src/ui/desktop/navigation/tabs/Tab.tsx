import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button.tsx";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  Home,
  SeparatorVertical,
  X,
  Terminal as TerminalIcon,
  Server as ServerIcon,
  Folder as FolderIcon,
  User as UserIcon,
  Monitor as MonitorIcon,
  Eye as EyeIcon,
  MessagesSquare as MessageSquareIcon,
  Network,
  ArrowDownUp as TunnelIcon,
  Container as DockerIcon,
  Key,
  Pencil,
  Columns2,
} from "lucide-react";
import type { SSHHost } from "@/types";

interface TabProps {
  tabType: string;
  title?: string;
  isActive?: boolean;
  isSplit?: boolean;
  isMultiSelected?: boolean;
  onActivate?: (ctrlKey?: boolean) => void;
  onMultiSelectContextMenu?: (e: React.MouseEvent) => void;
  onClose?: () => void;
  onSplit?: () => void;
  canSplit?: boolean;
  canClose?: boolean;
  disableActivate?: boolean;
  disableSplit?: boolean;
  disableClose?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  isValidDropTarget?: boolean;
  isHoveredDropTarget?: boolean;
  hostConfig?: SSHHost;
  onRename?: (newTitle: string) => void;
  onAddToSplit?: () => void;
  onSplitAll?: () => void;
}

export function Tab({
  tabType,
  title,
  isActive,
  isSplit = false,
  isMultiSelected = false,
  onActivate,
  onMultiSelectContextMenu,
  onClose,
  onSplit,
  canSplit = false,
  canClose = false,
  disableActivate = false,
  disableSplit = false,
  disableClose = false,
  isDragging = false,
  isDragOver = false,
  isValidDropTarget = false,
  isHoveredDropTarget = false,
  hostConfig,
  onRename,
  onAddToSplit,
  onSplitAll,
}: TabProps): React.ReactElement {
  const { t } = useTranslation();
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isEditing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [contextMenu]);

  const handleCopyPassword = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!hostConfig) return;

    const hasSshPassword =
      hostConfig.authType === "password" && hostConfig.password;
    const hasSudoPassword = hostConfig.sudoPassword;

    if (!hasSshPassword && !hasSudoPassword) {
      return;
    }

    try {
      let passwordToCopy = "";

      if (hasSshPassword) {
        passwordToCopy = hostConfig.password || "";
      } else if (hasSudoPassword) {
        passwordToCopy = hostConfig.sudoPassword;
      }

      await navigator.clipboard.writeText(passwordToCopy);
    } catch {}
  };

  const hasPassword =
    hostConfig &&
    ((hostConfig.authType === "password" && hostConfig.password) ||
      hostConfig.sudoPassword);

  const getPasswordButtonTitle = () => {
    if (!hostConfig) return "";

    const hasSshPassword =
      hostConfig.authType === "password" && hostConfig.password;
    const hasSudoPassword = hostConfig.sudoPassword;

    if (hasSshPassword) {
      return t("nav.copyPassword");
    } else if (hasSudoPassword) {
      return t("nav.copySudoPassword");
    }
    return t("nav.noPasswordAvailable");
  };

  const tabBaseClasses = cn(
    "relative flex items-center gap-1.5 px-3 w-full min-w-0",
    "rounded-t-lg border-t-2 border-l-2 border-r-2",
    "transition-all duration-150 h-[42px]",
    isDragOver &&
      "bg-background/40 text-muted-foreground border-border opacity-60",
    isDragging && "opacity-70",
    isHoveredDropTarget &&
      "bg-blue-500/20 border-blue-500 ring-2 ring-blue-500/50",
    !isHoveredDropTarget &&
      isValidDropTarget &&
      "border-blue-400/50 bg-background/90",
    !isDragOver &&
      !isDragging &&
      !isValidDropTarget &&
      !isHoveredDropTarget &&
      isActive &&
      "bg-background text-foreground border-border z-10",
    !isDragOver &&
      !isDragging &&
      !isValidDropTarget &&
      !isHoveredDropTarget &&
      !isActive &&
      "bg-background/80 text-muted-foreground border-border hover:bg-background/90",
  );

  const splitTitle = (fullTitle: string): { base: string; suffix: string } => {
    const match = fullTitle.match(/^(.*?)(\s*\(\d+\))$/);
    if (match) {
      return { base: match[1], suffix: match[2] };
    }
    return { base: fullTitle, suffix: "" };
  };

  if (tabType === "home") {
    return (
      <div
        className={cn(
          "relative flex items-center gap-1.5 px-3 flex-shrink-0 cursor-pointer",
          "rounded-t-lg border-t-2 border-l-2 border-r-2",
          "transition-all duration-150 h-[42px]",
          isDragOver &&
            "bg-background/40 text-muted-foreground border-border opacity-60",
          isDragging && "opacity-70",
          !isDragOver &&
            !isDragging &&
            isActive &&
            "bg-background text-foreground border-border z-10",
          !isDragOver &&
            !isDragging &&
            !isActive &&
            "bg-background/80 text-muted-foreground border-border hover:bg-background/90",
        )}
        onClick={!disableActivate ? onActivate : undefined}
        style={{
          marginBottom: "-2px",
          borderBottom: isActive ? "2px solid var(--foreground)" : "none",
        }}
      >
        <Home className="h-4 w-4" />
      </div>
    );
  }

  if (
    tabType === "terminal" ||
    tabType === "server_stats" ||
    tabType === "file_manager" ||
    tabType === "rdp" ||
    tabType === "vnc" ||
    tabType === "telnet" ||
    tabType === "tunnel" ||
    tabType === "docker" ||
    tabType === "user_profile"
  ) {
    const isServer = tabType === "server_stats";
    const isFileManager = tabType === "file_manager";
    const isTunnel = tabType === "tunnel";
    const isDocker = tabType === "docker";
    const isUserProfile = tabType === "user_profile";
    const displayTitle =
      title ||
      (isServer
        ? t("nav.serverStats")
        : isFileManager
          ? t("nav.fileManager")
          : isTunnel
            ? t("nav.tunnels")
            : isDocker
              ? t("nav.docker")
              : isUserProfile
                ? t("nav.userProfile")
                : tabType === "rdp" || tabType === "vnc" || tabType === "telnet"
                  ? tabType.toUpperCase()
                  : t("nav.terminal"));

    const { base, suffix } = splitTitle(displayTitle);

    return (
      <>
        <div
          className={cn(tabBaseClasses, "cursor-pointer")}
          onClick={
            !disableActivate
              ? (e) => onActivate?.(e.ctrlKey || e.metaKey)
              : undefined
          }
          onContextMenu={
            onMultiSelectContextMenu
              ? onMultiSelectContextMenu
              : onRename
                ? (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({ x: e.clientX, y: e.clientY });
                  }
                : undefined
          }
          style={{
            marginBottom: "-2px",
            // White underline for Ctrl+click multi-selection; regular
            // foreground underline for the active/split tab.
            borderBottom: isMultiSelected
              ? "2px solid #ffffff"
              : isActive || isSplit
                ? "2px solid var(--foreground)"
                : "none",
          }}
        >
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            {isServer ? (
              <ServerIcon className="h-4 w-4 flex-shrink-0" />
            ) : isFileManager ? (
              <FolderIcon className="h-4 w-4 flex-shrink-0" />
            ) : isTunnel ? (
              <TunnelIcon className="h-4 w-4 flex-shrink-0" />
            ) : isDocker ? (
              <DockerIcon className="h-4 w-4 flex-shrink-0" />
            ) : isUserProfile ? (
              <UserIcon className="h-4 w-4 flex-shrink-0" />
            ) : tabType === "rdp" ? (
              <MonitorIcon className="h-4 w-4 flex-shrink-0" />
            ) : tabType === "vnc" ? (
              <EyeIcon className="h-4 w-4 flex-shrink-0" />
            ) : tabType === "telnet" ? (
              <MessageSquareIcon className="h-4 w-4 flex-shrink-0" />
            ) : (
              <TerminalIcon className="h-4 w-4 flex-shrink-0" />
            )}
            {isEditing ? (
              <input
                ref={editInputRef}
                className="bg-transparent border-b border-foreground/40 outline-none text-foreground text-sm flex-1 min-w-0 h-[22px] leading-[22px]"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    const trimmed = editValue.trim();
                    if (trimmed && onRename) onRename(trimmed);
                    setIsEditing(false);
                  } else if (e.key === "Escape") {
                    setIsEditing(false);
                  }
                }}
                onBlur={() => {
                  const trimmed = editValue.trim();
                  if (trimmed && onRename) onRename(trimmed);
                  setIsEditing(false);
                }}
              />
            ) : (
              <>
                <span className="truncate text-sm flex-1 min-w-0">{base}</span>
                {suffix && (
                  <span className="text-sm flex-shrink-0">{suffix}</span>
                )}
              </>
            )}
          </div>

          {hasPassword && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleCopyPassword}
            title={getPasswordButtonTitle()}
          >
            <Key className="h-4 w-4 text-muted-foreground" />
          </Button>
        )}

        {canSplit && (
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-6 w-6", disableSplit && "opacity-50")}
            onClick={(e) => {
              e.stopPropagation();
              if (!disableSplit && onSplit) onSplit();
            }}
            disabled={disableSplit}
            title={
              disableSplit ? t("nav.cannotSplitTab") : t("nav.splitScreen")
            }
          >
            <SeparatorVertical
              className={cn(
                "h-4 w-4",
                isSplit ? "text-foreground" : "text-muted-foreground",
              )}
            />
          </Button>
        )}

        {canClose && (
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-6 w-6", disableClose && "opacity-50")}
            onClick={(e) => {
              e.stopPropagation();
              if (!disableClose && onClose) onClose();
            }}
            disabled={disableClose}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {contextMenu && (
        <div
          className="fixed z-[9999] bg-surface border border-edge rounded-md shadow-lg py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-foreground hover:bg-hover cursor-pointer"
            onClick={() => {
              setEditValue(displayTitle);
              setIsEditing(true);
              setContextMenu(null);
            }}
          >
            <Pencil className="w-3.5 h-3.5" />
            Rename
          </button>
          {onAddToSplit && (
            <button
              className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-foreground hover:bg-hover cursor-pointer"
              onClick={() => {
                onAddToSplit();
                setContextMenu(null);
              }}
            >
              <SeparatorVertical className="w-3.5 h-3.5" />
              Add to Split View
            </button>
          )}
          {onSplitAll && (
            <button
              className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-foreground hover:bg-hover cursor-pointer"
              onClick={() => {
                onSplitAll();
                setContextMenu(null);
              }}
            >
              <Columns2 className="w-3.5 h-3.5" />
              Add all tabs to Split View
            </button>
          )}
        </div>
      )}
      </>
    );
  }

  if (tabType === "ssh_manager") {
    const displayTitle = title || t("nav.sshManager");
    const { base, suffix } = splitTitle(displayTitle);

    return (
      <div
        className={cn(tabBaseClasses, "cursor-pointer")}
        onClick={!disableActivate ? onActivate : undefined}
        style={{
          marginBottom: "-2px",
          borderBottom: isActive ? "2px solid var(--foreground)" : "none",
        }}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="truncate text-sm flex-1 min-w-0">{base}</span>
          {suffix && <span className="text-sm flex-shrink-0">{suffix}</span>}
        </div>

        {canClose && (
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-6 w-6", disableClose && "opacity-50")}
            onClick={(e) => {
              e.stopPropagation();
              if (!disableClose && onClose) onClose();
            }}
            disabled={disableClose}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }

  if (tabType === "admin") {
    const displayTitle = title || t("nav.admin");
    const { base, suffix } = splitTitle(displayTitle);

    return (
      <div
        className={cn(tabBaseClasses, "cursor-pointer")}
        onClick={!disableActivate ? onActivate : undefined}
        style={{
          marginBottom: "-2px",
          borderBottom: isActive ? "2px solid var(--foreground)" : "none",
        }}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="truncate text-sm flex-1 min-w-0">{base}</span>
          {suffix && <span className="text-sm flex-shrink-0">{suffix}</span>}
        </div>

        {canClose && (
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-6 w-6", disableClose && "opacity-50")}
            onClick={(e) => {
              e.stopPropagation();
              if (!disableClose && onClose) onClose();
            }}
            disabled={disableClose}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }

  if (tabType === "network_graph") {
    const displayTitle = title || t("dashboard.networkGraph");
    const { base, suffix } = splitTitle(displayTitle);

    return (
      <div
        className={cn(tabBaseClasses, "cursor-pointer")}
        onClick={!disableActivate ? onActivate : undefined}
        style={{
          marginBottom: "-2px",
          borderBottom: isActive ? "2px solid var(--foreground)" : "none",
        }}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Network className="h-4 w-4 flex-shrink-0" />
          <span className="truncate text-sm flex-1 min-w-0">{base}</span>
          {suffix && <span className="text-sm flex-shrink-0">{suffix}</span>}
        </div>

        {canClose && (
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-6 w-6", disableClose && "opacity-50")}
            onClick={(e) => {
              e.stopPropagation();
              if (!disableClose && onClose) onClose();
            }}
            disabled={disableClose}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }

  return null;
}
