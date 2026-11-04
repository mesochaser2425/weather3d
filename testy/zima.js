// Diagnoza zimy: Tatry, N dób od daty startu – domena vs duża skala (model synoptyczny) co dobę.
// T 2 m, opad, SWE w pasach wysokości; zachmurzenie; dryf T i q_v względem pola docelowego przy gruncie i na wysokościach.
sim.stop();
sim.set('date', window.__date || '2026-12-01');
await sim.dem(49.25, 20.0, 1.0, 0.9);
sim.stop(); await sim.roll(window.__sd || 1); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const H = sim.hgt();
const bands = [['<900', (h) => h < 900], ['900-1500', (h) => h >= 900 && h < 1500], ['>1500', (h) => h >= 1500]];
const bmean = (v) => bands.map(([, f]) => { let s = 0, n = 0; for (let q = 0; q < v.length; q++) if (f(H[q])) { s += v[q]; n++; } return n ? s / n : NaN; });
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '–');
const days = window.__days || 20;
let pe = 0, pePrev = 0, accPrev = bmean(sim.sfcGrid('PACC').v);
const tot = { pe: 0, dom: [0, 0, 0], drBl: 0, drT: [0, 0, 0], cov: 0, peT: 0, domT: [0, 0, 0], n: 0 };
log(`dt ${dt} s, oczek ${H.length}, wysokość: min ${Math.min(...H).toFixed(0)} maks ${Math.max(...H).toFixed(0)} m`);
for (let d = 1; d <= days; d++) {
  let t2 = [0, 0, 0], cov = 0, peT = 0, nS = 0;
  for (let h = 0; h < 24; h += 3) {
    await sim.run(Math.round(3 * 3600 / dt));
    pe += 3 * await sim.pePr();
    const s = await sim.syn(); peT += s.tDay;
    const tv = bmean(sim.sfcGrid('T2').v); t2 = t2.map((x, i) => x + tv[i]);
    cov += sim.sfcStats('COVER').mean; nS++;
  }
  t2 = t2.map((x) => x / nS); cov /= nS; peT /= nS;
  const acc = bmean(sim.sfcGrid('PACC').v), dP = acc.map((x, i) => x - accPrev[i]); accPrev = acc;
  const swe = bmean(sim.sfcGrid('SWE').v);
  const dr = await sim.drift();
  const lay = [[1000, 2000], [2000, 3500], [3500, 6000]].map(([z0, z1]) => {
    let s = 0, st = 0, sq = 0, sqt = 0, n = 0; for (const L of dr.lev) if (L.z >= z0 && L.z < z1) { s += L.T; st += L.Tt; sq += L.q; sqt += L.qt; n++; }
    return { dT: (s - st) / n, T: s / n, Tt: st / n, dq: (sq - sqt) / n };
  });
  const s = await sim.syn();
  log(`d${d} ${s.cls?.key || ''} | PE: Tdzień ${f1(peT)} °C, opad ${f1(pe - pePrev)} mm | T2 [<900/900-1500/>1500] ${t2.map(f1).join('/')} | opad ${dP.map(f1).join('/')} | SWE ${swe.map(f1).join('/')} | chmury ${(100 * cov).toFixed(0)}% | ` +
    `dryf przy gruncie ${f1(dr.bl.T - dr.bl.Tt)} K, q ${(dr.bl.q - dr.bl.qt).toFixed(2)} | 1-2 km ${f1(lay[0].T)} (cel ${f1(lay[0].Tt)}) | 2-3.5 km ${f1(lay[1].dT)} K | 3.5-6 km ${f1(lay[2].dT)} K, q ${lay[0].dq.toFixed(2)}/${lay[1].dq.toFixed(2)}`);
  tot.pe += pe - pePrev; pePrev = pe; tot.dom = tot.dom.map((x, i) => x + dP[i]); tot.drBl += dr.bl.T - dr.bl.Tt; tot.drT = tot.drT.map((x, i) => x + lay[i].dT);
  tot.cov += cov; tot.peT += peT; tot.domT = tot.domT.map((x, i) => x + t2[i]); tot.n++;
}
const n = tot.n;
log(`RAZEM ${n} dób: PE opad ${f1(tot.pe)} mm, Tdzień ${f1(tot.peT / n)} | domena opad ${tot.dom.map(f1).join('/')} mm | T2 ${tot.domT.map((x) => f1(x / n)).join('/')} | chmury ${(100 * tot.cov / n).toFixed(0)}% | dryf grunt ${f1(tot.drBl / n)} K, 1-2/2-3.5/3.5-6 km ${tot.drT.map((x) => f1(x / n)).join('/')} K`);
