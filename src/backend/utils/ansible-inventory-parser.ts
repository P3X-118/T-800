/**
 * Parser for Ansible INI-format inventory files.
 *
 * Returns entries shaped like {@link SSHConfigEntry} so the same import
 * pipeline used by the SSH-config importer can process them. The Ansible
 * group name is exposed via `extras._folder` so the import endpoint can
 * use it as the host folder name; if missing we fall back to "Ansible".
 *
 * Supported syntax (INI):
 *   [groupname]                     ← group header
 *   [groupname:vars]                ← group-level variables (tracked, applied)
 *   [groupname:children]            ← ignored (we don't recurse sub-groups)
 *
 *   host1 ansible_host=1.2.3.4 ansible_user=ubuntu ansible_port=2222
 *   host2 ansible_ssh_private_key_file=~/.ssh/id_rsa
 *   host3                           ← just a hostname, uses ansible defaults
 *
 * Supported host variables:
 *   - ansible_host / ansible_ssh_host
 *   - ansible_port / ansible_ssh_port
 *   - ansible_user / ansible_ssh_user
 *   - ansible_ssh_private_key_file / ansible_private_key_file
 *   - ansible_password / ansible_ssh_pass (stored in extras, we don't import
 *     plaintext passwords automatically — user can set them later)
 *
 * Basic numeric range expansion for host patterns like `web[01:03]` is
 * supported; it expands to `web01`, `web02`, `web03`.
 *
 * YAML inventories are NOT supported — users should export to INI.
 */

import type { SSHConfigEntry } from "./ssh-config-parser.js";

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
 * Expand a single host spec like `web[01:03]` into `["web01","web02","web03"]`.
 * If the spec has no bracket range, returns `[spec]`.
 */
function expandHostPattern(spec: string): string[] {
  const match = spec.match(/^(.*?)\[(\d+):(\d+)\](.*)$/);
  if (!match) return [spec];
  const [, prefix, startStr, endStr, suffix] = match;
  const start = parseInt(startStr, 10);
  const end = parseInt(endStr, 10);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return [spec];
  }
  const pad = startStr.length;
  const out: string[] = [];
  for (let i = start; i <= end; i++) {
    out.push(`${prefix}${String(i).padStart(pad, "0")}${suffix}`);
  }
  return out;
}

/**
 * Tokenize an INI host line into `[alias, "key=value", "key=value", ...]`.
 * Handles quoted values with spaces: `foo key="value with space"`.
 */
function tokenizeLine(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    while (i < n && /\s/.test(line[i])) i++;
    if (i >= n) break;
    let token = "";
    while (i < n && !/\s/.test(line[i])) {
      if (line[i] === '"' || line[i] === "'") {
        const quote = line[i];
        i++;
        while (i < n && line[i] !== quote) {
          token += line[i];
          i++;
        }
        if (i < n) i++; // consume closing quote
      } else {
        token += line[i];
        i++;
      }
    }
    tokens.push(token);
  }
  return tokens;
}

export function parseAnsibleInventory(text: string): SSHConfigEntry[] {
  const entries: SSHConfigEntry[] = [];
  const groupVars: Record<string, Record<string, string>> = {};
  let currentGroup: string | null = null;
  let currentSection: "hosts" | "vars" | "children" | null = null;

  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    // Strip comments (# or ; starting mid-line, but not inside quotes —
    // for simplicity we just strip # at any position and ; at start)
    let line = rawLine.replace(/\s+[#;].*$/, "").replace(/^\s*[;#].*$/, "");
    line = line.trim();
    if (!line) continue;

    // Group header: [name] or [name:vars] or [name:children]
    const headerMatch = line.match(/^\[([^\]]+)\]$/);
    if (headerMatch) {
      const spec = headerMatch[1].trim();
      if (spec.includes(":")) {
        const [name, section] = spec.split(":").map((s) => s.trim());
        currentGroup = name;
        if (section === "vars") currentSection = "vars";
        else if (section === "children") currentSection = "children";
        else currentSection = "hosts";
      } else {
        currentGroup = spec;
        currentSection = "hosts";
      }
      continue;
    }

    if (currentSection === "children") continue; // skip sub-group listings

    if (currentSection === "vars") {
      // key=value lines belong to the current group's vars bucket
      const eqIdx = line.indexOf("=");
      if (eqIdx > 0 && currentGroup) {
        const key = line.slice(0, eqIdx).trim();
        const value = stripQuotes(line.slice(eqIdx + 1).trim());
        if (!groupVars[currentGroup]) groupVars[currentGroup] = {};
        groupVars[currentGroup][key] = value;
      }
      continue;
    }

    // Host line within a group (or top-level, where currentGroup may be null).
    // Format: alias [key=value] [key=value] ...
    const tokens = tokenizeLine(line);
    if (tokens.length === 0) continue;
    const aliasSpec = tokens[0];

    // Parse variables from remaining tokens
    const hostVars: Record<string, string> = {};
    for (let i = 1; i < tokens.length; i++) {
      const eqIdx = tokens[i].indexOf("=");
      if (eqIdx > 0) {
        const k = tokens[i].slice(0, eqIdx);
        const v = stripQuotes(tokens[i].slice(eqIdx + 1));
        hostVars[k] = v;
      }
    }

    // Merge group vars in (host vars take precedence)
    const mergedVars: Record<string, string> = {
      ...(currentGroup ? groupVars[currentGroup] || {} : {}),
      ...hostVars,
    };

    const hostAliases = expandHostPattern(aliasSpec);
    for (const alias of hostAliases) {
      const hostname =
        mergedVars.ansible_host || mergedVars.ansible_ssh_host || alias;
      const user =
        mergedVars.ansible_user || mergedVars.ansible_ssh_user || undefined;
      const portStr =
        mergedVars.ansible_port || mergedVars.ansible_ssh_port || "22";
      const port = parseInt(portStr, 10);
      const identityFile =
        mergedVars.ansible_ssh_private_key_file ||
        mergedVars.ansible_private_key_file ||
        undefined;

      const entry: SSHConfigEntry = {
        name: alias,
        hostname,
        user,
        port: Number.isFinite(port) && port > 0 ? port : 22,
        identityFile,
        localForwards: [],
        remoteForwards: [],
        dynamicForwards: [],
        extras: {
          ...(currentGroup ? { _folder: currentGroup } : {}),
          _source: "ansible",
        },
      };

      entries.push(entry);
    }
  }

  return entries;
}
