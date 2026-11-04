// Rok samego modelu synoptycznego od 21 VI (Tatry): średnie miesięczne w okolicy domeny vs przybliżony klimat
// południowej Polski (T 2 m, T 850 / 700 / 500 hPa) – czy model dryfuje w długim przebiegu i jaki ma profil pionowy.
const CL = { // miesiąc: [T2, T850, T700, T500, opad mm/d] – przybliżone (Kraków / ERA5)
  1: [-1.8, -6.0, -13.0, -30.0, 1.2], 2: [-0.6, -5.5, -12.5, -29.5, 1.2], 3: [3.0, -3.0, -10.5, -27.5, 1.3], 4: [8.8, 0.5, -7.0, -24.0, 1.6],
  5: [13.8, 5.0, -3.0, -19.5, 2.6], 6: [17.0, 8.5, 0.0, -16.0, 3.0], 7: [19.0, 10.5, 1.5, -14.5, 3.0], 8: [18.5, 10.5, 1.5, -14.5, 2.5],
  9: [13.8, 6.5, -1.5, -18.0, 2.0], 10: [8.8, 3.0, -4.5, -21.5, 1.6], 11: [3.8, -1.0, -8.0, -25.5, 1.4], 12: [-0.5, -4.5, -11.5, -29.0, 1.3] };
sim.stop();
sim.set('date', '2026-06-21');
await sim.dem(49.25, 20.0, 1.0, 0.9);
const seeds = window.__seeds || [1, 2, 3];
const f1 = (x) => x.toFixed(1);
const sum = {};
for (const sd of seeds) {
  sim.stop(); await sim.roll(sd); sim.stop();
  const t0 = Date.now();
  const Y = await sim.peYear(365);
  const mon = {};
  Y.forEach((r, d) => {
    const dt = new Date(Date.UTC(2026, 5, 21 + d)), m = dt.getUTCMonth() + 1;
    (mon[m] = mon[m] || []).push(r);
  });
  log(`seed ${sd} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  for (const m of [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6]) {
    const R = mon[m], n = R.length, avg = (k) => R.reduce((a, r) => a + r[k], 0) / n, c = CL[m];
    const v = { ts: avg('ts'), t15: avg('t15'), t3: avg('t3'), t5: avg('t5'), pr: 24 * avg('pr'), cl: avg('cloud'), olr: avg('olr') };
    (sum[m] = sum[m] || []).push(v);
    log(`  ${String(m).padStart(2)}: T2 ${f1(v.ts)} (${f1(v.ts - c[0])}) | T850 ${f1(v.t15)} (${f1(v.t15 - c[1])}) | T700 ${f1(v.t3)} (${f1(v.t3 - c[2])}) | T500 ${f1(v.t5)} (${f1(v.t5 - c[3])}) | ` +
      `Γ 0-1.5 km ${f1((v.ts - v.t15) / 1.5)} K/km | opad ${f1(v.pr)} mm/d (klimat ${c[4]}) | chmury ${(100 * v.cl).toFixed(0)}% | OLR ${v.olr.toFixed(0)}`);
  }
}
log('ŚREDNIA losowań – odchyłki od klimatu: T2 / T850 / T700 / T500, opad');
for (const m of [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6]) {
  const V = sum[m], n = V.length, a = (k) => V.reduce((s, v) => s + v[k], 0) / n, c = CL[m];
  log(`  ${String(m).padStart(2)}: ${f1(a('ts') - c[0])} / ${f1(a('t15') - c[1])} / ${f1(a('t3') - c[2])} / ${f1(a('t5') - c[3])} K | opad ${f1(a('pr'))} (klimat ${c[4]}) mm/d`);
}
