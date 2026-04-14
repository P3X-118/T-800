import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { KeyRound, Trash2, Plus, Loader2, Shield } from "lucide-react";
const lazyStartRegistration = () =>
  import("@simplewebauthn/browser").then((m) => m.startRegistration);
import {
  getWebAuthnRegistrationOptions,
  verifyWebAuthnRegistration,
  getWebAuthnCredentials,
  deleteWebAuthnCredential,
  type WebAuthnCredential,
} from "@/ui/main-axios";

export function WebAuthnSetup() {
  const [credentials, setCredentials] = useState<WebAuthnCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [keyName, setKeyName] = useState("");

  const fetchCredentials = async () => {
    try {
      setLoading(true);
      const creds = await getWebAuthnCredentials();
      setCredentials(creds);
    } catch {
      // silently fail — endpoint may not exist on older builds
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCredentials();
  }, []);

  const handleRegister = async () => {
    setRegistering(true);
    try {
      const options = await getWebAuthnRegistrationOptions();

      const startReg = await lazyStartRegistration();
      const attestation = await startReg({
        optionsJSON: options as any,
      });

      const result = await verifyWebAuthnRegistration({
        ...attestation,
        name: keyName.trim() || undefined,
      });

      if (result.verified) {
        toast.success("Security key registered successfully");
        setKeyName("");
        await fetchCredentials();
      } else {
        toast.error("Registration failed — key was not verified");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Registration failed";
      if (msg.includes("cancelled") || msg.includes("AbortError")) {
        toast.message("Registration cancelled");
      } else {
        toast.error(`Registration failed: ${msg}`);
      }
    } finally {
      setRegistering(false);
    }
  };

  const handleDelete = async (cred: WebAuthnCredential) => {
    try {
      await deleteWebAuthnCredential(cred.id);
      toast.success(`Removed "${cred.name}"`);
      await fetchCredentials();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to remove key",
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Security Keys (WebAuthn)</h3>
      </div>
      <p className="text-[13px] text-muted-foreground">
        Register a hardware security key (YubiKey, Titan, etc.) for
        two-factor authentication. After registration, you can tap your key
        during login instead of entering a TOTP code.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading keys...
        </div>
      ) : (
        <>
          {credentials.length > 0 && (
            <div className="space-y-2">
              {credentials.map((cred) => (
                <div
                  key={cred.id}
                  className="flex items-center gap-3 border border-edge rounded p-3 bg-surface"
                >
                  <KeyRound className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate">
                      {cred.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Added{" "}
                      {new Date(cred.createdAt).toLocaleDateString()}
                      {cred.lastUsedAt &&
                        ` · Last used ${new Date(cred.lastUsedAt).toLocaleDateString()}`}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-red-400 hover:text-red-300"
                    onClick={() => handleDelete(cred)}
                    title="Remove key"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Input
              placeholder="Key name (e.g. YubiKey 5)"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              className="h-8 text-[13px] max-w-[250px]"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !registering) handleRegister();
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleRegister}
              disabled={registering}
            >
              {registering ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Plus className="h-3.5 w-3.5 mr-1" />
              )}
              {registering ? "Waiting for key..." : "Register Key"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
