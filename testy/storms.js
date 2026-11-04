// szukanie dnia burzowego: kilka losowań lipca, środek domeny o 14:00 – CAPE, ścinanie, opad
sim.stop();
sim.set('date', '2026-07-15');
for (const sd of (window.__seeds || [1, 2, 3, 4, 5, 6])) {
  sim.stop(); await sim.roll(sd); sim.stop();
  await sim.run(Math.round(8 * 3600 / 30));
  const f = (n) => { const s = sim.sfcStats(n); return `${s.mean.toFixed(0)}/${s.max.toFixed(0)}`; };
  const sy = await sim.syn();
  log(`seed ${sd} ${sy.cls && sy.cls.key}: T2 ${f('T2')} Td ${f('TD2')} CAPE ${f('CAPE')} MU ${f('MUCAPE')} SRH03 ${f('SRH03')} PR ${f('PR')} PACC ${f('PACC')}`);
}
