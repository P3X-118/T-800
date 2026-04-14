import React, { useState } from "react";
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
import { KeyRound, Upload } from "lucide-react";
import {
  provideSSHConfigKeys,
  type PendingKeyHost,
} from "@/ui/main-axios";

interface MissingKeysDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingKeyHosts: PendingKeyHost[];
  onCompleted: () => void;
}

interface KeyFormState {
  contents: string;
  passphrase: string;
  filename?: string;
}

/**
 * Shown after `importSSHConfigFromDisk` returns hosts whose IdentityFile
 * couldn't be read. The user supplies the key contents (paste or upload
 * a file) and we hand them off to the provide-keys endpoint, which
 * creates a credential and updates the affected hosts.
 */
export function SSHConfigMissingKeysDialog({
  open,
  onOpenChange,
  pendingKeyHosts,
  onCompleted,
}: MissingKeysDialogProps) {
  const [forms, setForms] = useState<Record<string, KeyFormState>>({});
  const [submitting, setSubmitting] = useState(false);

  const pairKey = (p: PendingKeyHost) => `${p.user}::${p.identityFile}`;

  const updateForm = (key: string, patch: Partial<KeyFormState>) => {
    setForms((prev) => ({
      ...prev,
      [key]: {
        contents: prev[key]?.contents ?? "",
        passphrase: prev[key]?.passphrase ?? "",
        filename: prev[key]?.filename,
        ...patch,
      },
    }));
  };

  const handleFile = async (
    key: string,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      if (!text.includes("-----BEGIN")) {
        toast.error(
          `${file.name} doesn't look like a PEM private key — won't load.`,
        );
        return;
      }
      updateForm(key, { contents: text, filename: file.name });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to read key file",
      );
    }
  };

  const handleSubmit = async () => {
    const payload: Array<{
      identityFile: string;
      user: string;
      contents: string;
      passphrase?: string;
      hostIds: number[];
    }> = [];

    for (const p of pendingKeyHosts) {
      const key = pairKey(p);
      const form = forms[key];
      if (!form || !form.contents.trim()) continue;
      payload.push({
        identityFile: p.identityFile,
        user: p.user,
        contents: form.contents,
        passphrase: form.passphrase || undefined,
        hostIds: p.hostIds,
      });
    }

    if (payload.length === 0) {
      onOpenChange(false);
      return;
    }

    setSubmitting(true);
    try {
      const result = await provideSSHConfigKeys(payload);
      const parts: string[] = [];
      if (result.credentialsCreated > 0)
        parts.push(`${result.credentialsCreated} credentials`);
      if (result.hostsUpdated > 0)
        parts.push(`${result.hostsUpdated} hosts updated`);
      toast.success(
        parts.length > 0 ? `Keys applied: ${parts.join(", ")}` : "Keys applied",
      );
      if (result.errors && result.errors.length > 0) {
        toast.error(`Issues: ${result.errors.slice(0, 3).join("; ")}`);
      }
      onCompleted();
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to apply keys",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Provide missing SSH keys</DialogTitle>
          <DialogDescription>
            The following hosts were imported but the backend couldn't read
            their IdentityFile. Paste the key contents or upload the file
            for each one — we'll create a credential and link it to the
            affected hosts. Skip any you don't want to fix right now.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {pendingKeyHosts.map((p) => {
            const key = pairKey(p);
            const form = forms[key] || { contents: "", passphrase: "" };
            return (
              <div
                key={key}
                className="border border-edge rounded p-3 bg-surface flex flex-col gap-2"
              >
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-mono truncate">
                      {p.identityFile}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      User: <strong>{p.user}</strong> · Hosts:{" "}
                      {p.hostNames.join(", ")}
                    </div>
                  </div>
                  <label className="flex-shrink-0">
                    <input
                      type="file"
                      accept="*"
                      className="hidden"
                      onChange={(e) => handleFile(key, e)}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                      className="cursor-pointer"
                    >
                      <span>
                        <Upload className="h-3.5 w-3.5 mr-1" />
                        {form.filename ? "Replace" : "Upload"}
                      </span>
                    </Button>
                  </label>
                </div>
                <textarea
                  className="w-full min-h-[80px] max-h-[200px] text-[11px] font-mono bg-background border border-edge rounded p-2 resize-y"
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----…"
                  value={form.contents}
                  onChange={(e) =>
                    updateForm(key, { contents: e.target.value })
                  }
                />
                <Input
                  type="password"
                  placeholder="Passphrase (optional)"
                  value={form.passphrase}
                  onChange={(e) =>
                    updateForm(key, { passphrase: e.target.value })
                  }
                  className="h-8 text-[12px]"
                />
                {form.filename && (
                  <div className="text-[11px] text-emerald-500">
                    Loaded: {form.filename}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Skip
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Applying…" : "Apply keys"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
