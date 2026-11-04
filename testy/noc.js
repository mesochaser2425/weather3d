// Noc w domenie: średnie przy gruncie o 15:00 i 3:00 oraz Tmax/Tmin z N dób. Pogoda modelu synoptycznego ta sama przy tym samym ziarnie i miejscu, więc zmiany fizyki domeny można porównywać A/B (np. ?xp=…).
// Parametry w adresie: tp=data,ziarno,doby,szer,dł (domyślnie 2027-07-01,1,12,52,19). Szybko: "?dx=8000&nx=40&ny=40&tp=…". BLOCK_OM=1.
sim.stop();
const P = (new URLSearchParams(location.search).get('tp') || '2027-07-01,1,12,52,19').split(',');
sim.set('date', P[0]);
await sim.place(+P[3], +P[4]);
sim.stop(); await sim.roll(+P[1]); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600, spd = Math.round(86400 / dt), n3h = Math.round(spd / 8);
const m = (name) => { const s = sim.sfcStats(name); return s ? s.mean : NaN; };
const KEYS = ['T2', 'T1', 'TS', 'TD', 'TD2', 'H', 'LE', 'QRAD', 'U10', 'PBLH', 'WS', 'LINV', 'COVER', 'CDU', 'SUNH'];
const DAY = { n: 0, trop: 0, tx30: 0, frost: 0, sun: 0, txm: -99, tnm: 99, prm: 0 }; let pacc0 = null;
const acc = {}; for (const h of [0, 3, 6, 9, 12, 15, 18, 21]) acc[h] = { n: 0, prof: null, ...Object.fromEntries(KEYS.map((k) => [k, 0])) };
const t0 = performance.now(); let h = 6, sx = 0, sn = 0, nd = 0, pr0 = 0;
for (let d = 0; d < +P[2]; d++) {
  for (let q = 0; q < 8; q++) {
    await sim.run(n3h);
    h = (h + 3) % 24;
    if (d < 2) continue;
    const A = acc[h]; A.n++;
    for (const k of KEYS) A[k] += m(k);
    const pf = sim.profile();
    if (pf) { if (!A.prof) A.prof = pf.slice(0, 16).map((r) => [r[0], 0, 0]); pf.slice(0, 16).forEach((r, i) => { A.prof[i][1] += r[1]; A.prof[i][2] += r[2]; }); }
    // o 21:00: Tmin i Tmax od północy, usłonecznienie doby; część oczek z nocą tropikalną, upałem i przymrozkiem; największy opad dobowy
    if (h === 21) {
      const X = sim.sfcGrid('TMAX').v, N = sim.sfcGrid('TMIN').v, Pa = sim.sfcGrid('PACC').v;
      DAY.n++; DAY.trop += N.filter((v) => v >= 20).length / N.length; DAY.tx30 += X.filter((v) => v >= 30).length / X.length; DAY.frost += N.filter((v) => v < 0).length / N.length;
      DAY.sun += m('SUNH'); DAY.txm = Math.max(DAY.txm, ...X); DAY.tnm = Math.min(DAY.tnm, ...N);
      if (pacc0) { let mx = 0; for (let k = 0; k < Pa.length; k++) mx = Math.max(mx, Pa[k] - pacc0[k]); DAY.prm = Math.max(DAY.prm, mx); }
      pacc0 = Pa.slice();
    }
  }
}
const f = (A, k, d = 1) => (A[k] / A.n).toFixed(d);
log(`czas ${((performance.now() - t0) / 1000).toFixed(0)} s`);
log('godz:  T2    T1    TS    TD    Td2  |  H    LE   QRAD | U10  PBLH   u*   1/L   zachm  CDU');
for (const h2 of [3, 6, 9, 12, 15, 18, 21, 0]) { const A = acc[h2]; log(`${String(h2).padStart(2)}: ${f(A, 'T2')} ${f(A, 'T1')} ${f(A, 'TS')} ${f(A, 'TD')} ${f(A, 'TD2')} | ${f(A, 'H', 0)} ${f(A, 'LE', 0)} ${f(A, 'QRAD', 0)} | ${f(A, 'U10')} ${f(A, 'PBLH', 0)} ${f(A, 'WS', 2)} ${f(A, 'LINV', 4)} ${f(A, 'COVER', 2)} ${f(A, 'CDU', 4)}`); }
const pr = (h2) => acc[h2].prof ? acc[h2].prof.map((r) => `${r[0]}:${(r[1] / acc[h2].n).toFixed(1)}`).join(' ') : '';
log('profil T 3:00 ', pr(3)); log('profil T 15:00', pr(15));
for (const p of sim.ana('m')) log(`${p.label}${p.cur ? '*' : ''}: T ${p.t?.toFixed(2)} Tmax ${p.tx?.toFixed(2)} Tmin ${p.tn?.toFixed(2)} amplituda ${(p.tx - p.tn).toFixed(2)} opad ${p.p?.toFixed(1)} mm`);
log(`doby: ${DAY.n}, oczko·doby Tmin ≥ 20: ${(100 * DAY.trop / DAY.n).toFixed(1)}%, Tmax ≥ 30: ${(100 * DAY.tx30 / DAY.n).toFixed(1)}%, Tmin < 0: ${(100 * DAY.frost / DAY.n).toFixed(1)}%, usłon. ${(DAY.sun / DAY.n).toFixed(2)} h/d, maks. Tmax ${DAY.txm.toFixed(1)}, min. Tmin ${DAY.tnm.toFixed(1)}, maks. opad dobowy ${DAY.prm.toFixed(0)} mm`);
log('korekta', JSON.stringify(sim.cc().nodes[0].corr), 'fq', sim.cc().nodes[0].fq);
