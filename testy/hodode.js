sim.stop();
sim.set('date', '2026-07-10');
await sim.dem(52.7, 10.2, 1.0, 0.8);
sim.stop(); await sim.roll(2); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
await sim.run(Math.round(4 * 3600 / dt));
const acc = {};
for (const [i, j] of [[30, 30], [90, 30], [30, 90], [90, 90], [60, 60]]) {
  const col = await sim.column(i, j);
  for (const r of col) { const zb = [100, 300, 700, 1500, 3000, 5000, 8000].find((z) => Math.abs(r[0] - z) < (z < 1000 ? 120 : 400)); if (!zb) continue; acc[zb] = acc[zb] || [0, 0, 0, 0, 0]; acc[zb][0] += r[1]; acc[zb][1] += r[3]; acc[zb][2]++; acc[zb][3] += r[2]; acc[zb][4] += r[4]; }
}
log(Object.keys(acc).map(Number).sort((x, y) => x - y).map((z) => { const u = acc[z][0] / acc[z][2], v = acc[z][1] / acc[z][2]; const ut = acc[z][3] / acc[z][2], vt = acc[z][4] / acc[z][2]; const dir = (x, y) => ((Math.atan2(-x, -y) * 180 / Math.PI + 360) % 360).toFixed(0); return `${z} m: ${Math.hypot(u, v).toFixed(1)} z ${dir(u, v)}° (cel ${Math.hypot(ut, vt).toFixed(1)} z ${dir(ut, vt)}°)`; }).join(' | '));
