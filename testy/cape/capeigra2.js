// Jak capeigra.js + bilans: co 6 h odchyłka domena − cel na poziomach (drift), co dobę opad domeny, parowanie, strumień ciepła.
// Co dobę o 13:15 (czas słoneczny, ~12 UTC przy 19°E) 9 kolumn 3 × 3; o 15:00 mapa CAPE i CAPE wg odległości od brzegu napływu. Adres: ?seed=, ?sd=
for (let i = 0; i < 900 && !(sim.ready && sim.ready()); i++) await new Promise((r) => setTimeout(r, 1000));
const Q = new URLSearchParams(location.search);
sim.stop(); await sim.roll(+(Q.get('seed') || 1)); sim.stop();
const B = sim.base(), NZ = B.zc.length;
log('BASE ' + JSON.stringify({ zc: B.zc, prs: B.prs, exc: B.exc, rc: B.rc, dzc: B.dzc, mg: B.mg }));
log('CC ' + JSON.stringify(sim.cc()));
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
let r = await sim.run(1);
const days = +(Q.get('sd') || 92);
const g0 = sim.sfcGrid('T2'), NXD = g0.nx, NYD = g0.ny, IC = NXD >> 1, JC = NYD >> 1, OFF = [-9, 0, 9];
const pct = (s, p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
function mapStats(v0) {
  const v = Float32Array.from(v0).sort(), n = v.length;
  const frac = (x) => { let c = 0; for (let i = 0; i < n; i++) if (v[i] >= x) c++; return +(100 * c / n).toFixed(2); };
  let s = 0; for (let i = 0; i < n; i++) s += v[i];
  return { mean: +(s / n).toFixed(0), p50: +pct(v, 0.5).toFixed(0), p90: +pct(v, 0.9).toFixed(0), p99: +pct(v, 0.99).toFixed(0), max: +v[n - 1].toFixed(0), f1k: frac(1000), f2k: frac(2000), f3k: frac(3000) };
}
async function drift(d, h) {
  const D = await sim.drift(), lev = D.lev.filter((x) => x.z <= 4000);
  log('DR ' + JSON.stringify({ d, h: +h.toFixed(2), bl: Object.fromEntries(Object.entries(D.bl).map(([k, v]) => [k, +v.toFixed(3)])), z: lev.map((x) => x.z), dq: lev.map((x) => +(x.q - x.qt).toFixed(3)), dT: lev.map((x) => +(x.T - x.Tt).toFixed(3)), q: lev.map((x) => +x.q.toFixed(3)) }));
}
const stepTo = async (lo, hi) => { while (true) { const h = r.clock.hour; if (h >= lo && h < hi) break; r = await sim.run(Math.max(1, Math.round(900 / dt))); } };
let prevP = sim.sfcStats('PACC').mean;
for (let d = 0; d < days; d++) {
  // 13:15 – profile
  await stepTo(13.2, 14);
  const G2 = { T2: sim.sfcGrid('T2').v, TD2: sim.sfcGrid('TD2').v, PBLH: sim.sfcGrid('PBLH').v, CAPE: sim.sfcGrid('CAPE').v };
  const syn = await sim.syn();
  log('DAY ' + JSON.stringify({ d, clock: r.clock, simH: +r.simHours.toFixed(2), mass: syn.cls && syn.cls.key, map: mapStats(G2.CAPE), pblm: +sim.sfcStats('PBLH').mean.toFixed(0), t2: +sim.sfcStats('T2').mean.toFixed(2), td2: +sim.sfcStats('TD2').mean.toFixed(2), le: +sim.sfcStats('LE').mean.toFixed(1), h: +sim.sfcStats('H').mean.toFixed(1), u: +syn.u0.toFixed(1), v: +syn.v0.toFixed(1) }));
  await drift(d, r.clock.hour);
  for (const dj of OFF) for (const di of OFF) {
    const iv = IC + di, jv = JC + dj, i = iv + B.mg, j = jv + B.mg, c = j * B.nx + i, kb = B.kb[c], g = jv * NXD + iv;
    const col = await sim.column(i, j);
    const f = (v, n) => v.slice(kb).map((x) => +x.toFixed(n));
    log('COL ' + JSON.stringify({ d, di, dj, h: +B.h[c].toFixed(1), kb, map: +G2.CAPE[g].toFixed(0), t2: +G2.T2[g].toFixed(2), td2: +G2.TD2[g].toFixed(2), pbl: +G2.PBLH[g].toFixed(0),
      thD: f(col.map((x) => x[10] + x[5]), 2), thT: f(col.map((x) => x[10] + x[6]), 2), qD: f(col.map((x) => x[7]), 2), qT: f(col.map((x) => x[8]), 2) }));
  }
  // 15:00 – mapa i pasma wg odległości od brzegu napływu (wiatr dużej skali nad środkiem)
  await stepTo(15, 15.9);
  const syn2 = await sim.syn(), C = sim.sfcGrid('CAPE').v, TD = sim.sfcGrid('TD2').v, u = syn2.u0, v = syn2.v0, sp = Math.hypot(u, v) || 1, DXK = g0.dx / 1000;
  const NB = 6, bsum = new Array(NB).fill(0), bn = new Array(NB).fill(0), bTd = new Array(NB).fill(0), bHi = new Array(NB).fill(0);
  // droga wzdłuż wiatru od brzegu napływu: rzut punktu na kierunek wiatru względem najdalej pod wiatr rogu
  const ex = u / sp, ey = v / sp, rogi = [[0, 0], [NXD, 0], [0, NYD], [NXD, NYD]].map(([x, y]) => x * ex + y * ey), s0 = Math.min(...rogi), s1 = Math.max(...rogi);
  for (let j = 0; j < NYD; j++) for (let i = 0; i < NXD; i++) { const s = ((i + 0.5) * ex + (j + 0.5) * ey - s0) / (s1 - s0), k = Math.min(NB - 1, Math.floor(s * NB)), g = j * NXD + i; bsum[k] += C[g]; bn[k]++; bTd[k] += TD[g]; if (C[g] >= 2000) bHi[k]++; }
  log('M15 ' + JSON.stringify({ d, map: mapStats(C), sp: +sp.toFixed(1), band: bsum.map((x, k) => +(x / Math.max(bn[k], 1)).toFixed(0)), bTd: bTd.map((x, k) => +(x / Math.max(bn[k], 1)).toFixed(2)), bHi: bHi.map((x, k) => +(100 * x / Math.max(bn[k], 1)).toFixed(1)), bn }));
  await drift(d, r.clock.hour);
  // 21:00, 3:00, 9:00 – odchyłka domena − cel
  for (const h of [21, 3, 9]) {
    await stepTo(h, h + 0.5); await drift(d, r.clock.hour);
    if (h === 21) log('EX ' + JSON.stringify({ d, tx: +sim.sfcStats('TMAX').mean.toFixed(2), sun: +sim.sfcStats('SUNH').mean.toFixed(2), le21: +sim.sfcStats('LE').mean.toFixed(1), td21: +sim.sfcStats('TD2').mean.toFixed(2) }));
    if (h === 9) log('EX2 ' + JSON.stringify({ d, tn: +sim.sfcStats('TMIN').mean.toFixed(2), td9: +sim.sfcStats('TD2').mean.toFixed(2), le9: +sim.sfcStats('LE').mean.toFixed(1) }));
  }
  if (d % 20 === 10) log('CC ' + JSON.stringify(sim.cc()));
  const pa = sim.sfcStats('PACC').mean; log('BUD ' + JSON.stringify({ d, p: +(pa - prevP).toFixed(3), pacc: +pa.toFixed(2) })); prevP = pa;
  r = await sim.run(Math.round(3600 / dt));
  if (d % 10 === 0) log(`postep doba ${d + 1}/${days}`);
}
return 'ok';
