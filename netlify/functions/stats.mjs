import { json, allRegistrations, getSettings, playerCount } from './_store.mjs';

/** Public, and deliberately free of personal data — the page calls this on
 *  load to decide whether to show "Play" or flip itself to waitlist-only. */
export default async () => {
  const [regs, settings] = await Promise.all([allRegistrations(), getSettings()]);
  const players = playerCount(regs);
  return json({
    players,
    cap: settings.cap,
    spotsLeft: Math.max(0, settings.cap - players),
    full: players >= settings.cap
  });
};
