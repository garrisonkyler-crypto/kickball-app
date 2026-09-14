import crypto from 'node:crypto';
import {
  store, json, allRegistrations, getSettings, playerCount, clean
} from './_store.mjs';

const ROLES = ['play', 'watch', 'wait'];

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Could not read that submission.' }, 400);
  }

  // Honeypot: bots fill hidden fields, people don't.
  if (clean(body.company, 40)) return json({ id: 'ok' }, 200);

  const name = clean(body.name, 120);
  const contact = clean(body.contact, 160);
  if (!name || !contact) {
    return json({ error: 'We need a name and a way to reach you.' }, 400);
  }

  let role = ROLES.includes(body.role) ? body.role : 'play';

  const [regs, settings] = await Promise.all([allRegistrations(), getSettings()]);
  const players = playerCount(regs);
  const wasFull = players >= settings.cap;

  // The cap is enforced here, not in the browser — someone with the old
  // page cached can't sneak into a full roster.
  if (role === 'play' && wasFull) role = 'wait';

  const existing = regs.find(
    (r) =>
      r.name.toLowerCase() === name.toLowerCase() &&
      r.contact.toLowerCase() === contact.toLowerCase()
  );
  if (existing) {
    return json({
      id: existing.id,
      role: existing.role,
      paid: !!existing.paid,
      duplicate: true,
      full: wasFull
    });
  }

  const id = crypto.randomUUID().split('-')[0];
  const record = {
    name,
    contact,
    role,
    grade: clean(body.grade, 12),
    friends: clean(body.friends, 240),
    party: clean(body.party, 40),
    intent: clean(body.intent, 60),
    paid: false,
    paidBy: '',
    paidAt: '',
    amount: 0,
    team: '',
    createdAt: new Date().toISOString()
  };

  await store().setJSON('reg/' + id, record);

  const nowPlayers = players + (role === 'play' ? 1 : 0);
  return json({
    id,
    role,
    bumpedToWaitlist: role === 'wait' && body.role === 'play',
    full: nowPlayers >= settings.cap
  });
};
