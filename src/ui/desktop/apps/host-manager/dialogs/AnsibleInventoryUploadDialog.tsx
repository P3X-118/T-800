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
  importAnsibleInventoryFromUpload,
  batchVerifyHosts,
  getSSHHosts,
} from "@/ui/main-axios";

interface AnsibleInventoryUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
}

/**
 * Parse an uploaded Ansible INI inventory to extract unique
 * `ansible_ssh_private_key_file` / `ansible_private_key_file` paths. This
 * is a lightweight client-side preview so we can show the user which
 * private keys they need to provide.
 */
function extractKeyFiles(inventoryText: string): string[] {
  const files = new Set<string>();
  for (const rawLine of inventoryText.split(/\r?\n/)) {
    // Skip comments and section headers
    const line = rawLine
      .replace(/\s+[#;].*$/, "")
      .replace(/^\s*[;#].*$/, "")
      .trim();
    if (!line || line.startsWith("[")) continue;

    // Look for the key file variable anywhere on the line
    const matches = line.matchAll(
      /ansible_(?:ssh_)?private_key_file\s*=\s*("[^"]+"|'[^']+'|\S+)/g,
    );
    for (const m of matches) {
      let val = m[1];
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

/**
 * Count unique host aliases in the inventory for the Import button label.
 * Mirrors the backend parser closely enough for a live preview: a host line
 * is the first non-comment token in a section that isn't `:vars`/`:children`.
 */
function countHosts(inventoryText: string): number {
  let currentSection: "hosts" | "vars" | "children" | null = null;
  let count = 0;
  for (const rawLine of inventoryText.split(/\r?\n/)) {
    const line = rawLine
      .replace(/\s+[#;].*$/, "")
      .replace(/^\s*[;#].*$/, "")
      .trim();
    if (!line) continue;

    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      const spec = header[1];
      if (spec.endsWith(":vars")) currentSection = "vars";
      else if (spec.endsWith(":children")) currentSection = "children";
      else currentSection = "hosts";
      continue;
    }

    if (currentSection === "vars" || currentSection === "children") continue;
    // Match the first token (the host alias)
    const match = line.match(/^(\S+)/);
    if (match) {
      // Expand simple `foo[01:03]` numeric ranges for the count
      const rangeMatch = match[1].match(/^.*?\[(\d+):(\d+)\].*$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        if (
          Number.isFinite(start) &&
          Number.isFinite(end) &&
          end >= start
        ) {
          count += end - start + 1;
          continue;
        }
      }
      count++;
    }
  }
  return count;
}

export function AnsibleInventoryUploadDialog({
  open,
  onOpenChange,
  onCompleted,
}: AnsibleInventoryUploadDialogProps) {
  const [step, setStep] = useState<"config" | "keys" | "importing">("config");
  const [inventoryText, setInventoryText] = useState("");
  const [inventoryFileName, setInventoryFileName] = useState<string | null>(
    null,
  );
  const [identityFiles, setIdentityFiles] = useState<string[]>([]);
  const [keyContents, setKeyContents] = useState<Record<string, string>>({});
  const [keyFileNames, setKeyFileNames] = useState<Record<string, string>>({});
  const [overwrite, setOverwrite] = useState(false);
  const [skipMissingKeys, setSkipMissingKeys] = useState(false);
  const [configDragOver, setConfigDragOver] = useState(false);
  const [keyDragOver, setKeyDragOver] = useState<string | null>(null);
  const inventoryInputRef = useRef<HTMLInputElement | null>(null);
  const keyFolderInputRef = useRef<HTMLInputElement | null>(null);
  const keyMultiInputRef = useRef<HTMLInputElement | null>(null);
  const importInFlightRef = useRef(false);

  const reset = () => {
    setStep("config");
    setInventoryText("");
    setInventoryFileName(null);
    setIdentityFiles([]);
    setKeyContents({});
    setKeyFileNames({});
    setOverwrite(false);
    setSkipMissingKeys(false);
  };

  const loadConfigFromFile = async (file: File) => {
    try {
      const text = await file.text();
      setInventoryText(text);
      setInventoryFileName(file.name);
      const ids = extractKeyFiles(text);
      setIdentityFiles(ids);
      if (ids.length > 0) setStep("keys");
      const hc = countHosts(text);
      toast.success(
        `Loaded ${file.name}: ${hc} host entries, ${ids.length} unique key files referenced`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to read inventory file",
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
    if (!inventoryText) {
      toast.error("No inventory loaded");
      return;
    }
    if (importInFlightRef.current) return;
    importInFlightRef.current = true;
    setStep("importing");
    try {
      const result = await importAnsibleInventoryFromUpload(
        inventoryText,
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
      if (pendingCount > 0) parts.push(`${pendingCount} hosts awaiting keys`);

      const summary =
        parts.length > 0 ? parts.join(", ") : "nothing imported";
      if (result.success > 0 || result.updated > 0) {
        toast.success(`Ansible inventory: ${summary}`);
      } else {
        toast.message(`Ansible inventory: ${summary}`);
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
        // Non-fatal
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
  const hostCount = inventoryText ? countHosts(inventoryText) : 0;

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
          <DialogTitle>Import Ansible Inventory</DialogTitle>
          <DialogDescription>
            Upload your local Ansible <code>hosts</code> (INI format)
            inventory file and any referenced private key files. Each
            Ansible group becomes a folder; YAML inventories are not
            supported.
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Upload inventory file (click or drag-and-drop) */}
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
                ref={inventoryInputRef}
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
                  {inventoryFileName
                    ? `Loaded: ${inventoryFileName}`
                    : "Drop or choose Ansible inventory file"}
                </span>
              </Button>
            </label>
          </div>

          {inventoryText && (
            <div className="text-xs text-muted-foreground">
              {hostCount} host entries found
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
              Select your key folder to auto-match all referenced keys, or
              upload them individually below.
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
            disabled={!inventoryText || step === "importing"}
          >
            {step === "importing"
              ? "Importing..."
              : `Import${inventoryText ? ` ${hostCount} hosts` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
