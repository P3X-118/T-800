import React, { useState, useRef, useEffect } from "react";
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
}

export function FolderCard({
  folderName,
  hosts,
  folderColor,
  folderIcon,
  onFolderRenamed,
  disableRename = false,
}: FolderCardProps): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(true);
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
    <div className="bg-elevated border-2 border-edge rounded-lg overflow-hidden p-0 m-0">
      <div
        className={`px-4 py-3 relative ${isExpanded ? "border-b-2" : ""} bg-header`}
        onContextMenu={
          disableRename
            ? undefined
            : (e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({ x: e.clientX, y: e.clientY });
              }
        }
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
            className={`h-4 w-4 transition-transform ${isExpanded ? "" : "rotate-180"}`}
          />
        </Button>
      </div>

      {contextMenu && (
        <div
          className="fixed z-[9999] bg-surface border border-edge rounded-md shadow-lg py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-foreground hover:bg-hover cursor-pointer"
            onClick={handleStartRename}
          >
            <Pencil className="w-3.5 h-3.5" />
            Rename
          </button>
        </div>
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
