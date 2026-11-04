// tryby organizacji burz: udział oczek z aktywną konwekcją wg trybu, 4 losowania × 36 h (lipiec, Polska)
sim.stop();
sim.set('date', window.__date || '2026-07-10');
await sim.dem(52.0, 19.3, 1.0, 0.75);
const rows = [];
for (const sd of (window.__seeds || [1, 2, 3, 4])) {
  sim.stop(); await sim.roll(sd); sim.stop();
  const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
  const cnt = [0, 0, 0, 0]; let best = { n: 0, h: 0 }; let s06 = 0, ns = 0;
  for (let hr = 0; hr < 36; hr++) {
    await sim.run(Math.round(3600 / dt));
    const M = sim.sfcGrid('SMODE').v; let act = 0;
    for (const v of M) { if (v > 0) { act++; cnt[Math.min(3, Math.round(v))]++; } }
    if (act > best.n) best = { n: act, h: hr + 1 };
    const U = sim.sfcGrid('SHU').v, V = sim.sfcGrid('SHV').v; for (let q = 0; q < U.length; q += 7) { s06 += Math.hypot(U[q], V[q]); ns++; }
  }
  const tot = cnt.reduce((x, y) => x + y, 0) || 1;
  rows.push(`s${sd}: pojedyncze ${(100 * cnt[1] / tot).toFixed(0)}% linie ${(100 * cnt[2] / tot).toFixed(0)}% superkom. ${(100 * cnt[3] / tot).toFixed(0)}% (oczko·h ${tot}); najwięcej o h${best.h}; ścinanie 0–6 km śr. ${(s06 / ns).toFixed(1)} m/s`);
}
log('\n' + rows.join('\n'));
