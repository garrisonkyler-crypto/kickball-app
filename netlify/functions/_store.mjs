import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

export const DEFAULT_CAP = 100;
export const PRICE = { play: 10, watch: 5, wait: 0 };

/** Strong consistency matters here: a read right after a write must see it,
 *  otherwise two people can claim the last spot. */
export function store() {
  return getStore({ name: 'kickball', consistency: 'strong' });
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}

export async function allRegistrations() {
  const s = store();
  const { blobs } = await s.list({ prefix: 'reg/' });
  const out = await Promise.all(
    blobs.map(async (b) => {
      const v = await s.get(b.key, { type: 'json' });
      return v ? { id: b.key.slice(4), ...v } : null;
    })
  );
  return out
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

/** Payments that arrived with no matching registration — a parent paying
 *  under their own name, usually. Never silently dropped. */
export async function allOrphans() {
  const s = store();
  const { blobs } = await s.list({ prefix: 'orphan/' });
  const out = await Promise.all(
    blobs.map(async (b) => {
      const v = await s.get(b.key, { type: 'json' });
      return v ? { id: b.key.slice(7), ...v } : null;
    })
  );
  return out.filter(Boolean);
}

export async function getSettings() {
  const v = await store().get('settings', { type: 'json' });
  return { cap: DEFAULT_CAP, ...(v || {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await store().setJSON('settings', next);
  return next;
}

export function playerCount(regs) {
  return regs.filter((r) => r.role === 'play').length;
}

/** Constant-time compare so the admin password can't be probed by timing. */
export function secretMatches(given, expected) {
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function requireAdmin(req) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return json({ error: 'ADMIN_PASSWORD is not set on this site yet.' }, 503);
  }
  const given = req.headers.get('x-admin-key') || '';
  if (!secretMatches(given, expected)) {
    return json({ error: 'Wrong password.' }, 401);
  }
  return null;
}

export function clean(v, max) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}
