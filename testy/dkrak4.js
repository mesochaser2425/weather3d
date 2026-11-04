// domena nad Krakowem: tylko oczka < 300 m; dobowe T i Td względem dużej skali (średnia dobowa PE, Td celu)
window.__seeds = window.__seeds || [1, 3];
sim.stop();
sim.set('date', window.__date || '2026-07-10');
await sim.dem(50.06, 19.94, 1.0, 0.75);
const es = (x) => 6.112 * Math.exp(17.62 * x / (243.12 + x));
const tdOf = (e) => 243.12 * Math.log(e / 6.112) / (17.62 - Math.log(e / 6.112));
let sT = 0, sTd = 0, n = 0; const rows = [];
for (const sd of (window.__seeds || [1, 2, 3, 4])) {
  sim.stop(); await sim.roll(sd); sim.stop();
  const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
  const h = sim.hgt();
  for (let d = 0; d < 3; d++) {
    let t = 0, td = 0, k = 0, peT = 0, peTd = 0, kp = 0, mx = -99, mn = 99;
    for (let hr = 0; hr < 24; hr++) {
      await sim.run(Math.round(3600 / dt));
      const T2 = sim.sfcGrid('T2').v, TD = sim.sfcGrid('TD2').v;
      let st = 0, sd2 = 0, c = 0; for (let q = 0; q < h.length; q++) if (h[q] < 300) { st += T2[q]; sd2 += TD[q]; c++; }
      t += st / c; td += sd2 / c; k++; mx = Math.max(mx, st / c); mn = Math.min(mn, st / c);
      if (hr % 6 === 0) { const sy = await sim.syn(); peT += sy.tDay; peTd += tdOf(sy.air.rhLow / 100 * es(sy.air.tsfc)); kp++; }
    }
    const dT = t / k - peT / kp, dTd = td / k - peTd / kp;
    sT += dT; sTd += dTd; n++;
    rows.push(`s${sd}d${d + 1}: dom ${(t / k).toFixed(1)} (${mn.toFixed(0)}–${mx.toFixed(0)}) Td ${(td / k).toFixed(1)} | PE ${(peT / kp).toFixed(1)} Td ${(peTd / kp).toFixed(1)}`);
  }
}
log('\n' + rows.join('\n') + `\nśrednio: domena − PE: T ${(sT / n).toFixed(1)} K, Td ${(sTd / n).toFixed(1)} K`);
