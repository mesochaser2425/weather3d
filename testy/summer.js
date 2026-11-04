// lato nad Krakowem (prawdziwy teren, 2 km): T, Tmax, Tmin, Td w nizinach, zachmurzenie (COVER) w dzień i usłonecznienie; model synoptyczny
sim.stop();
sim.set('date', window.__date || '2026-07-10');
await sim.dem(50.06, 19.94, 1.0, 0.75);
const rows = [];
for (const sd of (window.__seeds || [1, 3])) {
  sim.stop(); await sim.roll(sd); sim.stop();
  const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
  const h = sim.hgt();
  for (let d = 0; d < 3; d++) {
    let t = 0, td = 0, k = 0, mx = -99, mn = 99, cov = 0, kc = 0, pe = 0, kp = 0;
    for (let hr = 0; hr < 24; hr++) {
      await sim.run(Math.round(3600 / dt));
      const T2 = sim.sfcGrid('T2').v, TD = sim.sfcGrid('TD2').v, C = sim.sfcGrid('COVER').v;
      let st = 0, s2 = 0, sc = 0, c = 0; for (let q = 0; q < h.length; q++) if (h[q] < 300) { st += T2[q]; s2 += TD[q]; sc += C[q]; c++; }
      t += st / c; td += s2 / c; k++; mx = Math.max(mx, st / c); mn = Math.min(mn, st / c);
      const hrLocal = (6 + hr + 1) % 24; if (hrLocal >= 9 && hrLocal <= 17) { cov += sc / c; kc++; }
      if (hr % 6 === 0) { const sy = await sim.syn(); pe += sy.tDay; kp++; }
    }
    const SU = sim.sfcGrid('SUNH').v; let su = 0, cs = 0; for (let q = 0; q < h.length; q++) if (h[q] < 300) { su += SU[q]; cs++; }
    rows.push(`s${sd}d${d + 1}: T ${(t / k).toFixed(1)} (${mn.toFixed(1)}–${mx.toFixed(1)}) Td ${(td / k).toFixed(1)} | chmury 9–17 h ${(100 * cov / kc).toFixed(0)}% | słońce ${(su / cs).toFixed(1)} h | PE ${(pe / kp).toFixed(1)}`);
  }
}
log('\n' + rows.join('\n'));
