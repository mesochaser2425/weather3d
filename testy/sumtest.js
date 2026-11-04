// Jeden wiersz podsumowania fizyki domeny (A/B przy tej samej pogodzie modelu synoptycznego): T, Tx, Tn, RH, parowanie, ciepło jawne, zachmurzenie, słońce, wiatr, CAPE o 15:00, punkt rosy,
// opad (średnia, maks. dobowe, oczka ≥ 50 mm), kropki opadu (osobne plamy ≤ 4 oczek przy ≥ 1 mm/h o 15:00 i 18:00), noce tropikalne i upał. Pierwsze 2 doby – rozbieg.
// Parametry: tp=data,ziarno,doby,szer,dł; "?dx=5000&nx=64&ny=64&tp=2027-07-01,2,14,50,20", BLOCK_OM=1. Porównanie wersji: ten sam skrypt na dwóch serwerach (PORT) albo ?xp=…
sim.stop();
const P = (new URLSearchParams(location.search).get('tp') || '2027-07-01,2,14,50,20').split(',');
sim.set('date', P[0]);
await sim.place(+P[3], +P[4]);
sim.stop(); await sim.roll(+P[1]); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600, n3h = Math.round(10800 / dt);
const mean = (v) => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i]; return s / v.length; };
const es = (t) => 6.112 * Math.exp(17.67 * t / (t + 243.5));
const A = { n: 0, t: 0, td: 0, rh: 0, le: 0, h: 0, cov: 0, u: 0 };
const D = { n: 0, tx: 0, tn: 0, sun: 0, trop: 0, x30: 0, frost: 0, txm: -99, tnm: 99, prm: 0, pr: 0, n50: 0, tdm: -99 };
const C = { n: 0, m: 0, f1: 0, f2: 0, mx: 0 };
const K = { n: 0, spots: 0, rain: 0, big: 0, cu: 0 };
function spots(pr) {
  const g = sim.sfcGrid('PR'), nx = g.nx, ny = g.ny, seen = new Uint8Array(nx * ny);
  let small = 0, big = 0, cells = 0;
  for (let k = 0; k < nx * ny; k++) {
    if (seen[k] || pr[k] < 1) continue;
    let size = 0; const st = [k]; seen[k] = 1;
    while (st.length) {
      const c = st.pop(); size++;
      const i = c % nx, j = (c - i) / nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const q = jj * nx + ii;
        if (!seen[q] && pr[q] >= 1) { seen[q] = 1; st.push(q); }
      }
    }
    cells += size;
    if (size <= 4) small++; else big++;
  }
  return { small, big, cells };
}
const t0 = performance.now();
let h = 6, pacc0 = null;
const days = +P[2];
for (let d = 0; d < days; d++) {
  for (let q = 0; q < 8; q++) {
    await sim.run(n3h);
    h = (h + 3) % 24;
    if (d < 2) continue;
    const T = sim.sfcGrid('T2').v, Td = sim.sfcGrid('TD2').v;
    const tm = mean(T), tdm = mean(Td);
    A.n++; A.t += tm; A.td += tdm; A.rh += 100 * es(tdm) / es(tm); A.le += sim.sfcStats('LE').mean; A.h += sim.sfcStats('H').mean; A.cov += sim.sfcStats('COVER').mean; A.u += sim.sfcStats('U10').mean;
    D.tdm = Math.max(D.tdm, ...Td);
    if (h === 15 || h === 18) {
      const pr = sim.sfcGrid('PR').v, s = spots(pr), pc = sim.sfcGrid('PRCUS').v;
      let cu = 0; for (let k = 0; k < pr.length; k++) if (pr[k] >= 1 && pc[k] > 0.5 * pr[k]) cu++;
      K.n++; K.spots += s.small; K.big += s.big; K.rain += s.cells; K.cu += cu;
    }
    if (h === 15) {
      const ca = sim.sfcGrid('CAPE').v;
      C.n++; C.m += mean(ca); C.f1 += ca.filter((v) => v >= 1000).length / ca.length; C.f2 += ca.filter((v) => v >= 2000).length / ca.length; C.mx = Math.max(C.mx, ...ca);
    }
    if (h === 21) {
      const X = sim.sfcGrid('TMAX').v, N = sim.sfcGrid('TMIN').v, Pa = sim.sfcGrid('PACC').v;
      D.n++; D.tx += mean(X); D.tn += mean(N); D.sun += sim.sfcStats('SUNH').mean;
      D.trop += N.filter((v) => v >= 20).length / N.length; D.x30 += X.filter((v) => v >= 30).length / X.length; D.frost += N.filter((v) => v < 0).length / N.length;
      D.txm = Math.max(D.txm, ...X); D.tnm = Math.min(D.tnm, ...N);
      if (pacc0) {
        let mx = 0, s = 0, n50 = 0;
        for (let k = 0; k < Pa.length; k++) { const v = Pa[k] - pacc0[k]; s += v; if (v > mx) mx = v; if (v >= 50) n50++; }
        D.pr += s / Pa.length; D.prm = Math.max(D.prm, mx); D.n50 += n50;
      }
      pacc0 = Pa.slice();
    }
  }
}
const f = (x, d = 1) => x.toFixed(d), c = sim.cc().nodes[0];
log(`T ${f(A.t / A.n, 2)} Tx ${f(D.tx / D.n, 2)} Tn ${f(D.tn / D.n, 2)} ampl ${f((D.tx - D.tn) / D.n)} | Td ${f(A.td / A.n)} RH ${f(A.rh / A.n, 0)} maxTd ${f(D.tdm)} | ET ${f(A.le / A.n * 86400 / 2.5e6, 2)} mm/d H ${f(A.h / A.n, 0)} W/m2 | zachm ${f(100 * A.cov / A.n, 0)} sł ${f(D.sun / D.n)} h/d U10 ${f(A.u / A.n, 2)}`);
log(`CAPE15 śr ${f(C.m / C.n, 0)} >1000: ${f(100 * C.f1 / C.n)}% >2000: ${f(100 * C.f2 / C.n)}% maks ${f(C.mx, 0)} | opad ${f(D.pr / Math.max(D.n - 1, 1), 2)} mm/d maks.doby ${f(D.prm, 0)} oczka≥50/d ${f(D.n50 / Math.max(D.n - 1, 1), 1)} | kropki ${f(K.spots / K.n, 1)} plamy ${f(K.big / K.n, 1)} oczek ${f(K.rain / K.n, 0)} schemat ${f(K.cu / K.n, 1)} | Tmin≥20 ${f(100 * D.trop / D.n)}% Tx≥30 ${f(100 * D.x30 / D.n)}% maksTx ${f(D.txm)} minTn ${f(D.tnm)} mróz ${f(100 * D.frost / D.n, 0)}% | korekta ${c.corr.join('/')} a ${c.fq}/${c.fqa.join('/')} fp ${c.fp} | ${f((performance.now() - t0) / 1000, 0)} s`);
