import React, { useState, useRef } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, KeyRound, FileText, CheckCircle2 } from "lucide-react";
import { importSSHConfigFromUpload } from "@/ui/main-axios";

interface SSHConfigUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
}

/**
 * Parse an uploaded ssh_config text to extract unique IdentityFile paths.
 * This is a lightweight client-side parse — just enough to show the user
 * which key files they need to provide.
 */
function extractIdentityFiles(configText: string): string[] {
  const files = new Set<string>();
  for (const line of configText.split(/\r?\n/)) {
    const trimmed = line.replace(/#.*/, "").trim();
    const match = trimmed.match(
      /^identityfile\s*[=\s]\s*(.+)/i,
    );
    if (match) {
      let val = match[1].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      files.add(val);
    }
  }
  return Array.from(files).sort();
}

export function SSHConfigUploadDialog({
  open,
  onOpenChange,
  onCompleted,
}: SSHConfigUploadDialogProps) {
  const [step, setStep] = useState<"config" | "keys" | "importing">("config");
  const [configText, setConfigText] = useState("");
  const [configFileName, setConfigFileName] = useState<string | null>(null);
  const [identityFiles, setIdentityFiles] = useState<string[]>([]);
  const [keyContents, setKeyContents] = useState<Record<string, string>>({});
  const [keyFileNames, setKeyFileNames] = useState<Record<string, string>>({});
  const [overwrite, setOverwrite] = useState(false);
  const configInputRef = useRef<HTMLInputElement | null>(null);
  const importInFlightRef = useRef(false);

  const reset = () => {
    setStep("config");
    setConfigText("");
    setConfigFileName(null);
    setIdentityFiles([]);
    setKeyContents({});
    setKeyFileNames({});
    setOverwrite(false);
  };

  const handleConfigFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      setConfigText(text);
      setConfigFileName(file.name);
      const ids = extractIdentityFiles(text);
      setIdentityFiles(ids);
      if (ids.length > 0) {
        setStep("keys");
      }
      // Count hosts for feedback
      const hostCount = (text.match(/^Host\s+/gim) || []).length;
      toast.success(
        `Loaded ${file.name}: ${hostCount} Host entries, ${ids.length} unique key files referenced`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to read config file",
      );
    }
  };

  const handleKeyFile = async (
    identityFile: string,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      setKeyContents((prev) => ({ ...prev, [identityFile]: text }));
      setKeyFileNames((prev) => ({ ...prev, [identityFile]: file.name }));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to read key file",
      );
    }
  };

  const handleImport = async () => {
    if (!configText) {
      toast.error("No SSH config loaded");
      return;
    }
    // Belt-and-suspenders guard against rapid double-clicks: the Import
    // button is disabled during `importing`, but React batches state
    // updates so two synchronous clicks can both slip through before the
    // disabled prop reflects. A ref blocks the second call synchronously.
    if (importInFlightRef.current) return;
    importInFlightRef.current = true;
    setStep("importing");
    try {
      const result = await importSSHConfigFromUpload(
        configText,
        overwrite,
        keyContents,
      );

      const parts: string[] = [];
      if (result.success > 0) parts.push(`${result.success} created`);
      if (result.updated > 0) parts.push(`${result.updated} updated`);
      if (result.skipped > 0)
        parts.push(`${result.skipped} skipped (already exist)`);
      if (result.failed > 0) parts.push(`${result.failed} failed`);
      if (result.credentialsCreated > 0)
        parts.push(`${result.credentialsCreated} credentials`);
      const pendingCount = result.pendingKeyHosts
        ? result.pendingKeyHosts.reduce((n, p) => n + p.hostIds.length, 0)
        : 0;
      if (pendingCount > 0)
        parts.push(`${pendingCount} hosts awaiting keys`);

      const summary =
        parts.length > 0 ? parts.join(", ") : "nothing imported";
      if (result.success > 0 || result.updated > 0) {
        toast.success(`SSH config import: ${summary}`);
      } else {
        toast.message(`SSH config import: ${summary}`);
      }

      const allErrors = [
        ...(result.errors || []),
        ...(result.credentialErrors || []),
      ];
      if (allErrors.length > 0) {
        toast.error(`Issues: ${allErrors.slice(0, 5).join("; ")}`);
      }

      onCompleted();
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `Import failed: ${err.message}`
          : "Import failed",
      );
      setStep("keys");
    } finally {
      importInFlightRef.current = false;
    }
  };

  const keysProvided = Object.keys(keyContents).length;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import SSH Config</DialogTitle>
          <DialogDescription>
            Upload your local <code>~/.ssh/config</code> file and any
            referenced private key files. All hosts will be imported.
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Upload config file */}
        <div className="flex flex-col gap-3 py-2">
          <div className="flex items-center gap-3">
            <label className="flex-1">
              <input
                ref={configInputRef}
                type="file"
                accept="*"
                className="hidden"
                onChange={handleConfigFile}
              />
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                asChild
              >
                <span>
                  <FileText className="h-4 w-4" />
                  {configFileName
                    ? `Loaded: ${configFileName}`
                    : "Choose SSH config file"}
                </span>
              </Button>
            </label>
          </div>

          {configText && (
            <div className="text-xs text-muted-foreground">
              {(configText.match(/^Host\s+/gim) || []).length} Host entries
              found
            </div>
          )}
        </div>

        {/* Step 2: Upload key files */}
        {identityFiles.length > 0 && step !== "config" && (
          <>
            <div className="border-t border-edge my-1" />
            <div className="text-sm font-medium text-foreground mb-1">
              SSH Key Files ({keysProvided}/{identityFiles.length} provided)
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              Upload the private key files referenced in your config. Skip
              any you don't have — those hosts will be imported without key
              auth and you can add keys later.
            </p>
            <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto thin-scrollbar">
              {identityFiles.map((idFile) => {
                const hasKey = !!keyContents[idFile];
                return (
                  <div
                    key={idFile}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md border ${
                      hasKey
                        ? "border-emerald-500/40 bg-emerald-500/5"
                        : "border-edge bg-surface"
                    }`}
                  >
                    {hasKey ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                    ) : (
                      <KeyRound className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-mono truncate">
                        {idFile}
                      </div>
                      {keyFileNames[idFile] && (
                        <div className="text-[11px] text-emerald-500">
                          {keyFileNames[idFile]}
                        </div>
                      )}
                    </div>
                    <label className="flex-shrink-0">
                      <input
                        type="file"
                        accept="*"
                        className="hidden"
                        onChange={(e) => handleKeyFile(idFile, e)}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                        className="cursor-pointer"
                      >
                        <span>
                          <Upload className="h-3.5 w-3.5 mr-1" />
                          {hasKey ? "Replace" : "Upload"}
                        </span>
                      </Button>
                    </label>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Overwrite toggle */}
        {configText && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground pt-1">
            <Input
              type="checkbox"
              className="h-4 w-4 rounded"
              checked={overwrite}
              onChange={(e) =>
                setOverwrite((e.target as HTMLInputElement).checked)
              }
            />
            Update existing hosts (same IP/port/user) instead of skipping
          </label>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              reset();
            }}
            disabled={step === "importing"}
          >
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={!configText || step === "importing"}
          >
            {step === "importing"
              ? "Importing..."
              : `Import${
                  configText
                    ? ` ${(configText.match(/^Host\s+/gim) || []).length} hosts`
                    : ""
                }`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
