sim.stop();
sim.set('date', window.__date || '2026-07-15');
await sim.roll(window.__seed || 3);
const s0 = await sim.syn();
log('start air', s0.air, 'cls', s0.cls && s0.cls.key, 'p', s0.p && s0.p.toFixed(1));
const t0 = performance.now();
const hours = window.__hours || 12;
const stepsH = Math.round(3600 / (window.__dt || 20));
for (let h = 1; h <= hours; h++) {
  const r = await sim.run(stepsH);
  const f = (n) => { const s = sim.sfcStats(n); return s ? `${s.mean.toFixed(1)}/${s.max.toFixed(1)}` : '-'; };
  const sy = await sim.syn();
  log(`h${(6 + h).toString().padStart(2)} T2 ${f('T2')} Td2 ${f('TD2')} CAPE ${f('CAPE')} MU ${f('MUCAPE')} PR ${f('PR')} PACC ${f('PACC')} PBLH ${f('PBLH')} H ${f('H')} LE ${f('LE')} | tgt T${sy.air.tsfc.toFixed(1)} lapse ${sy.air.lapse.toFixed(2)} dinv ${sy.air.dinv.toFixed(1)} rhl ${sy.air.rhLow.toFixed(0)} rhh ${sy.air.rhHigh.toFixed(0)}`);
  if (h === 9) log('profile', JSON.stringify(sim.profile().filter((_, k) => k % 3 === 0)));
}
log('wall s', ((performance.now() - t0) / 1000).toFixed(0));
