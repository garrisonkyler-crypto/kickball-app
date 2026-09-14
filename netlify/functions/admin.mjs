import {
  store, json, allRegistrations, allOrphans, getSettings, saveSettings,
  requireAdmin, playerCount, PRICE, clean
} from './_store.mjs';

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return denied;

  if (req.method === 'GET') {
    const [regs, settings, orphans] = await Promise.all([
      allRegistrations(), getSettings(), allOrphans()
    ]);

    let collected = 0, owed = 0, owedPlayers = 0;
    for (const r of regs) {
      const price = PRICE[r.role] ?? 0;
      if (r.role === 'wait') continue;
      if (r.paid) collected += r.amount || price;
      else {
        owed += price;
        if (r.role === 'play') owedPlayers++;
      }
    }

    const players = playerCount(regs);
    return json({
      registrations: regs,
      orphans,
      settings,
      totals: {
        total: regs.length,
        players,
        watchers: regs.filter((r) => r.role === 'watch').length,
        waiting: regs.filter((r) => r.role === 'wait').length,
        spotsLeft: Math.max(0, settings.cap - players),
        full: players >= settings.cap,
        collected,
        owed,
        owedPlayers,
        paidCount: regs.filter((r) => r.paid).length
      }
    });
  }

  if (req.method !== 'POST') return json({ error: 'GET or POST' }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request body.' }, 400);
  }

  const s = store();
  const action = body.action;

  if (action === 'setCap') {
    const cap = Math.max(1, Math.min(999, parseInt(body.cap, 10) || 0));
    const next = await saveSettings({ cap });
    return json({ ok: true, settings: next });
  }

  const id = clean(body.id, 40);
  if (!id) return json({ error: 'Missing id.' }, 400);
  const key = 'reg/' + id;

  if (action === 'remove') {
    await s.delete(key);
    return json({ ok: true });
  }

  const record = await s.get(key, { type: 'json' });
  if (!record) return json({ error: 'That person is no longer on the roster.' }, 404);

  if (action === 'setPaid') {
    const paid = !!body.paid;
    record.paid = paid;
    record.paidBy = paid ? (clean(body.method, 30) || 'Cash') : '';
    record.paidAt = paid ? new Date().toISOString() : '';
    if (paid && !record.amount) record.amount = PRICE[record.role] ?? 0;
    if (!paid) record.amount = 0;
  } else if (action === 'setMethod') {
    record.paidBy = clean(body.method, 30);
  } else if (action === 'setTeam') {
    const t = parseInt(body.team, 10);
    record.team = t >= 1 && t <= 8 ? String(t) : '';
  } else if (action === 'setRole') {
    const role = ['play', 'watch', 'wait'].includes(body.role) ? body.role : record.role;
    record.role = role;
    if (role === 'wait') {
      record.paid = false;
      record.paidBy = '';
      record.paidAt = '';
      record.amount = 0;
      record.team = '';
    }
  } else {
    return json({ error: 'Unknown action.' }, 400);
  }

  await s.setJSON(key, record);
  return json({ ok: true });
};
