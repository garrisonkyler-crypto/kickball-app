import crypto from 'node:crypto';
import { store, allRegistrations } from './_store.mjs';

/**
 * Verifies Stripe's signature by hand rather than pulling in the Stripe SDK,
 * so this deploys with no extra runtime dependency.
 * Header looks like: t=1699999999,v1=abc...,v1=def...
 */
function verifySignature(rawBody, header, secret) {
  if (!header) return false;

  const parts = {};
  for (const piece of header.split(',')) {
    const i = piece.indexOf('=');
    if (i < 1) continue;
    const k = piece.slice(0, i).trim();
    const v = piece.slice(i + 1).trim();
    (parts[k] ||= []).push(v);
  }

  const timestamp = parts.t?.[0];
  const signatures = parts.v1 || [];
  if (!timestamp || signatures.length === 0) return false;

  // Reject replays of old events (5 minute window, same as Stripe's default).
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');

  return signatures.some((sig) => {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(sig, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

export default async (req) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response('STRIPE_WEBHOOK_SECRET not set', { status: 500 });
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get('stripe-signature'), secret)) {
    // Anyone can hit this URL; only Stripe can sign for it.
    return new Response('Invalid signature', { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  if (event.type !== 'checkout.session.completed') {
    return new Response('Ignored ' + event.type, { status: 200 });
  }

  const session = event.data.object || {};
  const ref = String(session.client_reference_id || '').trim();
  const email = String(session.customer_details?.email || '').toLowerCase().trim();
  const payerName = String(session.customer_details?.name || '').trim();
  const amount = Number(session.amount_total || 0) / 100;

  const s = store();
  let key = null;
  let record = null;

  // Best case: the pay button carried the registration id, so this is exact.
  if (ref) {
    const found = await s.get('reg/' + ref, { type: 'json' });
    if (found) {
      key = 'reg/' + ref;
      record = found;
    }
  }

  // Fallback: match on the email, then the name they registered with.
  if (!record) {
    const regs = await allRegistrations();
    const hit =
      (email && regs.find((r) => String(r.contact).toLowerCase().trim() === email)) ||
      (payerName &&
        regs.find(
          (r) => String(r.name).toLowerCase().trim() === payerName.toLowerCase()
        ));
    if (hit) {
      key = 'reg/' + hit.id;
      record = { ...hit };
      delete record.id;
    }
  }

  // Money arrived that we can't attribute. Keep it — never drop it.
  if (!record) {
    await s.setJSON('orphan/' + (session.id || Date.now()), {
      email,
      name: payerName,
      amount,
      sessionId: session.id || '',
      at: new Date().toISOString()
    });
    return new Response('Stored as unmatched payment', { status: 200 });
  }

  // Stripe retries webhooks; make a repeat delivery harmless.
  if (record.paid && record.paidBy === 'Stripe') {
    return new Response('Already recorded', { status: 200 });
  }

  record.paid = true;
  record.paidBy = 'Stripe';
  record.paidAt = new Date().toISOString();
  record.amount = amount;
  record.payerName = payerName;

  // Paying is what claims a spot, so a waitlister who pays becomes a player.
  if (record.role === 'wait') record.role = 'play';

  await s.setJSON(key, record);
  return new Response('ok', { status: 200 });
};
