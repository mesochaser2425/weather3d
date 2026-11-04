sim.stop();
sim.set('date', '2026-07-15');
for (const sd of [1, 2, 3, 5]) {
  sim.stop(); await sim.roll(sd); sim.stop();
  await sim.run(Math.round(6 * 3600 / 30));   // do południa
  const f = (n) => { const s = sim.sfcStats(n); return `${s.mean.toFixed(0)}/${s.max.toFixed(0)}`; };
  log(`seed ${sd}: SRH03 ${f('SRH03')} SRH01 ${f('SRH01')} SHR06 ${f('SHR')} CAPE ${f('CAPE')}`);
}
