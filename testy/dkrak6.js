// jak dkrak4, ale płaski ląd 220 m (bez internetu) – T, Td domeny i dużej skali
window.__seeds = window.__seeds || [1, 3];
sim.stop();
sim.set('date', window.__date || '2026-07-10');
await sim.dem(50.06, 19.94, 1.0, 0.75, 220);
const es = (x) => 6.112 * Math.exp(17.62 * x / (243.12 + x));
const tdOf = (e) => 243.12 * Math.log(e / 6.112) / (17.62 - Math.log(e / 6.112));
let sT = 0, sTd = 0, n = 0; const rows = [];
for (const sd of window.__seeds) {
  sim.stop(); await sim.roll(sd); sim.stop();
  const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
  for (let d = 0; d < (window.__days || 3); d++) {
    let t = 0, td = 0, k = 0, peT = 0, peTd = 0, kp = 0, mx = -99, mn = 99;
    for (let hr = 0; hr < 24; hr++) {
      await sim.run(Math.round(3600 / dt));
      const st = sim.sfcStats ? null : null;
      const T2 = sim.sfcGrid('T2').v, TD = sim.sfcGrid('TD2').v;
      let s1 = 0, s2 = 0; for (let q = 0; q < T2.length; q++) { s1 += T2[q]; s2 += TD[q]; }
      t += s1 / T2.length; td += s2 / T2.length; k++; mx = Math.max(mx, s1 / T2.length); mn = Math.min(mn, s1 / T2.length);
      if (hr % 6 === 0) { const sy = await sim.syn(); peT += sy.tDay; peTd += tdOf(sy.air.rhLow / 100 * es(sy.air.tsfc)); kp++; }
    }
    sT += t / k - peT / kp; sTd += td / k - peTd / kp; n++;
    rows.push(`s${sd}d${d + 1}: dom ${(t / k).toFixed(1)} (${mn.toFixed(0)}–${mx.toFixed(0)}) Td ${(td / k).toFixed(1)} | PE ${(peT / kp).toFixed(1)} Td ${(peTd / kp).toFixed(1)}`);
  }
}
log('\n' + rows.join('\n') + `\nśrednio: domena − PE: T ${(sT / n).toFixed(1)} K, Td ${(sTd / n).toFixed(1)} K`);
