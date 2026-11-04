// Pasma opadu CHWILOWEGO: przebieg do chwili z opadem > __pmin mm/h (sprawdzane co 30 min, od __from h), potem mapa opadu chwilowego
// (bloki 2 × 2 oczka) w dwóch chwilach co 30 min (czy pasmo stoi w miejscu) i przekrój wzdłuż pasma pod wiatr ~3 km co 1 km od
// najsilniejszego opadu: teren, opad, maks. w (i jego wysokość), maks. q_c, q_i, q_r w kolumnie – linia konwekcji czy smuga opadu
// z jednego prądu wstępującego. Parametry: __pmin (8), __from (0), __maxh (60)
sim.stop();
for (let n = 0; n < 600 && !(await sim.syn()).cls; n++) await new Promise((r) => setTimeout(r, 500));
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const g0 = sim.sfcGrid('PR'), nx = g0.nx, ny = g0.ny, dx = g0.dx;
const h = sim.hgt(), B = sim.base();
const pmin = window.__pmin || 8;
let r = null, PR = null;
for (let s = 0; s < (window.__maxh || 60) * 2; s++) {
  r = await sim.run(Math.round(1800 / dt));
  if (r.simHours < (window.__from || 0)) continue;
  PR = sim.sfcGrid('PR').v;
  if (Math.max(...PR) > pmin) break;
}
const dump = (P) => {
  let out = '';
  for (let rj = Math.floor(ny / 2) - 1; rj >= 0; rj--) {
    let l = '';
    for (let ci = 0; ci < Math.floor(nx / 2); ci++) {
      let m = 0;
      for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) m = Math.max(m, P[(rj * 2 + dj) * nx + ci * 2 + di]);
      l += m < 0.2 ? ' ' : m < 1 ? '.' : m < 2 ? ':' : m < 5 ? '-' : m < 10 ? '=' : m < 20 ? '+' : '#';
    }
    out += l + '\n';
  }
  return out;
};
let km = 0;
PR.forEach((v, k) => { if (v > PR[km]) km = k; });
const im = km % nx, jm = Math.floor(km / nx);
// wiatr ~3 km n.p.m. nad najsilniejszym opadem
const col = await sim.column(im + B.mg, jm + B.mg);
const k3 = col.findIndex((x) => x[0] > 3000);
const u3 = col[k3][1], v3 = col[k3][3], sp = Math.hypot(u3, v3);
log(`${r.clock.hour.toFixed(1)} h (doba ${Math.floor(r.simHours / 24) + 1}): opad maks ${PR[km].toFixed(1)} mm/h w (${im}, ${jm}), teren ${h[km].toFixed(0)} m | ` +
  `wiatr ~3 km ${sp.toFixed(1)} m/s z ${((Math.atan2(-u3, -v3) * 180 / Math.PI + 360) % 360).toFixed(0)}° | CAPE śr ${(sim.sfcGrid('CAPE').v.reduce((x, y) => x + y, 0) / PR.length).toFixed(0)}`);
log('opad chwilowy (. <1, : <2, - <5, = <10, + <20, # ≥20 mm/h):\n' + dump(PR));
// przekrój pod wiatr co 1 km
const ex = u3 / sp, ey = v3 / sp;
let line = 'od maksimum pod wiatr [km]: teren m | opad mm/h | maks w m/s (z n.gr. km) | maks q_c / q_i / q_r g/kg (z q_r maks)';
for (let d = 0; d <= 20; d += 1) {
  const i = Math.round(im - ex * d * 1000 / dx), j = Math.round(jm - ey * d * 1000 / dx);
  if (i < 0 || j < 0 || i >= nx || j >= ny) break;
  const c = await sim.colq(i, j);
  let wm = -1e9, zw = 0, qc = 0, qi = 0, qr = 0, zr = 0;
  for (const x of c) { if (x[2] > wm) { wm = x[2]; zw = x[0]; } qc = Math.max(qc, x[4]); qi = Math.max(qi, x[5]); if (x[6] > qr) { qr = x[6]; zr = x[0]; } }
  line += `\n  ${String(d).padStart(2)}: ${h[j * nx + i].toFixed(0).padStart(4)} | ${PR[j * nx + i].toFixed(1).padStart(5)} | ${wm.toFixed(1).padStart(5)} (${(zw / 1000).toFixed(1)}) | ` +
    `${qc.toFixed(2)} / ${qi.toFixed(2)} / ${qr.toFixed(2)} (${(zr / 1000).toFixed(1)})`;
}
log(line);
await sim.run(Math.round(1800 / dt));
const PR2 = sim.sfcGrid('PR').v;
let sxy = 0, sxx = 0, syy = 0;
const m1 = PR.reduce((x, y) => x + y, 0) / PR.length, m2 = PR2.reduce((x, y) => x + y, 0) / PR2.length;
for (let k = 0; k < PR.length; k++) { sxy += (PR[k] - m1) * (PR2[k] - m2); sxx += (PR[k] - m1) ** 2; syy += (PR2[k] - m2) ** 2; }
log(`30 min później: korelacja map opadu chwilowego ${(sxy / Math.sqrt(sxx * syy)).toFixed(2)} (1 – pasmo stoi w miejscu)\n` + dump(PR2));
