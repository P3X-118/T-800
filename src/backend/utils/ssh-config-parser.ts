import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Parser for OpenSSH ssh_config files (backend copy).
 *
 * Reads a textual ssh_config and returns one entry per `Host` block.
 * Wildcard hosts (containing `*` or `?`) and `Match` blocks are ignored —
 * we only import concrete `Host alias` entries that have a `HostName`.
 *
 * The parser now resolves `Include` directives (with tilde and glob
 * expansion) so hosts defined in included files are also returned.
 *
 * The parser is intentionally permissive: unknown directives are kept on
 * the entry as raw key/value pairs in `extras` so callers can decide what
 * to do with them, but we don't fail the entire import if we encounter
 * something we don't recognise.
 */

export interface LocalForwardEntry {
  bindAddress?: string;
  bindPort: number;
  targetHost: string;
  targetPort: number;
}

export interface RemoteForwardEntry {
  bindAddress?: string;
  bindPort: number;
  targetHost: string;
  targetPort: number;
}

export interface SSHConfigEntry {
  /** The `Host` alias — used as the friendly name when imported */
  name: string;
  /** Resolved `HostName` (IP or domain). Defaults to name if omitted. */
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
  /** `ProxyCommand` — raw command string */
  proxyCommand?: string;
  /** `LocalForward` entries */
  localForwards: LocalForwardEntry[];
  /** `RemoteForward` entries */
  remoteForwards: RemoteForwardEntry[];
  /** `DynamicForward` entries (SOCKS ports) */
  dynamicForwards: number[];
  /** `ForwardAgent yes/no` */
  forwardAgent?: boolean;
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
  "proxycommand",
  "localforward",
  "remoteforward",
  "dynamicforward",
  "forwardagent",
  "match",
  "include",
]);

/**
 * Resolve an `Include` directive value into absolute file paths.
 *
 * Handles:
 * - Tilde expansion (`~/…` → `$HOME/…`)
 * - Relative paths (relative to the user's `~/.ssh/`)
 * - Simple glob patterns (trailing `*` in the last path segment, e.g.
 *   `config.d/*` or `config.d/*.conf`)
 *
 * **Security:** Resolved paths must stay within the user's `~/.ssh/`
 * directory. Any `../`-based escapes or absolute paths outside `~/.ssh/`
 * are rejected to prevent path traversal attacks from a malicious
 * uploaded/parsed ssh_config.
 */
function resolveIncludePaths(raw: string): string[] {
  const homeDir = os.homedir();
  const sshRoot = path.resolve(path.join(homeDir, ".ssh"));

  // Enforce that a candidate path stays within the user's ~/.ssh/ root.
  const isInsideSshRoot = (candidate: string): boolean => {
    const resolved = path.resolve(candidate);
    const rel = path.relative(sshRoot, resolved);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  };

  let pattern = stripQuotes(raw);
  if (pattern.startsWith("~/") || pattern === "~") {
    pattern = path.join(homeDir, pattern.slice(1));
  } else if (!path.isAbsolute(pattern)) {
    pattern = path.join(homeDir, ".ssh", pattern);
  }

  const dir = path.dirname(pattern);
  const base = path.basename(pattern);

  // Reject the whole include if its directory isn't inside ~/.ssh/ —
  // blocks `Include ../../etc/passwd` and `Include /etc/shadow`.
  if (!isInsideSshRoot(dir)) return [];

  // No wildcard — return the literal path if it exists and is inside root.
  if (!base.includes("*") && !base.includes("?")) {
    if (!isInsideSshRoot(pattern)) return [];
    try {
      fs.accessSync(pattern, fs.constants.R_OK);
      return [pattern];
    } catch {
      return [];
    }
  }

  // Simple wildcard expansion: convert the basename pattern to a RegExp
  // and match against directory entries.
  try {
    const entries = fs.readdirSync(dir);
    const regexStr = base
      .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape special regex chars
      .replace(/\*/g, ".*") // * → .*
      .replace(/\?/g, "."); // ? → .
    const regex = new RegExp(`^${regexStr}$`);
    return entries
      .filter((e) => regex.test(e))
      .map((e) => path.join(dir, e))
      .filter((p) => isInsideSshRoot(p))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Parse an ssh_config text into entries.
 *
 * `alreadyIncluded` prevents infinite Include loops.
 */
function parseSSHConfigInternal(
  text: string,
  alreadyIncluded: Set<string>,
): SSHConfigEntry[] {
  const entries: SSHConfigEntry[] = [];
  let current: SSHConfigEntry | null = null;
  let skipping = false;

  const flush = () => {
    if (current) {
      if (!current.hostname) {
        current.hostname = current.name;
      }
      entries.push(current);
    }
    current = null;
  };

  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const commentIdx = rawLine.indexOf("#");
    const line = (
      commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine
    ).trim();
    if (!line) continue;

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

    // ── Include directive ────────────────────────────────────────────
    if (key === "include") {
      flush();
      skipping = false;
      const paths = resolveIncludePaths(value);
      for (const filePath of paths) {
        if (alreadyIncluded.has(filePath)) continue;
        alreadyIncluded.add(filePath);
        try {
          const included = fs.readFileSync(filePath, "utf8");
          entries.push(...parseSSHConfigInternal(included, alreadyIncluded));
        } catch {
          // silently skip unreadable included files
        }
      }
      continue;
    }

    if (key === "match") {
      flush();
      skipping = true;
      continue;
    }

    if (key === "host") {
      flush();
      const aliases = value
        .split(/\s+/)
        .filter((a) => a && !a.includes("*") && !a.includes("?"));
      if (aliases.length === 0) {
        skipping = true;
        continue;
      }
      skipping = false;
      current = {
        name: aliases[0],
        port: 22,
        localForwards: [],
        remoteForwards: [],
        dynamicForwards: [],
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
      case "proxycommand":
        current.proxyCommand = value;
        break;
      case "localforward": {
        const lf = parseForwardDirective(value);
        if (lf) current.localForwards.push(lf);
        break;
      }
      case "remoteforward": {
        const rf = parseForwardDirective(value);
        if (rf) current.remoteForwards.push(rf);
        break;
      }
      case "dynamicforward": {
        const dynParts = value.split(":");
        const dynPort = parseInt(dynParts[dynParts.length - 1], 10);
        if (Number.isFinite(dynPort) && dynPort > 0) {
          current.dynamicForwards.push(dynPort);
        }
        break;
      }
      case "forwardagent":
        current.forwardAgent = value.toLowerCase() === "yes";
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

export function parseSSHConfig(text: string): SSHConfigEntry[] {
  return parseSSHConfigInternal(text, new Set<string>());
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
 * Parse a LocalForward or RemoteForward directive value.
 * Formats:
 *   LocalForward 8080 localhost:80
 *   LocalForward 127.0.0.1:8080 localhost:80
 *   LocalForward [::1]:8080 localhost:80
 */
function parseForwardDirective(value: string): LocalForwardEntry | null {
  const parts = value.split(/\s+/);
  if (parts.length < 2) return null;

  const parseBind = (s: string): { address?: string; port: number } | null => {
    // [::1]:port
    const bracketMatch = s.match(/^\[(.+)\]:(\d+)$/);
    if (bracketMatch) {
      return { address: bracketMatch[1], port: parseInt(bracketMatch[2], 10) };
    }
    // address:port
    const colonIdx = s.lastIndexOf(":");
    if (colonIdx > 0) {
      return {
        address: s.slice(0, colonIdx),
        port: parseInt(s.slice(colonIdx + 1), 10),
      };
    }
    // port only
    const port = parseInt(s, 10);
    if (Number.isFinite(port)) return { port };
    return null;
  };

  const bind = parseBind(parts[0]);
  const target = parseBind(parts[1]);
  if (!bind || !target) return null;

  return {
    bindAddress: bind.address,
    bindPort: bind.port,
    targetHost: target.address || "localhost",
    targetPort: target.port,
  };
}
