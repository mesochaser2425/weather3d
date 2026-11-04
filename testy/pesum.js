// model synoptyczny nad Krakowem, lipiec: T, RH najniższej warstwy, opad (3 losowania × 20 dób)
sim.stop();
sim.set('date', window.__date || '2026-07-01');
await sim.dem(50.06, 19.94, 1.0, 0.75);
const out = [];
for (const sd of (window.__seeds || [1, 2, 3])) {
  sim.stop(); await sim.roll(sd); sim.stop();
  const r = await sim.peStats(window.__days || 20);
  out.push(`s${sd}: T ${r.tMean ?? r.tDay ?? ''} ${JSON.stringify(r).slice(0, 400)}`);
}
log('\n' + out.join('\n'));
