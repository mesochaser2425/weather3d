sim.stop();
sim.set('date', '2026-07-10');
await sim.dem(52.0, 19.3, 1.0, 0.75);
sim.stop(); await sim.roll(3); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
await sim.run(Math.round(3 * 3600 / dt));
const g = sim.sfcGrid('W1'); const acc = {};
let w1s = 0, n1 = 0;
for (let jj = 0; jj < 6; jj++) for (let ii = 0; ii < 6; ii++) {
  const i = Math.round((ii + 0.5) / 6 * g.nx), j = Math.round((jj + 0.5) / 6 * g.ny);
  const col = await sim.column(i + (window.__mg ?? 0), j + (window.__mg ?? 0));
  for (const r of col) { const zb = Math.round(r[0] / 1000); if (zb > 8) continue; acc[zb] = acc[zb] || [0, 0]; acc[zb][0] += r[9]; acc[zb][1]++; }
  w1s += g.v[j * g.nx + i]; n1++;
}
log(`W1 (te kolumny) śr ${(w1s / n1).toFixed(3)}; w wg wysokości: ` + Object.keys(acc).map((z) => `${z} km ${(acc[z][0] / acc[z][1]).toFixed(3)}`).join(', ') + `; wmax ${JSON.stringify(await sim.wmax())}`);
