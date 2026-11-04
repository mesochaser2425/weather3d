// Skąd bierze się odchyłka T domeny: miesiąc co 3 h – T 2 m, najniższa warstwa i poziomy n.p.m.: domena wobec celu (dużej skali po korekcie) i wobec odniesienia korekty klimatu.
// Odchyłka domena − cel jest mało zaszumiona pogodą (pogoda jest w obu), odniesienie − cel to reszta po korekcie (okno ±90 dób).
// Parametry w adresie: tp=data,ziarno,doby,szer,dł (domyślnie 2027-01-01,1,31,50,20). Szybko: "?dx=8000&nx=40&ny=40&tp=…" (~5 s/dobę, drift co 3 h nieco wolniej). BLOCK_OM=1.
sim.stop();
const P = (new URLSearchParams(location.search).get('tp') || '2027-01-01,1,31,50,20').split(',');
sim.set('date', P[0]);
await sim.place(+P[3], +P[4]);
sim.stop(); await sim.roll(+P[1]); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600, spd = Math.round(86400 / dt), n3h = Math.round(spd / 8);
const ZS = [500, 1000, 1500, 3000, 5600], mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
const A = { t2: 0, td2: 0, cov: 0, u10: 0, n: 0, bl: 0, blt: 0, q: 0, qt: 0, off: 0, ref: [0, 0, 0, 0], lev: ZS.map(() => ({ T: 0, Tt: 0, q: 0, qt: 0 })) };
const H = sim.hgt(), hm = mean(Array.from(H.v || H));
const t0 = performance.now(), days = +P[2];
const hours = Array.from({ length: 8 }, () => ({ t2: 0, bl: 0, blt: 0, u: 0, n: 0 }));
for (let d = 0; d < days; d++) {
  for (let q = 0; q < 8; q++) {
    await sim.run(n3h);
    if (d < 2) continue;          // rozbieg domeny
    const dr = await sim.drift(), T2 = mean(sim.sfcGrid('T2').v), U = sim.sfcGrid('U10'), c = sim.cc();
    A.t2 += T2; A.bl += dr.bl.T; A.blt += dr.bl.Tt; A.q += dr.bl.q; A.qt += dr.bl.qt; A.n++;
    A.off += c.tsOff || 0;
    if (U) A.u10 += mean(U.v);
    const cv = sim.sfcGrid('COVER'); if (cv) A.cov += mean(cv.v);
    const nd = c.nodes[0];
    if (nd.ref) for (let k = 0; k < 4; k++) A.ref[k] += nd.ref[k];
    ZS.forEach((z, k) => { const r = dr.lev.find((x) => x.z >= z); if (r) { A.lev[k].z = r.z; A.lev[k].T += r.T; A.lev[k].Tt += r.Tt; A.lev[k].q += r.q; A.lev[k].qt += r.qt; } });
    const h = hours[q]; h.t2 += T2; h.bl += dr.bl.T; h.blt += dr.bl.Tt; if (U) h.u += mean(U.v); h.n++;
  }
}
const n = A.n, f = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
const c = sim.cc(), nd = c.nodes[0];
const refAt = (z) => { const r = A.ref.map((v) => v / n); return z <= 1500 ? r[0] + (r[1] - r[0]) * z / 1500 : z <= 3000 ? r[1] + (r[2] - r[1]) * (z - 1500) / 1500 : r[2] + (r[3] - r[2]) * (z - 3000) / 2600; };   // (poziomy siatki, nie dokładne wysokości)
const elevN = nd.elev, tsl = A.ref[0] / n;
log(`czas ${((performance.now() - t0) / 1000).toFixed(0)} s; wys. śr. terenu ${hm.toFixed(0)} m; korekta ${nd.corr.join('/')} fq ${nd.fq} fqa ${nd.fqa.join('/')} fp ${nd.fp}; tsOff ${(A.off / n).toFixed(2)}`);
log(`T2 ${(A.t2 / n).toFixed(2)} | odniesienie na wys. terenu (poziom morza − 6.5 K/km) ${(tsl - 0.0065 * hm).toFixed(2)} | T2 − odn. ${f(A.t2 / n - (tsl - 0.0065 * hm))} | wiatr 10 m ${(A.u10 / n).toFixed(2)} | zachm. ${(A.cov / n).toFixed(0)}`);
log(`najniższa warstwa: domena ${(A.bl / n).toFixed(2)} cel ${(A.blt / n).toFixed(2)} (cel dobowy ${((A.blt - A.off) / n).toFixed(2)}) dom−cel dobowy ${f((A.bl - A.blt + A.off) / n)} | q dom ${(A.q / n).toFixed(2)} cel ${(A.qt / n).toFixed(2)} g/kg`);
ZS.forEach((z, k) => log(`${A.lev[k].z} m: dom ${(A.lev[k].T / n).toFixed(2)} cel ${(A.lev[k].Tt / n).toFixed(2)} odn. ${refAt(A.lev[k].z).toFixed(2)} | dom−cel ${f((A.lev[k].T - A.lev[k].Tt) / n)} cel−odn. ${f(A.lev[k].Tt / n - refAt(A.lev[k].z))} | q dom ${(A.lev[k].q / n).toFixed(2)} cel ${(A.lev[k].qt / n).toFixed(2)}`));
log('cykl dobowy co 3 h (po starcie o 6:00: 9, 12, … 6): T2 ' + hours.map((h) => (h.t2 / h.n).toFixed(1)).join(' ') + ' | dom−cel warstwy ' + hours.map((h) => f((h.bl - h.blt) / h.n)).join(' ') + ' | wiatr ' + hours.map((h) => (h.u / h.n).toFixed(1)).join(' '));
for (const p of sim.ana('m')) log(`${p.label}${p.cur ? '*' : ''}: T ${p.t?.toFixed(2)} Tmax ${p.tx?.toFixed(2)} Tmin ${p.tn?.toFixed(2)} opad ${p.p?.toFixed(1)} mm śnieg ${p.s?.toFixed(1)}`);
log('dane:', c.src);
