/**
 * Fetches, verifies and caches the public capabilities list
 * (HarnessMD/awesome-agent-capabilities, CC0). Free of any `electron` import so it
 * can be tested as a plain Node module.
 *
 * The list is signed with Ed25519 over its format, issue time and the catalog's
 * SHA-256. An unsigned or tampered download is refused and the cache is kept, so a
 * compromised host cannot widen what the app will offer to install.
 */
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getText } from './fetchText';
import { parseCapabilityList, type CapabilityList } from '../shared/capabilities';

export const CAPABILITY_LIST_URL = 'https://raw.githubusercontent.com/HarnessMD/awesome-agent-capabilities/main/catalog-update.json';
const FORMAT = 'munder-difflin/catalog-update@1';
/** Published in the list repository's scripts/publish.mjs. */
const PUBLIC_KEY_DER = 'MCowBQYDK2VwAyEApta6kKqiZ3WfCC2p6MP5yoWze/6Mw77PH4l/aJGx0vE=';
const TTL_MS = 24 * 60 * 60 * 1000;

export const capabilityPublicKey = (): KeyObject =>
  createPublicKey({ key: Buffer.from(PUBLIC_KEY_DER, 'base64'), format: 'der', type: 'spki' });

/** Returns the signed catalog text, or null unless the signature checks out. */
export function verifyCapabilityUpdate(text: string, key: KeyObject): { catalog: string; issuedAt: string } | null {
  let body: Record<string, unknown>;
  try { body = JSON.parse(text); } catch { return null; }
  if (typeof body !== 'object' || body === null) return null;
  const { format, issuedAt, catalog, signature } = body;
  if (format !== FORMAT || typeof issuedAt !== 'string' || typeof catalog !== 'string') return null;
  if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) return null;
  const digest = createHash('sha256').update(catalog).digest('hex');
  const signed = Buffer.from([FORMAT, issuedAt, digest].join('\n'));
  try {
    return verify(null, signed, key, Buffer.from(signature, 'base64')) ? { catalog, issuedAt } : null;
  } catch {
    return null;
  }
}

export interface CapabilityLoadResult {
  list: CapabilityList | null;
  /** When the list's maintainers signed this copy. */
  issuedAt?: string;
  /** This copy is older than a day because the refresh failed. */
  stale: boolean;
  error?: string;
}

function readCache(cachePath: string, key: KeyObject): { list: CapabilityList; issuedAt: string; fetchedAt: number } | null {
  try {
    if (!existsSync(cachePath)) return null;
    const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as { update?: string; fetchedAt?: number };
    if (typeof cached.update !== 'string' || typeof cached.fetchedAt !== 'number') return null;
    // Re-verified on every read: the cache file is as editable as anything on disk.
    const verified = verifyCapabilityUpdate(cached.update, key);
    const list = verified && parseCapabilityList(verified.catalog);
    return list && verified ? { list, issuedAt: verified.issuedAt, fetchedAt: cached.fetchedAt } : null;
  } catch {
    return null;
  }
}

/** The list from a fresh cache or the network. A failed or unverifiable refresh
 *  falls back to the last good copy, flagged stale. */
export async function loadCapabilityList(
  cachePath: string,
  opts: { force?: boolean; fetcher?: (url: string) => Promise<string>; key?: KeyObject; now?: number } = {}
): Promise<CapabilityLoadResult> {
  const key = opts.key ?? capabilityPublicKey();
  const now = opts.now ?? Date.now();
  const cached = readCache(cachePath, key);
  if (cached && !opts.force && now - cached.fetchedAt < TTL_MS) {
    return { list: cached.list, issuedAt: cached.issuedAt, stale: false };
  }
  const fallback = (error: string): CapabilityLoadResult =>
    ({ list: cached?.list ?? null, issuedAt: cached?.issuedAt, stale: true, error });
  let text: string;
  try {
    text = await (opts.fetcher ?? ((url) => getText(url, { timeoutMs: 30_000 })))(CAPABILITY_LIST_URL);
  } catch (e) {
    return fallback(e instanceof Error ? e.message : String(e));
  }
  const verified = verifyCapabilityUpdate(text, key);
  if (!verified) return fallback('the downloaded list failed its signature check');
  const list = parseCapabilityList(verified.catalog);
  if (!list) return fallback('the downloaded list could not be read');
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ update: text, fetchedAt: now }));
  } catch { /* the cache is an optimisation, not a requirement */ }
  return { list, issuedAt: verified.issuedAt, stale: false };
}
