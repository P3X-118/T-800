import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { CardTitle } from "@/components/ui/card.tsx";
import {
  ChevronDown,
  Folder,
  Server,
  Cloud,
  Database,
  Box,
  Package,
  Layers,
  Archive,
  HardDrive,
  Globe,
  Pencil,
  Trash2,
  Columns2,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Host } from "@/ui/desktop/navigation/hosts/Host.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { renameFolder } from "@/ui/main-axios.ts";
import { toast } from "sonner";

interface SSHHost {
  id: number;
  name: string;
  ip: string;
  port: number;
  username: string;
  folder: string;
  tags: string[];
  pin: boolean;
  authType: string;
  password?: string;
  key?: string;
  keyPassword?: string;
  keyType?: string;
  enableTerminal: boolean;
  enableTunnel: boolean;
  enableFileManager: boolean;
  defaultPath: string;
  tunnelConnections: Array<{
    sourcePort: number;
    endpointPort: number;
    endpointHost: string;
    maxRetries: number;
    retryInterval: number;
    autoStart: boolean;
  }>;
  createdAt: string;
  updatedAt: string;
}

interface FolderCardProps {
  folderName: string;
  hosts: SSHHost[];
  isFirst: boolean;
  isLast: boolean;
  folderColor?: string;
  folderIcon?: string;
  onFolderRenamed?: () => void;
  disableRename?: boolean;
  forceExpandedKey?: number;
  searchActive?: boolean;
  isSelected?: boolean;
  onSelect?: (mode: "ctrl" | "shift") => void;
  onDeleteFolder?: () => void;
  selectedCount?: number;
  onDeleteSelected?: () => void;
  onOpenInSplitView?: () => void;
}

export function FolderCard({
  folderName,
  hosts,
  folderColor,
  folderIcon,
  onFolderRenamed,
  disableRename = false,
  forceExpandedKey,
  searchActive = false,
  isSelected = false,
  onSelect,
  onDeleteFolder,
  selectedCount = 0,
  onDeleteSelected,
  onOpenInSplitView,
}: FolderCardProps): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    if (forceExpandedKey === undefined) return;
    setIsExpanded(forceExpandedKey > 0);
  }, [forceExpandedKey]);

  // While a host search is active, force every rendered folder open so
  // matches are visible; restore the prior expansion state when the
  // search clears.
  const preSearchExpandedRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (searchActive) {
      if (preSearchExpandedRef.current === null) {
        preSearchExpandedRef.current = isExpanded;
      }
      setIsExpanded(true);
    } else if (preSearchExpandedRef.current !== null) {
      setIsExpanded(preSearchExpandedRef.current);
      preSearchExpandedRef.current = null;
    }
    // isExpanded intentionally not a dep — we only snapshot on the
    // false→true edge of searchActive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchActive]);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameCommittedRef = useRef(false);

  // Close context menu on outside click
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

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  const handleStartRename = () => {
    renameCommittedRef.current = false;
    setRenameValue(folderName);
    setIsRenaming(true);
    setContextMenu(null);
  };

  const handleCommitRename = async () => {
    // Guard against double-fire (Enter unmounts the input → onBlur fires
    // again with the same value).
    if (renameCommittedRef.current) return;
    renameCommittedRef.current = true;
    const newName = renameValue.trim();
    setIsRenaming(false);
    if (!newName || newName === folderName) return;
    try {
      await renameFolder(folderName, newName);
      // Notify the host list to refresh (the backend updates all hosts in
      // the folder). The sidebar listens for this custom event.
      window.dispatchEvent(new CustomEvent("ssh-hosts:changed"));
      window.dispatchEvent(new CustomEvent("folders:changed"));
      onFolderRenamed?.();
      toast.success(`Renamed folder to "${newName}"`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to rename folder",
      );
    }
  };

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  const iconMap: Record<
    string,
    React.ComponentType<{
      size?: number;
      strokeWidth?: number;
      className?: string;
      style?: React.CSSProperties;
    }>
  > = {
    Folder,
    Server,
    Cloud,
    Database,
    Box,
    Package,
    Layers,
    Archive,
    HardDrive,
    Globe,
  };

  const FolderIcon =
    folderIcon && iconMap[folderIcon] ? iconMap[folderIcon] : Folder;

  return (
    <div
      className={`bg-elevated border-2 rounded-lg overflow-hidden p-0 m-0 transition-colors ${
        isSelected ? "border-blue-500" : "border-edge"
      }`}
    >
      <div
        className={`px-4 py-3 relative ${isExpanded ? "border-b-2" : ""} bg-header cursor-pointer`}
        onClick={(e) => {
          if ((e.ctrlKey || e.metaKey || e.shiftKey) && onSelect) {
            e.stopPropagation();
            onSelect(e.ctrlKey || e.metaKey ? "ctrl" : "shift");
            return;
          }
          // Ignore clicks that originate from interactive children
          // (chevron button has its own onClick, rename input should
          // not expand/collapse the folder).
          const target = e.target as HTMLElement;
          if (target.closest("button, input, textarea, [contenteditable]")) {
            return;
          }
          toggleExpanded();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <div className="flex gap-2 pr-10">
          <div className="flex-shrink-0 flex items-center">
            <FolderIcon
              size={16}
              strokeWidth={3}
              style={folderColor ? { color: folderColor } : undefined}
            />
          </div>
          <div className="flex-1 min-w-0">
            {isRenaming ? (
              <Input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={handleCommitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCommitRename();
                  else if (e.key === "Escape") setIsRenaming(false);
                }}
                className="h-7 text-md font-semibold"
              />
            ) : (
              <CardTitle className="mb-0 leading-tight break-words text-md">
                {folderName}
              </CardTitle>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          className="w-[28px] h-[28px] absolute right-4 top-1/2 -translate-y-1/2 flex-shrink-0"
          onClick={toggleExpanded}
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
          />
        </Button>
      </div>

      {contextMenu && createPortal(
        <div
          className="fixed z-[9999] bg-surface border border-edge rounded-md shadow-lg py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {!disableRename && (
            <button
              className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-foreground hover:bg-hover cursor-pointer"
              onClick={handleStartRename}
            >
              <Pencil className="w-3.5 h-3.5" />
              Rename
            </button>
          )}
          {onOpenInSplitView && hosts.length > 0 && (
            <button
              className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-foreground hover:bg-hover cursor-pointer"
              onClick={() => {
                setContextMenu(null);
                onOpenInSplitView();
              }}
            >
              <Columns2 className="w-3.5 h-3.5" />
              Open in Split View ({hosts.length})
            </button>
          )}
          {selectedCount > 1 && onDeleteSelected && (
            <button
              className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-red-400 hover:bg-hover cursor-pointer"
              onClick={() => {
                setContextMenu(null);
                onDeleteSelected();
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete {selectedCount} folders
            </button>
          )}
          {onDeleteFolder && (
            <button
              className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-red-400 hover:bg-hover cursor-pointer"
              onClick={() => {
                setContextMenu(null);
                onDeleteFolder();
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete folder ({hosts.length} hosts)
            </button>
          )}
        </div>,
        document.body,
      )}
      {isExpanded && (
        <div className="flex flex-col p-2 gap-y-3">
          {hosts.map((host, index) => (
            <React.Fragment
              key={`${folderName}-host-${host.id}-${host.name || host.ip}`}
            >
              <Host host={host} />
              {index < hosts.length - 1 && (
                <div className="relative -mx-2">
                  <Separator className="p-0.25 absolute inset-x-0" />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
