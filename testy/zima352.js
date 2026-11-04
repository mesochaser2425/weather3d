// Zima w domenie użytkownika (352 km, 4 km, środek 49.93°N 19.91°E; rok ze stacjami: I–III o 6–8.5 K za zimno).
// Co dobę: model synoptyczny (T i anomalia w środku), cel i domena w najniższej warstwie, T 2 m nizin (< 350 m),
// śnieg, zachmurzenie (ogólne i niskie), usłonecznienie – gdzie powstaje chłód.
// Użycie: node runm.mjs "?dx=4000&nx=88&ny=88" zima352.js   (window.__days, __sd, __date)
sim.stop();
sim.set('date', window.__date || '2027-01-01');
await sim.dem(49.93, 19.91, 1.0, 0.8);
sim.stop(); await sim.roll(window.__sd || 1); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const H = sim.hgt(), low = H.map((h) => h < 350);
const mlow = (v) => { let s = 0, n = 0; for (let q = 0; q < v.length; q++) if (low[q]) { s += v[q]; n++; } return s / n; };
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '–');
const days = window.__days || 30;
const tot = { pe: 0, an: 0, t2: 0, bl: 0, blt: 0, sn: 0, cov: 0, cll: 0, pr: 0, ppe: 0, n: 0 };
let pacc0 = mlow(sim.sfcGrid('PACC').v);
log(`dt ${dt} s, oczek nizinnych ${low.filter(Boolean).length}/${H.length}`);
for (let d = 1; d <= days; d++) {
  let t2 = 0, cov = 0, cll = 0, pe = 0, an = 0, bl = 0, blt = 0, nS = 0;
  for (let h = 0; h < 24; h += 3) {
    await sim.run(Math.round(3 * 3600 / dt));
    const s = await sim.syn(); pe += s.tDay; an += s.tAnom; tot.ppe += 3 * await sim.pePr();
    t2 += mlow(sim.sfcGrid('T2').v); cov += mlow(sim.sfcGrid('COVER').v); cll += mlow(sim.sfcGrid('CLL').v);
    const dr = await sim.drift(); bl += dr.bl.T; blt += dr.bl.Tt;
    nS++;
  }
  [t2, cov, cll, pe, an, bl, blt] = [t2, cov, cll, pe, an, bl, blt].map((x) => x / nS);
  const swe = sim.sfcGrid('SWE').v, sn = swe.filter((x, q) => low[q] && x > 3).length / low.filter(Boolean).length;
    const pacc = mlow(sim.sfcGrid('PACC').v), pr = pacc - pacc0; pacc0 = pacc; tot.pr += pr;
  const dr = await sim.drift();
  const lay = [[300, 1000], [1000, 2000], [2000, 4000]].map(([z0, z1]) => {
    let s = 0, st = 0, sq = 0, sqt = 0, n = 0; for (const L of dr.lev) if (L.z >= z0 && L.z < z1) { s += L.T; st += L.Tt; sq += L.q; sqt += L.qt; n++; }
    return { dT: (s - st) / n, dq: (sq - sqt) / n };
  });
  log(`d${d} PE ${f1(pe)} °C (anom ${f1(an)}) | cel 1. warstwy ${f1(blt)}, domena ${f1(bl)} | T2 nizin ${f1(t2)} | opad ${f1(pr)} mm | śnieg ${(100 * sn).toFixed(0)}% | ` +
    `chmury ${(100 * cov).toFixed(0)}%, woda chmur < 2 km ${cll.toFixed(0)} g/m² | dT 0.3-1/1-2/2-4 km ${lay.map((L) => f1(L.dT)).join('/')} K, dq ${lay.map((L) => L.dq.toFixed(2)).join('/')}`);
  Object.entries({ pe, an, t2, bl, blt, sn, cov, cll }).forEach(([k, v]) => { tot[k] += v; });
  tot.n++;
}
const m = (k) => tot[k] / tot.n;
log(`RAZEM ${tot.n} dób: PE ${f1(m('pe'))} (anom ${f1(m('an'))}) | cel ${f1(m('blt'))} domena ${f1(m('bl'))} | T2 nizin ${f1(m('t2'))} | opad ${f1(tot.pr)} mm (model synoptyczny ${f1(tot.ppe)}) | śnieg ${(100 * m('sn')).toFixed(0)}% | chmury ${(100 * m('cov')).toFixed(0)}%, woda chmur < 2 km ${m('cll').toFixed(0)} g/m²`);
