import React from "react";
import { useTranslation } from "react-i18next";
import { ChartLine, Loader2, RotateCw, Server, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { HostLiveness } from "@/types/index.ts";

interface ServerStat {
  id: number;
  name: string;
  cpu: number | null;
  ram: number | null;
  status: HostLiveness;
}

interface ServerStatsCardProps {
  serverStats: ServerStat[];
  loading: boolean;
  onServerClick: (serverId: number, serverName: string) => void;
  onRetryConnection?: (serverId: number) => void;
  onDeleteAllDead?: () => void;
  retryingHostIds?: Set<number>;
  deletingAllDead?: boolean;
}

export function ServerStatsCard({
  serverStats,
  loading,
  onServerClick,
  onRetryConnection,
  onDeleteAllDead,
  retryingHostIds,
  deletingAllDead,
}: ServerStatsCardProps): React.ReactElement {
  const { t } = useTranslation();

  const liveStats = serverStats.filter((s) => s.status !== "dead");
  const deadStats = serverStats.filter((s) => s.status === "dead");

  return (
    <div className="border-2 border-edge rounded-md flex flex-col overflow-hidden transition-all duration-150 hover:border-primary/20 !bg-elevated">
      <div className="flex flex-col mx-3 my-2 flex-1 overflow-hidden">
        <div className="flex flex-row items-center mb-3 mt-1">
          <p className="text-xl font-semibold flex flex-row items-center">
            <ChartLine className="mr-3" />
            {t("dashboard.serverStats")}
          </p>
          {deadStats.length > 0 && onDeleteAllDead && (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-7 text-xs text-red-400 border-edge hover:bg-destructive/10 hover:text-red-400"
              onClick={onDeleteAllDead}
              disabled={deletingAllDead}
              title={`Delete all ${deadStats.length} dead host${deadStats.length === 1 ? "" : "s"}`}
            >
              {deletingAllDead ? (
                <Loader2 className="animate-spin mr-2" size={12} />
              ) : (
                <Trash2 className="mr-2" size={12} />
              )}
              Delete Dead ({deadStats.length})
            </Button>
          )}
        </div>
        <div
          className={`grid gap-4 grid-cols-3 auto-rows-min overflow-x-hidden thin-scrollbar ${loading ? "overflow-y-hidden" : "overflow-y-auto"}`}
        >
          {loading ? (
            <div className="flex flex-row items-center text-muted-foreground text-sm animate-pulse">
              <Loader2 className="animate-spin mr-2" size={16} />
              <span>{t("dashboard.loadingServerStats")}</span>
            </div>
          ) : serverStats.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("dashboard.noServerData")}
            </p>
          ) : (
            <>
              {liveStats.map((server) => (
                <Button
                  key={server.id}
                  variant="outline"
                  className="border-2 !border-edge h-auto p-3 min-w-0 !bg-canvas"
                  onClick={() => onServerClick(server.id, server.name)}
                >
                  <div className="flex flex-col w-full">
                    <div className="flex flex-row items-center mb-2">
                      <Server size={20} className="shrink-0" />
                      <p className="truncate ml-2 font-semibold">
                        {server.name}
                      </p>
                    </div>
                    <div className="flex flex-row justify-start gap-4 text-xs text-muted-foreground">
                      <span>
                        {t("dashboard.cpu")}:{" "}
                        {server.cpu !== null
                          ? `${server.cpu}%`
                          : t("dashboard.notAvailable")}
                      </span>
                      <span>
                        {t("dashboard.ram")}:{" "}
                        {server.ram !== null
                          ? `${server.ram}%`
                          : t("dashboard.notAvailable")}
                      </span>
                    </div>
                  </div>
                </Button>
              ))}
              {deadStats.map((server) => {
                const retrying = retryingHostIds?.has(server.id) ?? false;
                return (
                  <div
                    key={server.id}
                    className="border-2 border-edge rounded-md p-3 min-w-0 bg-canvas flex flex-col"
                  >
                    <div className="flex flex-row items-center mb-2">
                      <Server
                        size={20}
                        className="shrink-0 text-muted-foreground"
                      />
                      <p className="truncate ml-2 font-semibold text-muted-foreground">
                        {server.name}
                      </p>
                      <Badge variant="destructive" className="ml-auto">
                        Dead
                      </Badge>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-1 h-7 text-xs"
                      disabled={retrying || !onRetryConnection}
                      onClick={() => onRetryConnection?.(server.id)}
                    >
                      {retrying ? (
                        <>
                          <Loader2
                            className="animate-spin mr-2"
                            size={12}
                          />
                          Probing…
                        </>
                      ) : (
                        <>
                          <RotateCw className="mr-2" size={12} />
                          Retry Connection
                        </>
                      )}
                    </Button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
