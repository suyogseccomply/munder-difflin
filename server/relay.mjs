/**
 * Teams relay: passes sealed messages and encrypted files between offices. It has
 * no accounts and never holds a key, so anyone reading its disk sees only ciphertext.
 * An office proves who it is by signing each read with the key its id is a hash of.
 * Node's standard library only.
 */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const DEFAULT_LIMITS = {
  maxMessageBytes: 64 * 1024,
  maxQueuedPerOffice: 1000,
  maxFileBytes: 25 * 1024 * 1024,
  maxStoredFileBytes: 1024 * 1024 * 1024,
  requestsPerMinute: 240,
  messageTtlMs: 14 * 24 * 60 * 60 * 1000,
  fileTtlMs: 7 * 24 * 60 * 60 * 1000,
  inviteTtlMs: 24 * 60 * 60 * 1000,
  clockSkewMs: 5 * 60 * 1000
};

const HEX_ID = /^[a-f0-9]{32,64}$/;

export const officeIdOf = (signPubBase64) => createHash('sha256').update(Buffer.from(signPubBase64, 'base64')).digest('hex').slice(0, 40);

function verifiedOffice(req, officeId, action, limits, now) {
  const signPub = req.headers['x-office-key'];
  const ts = Number(req.headers['x-office-ts']);
  const sig = req.headers['x-office-sig'];
  if (typeof signPub !== 'string' || typeof sig !== 'string' || !Number.isFinite(ts)) return false;
  if (Math.abs(now() - ts) > limits.clockSkewMs) return false;
  if (officeIdOf(signPub) !== officeId) return false;
  try {
    const key = createPublicKey({ key: Buffer.from(signPub, 'base64'), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(`${action}\n${officeId}\n${ts}`), key, Buffer.from(sig, 'base64'));
  } catch {
    return false;
  }
}

const readBody = (req, max) => new Promise((resolve, reject) => {
  const parts = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    // Rejects now but leaves the socket open, or the 413 never reaches the client.
    // The handler closes the connection once it has answered.
    if (size > max) { reject(new Error('too_large')); parts.length = 0; return; }
    parts.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(parts)));
  req.on('error', reject);
});

export function createRelay({ dir, limits: overrides = {}, now = Date.now } = {}) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const queues = join(dir, 'queues');
  const invites = join(dir, 'invites');
  const files = join(dir, 'files');
  for (const d of [queues, invites, files]) mkdirSync(d, { recursive: true });

  const buckets = new Map();
  const allow = (ip) => {
    const t = now();
    const b = buckets.get(ip);
    if (!b || t - b.start > 60_000) { buckets.set(ip, { start: t, count: 1 }); return true; }
    b.count += 1;
    return b.count <= limits.requestsPerMinute;
  };

  const queuePath = (id) => join(queues, `${id}.json`);
  const readQueue = (id) => {
    try { return JSON.parse(readFileSync(queuePath(id), 'utf8')).filter((m) => now() - m.at < limits.messageTtlMs); } catch { return []; }
  };
  const storedFileBytes = () => readdirSync(files).reduce((sum, f) => {
    try { return sum + statSync(join(files, f)).size; } catch { return sum; }
  }, 0);

  /** Removes expired invites and files. Queues expire when read. */
  const sweep = () => {
    for (const [d, ttl] of [[invites, limits.inviteTtlMs], [files, limits.fileTtlMs]]) {
      for (const f of readdirSync(d)) {
        try {
          const p = join(d, f);
          if (now() - statSync(p).mtimeMs > ttl) rmSync(p, { force: true });
        } catch { /* gone already */ }
      }
    }
  };
  const sweepTimer = setInterval(sweep, 60 * 60 * 1000);
  sweepTimer.unref();

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const server = createServer(async (req, res) => {
    try {
      if (!allow(req.socket.remoteAddress ?? '')) return json(res, 429, { error: 'slow down' });
      const url = new URL(req.url ?? '/', 'http://relay');
      const parts = url.pathname.split('/').filter(Boolean);

      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });

      // Invites: stored under a hash of the code, handed out once.
      if (parts[0] === 'invites' && HEX_ID.test(parts[1] ?? '')) {
        const p = join(invites, parts[1]);
        if (req.method === 'PUT') {
          if (existsSync(p)) return json(res, 409, { error: 'exists' });
          writeFileSync(p, await readBody(req, limits.maxMessageBytes), { flag: 'wx' });
          return json(res, 201, { ok: true });
        }
        if (req.method === 'POST' && parts[2] === 'claim') {
          if (!existsSync(p)) return json(res, 404, { error: 'invite not found or already used' });
          const fresh = now() - statSync(p).mtimeMs <= limits.inviteTtlMs;
          const body = fresh ? readFileSync(p, 'utf8') : null;
          rmSync(p, { force: true });
          return fresh ? json(res, 200, { payload: body }) : json(res, 404, { error: 'invite expired' });
        }
      }

      if (parts[0] === 'messages' && HEX_ID.test(parts[1] ?? '')) {
        const office = parts[1];
        if (req.method === 'POST' && parts.length === 2) {
          const body = (await readBody(req, limits.maxMessageBytes)).toString('utf8');
          JSON.parse(body); // refuses anything that isn't JSON
          // Read after the upload and written with no await between, so two senders
          // arriving together can't overwrite each other's message.
          const q = readQueue(office);
          if (q.length >= limits.maxQueuedPerOffice) return json(res, 507, { error: 'mailbox full' });
          const id = randomBytes(12).toString('hex');
          q.push({ id, at: now(), body });
          writeFileSync(queuePath(office), JSON.stringify(q));
          return json(res, 201, { id });
        }
        if (!verifiedOffice(req, office, req.method === 'GET' ? 'read' : 'ack', limits, now)) return json(res, 401, { error: 'bad signature' });
        if (req.method === 'GET') return json(res, 200, { messages: readQueue(office).map((m) => ({ id: m.id, body: m.body })) });
        if (req.method === 'POST' && parts[2] === 'ack') {
          const ids = new Set(JSON.parse((await readBody(req, limits.maxMessageBytes)).toString('utf8')));
          writeFileSync(queuePath(office), JSON.stringify(readQueue(office).filter((m) => !ids.has(m.id))));
          return json(res, 200, { ok: true });
        }
      }

      if (parts[0] === 'files') {
        if (req.method === 'POST' && parts.length === 1) {
          const body = await readBody(req, limits.maxFileBytes);
          if (storedFileBytes() + body.length > limits.maxStoredFileBytes) return json(res, 507, { error: 'relay storage full' });
          const id = randomBytes(16).toString('hex');
          writeFileSync(join(files, id), body);
          return json(res, 201, { id });
        }
        if (req.method === 'POST' && parts[2] === 'download' && HEX_ID.test(parts[1] ?? '')) {
          const p = join(files, parts[1]);
          if (!existsSync(p) || now() - statSync(p).mtimeMs > limits.fileTtlMs) {
            rmSync(p, { force: true });
            return json(res, 404, { error: 'this link was already used or has expired' });
          }
          const body = readFileSync(p);
          rmSync(p, { force: true }); // one download, deleted before it is sent
          res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
          return res.end(body);
        }
      }
      return json(res, 404, { error: 'not found' });
    } catch (e) {
      if (e && e.message === 'too_large') {
        res.writeHead(413, { 'content-type': 'application/json', connection: 'close' });
        return res.end(JSON.stringify({ error: 'too large' }), () => req.destroy());
      }
      if (e instanceof SyntaxError) return json(res, 400, { error: 'bad request' });
      return json(res, 500, { error: 'relay error' });
    }
  });
  return { server, sweep };
}
