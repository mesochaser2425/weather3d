sim.stop();
sim.set('date', '2026-07-15');
await sim.roll(window.__sd || 5); sim.stop();
await sim.run(Math.round(8 * 3600 / 30));
const col = await sim.column(75, 75);
const out = ['z   dθ\'(dom−cel) [K]   q_v dom/cel [g/kg]'];
for (const r of col) if (r[0] < 10000) out.push(`${r[0]} m: ${(r[5] - r[6]).toFixed(2)}  ${r[7]}/${r[8]}`);
log('\n' + out.join('\n'));
const s = await sim.syn(); log('cel: tsfc', s.air.tsfc.toFixed(1), 'lapse', s.air.lapse.toFixed(2), 'lapse2', (s.air.lapse2 || 0).toFixed(2), 'dinv', s.air.dinv.toFixed(2), 'rhl', s.air.rhLow.toFixed(0), 'rhh', s.air.rhHigh.toFixed(0));
