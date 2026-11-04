// Skąd CAPE? Co dobę o 14:00 (czas słoneczny) w 6 × 6 kolumnach: CAPE domeny (cząstka 0–500 m, jak mapa), CAPE profilu dużej skali
// (cel: model synoptyczny + korekta klimatu), CAPE cząstki z 2 m (T2/Td2, jak sonda), CAPE profilu dużej skali z dolnymi 500 m domeny
// (rozdziela wkład warstwy granicznej i swobodnej atmosfery) oraz różnice domena − cel: T i q w dolnych 500 m, T na 1.5 / 3 / 5.5 km
// nad gruntem, gradient 1.5–5.5 km. Parametry: __date, __sd, __days, __lat/__lon (teren z mapy świata)
sim.stop();
sim.set('date', window.__date || '2027-07-05');
if (window.__lat) await sim.dem(window.__lat, window.__lon, 1.0, 0.8);
sim.stop(); await sim.roll(window.__sd || 1); sim.stop();
const B = sim.base(), NZ = B.zc.length;
const G = 9.81, CP = 1004.0, RD = 287.04, LV = 2.5e6;
const qsat = (T, p) => { const es = 610.78 * Math.exp(17.27 * (T - 273.16) / (T - 35.86)); return 0.622 * es / Math.max(p - es, 1); };
// unoszenie cząstki od wysokości z0 (poziomy od k0 w górę) jak w jądrze cumulus: sucha adiabata do nasycenia, potem wilgotna
function lift(tp, qp, k0, z0, th, q) {
  let sat = false, cape = 0, zp = z0;
  for (let k = k0; k < NZ; k++) {
    const dz = B.zc[k] - zp, p = B.prs[k];
    zp = B.zc[k];
    if (!sat) { tp -= G / CP * dz; if (qp >= qsat(tp, p)) sat = true; }
    else for (let s = 0; s < 2; s++) { const qs = qsat(tp, p); tp -= 0.5 * dz * G * (1 + LV * qs / (RD * tp)) / (CP + LV * LV * qs * 0.622 / (RD * tp * tp)); }
    if (tp < 190) break;
    const te = th[k] * B.exc[k], qe = Math.max(q[k], 0);
    const b = (tp * (1 + 0.61 * (sat ? qsat(tp, p) : qp)) - te * (1 + 0.61 * qe)) / te;
    if (sat && b > 0) cape += G * b * dz;
  }
  return cape;
}
// cząstka z dolnych 500 m (średnia ważona masą)
function ml(th, q, kb, zg) {
  let mth = 0, mq = 0, mm = 0, ks = kb;
  for (let k = kb; k < NZ; k++) { if (k > kb && B.zc[k] - zg > 500) break; const m = B.rc[k] * B.dzc[k]; mth += m * th[k]; mq += m * Math.max(q[k], 0); mm += m; ks = k; }
  return { tp: mth / mm * B.exc[ks], qp: mq / mm, ks };
}
const capeML = (th, q, kb, zg) => { const c = ml(th, q, kb, zg); return lift(c.tp, c.qp, c.ks + 1, B.zc[c.ks], th, q); };
const kAt = (kb, zg, za) => { for (let k = kb; k < NZ; k++) if (B.zc[k] - zg >= za) return k; return NZ - 1; };
const pct = (v, p) => { const s = Float32Array.from(v).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (v) => { let s = 0; for (const x of v) s += x; return s / v.length; };
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
let r = await sim.run(1);
const days = window.__days || 4, NS = 6;
const g0 = sim.sfcGrid('T2'), NXD = g0.nx, NYD = g0.ny;
const tot = { dom: [], tgt: [], sb: [], mix: [], map: [], map90: [], dT0: [], dq0: [], dT15: [], dT3: [], dT55: [], lrD: [], lrT: [], t2: [], td2: [] };
for (let d = 0; d < days; d++) {
  while (!(r.clock.hour >= 14 && r.clock.hour < 15 && r.simHours > 24 * d + 6)) r = await sim.run(Math.max(1, Math.round(900 / dt)));
  const CPm = sim.sfcGrid('CAPE').v, MU = sim.sfcGrid('MUCAPE').v, T2 = sim.sfcGrid('T2').v, TD = sim.sfcGrid('TD2').v, PR = sim.sfcGrid('PR').v;
  const s = { dom: [], tgt: [], sb: [], mix: [], dT0: [], dq0: [], dT15: [], dT3: [], dT55: [], lrD: [], lrT: [] };
  for (let n = 0; n < NS * NS; n++) {
    const iv = Math.floor(((n % NS) + 0.5) / NS * NXD), jv = Math.floor((Math.floor(n / NS) + 0.5) / NS * NYD);
    const i = iv + B.mg, j = jv + B.mg, c = j * B.nx + i, kb = B.kb[c], zg = B.h[c];
    const col = await sim.column(i, j);
    const thD = col.map((x) => x[10] + x[5]), thT = col.map((x) => x[10] + x[6]), qD = col.map((x) => x[7] / 1000), qT = col.map((x) => x[8] / 1000);
    // profil dużej skali z dolnymi 500 m z domeny
    const thM = thT.slice(), qM = qT.slice();
    for (let k = kb; k < NZ && B.zc[k] - zg <= 500; k++) { thM[k] = thD[k]; qM[k] = qD[k]; }
    s.dom.push(capeML(thD, qD, kb, zg)); s.tgt.push(capeML(thT, qT, kb, zg)); s.mix.push(capeML(thM, qM, kb, zg));
    // cząstka z 2 m (sonda): T2, Td2
    const q2v = sim.sfcGrid('TD2').v[jv * NXD + iv], t2v = T2[jv * NXD + iv];
    const ps = B.prs[kb] * Math.exp((B.zc[kb] - zg) / 8000);
    s.sb.push(lift(t2v + 273.15, qsat(q2v + 273.15, ps), kb, zg + 2, thD, qD));
    const k0 = kb, k15 = kAt(kb, zg, 1500), k3 = kAt(kb, zg, 3000), k55 = kAt(kb, zg, 5500);
    const T = (th, k) => th[k] * B.exc[k];
    s.dT0.push(T(thD, k0) - T(thT, k0)); s.dq0.push(1000 * (qD[k0] - qT[k0]));
    s.dT15.push(T(thD, k15) - T(thT, k15)); s.dT3.push(T(thD, k3) - T(thT, k3)); s.dT55.push(T(thD, k55) - T(thT, k55));
    const dzl = (B.zc[k55] - B.zc[k15]) / 1000;
    s.lrD.push((T(thD, k15) - T(thD, k55)) / dzl); s.lrT.push((T(thT, k15) - T(thT, k55)) / dzl);
  }
  let rain = 0; for (const x of PR) rain += x > 0.5;
  log(`doba ${d + 1} ${r.clock.date || ''} 14:00 | mapa CAPE śr ${mean(CPm).toFixed(0)} p90 ${pct(CPm, 0.9).toFixed(0)} maks ${Math.max(...CPm).toFixed(0)}, MUCAPE p90 ${pct(MU, 0.9).toFixed(0)} | ` +
    `kolumny: domena ${mean(s.dom).toFixed(0)} (p90 ${pct(s.dom, 0.9).toFixed(0)}), duża skala ${mean(s.tgt).toFixed(0)} (p90 ${pct(s.tgt, 0.9).toFixed(0)}), ` +
    `duża skala + dół domeny ${mean(s.mix).toFixed(0)}, cząstka 2 m ${mean(s.sb).toFixed(0)} (p90 ${pct(s.sb, 0.9).toFixed(0)}) | ` +
    `domena − cel: T dół ${mean(s.dT0).toFixed(1)} K, q dół ${mean(s.dq0).toFixed(1)} g/kg, T 1.5 km ${mean(s.dT15).toFixed(1)}, 3 km ${mean(s.dT3).toFixed(1)}, 5.5 km ${mean(s.dT55).toFixed(1)} | ` +
    `Γ 1.5–5.5 km domena ${mean(s.lrD).toFixed(2)} cel ${mean(s.lrT).toFixed(2)} K/km | T2 ${mean(T2).toFixed(1)} Td2 ${mean(TD).toFixed(1)} | oczek z opadem > 0.5 mm/h ${(100 * rain / PR.length).toFixed(1)}%`);
  for (const k of Object.keys(s)) tot[k].push(mean(s[k]));
  tot.map.push(mean(CPm)); tot.map90.push(pct(CPm, 0.9)); tot.t2.push(mean(T2)); tot.td2.push(mean(TD));
  r = await sim.run(Math.round(3600 / dt));
}
const M = (k) => mean(tot[k]).toFixed(k.startsWith('d') || k.startsWith('lr') ? 2 : 0);
log(`RAZEM ${days} dób 14:00: mapa CAPE śr ${M('map')} (p90 ${M('map90')}) | domena ${M('dom')}, duża skala ${M('tgt')}, duża skala + dół domeny ${M('mix')}, cząstka 2 m ${M('sb')} | ` +
  `domena − cel: T dół ${M('dT0')}, q dół ${M('dq0')}, T 1.5 km ${M('dT15')}, 3 km ${M('dT3')}, 5.5 km ${M('dT55')} | Γ domena ${M('lrD')} cel ${M('lrT')} | T2 ${M('t2')} Td2 ${M('td2')}`);
