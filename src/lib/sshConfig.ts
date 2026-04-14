/**
 * Parser for OpenSSH ssh_config files.
 *
 * Reads a textual ssh_config and returns one entry per `Host` block.
 * Wildcard hosts (containing `*` or `?`) and `Match` blocks are ignored —
 * we only import concrete `Host alias` entries that have a `HostName`.
 *
 * The parser is intentionally permissive: unknown directives are kept on
 * the entry as raw key/value pairs in `extras` so callers can decide what
 * to do with them, but we don't fail the entire import if we encounter
 * something we don't recognise.
 */

export interface SSHConfigEntry {
  /** The `Host` alias — used as the friendly name when imported */
  name: string;
  /** Resolved `HostName` (IP or domain). Required for import. */
  hostname?: string;
  /** `User` directive */
  user?: string;
  /** `Port` (defaults to 22 when omitted) */
  port: number;
  /** First `IdentityFile` directive (rest are ignored) */
  identityFile?: string;
  /** `IdentityFilePassphrase` (rare but supported by some clients) */
  identityFilePassphrase?: string;
  /** `ProxyJump` — comma-separated list of host aliases */
  proxyJump?: string[];
  /** Any other directives we didn't explicitly handle */
  extras: Record<string, string>;
}

const KNOWN_KEYS = new Set([
  "host",
  "hostname",
  "user",
  "port",
  "identityfile",
  "identityfilepassphrase",
  "proxyjump",
  "match",
]);

/**
 * Parses an ssh_config file. Wildcard `Host` blocks (containing `*` or `?`)
 * and `Match` blocks are skipped — they don't represent importable hosts.
 *
 * Returns only entries that have a resolvable `HostName`.
 */
export function parseSSHConfig(text: string): SSHConfigEntry[] {
  const entries: SSHConfigEntry[] = [];
  let current: SSHConfigEntry | null = null;
  let skipping = false;

  const flush = () => {
    if (current && current.hostname) {
      entries.push(current);
    }
    current = null;
  };

  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    // Strip comments and trim
    const commentIdx = rawLine.indexOf("#");
    const line = (commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine).trim();
    if (!line) continue;

    // Split into directive + value. ssh_config allows `Key Value` or `Key=Value`.
    const eqIdx = line.indexOf("=");
    const spaceIdx = line.search(/\s/);
    let sepIdx = -1;
    if (eqIdx >= 0 && (spaceIdx < 0 || eqIdx < spaceIdx)) {
      sepIdx = eqIdx;
    } else {
      sepIdx = spaceIdx;
    }
    if (sepIdx < 0) continue;

    const key = line.slice(0, sepIdx).trim().toLowerCase();
    const value = line.slice(sepIdx + 1).trim();

    if (key === "match") {
      // Match blocks aren't importable as named hosts
      flush();
      skipping = true;
      continue;
    }

    if (key === "host") {
      flush();
      // A `Host` line can list multiple aliases. We skip wildcards and create
      // one entry per concrete alias (if multiple, the first wins for naming).
      const aliases = value
        .split(/\s+/)
        .filter((a) => a && !a.includes("*") && !a.includes("?"));
      if (aliases.length === 0) {
        // Pure-wildcard host (e.g. `Host *`) — apply nothing
        skipping = true;
        continue;
      }
      skipping = false;
      // We only model one entry; if the user has `Host a b c` we treat
      // it as a single named "a" import.
      current = {
        name: aliases[0],
        port: 22,
        extras: {},
      };
      continue;
    }

    if (skipping || !current) continue;

    switch (key) {
      case "hostname":
        current.hostname = value;
        break;
      case "user":
        current.user = value;
        break;
      case "port": {
        const parsed = parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed > 0 && parsed < 65536) {
          current.port = parsed;
        }
        break;
      }
      case "identityfile":
        if (!current.identityFile) current.identityFile = stripQuotes(value);
        break;
      case "identityfilepassphrase":
        current.identityFilePassphrase = stripQuotes(value);
        break;
      case "proxyjump":
        current.proxyJump = value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      default:
        if (!KNOWN_KEYS.has(key)) {
          current.extras[key] = value;
        }
        break;
    }
  }

  flush();
  return entries;
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

/**
 * Returns the unique set of identity files referenced across the parsed
 * entries. Used to drive the "upload your key files" step of the import
 * dialog.
 */
export function uniqueIdentityFiles(entries: SSHConfigEntry[]): string[] {
  const seen = new Set<string>();
  for (const e of entries) {
    if (e.identityFile) seen.add(e.identityFile);
  }
  return Array.from(seen);
}
