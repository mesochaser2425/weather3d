// Długi przebieg domeny z modelem synoptycznym (Tatry, od 21 VI): co 10 dób – opad modelu synoptycznego i domeny
// w pasach wysokości, T 2 m, zachmurzenie, dryf T i q_v względem celu (szukanie, skąd susza i zimno w przebiegu rocznym).
sim.stop();
sim.set('date', window.__date || '2026-06-21');
await sim.dem(49.25, 20.0, 1.0, 0.9);
sim.stop(); await sim.roll(window.__sd || 1); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const H = sim.hgt();
const bands = [(h) => h < 900, (h) => h >= 900 && h < 1500, (h) => h >= 1500];
const bmean = (v) => bands.map((f) => { let s = 0, n = 0; for (let q = 0; q < v.length; q++) if (f(H[q])) { s += v[q]; n++; } return n ? s / n : NaN; });
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '–');
const days = window.__days || 200, per = window.__per || 10;
const D0 = new Date(Date.UTC(2026, 5, 21));
let accPrev = bmean(sim.sfcGrid('PACC').v);
let blk = null;
const reset = () => ({ pe: 0, peT: 0, t2: [0, 0, 0], cov: 0, dB: 0, d12: 0, d23: 0, q: 0, q12: 0, n: 0, nd: 0 });
blk = reset();
for (let d = 1; d <= days; d++) {
  for (let h = 0; h < 24; h += 6) {
    await sim.run(Math.round(6 * 3600 / dt));
    blk.pe += 6 * await sim.pePr();
    blk.peT += (await sim.syn()).tDay;
    const tv = bmean(sim.sfcGrid('T2').v); blk.t2 = blk.t2.map((x, i) => x + tv[i]);
    blk.cov += sim.sfcStats('COVER').mean; blk.n++;
  }
  if (d % 2 === 0) {
    const dr = await sim.drift();
    const lay = (z0, z1) => { let s = 0, q = 0, n = 0; for (const L of dr.lev) if (L.z >= z0 && L.z < z1) { s += L.T - L.Tt; q += L.q - L.qt; n++; } return [s / n, q / n]; };
    blk.dB += dr.bl.T - dr.bl.Tt; blk.q += dr.bl.q - dr.bl.qt; const l1 = lay(1000, 2000); blk.d12 += l1[0]; blk.q12 += l1[1]; blk.d23 += lay(2000, 3500)[0]; blk.nd++;
  }
  if (d % per === 0) {
    const acc = bmean(sim.sfcGrid('PACC').v), dP = acc.map((x, i) => x - accPrev[i]); accPrev = acc;
    const swe = bmean(sim.sfcGrid('SWE').v);
    const dd = new Date(D0.getTime() + d * 86400e3), n = blk.n, nd = Math.max(blk.nd, 1);
    log(`do ${dd.getUTCDate()}.${dd.getUTCMonth() + 1} | PE opad ${f1(blk.pe)} mm, T ${f1(blk.peT / n)} | domena opad [<900/900-1500/>1500] ${dP.map(f1).join('/')} | ` +
      `T2 ${blk.t2.map((x) => f1(x / n)).join('/')} | SWE ${swe.map((x) => x.toFixed(0)).join('/')} | chmury ${(100 * blk.cov / n).toFixed(0)}% | ` +
      `dryf T grunt ${f1(blk.dB / nd)} / 1-2 km ${f1(blk.d12 / nd)} / 2-3.5 km ${f1(blk.d23 / nd)} K, q grunt ${(blk.q / nd).toFixed(2)} / 1-2 km ${(blk.q12 / nd).toFixed(2)} g/kg`);
    blk = reset();
  }
}
