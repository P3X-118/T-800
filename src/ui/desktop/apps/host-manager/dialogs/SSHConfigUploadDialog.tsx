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
import {
  importSSHConfigFromUpload,
  batchVerifyHosts,
  getSSHHosts,
} from "@/ui/main-axios";

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
  const [skipMissingKeys, setSkipMissingKeys] = useState(false);
  const [configDragOver, setConfigDragOver] = useState(false);
  const [keyDragOver, setKeyDragOver] = useState<string | null>(null);
  const configInputRef = useRef<HTMLInputElement | null>(null);
  const keyFolderInputRef = useRef<HTMLInputElement | null>(null);
  const keyMultiInputRef = useRef<HTMLInputElement | null>(null);
  const importInFlightRef = useRef(false);

  const reset = () => {
    setStep("config");
    setConfigText("");
    setConfigFileName(null);
    setIdentityFiles([]);
    setKeyContents({});
    setKeyFileNames({});
    setOverwrite(false);
    setSkipMissingKeys(false);
  };

  const loadConfigFromFile = async (file: File) => {
    try {
      const text = await file.text();
      setConfigText(text);
      setConfigFileName(file.name);
      const ids = extractIdentityFiles(text);
      setIdentityFiles(ids);
      if (ids.length > 0) {
        setStep("keys");
      }
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

  const handleConfigFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await loadConfigFromFile(file);
  };

  const loadKeyFromFile = async (identityFile: string, file: File) => {
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

  const handleKeyFile = async (
    identityFile: string,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await loadKeyFromFile(identityFile, file);
  };

  const matchAndLoadKeyFiles = async (files: FileList | File[]) => {
    const basenameToIdFile = new Map<string, string>();
    for (const idFile of identityFiles) {
      const parts = idFile.split("/");
      const base = parts[parts.length - 1];
      if (base && !basenameToIdFile.has(base)) {
        basenameToIdFile.set(base, idFile);
      }
    }

    let matched = 0;
    for (const file of Array.from(files)) {
      const idFile = basenameToIdFile.get(file.name);
      if (idFile && !keyContents[idFile]) {
        await loadKeyFromFile(idFile, file);
        matched++;
      }
    }

    if (matched > 0) {
      toast.success(`Auto-matched ${matched} key file${matched > 1 ? "s" : ""}`);
    } else {
      toast.message("No matching key files found");
    }
  };

  const handleKeyFolder = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = e.target.files;
    e.target.value = "";
    if (!files || files.length === 0) return;
    await matchAndLoadKeyFiles(files);
  };

  const handleKeyMultiSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = e.target.files;
    e.target.value = "";
    if (!files || files.length === 0) return;
    await matchAndLoadKeyFiles(files);
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
        skipMissingKeys,
      );

      const parts: string[] = [];
      if (result.success > 0) parts.push(`${result.success} created`);
      if (result.updated > 0) parts.push(`${result.updated} updated`);
      if (result.skipped > 0)
        parts.push(`${result.skipped} skipped (already exist)`);
      if (result.skippedMissingKeys > 0)
        parts.push(`${result.skippedMissingKeys} skipped (no key provided)`);
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

      // Auto-verify host keys for all imported hosts so the user
      // doesn't have to accept each one manually on first connect.
      // If the backend returned specific IDs, use those; otherwise
      // fetch all hosts and verify everything.
      try {
        let idsToVerify = result.importedHostIds ?? [];
        if (idsToVerify.length === 0) {
          const allHosts = await getSSHHosts();
          idsToVerify = allHosts.map((h) => h.id);
        }
        if (idsToVerify.length > 0) {
          toast.message(
            `Verifying ${idsToVerify.length} host keys...`,
          );
          const verify = await batchVerifyHosts(idsToVerify);
          const s = verify.summary;
          toast.success(
            `Verified: ${s.success} ok, ${s.authFailed} auth failed, ${s.unreachable + s.timeout} unreachable`,
          );
        }
      } catch {
        // Non-fatal — hosts are imported, verification can be retried
      }
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

        {/* Step 1: Upload config file (click or drag-and-drop) */}
        <div
          className={`flex flex-col gap-3 py-2 px-3 rounded-lg border-2 border-dashed transition-colors ${
            configDragOver
              ? "border-blue-500 bg-blue-500/10"
              : "border-transparent"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setConfigDragOver(true);
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setConfigDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setConfigDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setConfigDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) loadConfigFromFile(file);
          }}
        >
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
                    : "Drop or choose SSH config file"}
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
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm font-medium text-foreground">
                SSH Key Files ({keysProvided}/{identityFiles.length} provided)
              </div>
              <div className="flex gap-1">
                <label>
                  <input
                    ref={keyMultiInputRef}
                    type="file"
                    multiple
                    accept="*"
                    className="hidden"
                    onChange={handleKeyMultiSelect}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    className="cursor-pointer"
                  >
                    <span>
                      <KeyRound className="h-3.5 w-3.5 mr-1" />
                      Select Keys
                    </span>
                  </Button>
                </label>
                <label>
                  <input
                    ref={keyFolderInputRef}
                    type="file"
                    className="hidden"
                    {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
                    onChange={handleKeyFolder}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    className="cursor-pointer"
                  >
                    <span>
                      <Upload className="h-3.5 w-3.5 mr-1" />
                      Select Folder
                    </span>
                  </Button>
                </label>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              Select your <code>~/.ssh</code> folder to auto-match all
              referenced keys, or upload them individually below.
            </p>
            <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto thin-scrollbar">
              {identityFiles.map((idFile) => {
                const hasKey = !!keyContents[idFile];
                const isDragTarget = keyDragOver === idFile;
                return (
                  <div
                    key={idFile}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md border transition-colors ${
                      isDragTarget
                        ? "border-blue-500 bg-blue-500/10"
                        : hasKey
                          ? "border-emerald-500/40 bg-emerald-500/5"
                          : "border-edge bg-surface"
                    }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setKeyDragOver(idFile);
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setKeyDragOver(idFile);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (keyDragOver === idFile) setKeyDragOver(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setKeyDragOver(null);
                      const file = e.dataTransfer.files?.[0];
                      if (file) loadKeyFromFile(idFile, file);
                    }}
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

        {/* Missing keys warning + skip toggle */}
        {identityFiles.length > 0 &&
          keysProvided < identityFiles.length &&
          step !== "config" && (
            <div className="flex flex-col gap-1.5 pt-1">
              <div className="text-xs text-yellow-500">
                {identityFiles.length - keysProvided} key
                {identityFiles.length - keysProvided > 1 ? "s" : ""} not
                provided — those hosts will import without key auth.
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Input
                  type="checkbox"
                  className="h-4 w-4 rounded"
                  checked={skipMissingKeys}
                  onChange={(e) =>
                    setSkipMissingKeys(
                      (e.target as HTMLInputElement).checked,
                    )
                  }
                />
                Skip hosts without a provided key
              </label>
            </div>
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
