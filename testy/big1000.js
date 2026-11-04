// Duża domena (1000 × 1000 km, 10 km; Francja – Alpy): bilans opadu dobowo – opad domeny, opad modelu synoptycznego na tym samym
// obszarze, udział schematu konwekcji, parowanie z gruntu, klasy natężenia (kropki słabego opadu), na końcu sumy (średnia, maksimum,
// góry > 1000 m). Parametry: __date (2027-07-01), __sd (1), __days (9), __lat/__lon (47.4, 3.0).
sim.stop();
sim.set('date', window.__date || '2027-07-01');
await sim.dem(window.__lat ?? 47.4, window.__lon ?? 3.0, 1.0, 0.8);
sim.stop(); await sim.roll(window.__sd || 1); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const mean = (v) => { let s = 0; for (const x of v) s += x; return s / v.length; };
const days = window.__days || 9;
let tP = 0, tPE = 0, tCU = 0, tE = 0;
const cls = [0, 0, 0, 0];
for (let d = 0; d < days; d++) {
  let pD = 0, peD = 0, cuD = 0, eD = 0;
  for (let h = 0; h < 24; h++) {
    await sim.run(Math.round(3600 / dt));
    const PR = sim.sfcGrid('PR').v, PC = sim.sfcGrid('PRCUS').v, LE = sim.sfcGrid('LE').v;
    pD += mean(PR); cuD += mean(PC); eD += mean(LE) / 2.5e6 * 3600; peD += await sim.pePr();
    for (const x of PR) { if (x > 0.1) cls[x < 1 ? 0 : x < 5 ? 1 : x < 20 ? 2 : 3]++; }
  }
  tP += pD; tPE += peD; tCU += cuD; tE += eD;
  const w = await sim.water();
  log(`doba ${d + 1}: opad domeny ${pD.toFixed(1)} mm, model synopt. ${peD.toFixed(1)} mm, schemat ${(100 * cuD / Math.max(pD, 1e-9)).toFixed(0)}%, parowanie ${eD.toFixed(1)} mm | woda ${JSON.stringify(w)}`);
}
const P = sim.sfcGrid('PACC').v, hh = sim.hgt(), gw = sim.sfcGrid('PACC').nx;
let mx = 0, mt = 0, nm = 0, n100 = 0, n300 = 0;
for (let q = 0; q < P.length; q++) { mx = Math.max(mx, P[q]); if (hh[q] > 1000) { mt += P[q]; nm++; } n100 += P[q] > 100; n300 += P[q] > 300; }
const nc = cls.reduce((s, x) => s + x, 0);
log(`RAZEM ${days} dób: domena ${tP.toFixed(0)} mm (${(tP / days).toFixed(1)}/d), model synopt. ${tPE.toFixed(0)} mm (${(tPE / days).toFixed(1)}/d), schemat ${(100 * tCU / tP).toFixed(0)}%, parowanie ${tE.toFixed(0)} mm | ` +
  `maks. ${mx.toFixed(0)} mm, góry > 1000 m śr. ${(mt / Math.max(nm, 1)).toFixed(0)} mm (${nm} oczek), oczek > 100 mm ${(100 * n100 / P.length).toFixed(0)}%, > 300 mm ${(100 * n300 / P.length).toFixed(0)}% | ` +
  `oczko·h z opadem: 0.1–1 ${(100 * cls[0] / nc).toFixed(0)}%, 1–5 ${(100 * cls[1] / nc).toFixed(0)}%, 5–20 ${(100 * cls[2] / nc).toFixed(0)}%, > 20 ${(100 * cls[3] / nc).toFixed(0)}% (opad w ${(100 * nc / (P.length * 24 * days)).toFixed(0)}% oczko·h)`);
