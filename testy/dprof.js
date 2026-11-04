// średnia odchyłka domeny od celu (θ' i q_v) wg wysokości, 9 kolumn, co 3 h przez 2 doby
sim.stop();
sim.set('date', '2026-07-10');
await sim.dem(50.06, 19.94, 1.0, 0.75);
sim.stop(); await sim.roll(window.__sd || 1); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
await sim.run(Math.round(12 * 3600 / dt));
const acc = {}; let n = 0;
for (let q = 0; q < 16; q++) {
  await sim.run(Math.round(3 * 3600 / dt));
  for (const [i, j] of [[30, 30], [50, 50], [70, 70], [30, 70], [70, 30], [50, 30], [30, 50], [70, 50], [50, 70]]) {
    const col = await sim.column(i + 12, j + 12);
    for (const r of col) { const zb = Math.round(r[0] / 500) * 500; if (zb > 6000) continue; acc[zb] = acc[zb] || [0, 0, 0]; acc[zb][0] += r[5] - r[6]; acc[zb][1] += r[7] - r[8]; acc[zb][2]++; }
  }
}
log('\n' + Object.keys(acc).map(Number).sort((x, y) => x - y).map((z) => `${z} m: dθ ${(acc[z][0] / acc[z][2]).toFixed(2)} K  dq ${(acc[z][1] / acc[z][2]).toFixed(2)} g/kg`).join('\n'));
