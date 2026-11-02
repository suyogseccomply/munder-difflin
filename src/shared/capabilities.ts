/**
 * The Capabilities marketplace: parsing the public list, turning a reviewed entry
 * into an MCP server launch spec, and working out which servers an agent gets.
 * Dependency-free so main, renderer and tests all share one set of rules.
 *
 * SECURITY MODEL: the list is remote input, and a server spec is a program this
 * app starts inside an agent holding the user's keys. So:
 *   - only a list that passes signature verification can enable anything;
 *   - only entries the list marks as reviewed can be enabled;
 *   - a spec is one allowlisted launcher and flat, shell-free arguments;
 *   - nothing is ever enabled by loading the list; the user turns on each server.
 */
import { MCP_CATALOG, type McpTier } from './mcpCatalog';

export const CAPABILITY_KINDS = [
  'mcp-server', 'skill', 'skill-pack', 'plugin', 'subagent-set', 'hook-pack', 'status-line', 'tool', 'agent', 'app'
] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];
export type CapabilityDoor = 'none' | 'command' | 'skill-folder' | 'mcp-local';

export interface CapabilityEntry {
  id: string;
  name: string;
  kind: CapabilityKind;
  purposes: string[];
  maker: string;
  tier: string;
  source: string;
  what: string;
  /** True when the list says a maintainer reviewed this entry (wave 1 or 2). */
  reviewed: boolean;
  worksWith: string[];
  licence?: string;
  secretNames: string[];
  signIn: 'none' | 'key' | 'oauth';
  can?: { reads: boolean; writes: boolean; sends: boolean; spends: boolean; deletes: boolean };
  riskNote?: string;
  door: CapabilityDoor;
  /** skill-folder only: the GitHub folder to copy. */
  url?: string;
  /** command only: argv arrays shown for the user to run themselves. */
  steps: { argv: string[]; label: string }[];
  manual: string[];
}

export interface CapabilityList {
  entries: CapabilityEntry[];
  purposes: { id: string; label: string }[];
}

export interface McpServerSpec {
  command: string;
  args: string[];
}

/** A server the user added from the list, stored in config. */
export interface CapabilityServer extends McpServerSpec {
  label: string;
  /** Environment variables it reads. Names only, never values. */
  secretNames: string[];
}

export type AgentMcpGrants = { [serverId: string]: boolean };

const MAX_ENTRIES = 10_000;
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{0,80}$/;
/** Launchers only. Each fetches a named package, so no local path is reachable. */
const SPEC_COMMANDS: ReadonlySet<string> = new Set(['npx', 'uvx']);
/** No whitespace or shell metacharacters. A Windows `.cmd` launcher runs through
 *  cmd.exe, so `&`, `|`, `%`, `^`, `<`, `>`, quotes and `!` must never get through. */
const SPEC_ARG_RE = /^[A-Za-z0-9@._:/=+,~-]{1,200}$/;

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
const strings = (v: unknown, maxItems: number, maxLen: number): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, maxItems).map((x) => x.trim().slice(0, maxLen))
    : [];

function parseEntry(raw: unknown): CapabilityEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id, 81);
  const name = str(o.name, 120);
  const kind = o.kind as CapabilityKind;
  const source = str(o.source, 400);
  if (!id || !ID_RE.test(id) || !name || !source || !CAPABILITY_KINDS.includes(kind)) return null;
  if (!/^https:\/\//i.test(source)) return null;

  const install = (typeof o.install === 'object' && o.install !== null ? o.install : {}) as Record<string, unknown>;
  const reviewed = o.wave === 1 || o.wave === 2;
  // An unreviewed entry never carries install actions, whatever it claims.
  const door: CapabilityDoor = reviewed && ['command', 'skill-folder', 'mcp-local'].includes(install.door as string)
    ? (install.door as CapabilityDoor)
    : 'none';
  const url = door === 'skill-folder' ? str(install.url, 400) : undefined;
  const steps = door === 'command' && Array.isArray(install.steps)
    ? install.steps.slice(0, 4).flatMap((s) => {
        const step = (typeof s === 'object' && s !== null ? s : {}) as Record<string, unknown>;
        const argv = strings(step.argv, 40, 400);
        return argv.length ? [{ argv, label: str(step.label, 200) ?? '' }] : [];
      })
    : [];

  const signInRaw = (typeof o.signIn === 'object' && o.signIn !== null ? o.signIn : {}) as Record<string, unknown>;
  const signIn = signInRaw.kind === 'key' || signInRaw.kind === 'oauth' ? signInRaw.kind : 'none';
  const canRaw = o.can as Record<string, unknown> | undefined;

  return {
    id,
    name,
    kind,
    source,
    purposes: strings(o.purposes, 12, 40),
    maker: str(o.maker, 120) ?? 'Unknown',
    tier: str(o.tier, 40) ?? 'community',
    what: str(o.what, 600) ?? '',
    reviewed,
    worksWith: strings(o.worksWith, 24, 40),
    licence: str(o.licence, 60),
    signIn,
    secretNames: strings(signInRaw.secretNames, 12, 81).filter((n) => ENV_NAME_RE.test(n)),
    can: typeof canRaw === 'object' && canRaw !== null
      ? { reads: !!canRaw.reads, writes: !!canRaw.writes, sends: !!canRaw.sends, spends: !!canRaw.spends, deletes: !!canRaw.deletes }
      : undefined,
    riskNote: str(o.riskNote, 400),
    door,
    url,
    steps,
    manual: strings(install.manual, 12, 500)
  };
}

/** Parse the catalog text. A malformed entry is dropped, never guessed at. */
export function parseCapabilityList(text: string): CapabilityList | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.entries)) return null;
  const seen = new Set<string>();
  const entries: CapabilityEntry[] = [];
  for (const item of o.entries.slice(0, MAX_ENTRIES)) {
    const entry = parseEntry(item);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  const purposes = Array.isArray(o.purposes)
    ? o.purposes.flatMap((p) => {
        const q = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>;
        const id = str(q.id, 40);
        const label = str(q.label, 80);
        return id && label ? [{ id, label }] : [];
      })
    : [];
  return entries.length ? { entries, purposes } : null;
}

export function isSafeServerSpec(spec: unknown): spec is McpServerSpec {
  if (typeof spec !== 'object' || spec === null) return false;
  const { command, args } = spec as Record<string, unknown>;
  return typeof command === 'string' && SPEC_COMMANDS.has(command)
    && Array.isArray(args) && args.length > 0 && args.length <= 24
    && args.every((a) => typeof a === 'string' && SPEC_ARG_RE.test(a));
}

/** Everything after a `--` separator in a `claude mcp add` command is the server's
 *  launch command, for both a step's argv and a written-out manual line. */
function specFromTokens(tokens: string[]): McpServerSpec | null {
  const dash = tokens.indexOf('--');
  if (dash < 0 || tokens[0] !== 'claude' || tokens[1] !== 'mcp' || tokens[2] !== 'add') return null;
  const [command, ...args] = tokens.slice(dash + 1);
  const spec = { command, args };
  return isSafeServerSpec(spec) ? spec : null;
}

/** The stdio launch spec of a reviewed MCP entry, or null if it has none this app
 *  can start safely. Hosted (http) servers have none, as nothing is launched. */
export function serverSpecFromEntry(entry: CapabilityEntry): McpServerSpec | null {
  if (entry.kind !== 'mcp-server' || !entry.reviewed) return null;
  for (const step of entry.steps) {
    const spec = specFromTokens(step.argv);
    if (spec) return spec;
  }
  for (const line of entry.manual) {
    const written = /the command (\S+) and the arguments (.+?)\.?$/.exec(line);
    if (written) {
      const spec = { command: written[1], args: written[2].trim().split(/\s+/) };
      if (isSafeServerSpec(spec)) return spec;
    }
    const added = /\bclaude mcp add\b.*$/.exec(line);
    if (added) {
      const spec = specFromTokens(added[0].replace(/\.$/, '').trim().split(/\s+/));
      if (spec) return spec;
    }
  }
  return null;
}

/** Whether this agent gets this bundled server: its own grant wins, then the floor
 *  default. A write or secret server still needs an explicit yes from one of them. */
export function bundledServerEnabled(
  id: string,
  tier: McpTier,
  defaultEnabled: boolean,
  floor: { [id: string]: { enabled: boolean } } | undefined,
  grants: AgentMcpGrants | undefined
): boolean {
  const grant = grants?.[id];
  if (grant !== undefined) return grant;
  const consented = floor?.[id]?.enabled;
  if (tier !== 'safe-readonly' && consented !== true) return false;
  return consented ?? defaultEnabled;
}

export interface ResolvedMcp {
  servers: Record<string, { command: string; args: string[] }>;
  /** Env var names the enabled servers read. Values go in the agent's process env,
   *  which stdio servers inherit, so no key is written to settings.json. */
  secretNames: string[];
}

/** The MCP servers one agent gets. Servers added from the list are off until
 *  granted to that agent, and specs are re-checked here as config is hand-editable. */
export function resolveAgentMcp(
  cwd: string,
  floor: { [id: string]: { enabled: boolean } } | undefined,
  grants: AgentMcpGrants | undefined,
  listServers: { [id: string]: CapabilityServer } | undefined
): ResolvedMcp {
  const servers: ResolvedMcp['servers'] = {};
  const secretNames = new Set<string>();
  for (const e of MCP_CATALOG) {
    if (!bundledServerEnabled(e.id, e.tier, e.defaultEnabled, floor, grants)) continue;
    servers[`munder-${e.id}`] = {
      command: e.spec.command,
      args: e.spec.args.map((a) => (a === '<cwd>' ? cwd : a))
    };
    for (const name of Object.keys(e.spec.env ?? {})) secretNames.add(name);
  }
  for (const [id, server] of Object.entries(listServers ?? {})) {
    if (grants?.[id] !== true || !ID_RE.test(id) || !isSafeServerSpec(server)) continue;
    servers[`munder-list-${id}`] = { command: server.command, args: [...server.args] };
    for (const name of server.secretNames ?? []) if (ENV_NAME_RE.test(name)) secretNames.add(name);
  }
  return { servers, secretNames: [...secretNames] };
}

/** Name of the encrypted-store slot for one environment variable. */
export const capabilityKeyRef = (name: string): string => `capability-key:${name}`;
export const isValidKeyName = (name: unknown): name is string => typeof name === 'string' && ENV_NAME_RE.test(name);

// ─── Role bundles ───────────────────────────────────────────────────────────

export interface RoleBundle {
  id: string;
  name: string;
  description: string;
  /** Bundled MCP catalog ids. */
  servers: string[];
}

export const ROLE_BUNDLES: readonly RoleBundle[] = [
  { id: 'frontend', name: 'Frontend', description: 'Current library docs and web fetching for interface work.', servers: ['context7', 'fetch', 'filesystem', 'git'] },
  { id: 'backend', name: 'Backend', description: 'Docs, repository access and a database connection.', servers: ['context7', 'filesystem', 'git', 'db'] },
  { id: 'reviewer', name: 'Code reviewer', description: 'Read the repository and pull requests, with room to reason.', servers: ['sequential-thinking', 'git', 'filesystem', 'github-token'] },
  { id: 'tester', name: 'Tester', description: 'Project files and history, plus docs for test tools.', servers: ['context7', 'filesystem', 'git'] },
  { id: 'devops', name: 'DevOps', description: 'Repository and GitHub access for pipelines.', servers: ['git', 'filesystem', 'github-token', 'fetch'] },
  { id: 'security', name: 'Security', description: 'Read code and history, fetch advisories, reason through findings.', servers: ['sequential-thinking', 'fetch', 'git', 'filesystem'] },
  { id: 'data', name: 'Data', description: 'Database access with project files.', servers: ['db', 'filesystem', 'sequential-thinking'] },
  { id: 'writer', name: 'Writer', description: 'Project files, web fetching and live search.', servers: ['filesystem', 'fetch', 'search-with-key'] },
  { id: 'researcher', name: 'Researcher', description: 'Web fetching and search, with room to reason.', servers: ['fetch', 'search-with-key', 'sequential-thinking', 'time'] },
  { id: 'assistant', name: 'Assistant', description: 'Mail and calendar, with the current time.', servers: ['email-calendar', 'time', 'fetch'] },
  { id: 'minimal', name: 'Minimal', description: 'Project files only.', servers: ['filesystem'] }
];

/** Applying a bundle: every bundled server gets an explicit grant. Safe servers in
 *  the bundle turn on and the rest of the catalog turns off for this agent. Write
 *  and secret servers are returned for consent and are never switched on here. */
export function applyRoleBundle(
  bundle: RoleBundle,
  current: AgentMcpGrants | undefined
): { grants: AgentMcpGrants; needsConsent: string[] } {
  const grants: AgentMcpGrants = { ...(current ?? {}) };
  const needsConsent: string[] = [];
  for (const e of MCP_CATALOG) {
    const wanted = bundle.servers.includes(e.id);
    if (wanted && e.tier !== 'safe-readonly') {
      needsConsent.push(e.id);
      if (grants[e.id] !== true) grants[e.id] = false;
    } else {
      grants[e.id] = wanted;
    }
  }
  return { grants, needsConsent };
}

/** One row of the "Who has what" view: every server an agent gets. */
export function serversForAgent(
  floor: { [id: string]: { enabled: boolean } } | undefined,
  grants: AgentMcpGrants | undefined,
  listServers: { [id: string]: CapabilityServer } | undefined
): string[] {
  return Object.keys(resolveAgentMcp('', floor, grants, listServers).servers)
    .map((key) => key.replace(/^munder-(?:list-)?/, ''));
}

/** Search and filter. Pure, so the list screen stays a thin view. */
export function filterCapabilities(
  entries: readonly CapabilityEntry[],
  filter: { query?: string; kind?: string; purpose?: string; reviewedOnly?: boolean }
): CapabilityEntry[] {
  const q = filter.query?.trim().toLowerCase();
  return entries.filter((e) =>
    (!filter.kind || e.kind === filter.kind)
    && (!filter.purpose || e.purposes.includes(filter.purpose))
    && (!filter.reviewedOnly || e.reviewed)
    && (!q || `${e.name} ${e.what} ${e.maker}`.toLowerCase().includes(q))
  );
}
