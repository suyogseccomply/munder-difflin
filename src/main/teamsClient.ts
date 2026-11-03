/**
 * The Teams client: identity, pairing, sealed chat and one-download files. It has no
 * `electron` import. Storage, secrets and networking are injected, so two real
 * clients can be tested against a real relay.
 *
 * Each office has an Ed25519 key that signs and an X25519 key that encrypts. A
 * message is encrypted to one peer and signed, so the relay can neither read nor
 * forge it. There is no forward secrecy: a stolen private key would decrypt recorded
 * traffic. Everything received is untrusted input.
 */
import {
  createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman,
  generateKeyPairSync, hkdfSync, randomBytes, scryptSync, sign, verify
} from 'node:crypto';

const V = 'md-teams-v1';
const MAX_TEXT = 16_000;
const HISTORY_PER_PEER = 500;
const SEEN_LIMIT = 4000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_CLOCK_DRIFT_MS = 15 * 24 * 60 * 60 * 1000;

export interface Bundle { officeId: string; name: string; signPub: string; boxPub: string }
export type Answerer = 'you' | { agentId: string };

export interface Peer extends Bundle {
  fingerprint: string;
  answeredBy: Answerer;
}

export interface ChatMessage {
  id: string;
  peerId: string;
  direction: 'in' | 'out';
  text: string;
  at: number;
  /** A file offered in this message. The password is shared separately. */
  file?: { id: string; name: string; bytes: number };
  /** Set while a message routed to an agent waits for the person's decision. */
  decision?: 'pending' | 'approved' | 'rejected' | 'draft';
  /** A draft: the agent that wrote it. */
  draftedBy?: string;
}

export interface TeamsState {
  name: string;
  peers: Peer[];
  history: ChatMessage[];
  seen: string[];
  /** Codes this office issued and hasn't seen answered. The code is kept, as it
   *  decrypts the answer, which may arrive after this app has restarted. */
  pendingInvites: { tag: string; code: string; expiresAt: number }[];
}

export interface TeamsDeps {
  loadState: () => Partial<TeamsState> | null;
  saveState: (s: TeamsState) => void;
  getSecret: (name: string) => string | undefined;
  setSecret: (name: string, value: string) => boolean;
  relayUrl: () => string | null;
  fetch?: typeof fetch;
  now?: () => number;
}

const b64 = (b: Buffer | Uint8Array): string => Buffer.from(b).toString('base64');
const unb64 = (s: string): Buffer => Buffer.from(s, 'base64');
const sha = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');

export const officeIdOf = (signPubB64: string): string => sha(unb64(signPubB64)).slice(0, 40);

/** A short code both people can read out to confirm no one swapped keys. */
export function fingerprintOf(a: Bundle, b: Bundle): string {
  const [x, y] = [a, b].sort((p, q) => (p.officeId < q.officeId ? -1 : 1));
  const hex = sha(`${V}|${x.signPub}|${x.boxPub}|${y.signPub}|${y.boxPub}`).slice(0, 20).toUpperCase();
  return (hex.match(/.{4}/g) ?? []).join('-');
}

/** https, or http for this machine only, since http elsewhere exposes metadata. */
export function isAllowedRelayUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.username || u.password) return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

function aesSeal(key: Buffer, plain: Buffer, aad: string): { iv: string; ct: string; tag: string } {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return { iv: b64(iv), ct: b64(ct), tag: b64(c.getAuthTag()) };
}

function aesOpen(key: Buffer, box: { iv: string; ct: string; tag: string }, aad: string): Buffer {
  const d = createDecipheriv('aes-256-gcm', key, unb64(box.iv));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(unb64(box.tag));
  return Buffer.concat([d.update(unb64(box.ct)), d.final()]);
}

const codeKey = (code: string): Buffer => Buffer.from(hkdfSync('sha256', code, Buffer.alloc(0), `${V}|invite`, 32));

const FILE_MAGIC = 'MDT1';

/** Encrypts with a key stretched from the password. Salt is stored with the file. */
export function sealFile(plain: Buffer, password: string): Buffer {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([Buffer.from(FILE_MAGIC), salt, iv, c.getAuthTag(), ct]);
}

export function openFile(sealed: Buffer, password: string): Buffer {
  if (sealed.length < 48 || sealed.subarray(0, 4).toString() !== FILE_MAGIC) throw new Error('not a Teams file');
  const key = scryptSync(password, sealed.subarray(4, 20), 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const d = createDecipheriv('aes-256-gcm', key, sealed.subarray(20, 32));
  d.setAuthTag(sealed.subarray(32, 48));
  return Buffer.concat([d.update(sealed.subarray(48)), d.final()]);
}

/** A file or folder as one blob, so a folder needs no archive format on either side. */
export function packEntries(entries: { path: string; bytes: Buffer }[]): Buffer {
  return Buffer.from(JSON.stringify(entries.map((e) => ({ path: e.path, data: b64(e.bytes) }))));
}

/** Only plain relative paths survive. The sender is not trusted to name where files go. */
export function unpackEntries(packed: Buffer): { path: string; bytes: Buffer }[] {
  const rows: unknown = JSON.parse(packed.toString('utf8'));
  if (!Array.isArray(rows)) throw new Error('bad archive');
  return rows.map((r) => {
    const { path, data } = (r ?? {}) as { path?: unknown; data?: unknown };
    if (typeof path !== 'string' || typeof data !== 'string') throw new Error('bad archive');
    const segments = path.split(/[\\/]/);
    if (!path || /^[A-Za-z]:/.test(path) || segments.some((s) => s === '' || s === '.' || s === '..')) {
      throw new Error(`refused unsafe path: ${path}`);
    }
    return { path: segments.join('/'), bytes: unb64(data) };
  });
}

export class TeamsClient {
  private state: TeamsState;
  private signKey: ReturnType<typeof createPrivateKey>;
  private boxKey: ReturnType<typeof createPrivateKey>;
  readonly me: Bundle;

  constructor(private readonly deps: TeamsDeps) {
    const s = deps.loadState() ?? {};
    this.state = { name: s.name ?? 'My office', peers: s.peers ?? [], history: s.history ?? [], seen: s.seen ?? [], pendingInvites: s.pendingInvites ?? [] };
    const sign_ = this.key('teams-sign', 'ed25519');
    const box = this.key('teams-box', 'x25519');
    this.signKey = sign_.priv;
    this.boxKey = box.priv;
    const signPub = b64(createPublicKey(sign_.priv).export({ format: 'der', type: 'spki' }));
    this.me = { officeId: officeIdOf(signPub), name: this.state.name, signPub, boxPub: b64(createPublicKey(box.priv).export({ format: 'der', type: 'spki' })) };
  }

  private key(name: string, kind: 'ed25519' | 'x25519'): { priv: ReturnType<typeof createPrivateKey> } {
    const stored = this.deps.getSecret(name);
    if (stored) return { priv: createPrivateKey({ key: unb64(stored), format: 'der', type: 'pkcs8' }) };
    const { privateKey } = kind === 'ed25519' ? generateKeyPairSync('ed25519') : generateKeyPairSync('x25519');
    const der = privateKey.export({ format: 'der', type: 'pkcs8' });
    // Without safe storage a new key would change identity on each launch.
    if (!this.deps.setSecret(name, b64(der))) throw new Error('secure storage is unavailable on this machine');
    return { priv: privateKey };
  }

  private now(): number { return (this.deps.now ?? Date.now)(); }
  private save(): void { this.deps.saveState(this.state); }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const base = this.deps.relayUrl();
    if (!base || !isAllowedRelayUrl(base)) throw new Error('set a relay address first');
    return (this.deps.fetch ?? fetch)(`${base.replace(/\/+$/, '')}${path}`, { ...init, signal: AbortSignal.timeout(60_000) });
  }

  private signedHeaders(action: string): Record<string, string> {
    const ts = this.now();
    return {
      'x-office-key': this.me.signPub,
      'x-office-ts': String(ts),
      'x-office-sig': b64(sign(null, Buffer.from(`${action}\n${this.me.officeId}\n${ts}`), this.signKey))
    };
  }

  setName(name: string): void {
    this.state.name = name.trim().slice(0, 60) || this.state.name;
    this.me.name = this.state.name;
    this.save();
  }

  peers(): Peer[] { return [...this.state.peers]; }
  history(peerId: string): ChatMessage[] { return this.state.history.filter((m) => m.peerId === peerId); }

  // ─── Pairing ──────────────────────────────────────────────────────────────

  /** A one-use code. The relay stores it under a hash and can't read what it unlocks. */
  async createInvite(): Promise<string> {
    const code = randomBytes(16).toString('hex');
    const box = aesSeal(codeKey(code), Buffer.from(JSON.stringify(this.me)), V);
    const res = await this.call(`/invites/${sha(code)}`, { method: 'PUT', body: JSON.stringify(box) });
    if (!res.ok) throw new Error('the relay refused this invite');
    this.state.pendingInvites = [
      ...this.state.pendingInvites.filter((i) => i.expiresAt > this.now()),
      { tag: sha(`accept|${code}|${this.me.officeId}`), code, expiresAt: this.now() + 86_400_000 }
    ];
    this.save();
    return code;
  }

  async joinInvite(code: string): Promise<Peer> {
    const clean = code.trim().toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(clean)) throw new Error('that is not a valid invite code');
    const res = await this.call(`/invites/${sha(clean)}/claim`, { method: 'POST' });
    if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'invite refused');
    const { payload } = await res.json() as { payload: string };
    const inviter = parseBundle(JSON.parse(aesOpen(codeKey(clean), JSON.parse(payload), V).toString('utf8')));
    if (!inviter) throw new Error('that invite is damaged');
    if (inviter.officeId === this.me.officeId) throw new Error('that invite is your own');
    const peer = this.addPeer(inviter);
    const accept = {
      kind: 'pair',
      tag: sha(`accept|${clean}|${inviter.officeId}`),
      box: aesSeal(codeKey(clean), Buffer.from(JSON.stringify(this.me)), `${V}|accept`)
    };
    await this.post(inviter.officeId, accept);
    return peer;
  }

  private addPeer(b: Bundle): Peer {
    const existing = this.state.peers.find((p) => p.officeId === b.officeId);
    const peer: Peer = { ...b, fingerprint: fingerprintOf(this.me, b), answeredBy: existing?.answeredBy ?? 'you' };
    this.state.peers = [...this.state.peers.filter((p) => p.officeId !== b.officeId), peer];
    this.save();
    return peer;
  }

  setAnswerer(peerId: string, answeredBy: Answerer): void {
    this.state.peers = this.state.peers.map((p) => (p.officeId === peerId ? { ...p, answeredBy } : p));
    this.save();
  }

  removePeer(peerId: string): void {
    this.state.peers = this.state.peers.filter((p) => p.officeId !== peerId);
    this.state.history = this.state.history.filter((m) => m.peerId !== peerId);
    this.save();
  }

  // ─── Sealed messages ──────────────────────────────────────────────────────

  private post(to: string, body: unknown): Promise<Response> {
    return this.call(`/messages/${to}`, { method: 'POST', body: JSON.stringify(body) }).then((r) => {
      if (!r.ok) throw new Error(r.status === 507 ? 'their mailbox is full' : 'the relay refused this message');
      return r;
    });
  }

  private sharedKey(peer: Peer, id: string): Buffer {
    const secret = diffieHellman({
      privateKey: this.boxKey,
      publicKey: createPublicKey({ key: unb64(peer.boxPub), format: 'der', type: 'spki' })
    });
    return Buffer.from(hkdfSync('sha256', secret, Buffer.from(id), V, 32));
  }

  private async sendSealed(peer: Peer, payload: { text: string; file?: ChatMessage['file'] }): Promise<ChatMessage> {
    const id = randomBytes(16).toString('hex');
    const at = this.now();
    const aad = [V, this.me.officeId, peer.officeId, id, at].join('|');
    const box = aesSeal(this.sharedKey(peer, id), Buffer.from(JSON.stringify(payload)), aad);
    const sig = b64(sign(null, Buffer.from(`${aad}|${box.ct}`), this.signKey));
    await this.post(peer.officeId, { kind: 'chat', from: this.me.officeId, id, at, box, sig });
    const msg: ChatMessage = { id, peerId: peer.officeId, direction: 'out', text: payload.text, at, file: payload.file };
    this.record(msg);
    return msg;
  }

  private record(msg: ChatMessage): void {
    const others = this.state.history.filter((m) => m.peerId !== msg.peerId);
    const mine = [...this.state.history.filter((m) => m.peerId === msg.peerId), msg].slice(-HISTORY_PER_PEER);
    this.state.history = [...others, ...mine];
    this.save();
  }

  async send(peerId: string, text: string): Promise<ChatMessage> {
    const peer = this.state.peers.find((p) => p.officeId === peerId);
    if (!peer) throw new Error('unknown teammate');
    const clean = text.trim();
    if (!clean) throw new Error('nothing to send');
    if (clean.length > MAX_TEXT) throw new Error('that message is too long');
    return this.sendSealed(peer, { text: clean });
  }

  /** Reads the mailbox. Anything unsigned, tampered, replayed or from a stranger is
   *  dropped and acknowledged, so it can't sit in the queue and be retried forever. */
  async poll(): Promise<ChatMessage[]> {
    const res = await this.call(`/messages/${this.me.officeId}`, { headers: this.signedHeaders('read') });
    if (!res.ok) throw new Error('could not read the mailbox');
    const { messages } = await res.json() as { messages: { id: string; body: string }[] };
    const fresh: ChatMessage[] = [];
    const handled: string[] = [];
    for (const m of messages) {
      handled.push(m.id);
      try {
        const got = this.receive(JSON.parse(m.body));
        if (got) fresh.push(got);
      } catch { /* dropped */ }
    }
    if (handled.length) {
      await this.call(`/messages/${this.me.officeId}/ack`, { method: 'POST', headers: this.signedHeaders('ack'), body: JSON.stringify(handled) });
    }
    return fresh;
  }

  private receive(raw: Record<string, unknown>): ChatMessage | null {
    if (raw.kind === 'pair') { this.receivePair(raw); return null; }
    if (raw.kind !== 'chat') return null;
    const { from, id, at, box, sig } = raw as { from: string; id: string; at: number; box: { iv: string; ct: string; tag: string }; sig: string };
    const peer = this.state.peers.find((p) => p.officeId === from);
    if (!peer || typeof id !== 'string' || typeof at !== 'number' || typeof sig !== 'string' || !box) return null;
    if (this.state.seen.includes(id) || Math.abs(this.now() - at) > MAX_CLOCK_DRIFT_MS) return null;
    const aad = [V, peer.officeId, this.me.officeId, id, at].join('|');
    const signer = createPublicKey({ key: unb64(peer.signPub), format: 'der', type: 'spki' });
    if (!verify(null, Buffer.from(`${aad}|${box.ct}`), signer, unb64(sig))) return null;
    const payload = JSON.parse(aesOpen(this.sharedKey(peer, id), box, aad).toString('utf8')) as { text?: unknown; file?: ChatMessage['file'] };
    if (typeof payload.text !== 'string') return null;
    this.state.seen = [...this.state.seen, id].slice(-SEEN_LIMIT);
    const file = payload.file && typeof payload.file.id === 'string' && /^[a-f0-9]{32}$/.test(payload.file.id)
      ? { id: payload.file.id, name: String(payload.file.name ?? 'file').slice(0, 200), bytes: Number(payload.file.bytes) || 0 }
      : undefined;
    const msg: ChatMessage = {
      id, peerId: peer.officeId, direction: 'in', text: payload.text.slice(0, MAX_TEXT), at, file,
      decision: peer.answeredBy === 'you' ? undefined : 'pending'
    };
    this.record(msg);
    return msg;
  }

  private receivePair(raw: Record<string, unknown>): void {
    const tag = raw.tag as string;
    const pending = this.state.pendingInvites.find((i) => i.tag === tag && i.expiresAt > this.now());
    if (!pending) return;
    const bundle = parseBundle(JSON.parse(aesOpen(codeKey(pending.code), raw.box as { iv: string; ct: string; tag: string }, `${V}|accept`).toString('utf8')));
    if (!bundle) return;
    // One use on this side as well, so a replayed acceptance can't add anyone.
    this.state.pendingInvites = this.state.pendingInvites.filter((i) => i.tag !== tag);
    this.addPeer(bundle);
  }

  /** The person's verdict on a message routed to an agent. Returns it if approved. */
  decide(messageId: string, approved: boolean): ChatMessage | null {
    const msg = this.state.history.find((m) => m.id === messageId && m.decision === 'pending');
    if (!msg) return null;
    msg.decision = approved ? 'approved' : 'rejected';
    this.save();
    return approved ? msg : null;
  }

  /** An answering agent's reply, kept here until the person approves it. Nothing
   *  leaves this machine yet. */
  addDraft(peerId: string, text: string, draftedBy: string): ChatMessage | null {
    if (!this.state.peers.some((p) => p.officeId === peerId)) return null;
    const clean = text.trim().slice(0, MAX_TEXT);
    if (!clean) return null;
    const msg: ChatMessage = { id: randomBytes(16).toString('hex'), peerId, direction: 'out', text: clean, at: this.now(), decision: 'draft', draftedBy };
    this.record(msg);
    return msg;
  }

  /** Sends a draft, or discards it. Either way it can't be acted on twice. */
  async approveDraft(messageId: string, approved: boolean): Promise<boolean> {
    const draft = this.state.history.find((m) => m.id === messageId && m.decision === 'draft');
    if (!draft) return false;
    const peer = this.state.peers.find((p) => p.officeId === draft.peerId);
    if (!approved || !peer) {
      draft.decision = 'rejected';
      this.save();
      return true;
    }
    await this.sendSealed(peer, { text: draft.text });
    this.state.history = this.state.history.filter((m) => m.id !== messageId);
    this.save();
    return true;
  }

  // ─── Files ────────────────────────────────────────────────────────────────

  /** Encrypts on this machine and uploads. The password is never sent to anyone. */
  async sendFile(peerId: string, name: string, entries: { path: string; bytes: Buffer }[]): Promise<{ message: ChatMessage; password: string }> {
    const peer = this.state.peers.find((p) => p.officeId === peerId);
    if (!peer) throw new Error('unknown teammate');
    const packed = packEntries(entries);
    // Base64 packing grows the data, so this checks the size that gets uploaded.
    if (packed.length + 48 > MAX_FILE_BYTES) throw new Error('that is over the 25 MB limit');
    const password = randomBytes(12).toString('base64url');
    const res = await this.call('/files', { method: 'POST', body: new Uint8Array(sealFile(packed, password)) });
    if (!res.ok) throw new Error('the relay refused this file');
    const { id } = await res.json() as { id: string };
    const message = await this.sendSealed(peer, { text: `Sent ${name}`, file: { id, name: name.slice(0, 200), bytes: entries.reduce((n, e) => n + e.bytes.length, 0) } });
    return { message, password };
  }

  /** Using the link deletes the file from the relay, even with a wrong password. */
  async downloadFile(id: string, password: string): Promise<{ path: string; bytes: Buffer }[]> {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('that link is not valid');
    const res = await this.call(`/files/${id}/download`, { method: 'POST' });
    if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'download failed');
    const sealed = Buffer.from(await res.arrayBuffer());
    let plain: Buffer;
    try { plain = openFile(sealed, password); } catch { throw new Error('wrong password. This link has now been used up, so ask for it to be sent again.'); }
    return unpackEntries(plain);
  }
}

function parseBundle(raw: unknown): Bundle | null {
  const b = (raw ?? {}) as Partial<Bundle>;
  if (typeof b.signPub !== 'string' || typeof b.boxPub !== 'string') return null;
  // An office id is a hash of its key, so one office can't claim another's id.
  if (b.officeId !== officeIdOf(b.signPub)) return null;
  return { officeId: b.officeId, name: String(b.name ?? 'Office').slice(0, 60), signPub: b.signPub, boxPub: b.boxPub };
}
