import React, { useState } from "react";
import {
  ChevronUp,
  User2,
  HardDrive,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Layers,
  Save,
  Pencil,
  Trash2,
  Plus,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { isElectron, logoutUser } from "@/ui/main-axios.ts";
import {
  type SavedSplitGroup,
  loadSavedSplitGroups,
  persistSavedSplitGroups,
  buildSavedSplitGroup,
  instantiateSavedSplitGroup,
} from "@/ui/desktop/navigation/splitGroups/savedSplitGroups.ts";
import type { SplitLayoutNode } from "@/ui/desktop/navigation/tabs/splitLayout.ts";
import { toast } from "sonner";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarInset,
  SidebarHeader,
} from "@/components/ui/sidebar.tsx";

import { Separator } from "@/components/ui/separator.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@radix-ui/react-dropdown-menu";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { FolderCard } from "@/ui/desktop/navigation/hosts/FolderCard.tsx";
import { getSSHHosts, getSSHFolders } from "@/ui/main-axios.ts";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import type { SSHFolder, SSHHost } from "@/types/index.ts";

interface SidebarProps {
  disabled?: boolean;
  isAdmin?: boolean;
  username?: string | null;
  children?: React.ReactNode;
  onLogout?: () => void;
}

async function handleLogout() {
  try {
    await logoutUser();

    if (isElectron()) {
      localStorage.removeItem("jwt");
    }

    window.location.reload();
  } catch (error) {
    console.error("Logout failed:", error);
    window.location.reload();
  }
}

export function LeftSidebar({
  disabled,
  isAdmin,
  username,
  children,
  onLogout,
}: SidebarProps): React.ReactElement {
  const { t } = useTranslation();

  const [isSidebarOpenPersisted, setIsSidebarOpenPersisted] =
    useState<boolean>(() => {
      const saved = localStorage.getItem("leftSidebarOpen");
      return saved !== null ? JSON.parse(saved) : true;
    });
  const [isSidebarHoverOpen, setIsSidebarHoverOpen] =
    useState<boolean>(false);
  // Effective state — true if persisted-open OR temporarily hover-open. Hover
  // state is never persisted, so a reload returns to the user's last
  // committed toggle state.
  const isSidebarOpen = isSidebarOpenPersisted || isSidebarHoverOpen;
  // Wrapper that the toggle button uses to lock state. Toggling permanent
  // close should also clear any in-flight hover state so the sidebar
  // collapses immediately rather than lingering.
  const setIsSidebarOpen = React.useCallback((open: boolean) => {
    setIsSidebarOpenPersisted(open);
    if (!open) setIsSidebarHoverOpen(false);
  }, []);

  // ── Hover-open handling for the closed sidebar ───────────────────────
  const sidebarHoverCloseTimeoutRef = React.useRef<number | null>(null);
  const handleSidebarHoverEnter = React.useCallback(() => {
    if (sidebarHoverCloseTimeoutRef.current != null) {
      window.clearTimeout(sidebarHoverCloseTimeoutRef.current);
      sidebarHoverCloseTimeoutRef.current = null;
    }
    setIsSidebarHoverOpen(true);
  }, []);
  const handleSidebarHoverLeave = React.useCallback(() => {
    if (sidebarHoverCloseTimeoutRef.current != null) {
      window.clearTimeout(sidebarHoverCloseTimeoutRef.current);
    }
    sidebarHoverCloseTimeoutRef.current = window.setTimeout(() => {
      setIsSidebarHoverOpen(false);
      sidebarHoverCloseTimeoutRef.current = null;
    }, 120);
  }, []);
  React.useEffect(
    () => () => {
      if (sidebarHoverCloseTimeoutRef.current != null) {
        window.clearTimeout(sidebarHoverCloseTimeoutRef.current);
      }
    },
    [],
  );

  const {
    tabs: tabList,
    addTab,
    setCurrentTab,
    updateHostConfig,
    splitLayout,
    setSplitLayout,
  } = useTabs() as {
    tabs: Array<{
      id: number;
      type: string;
      title?: string;
      hostConfig?: SSHHost;
      connectionConfig?: Record<string, unknown>;
      [key: string]: unknown;
    }>;
    addTab: (tab: { type: string; [key: string]: unknown }) => number;
    setCurrentTab: (id: number) => void;
    updateHostConfig: (id: number, config: unknown) => void;
    splitLayout: SplitLayoutNode | null;
    setSplitLayout: (layout: SplitLayoutNode | null) => void;
  };
  const sshManagerTab = tabList.find((t) => t.type === "ssh_manager");
  const openSshManagerTab = () => {
    if (sshManagerTab) {
      setCurrentTab(sshManagerTab.id);
      return;
    }
    const id = addTab({ type: "ssh_manager", title: t("nav.hostManager") });
    setCurrentTab(id);
  };
  const adminTab = tabList.find((t) => t.type === "admin");
  const openAdminTab = () => {
    if (adminTab) {
      setCurrentTab(adminTab.id);
      return;
    }
    const id = addTab({ type: "admin" });
    setCurrentTab(id);
  };
  const userProfileTab = tabList.find((t) => t.type === "user_profile");
  const openUserProfileTab = () => {
    if (userProfileTab) {
      setCurrentTab(userProfileTab.id);
      return;
    }
    const id = addTab({ type: "user_profile" });
    setCurrentTab(id);
  };

  const [hosts, setHosts] = useState<SSHHost[]>([]);
  const [hostsLoading] = useState(false);
  const [hostsError, setHostsError] = useState<string | null>(null);
  const prevHostsRef = React.useRef<SSHHost[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [folderMetadata, setFolderMetadata] = useState<Map<string, SSHFolder>>(
    new Map(),
  );

  const fetchFolderMetadata = React.useCallback(async () => {
    try {
      const folders = await getSSHFolders();
      const metadataMap = new Map<string, SSHFolder>();
      folders.forEach((folder) => {
        metadataMap.set(folder.name, folder);
      });
      setFolderMetadata(metadataMap);
    } catch (error) {
      console.error("Failed to fetch folder metadata:", error);
    }
  }, []);

  const fetchHosts = React.useCallback(async () => {
    try {
      const newHosts = await getSSHHosts();
      const prevHosts = prevHostsRef.current;

      const existingHostsMap = new Map(prevHosts.map((h) => [h.id, h]));
      const newHostsMap = new Map(newHosts.map((h) => [h.id, h]));

      let hasChanges = false;

      if (newHosts.length !== prevHosts.length) {
        hasChanges = true;
      } else {
        for (const [id, newHost] of newHostsMap) {
          const existingHost = existingHostsMap.get(id);
          if (!existingHost) {
            hasChanges = true;
            break;
          }

          if (
            newHost.name !== existingHost.name ||
            newHost.folder !== existingHost.folder ||
            newHost.ip !== existingHost.ip ||
            newHost.port !== existingHost.port ||
            newHost.username !== existingHost.username ||
            newHost.folder !== existingHost.folder ||
            newHost.pin !== existingHost.pin ||
            newHost.enableTerminal !== existingHost.enableTerminal ||
            newHost.enableTunnel !== existingHost.enableTunnel ||
            newHost.enableFileManager !== existingHost.enableFileManager ||
            newHost.authType !== existingHost.authType ||
            newHost.password !== existingHost.password ||
            newHost.key !== existingHost.key ||
            newHost.keyPassword !== existingHost.keyPassword ||
            newHost.keyType !== existingHost.keyType ||
            newHost.defaultPath !== existingHost.defaultPath ||
            JSON.stringify(newHost.tags) !==
              JSON.stringify(existingHost.tags) ||
            JSON.stringify(newHost.tunnelConnections) !==
              JSON.stringify(existingHost.tunnelConnections)
          ) {
            hasChanges = true;
            break;
          }
        }
      }

      if (hasChanges) {
        setTimeout(() => {
          setHosts(newHosts);
          prevHostsRef.current = newHosts;
        }, 50);
      }
    } catch {
      setHostsError(t("leftSidebar.failedToLoadHosts"));
    }
  }, [t]);

  const fetchHostsRef = React.useRef(fetchHosts);
  const fetchFolderMetadataRef = React.useRef(fetchFolderMetadata);

  React.useEffect(() => {
    fetchHostsRef.current = fetchHosts;
    fetchFolderMetadataRef.current = fetchFolderMetadata;
  });

  React.useEffect(() => {
    fetchHostsRef.current();
    fetchFolderMetadataRef.current();
    const interval = setInterval(() => {
      fetchHostsRef.current();
      fetchFolderMetadataRef.current();
    }, 300000);
    return () => clearInterval(interval);
  }, []);

  React.useEffect(() => {
    const handleHostsChanged = () => {
      fetchHostsRef.current();
      fetchFolderMetadataRef.current();
    };
    const handleCredentialsChanged = () => {
      fetchHostsRef.current();
    };
    const handleFoldersChanged = () => {
      fetchFolderMetadataRef.current();
    };
    window.addEventListener(
      "ssh-hosts:changed",
      handleHostsChanged as EventListener,
    );
    window.addEventListener(
      "credentials:changed",
      handleCredentialsChanged as EventListener,
    );
    window.addEventListener(
      "folders:changed",
      handleFoldersChanged as EventListener,
    );
    return () => {
      window.removeEventListener(
        "ssh-hosts:changed",
        handleHostsChanged as EventListener,
      );
      window.removeEventListener(
        "credentials:changed",
        handleCredentialsChanged as EventListener,
      );
      window.removeEventListener(
        "folders:changed",
        handleFoldersChanged as EventListener,
      );
    };
  }, []);

  React.useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(handler);
  }, [search]);

  React.useEffect(() => {
    localStorage.setItem(
      "leftSidebarOpen",
      JSON.stringify(isSidebarOpenPersisted),
    );
  }, [isSidebarOpenPersisted]);

  // ── Saved Split View Groups ──────────────────────────────────────────
  const [savedGroups, setSavedGroups] = useState<SavedSplitGroup[]>(() =>
    loadSavedSplitGroups(),
  );
  const [savedGroupsPopoverOpen, setSavedGroupsPopoverOpen] =
    useState<boolean>(false);
  const [newGroupName, setNewGroupName] = useState<string>("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState<string>("");
  const savedGroupsPopoverRef = React.useRef<HTMLDivElement | null>(null);
  const savedGroupsTriggerRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    persistSavedSplitGroups(savedGroups);
  }, [savedGroups]);

  // Close popover on outside click
  React.useEffect(() => {
    if (!savedGroupsPopoverOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        savedGroupsPopoverRef.current &&
        target &&
        !savedGroupsPopoverRef.current.contains(target) &&
        !savedGroupsTriggerRef.current?.contains(target)
      ) {
        setSavedGroupsPopoverOpen(false);
        setEditingGroupId(null);
      }
    };
    window.addEventListener("mousedown", onDocClick);
    return () => window.removeEventListener("mousedown", onDocClick);
  }, [savedGroupsPopoverOpen]);

  const hasActiveSplit = !!splitLayout && splitLayout.type === "split";

  const handleSaveCurrentSplitGroup = () => {
    const name = newGroupName.trim();
    if (!name) {
      toast.error("Give the split view a name first");
      return;
    }
    if (!splitLayout) {
      toast.error("No active split view to save");
      return;
    }
    const group = buildSavedSplitGroup(name, splitLayout, (tabId) => {
      const t = tabList.find((tab) => tab.id === tabId);
      if (!t) return null;
      return {
        type: t.type,
        title: t.title ?? "",
        hostConfig: t.hostConfig,
        connectionConfig: t.connectionConfig,
      };
    });
    if (!group) {
      toast.error("Current split view doesn't have enough tabs to save");
      return;
    }
    setSavedGroups((prev) => [...prev, group]);
    setNewGroupName("");
    toast.success(`Saved split view "${name}"`);
  };

  const handleLoadSavedSplitGroup = (group: SavedSplitGroup) => {
    const { layout, tabIds } = instantiateSavedSplitGroup(group, (tab) =>
      addTab(tab as { type: string; [key: string]: unknown }),
    );
    setSplitLayout(layout);
    if (tabIds.length > 0) {
      setCurrentTab(tabIds[0]);
    }
    setSavedGroupsPopoverOpen(false);
    toast.success(`Loaded "${group.name}"`);
  };

  const handleDeleteSavedSplitGroup = (id: string) => {
    setSavedGroups((prev) => prev.filter((g) => g.id !== id));
    if (editingGroupId === id) setEditingGroupId(null);
  };

  const handleStartRenameGroup = (group: SavedSplitGroup) => {
    setEditingGroupId(group.id);
    setEditingGroupName(group.name);
  };

  const handleCommitRenameGroup = () => {
    if (!editingGroupId) return;
    const name = editingGroupName.trim();
    if (!name) {
      setEditingGroupId(null);
      return;
    }
    setSavedGroups((prev) =>
      prev.map((g) =>
        g.id === editingGroupId ? { ...g, name, updatedAt: Date.now() } : g,
      ),
    );
    setEditingGroupId(null);
  };

  // Default width is wide enough to fit ~12-character hostnames without
  // wrapping (status icon + ~100px for the name + a couple of action
  // buttons + sidebar padding).
  const DEFAULT_SIDEBAR_WIDTH = 280;
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem("leftSidebarWidth");
    const savedWidth =
      saved !== null ? parseInt(saved, 10) : DEFAULT_SIDEBAR_WIDTH;
    const minWidth = Math.min(240, Math.floor(window.innerWidth * 0.15));
    const maxWidth = Math.floor(window.innerWidth * 0.3);
    return Math.max(minWidth, Math.min(savedWidth, maxWidth));
  });

  const [isResizing, setIsResizing] = useState(false);
  const startXRef = React.useRef<number | null>(null);
  const startWidthRef = React.useRef<number>(sidebarWidth);

  React.useEffect(() => {
    localStorage.setItem("leftSidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);

  React.useEffect(() => {
    const handleResize = () => {
      const minWidth = Math.min(240, Math.floor(window.innerWidth * 0.15));
      const maxWidth = Math.floor(window.innerWidth * 0.3);
      if (sidebarWidth > maxWidth) {
        setSidebarWidth(Math.max(minWidth, maxWidth));
      } else if (sidebarWidth < minWidth) {
        setSidebarWidth(minWidth);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [sidebarWidth]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = sidebarWidth;
  };

  React.useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (startXRef.current == null) return;
      const dx = e.clientX - startXRef.current;
      const newWidth = Math.round(startWidthRef.current + dx);
      const minWidth = Math.min(200, Math.floor(window.innerWidth * 0.15));
      const maxWidth = Math.round(window.innerWidth * 0.3);
      if (newWidth >= minWidth && newWidth <= maxWidth) {
        setSidebarWidth(newWidth);
      } else if (newWidth < minWidth) {
        setSidebarWidth(minWidth);
      } else if (newWidth > maxWidth) {
        setSidebarWidth(maxWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      startXRef.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  const filteredHosts = React.useMemo(() => {
    if (!debouncedSearch.trim()) return hosts;
    const searchQuery = debouncedSearch.trim().toLowerCase();

    return hosts.filter((h) => {
      const fieldMatches: Record<string, string> = {};
      let remainingQuery = searchQuery;

      const fieldPattern = /(\w+):([^\s]+)/g;
      let match;
      while ((match = fieldPattern.exec(searchQuery)) !== null) {
        const [fullMatch, field, value] = match;
        fieldMatches[field] = value;
        remainingQuery = remainingQuery.replace(fullMatch, "").trim();
      }

      for (const [field, value] of Object.entries(fieldMatches)) {
        switch (field) {
          case "tag":
          case "tags": {
            const tags = Array.isArray(h.tags) ? h.tags : [];
            const hasMatchingTag = tags.some((tag) =>
              tag.toLowerCase().includes(value),
            );
            if (!hasMatchingTag) return false;
            break;
          }
          case "name":
            if (!(h.name || "").toLowerCase().includes(value)) return false;
            break;
          case "user":
          case "username":
            if (!h.username.toLowerCase().includes(value)) return false;
            break;
          case "ip":
          case "host":
            if (!h.ip.toLowerCase().includes(value)) return false;
            break;
          case "port":
            if (!String(h.port).includes(value)) return false;
            break;
          case "folder":
            if (!(h.folder || "").toLowerCase().includes(value)) return false;
            break;
          case "auth":
          case "authtype":
            if (!h.authType.toLowerCase().includes(value)) return false;
            break;
          case "path":
            if (!(h.defaultPath || "").toLowerCase().includes(value))
              return false;
            break;
        }
      }

      if (remainingQuery) {
        const searchableText = [
          h.name || "",
          h.username,
          h.ip,
          h.folder || "",
          ...(h.tags || []),
          h.authType,
          h.defaultPath || "",
        ]
          .join(" ")
          .toLowerCase();
        if (!searchableText.includes(remainingQuery)) return false;
      }

      return true;
    });
  }, [hosts, debouncedSearch]);

  const hostsByFolder = React.useMemo(() => {
    const map: Record<string, SSHHost[]> = {};
    filteredHosts.forEach((h) => {
      const folder =
        h.folder && h.folder.trim() ? h.folder : t("leftSidebar.noFolder");
      if (!map[folder]) map[folder] = [];
      map[folder].push(h);
    });
    return map;
  }, [filteredHosts]);

  const sortedFolders = React.useMemo(() => {
    const folders = Object.keys(hostsByFolder);
    folders.sort((a, b) => {
      if (a === t("leftSidebar.noFolder")) return -1;
      if (b === t("leftSidebar.noFolder")) return 1;
      return a.localeCompare(b);
    });
    return folders;
  }, [hostsByFolder]);

  const getSortedHosts = React.useCallback((arr: SSHHost[]) => {
    const pinned = arr
      .filter((h) => h.pin)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const rest = arr
      .filter((h) => !h.pin)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return [...pinned, ...rest];
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden">
      <SidebarProvider
        open={isSidebarOpen}
        style={
          { "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties
        }
      >
        <div className="flex h-screen w-screen overflow-hidden">
          <Sidebar
            variant="floating"
            onMouseEnter={handleSidebarHoverEnter}
            onMouseLeave={handleSidebarHoverLeave}
            onDoubleClick={(e) => {
              if (
                !isSidebarOpenPersisted &&
                (e.target === e.currentTarget ||
                  !(e.target as HTMLElement).closest("button, a, input"))
              ) {
                setIsSidebarOpen(true);
              }
            }}
          >
            <SidebarHeader>
              <SidebarGroupLabel className="text-lg font-bold text-foreground">
                {t("common.appName")}
                <div className="absolute right-5 flex gap-1">
                  <Button
                    variant="outline"
                    onClick={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
                    className="w-[28px] h-[28px]"
                    title={t("common.resetSidebarWidth")}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setIsSidebarOpen(!isSidebarOpenPersisted)
                    }
                    className="w-[28px] h-[28px]"
                    title={
                      isSidebarOpenPersisted
                        ? t("common.toggleSidebar")
                        : "Pin sidebar open"
                    }
                  >
                    {isSidebarOpenPersisted ? (
                      <ChevronLeft className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </SidebarGroupLabel>
            </SidebarHeader>
            <Separator className="p-0.25" />
            <SidebarContent>
              <SidebarGroup className="!m-0 !p-0 !-mb-2">
                <Button
                  className="m-2 flex flex-row font-semibold border-2 !border-edge"
                  variant="outline"
                  onClick={openSshManagerTab}
                >
                  <HardDrive strokeWidth="2.5" />
                  {t("nav.hostManager")}
                </Button>
              </SidebarGroup>
              <SidebarGroup className="!m-0 !p-0 !-mt-1 !-mb-2 relative">
                <div className="flex flex-row gap-2 px-2 pb-2">
                  <Button
                    ref={savedGroupsTriggerRef}
                    variant="outline"
                    className="flex-1 h-9 !px-0 border-2 !border-edge"
                    title="Saved split views"
                    onClick={() => {
                      setSavedGroupsPopoverOpen((v) => !v);
                      setEditingGroupId(null);
                    }}
                  >
                    <Layers className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 h-9 !px-0 border-2 !border-edge opacity-50 cursor-not-allowed"
                    title="Coming soon"
                    disabled
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 h-9 !px-0 border-2 !border-edge opacity-50 cursor-not-allowed"
                    title="Coming soon"
                    disabled
                  >
                    <Save className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 h-9 !px-0 border-2 !border-edge opacity-50 cursor-not-allowed"
                    title="Coming soon"
                    disabled
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>

                {savedGroupsPopoverOpen && (
                  <div
                    ref={savedGroupsPopoverRef}
                    className="absolute left-2 right-2 top-full z-[9999] bg-surface border-2 border-edge rounded-md shadow-lg p-2 flex flex-col gap-2 max-h-[420px]"
                  >
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold px-1">
                      Saved Split Views
                    </div>
                    <div className="flex flex-col gap-1 overflow-y-auto max-h-[240px] thin-scrollbar">
                      {savedGroups.length === 0 && (
                        <div className="text-xs text-muted-foreground px-1 py-2">
                          No saved split views yet.
                        </div>
                      )}
                      {savedGroups.map((group) => {
                        const isEditing = editingGroupId === group.id;
                        return (
                          <div
                            key={group.id}
                            className="flex items-center gap-1 px-2 py-1.5 rounded hover:bg-hover"
                          >
                            {isEditing ? (
                              <Input
                                value={editingGroupName}
                                onChange={(e) =>
                                  setEditingGroupName(e.target.value)
                                }
                                onBlur={handleCommitRenameGroup}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    handleCommitRenameGroup();
                                  } else if (e.key === "Escape") {
                                    setEditingGroupId(null);
                                  }
                                }}
                                autoFocus
                                className="h-7 text-sm flex-1 min-w-0"
                              />
                            ) : (
                              <button
                                className="flex-1 min-w-0 text-left text-[13px] text-foreground truncate cursor-pointer"
                                onClick={() => handleLoadSavedSplitGroup(group)}
                                title={`Load "${group.name}" (${group.tabs.length} tabs)`}
                              >
                                <span className="truncate block">
                                  {group.name}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  {group.tabs.length} tabs
                                </span>
                              </button>
                            )}
                            {!isEditing && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 flex-shrink-0"
                                  title="Rename"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleStartRenameGroup(group);
                                  }}
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 flex-shrink-0 hover:!text-red-400"
                                  title="Delete"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteSavedSplitGroup(group.id);
                                  }}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <Separator />
                    <div className="flex flex-col gap-1 px-1">
                      <div className="text-[10px] text-muted-foreground">
                        Save current split view
                      </div>
                      <div className="flex gap-1">
                        <Input
                          value={newGroupName}
                          onChange={(e) => setNewGroupName(e.target.value)}
                          placeholder="Name"
                          className="h-7 text-sm flex-1 min-w-0"
                          disabled={!hasActiveSplit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleSaveCurrentSplitGroup();
                            }
                          }}
                        />
                        <Button
                          variant="outline"
                          className="h-7 px-2 border-2 !border-edge"
                          onClick={handleSaveCurrentSplitGroup}
                          disabled={!hasActiveSplit || !newGroupName.trim()}
                        >
                          <Save className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      {!hasActiveSplit && (
                        <div className="text-[10px] text-muted-foreground">
                          Open a split view to save it.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </SidebarGroup>
              <Separator className="p-0.25" />
              <SidebarGroup className="flex flex-col gap-y-2 !-mt-2">
                <div className="!bg-field rounded-lg">
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("placeholders.searchHostsAny")}
                    className="w-full h-8 text-sm border-2 !bg-field border-edge rounded-md"
                    autoComplete="off"
                  />
                </div>

                {hostsError && (
                  <div className="!bg-field rounded-lg">
                    <div className="w-full h-8 text-sm border-2 !bg-field border-edge rounded-md px-3 py-1.5 flex items-center text-red-500">
                      {t("leftSidebar.failedToLoadHosts")}
                    </div>
                  </div>
                )}

                {hostsLoading && (
                  <div className="px-4 pb-2">
                    <div className="text-xs text-muted-foreground text-center">
                      {t("hosts.loadingHosts")}
                    </div>
                  </div>
                )}

                {sortedFolders.map((folder, idx) => {
                  const metadata = folderMetadata.get(folder);
                  return (
                    <FolderCard
                      key={`folder-${folder}`}
                      folderName={folder}
                      hosts={getSortedHosts(hostsByFolder[folder])}
                      isFirst={idx === 0}
                      isLast={idx === sortedFolders.length - 1}
                      folderColor={metadata?.color}
                      folderIcon={metadata?.icon}
                      disableRename={folder === t("leftSidebar.noFolder")}
                    />
                  );
                })}
              </SidebarGroup>
            </SidebarContent>
            <Separator className="p-0.25 mt-1 mb-1" />
            <SidebarFooter>
              <SidebarMenu>
                <SidebarMenuItem>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <SidebarMenuButton
                        className="data-[state=open]:opacity-90 w-full"
                        disabled={disabled}
                        onClick={() => {
                          // Clicking the user profile button while the
                          // sidebar is hover-open should pin it open so it
                          // doesn't collapse out from under the dropdown
                          // the user is about to interact with.
                          setIsSidebarOpen(true);
                        }}
                      >
                        <User2 /> {username ? username : t("common.logout")}
                        <ChevronUp className="ml-auto" />
                      </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      side="top"
                      align="start"
                      sideOffset={6}
                      className="min-w-[var(--radix-popper-anchor-width)] bg-sidebar-accent text-sidebar-accent-foreground border border-border rounded-md shadow-2xl p-1"
                    >
                      <DropdownMenuItem
                        className="rounded px-2 py-1.5 hover:bg-surface-hover hover:text-accent-foreground focus:bg-surface-hover focus:text-accent-foreground cursor-pointer focus:outline-none"
                        onClick={() => {
                          openUserProfileTab();
                        }}
                      >
                        <span>{t("profile.title")}</span>
                      </DropdownMenuItem>
                      {isAdmin && (
                        <DropdownMenuItem
                          className="rounded px-2 py-1.5 hover:bg-surface-hover hover:text-accent-foreground focus:bg-surface-hover focus:text-accent-foreground cursor-pointer focus:outline-none"
                          onClick={() => {
                            if (isAdmin) openAdminTab();
                          }}
                        >
                          <span>{t("admin.title")}</span>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        className="rounded px-2 py-1.5 hover:bg-surface-hover hover:text-accent-foreground focus:bg-surface-hover focus:text-accent-foreground cursor-pointer focus:outline-none"
                        onClick={onLogout || handleLogout}
                      >
                        <span>{t("common.logout")}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarFooter>
            {isSidebarOpen && (
              <div
                className="absolute top-0 h-full cursor-col-resize z-[60]"
                onMouseDown={handleMouseDown}
                style={{
                  right: "-4px",
                  width: "8px",
                  backgroundColor: isResizing
                    ? "var(--bg-interact)"
                    : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (!isResizing) {
                    e.currentTarget.style.backgroundColor =
                      "var(--border-hover)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isResizing) {
                    e.currentTarget.style.backgroundColor = "transparent";
                  }
                }}
                title={t("common.dragToResizeSidebar")}
              />
            )}
          </Sidebar>

          <SidebarInset>{children}</SidebarInset>
        </div>
      </SidebarProvider>

      {!isSidebarOpenPersisted && (
        <div
          onDoubleClick={() => setIsSidebarOpen(true)}
          onMouseEnter={handleSidebarHoverEnter}
          onMouseLeave={handleSidebarHoverLeave}
          className="fixed top-0 left-0 w-[10px] h-full cursor-pointer flex items-center justify-center rounded-tr-md rounded-br-md"
          style={{
            zIndex: 9999,
            // Keep mounted while hover-open so the cursor can move between
            // the strip and the sidebar without losing hover; just hide it
            // visually so it doesn't paint over the sidebar's left edge.
            opacity: isSidebarHoverOpen ? 0 : 1,
            backgroundColor: "var(--bg-base)",
            border: "2px solid var(--border-base)",
            borderLeft: "none",
          }}
        >
          <ChevronRight size={10} />
        </div>
      )}
    </div>
  );
}
