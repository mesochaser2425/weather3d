// Pasma opadu w oknach 6 h: dla każdego okna suma średnia i maks., wiatr ~1.5 km (kierunek), CAPE; gdy maks. sumy > __thr mm –
// mapa sumy okna w blokach 2 × 2 oczka (wiersze od północy) i współczynnik „pasmowości” (podobieństwo sumy wzdłuż wiatru /
// w poprzek, przesunięcie o 2 km). Parametry: __days (4), __thr (15 mm)
sim.stop();
for (let n = 0; n < 600 && !(await sim.syn()).cls; n++) await new Promise((r) => setTimeout(r, 500));
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const g0 = sim.sfcGrid('PR'), nx = g0.nx, ny = g0.ny, dx = g0.dx;
const zc = sim.levels(), B = sim.base();
const mean = (v) => { let s = 0; for (const x of v) s += x; return s / v.length; };
let P0 = Float32Array.from(sim.sfcGrid('PACC').v);
const days = window.__days || 4, thr = window.__thr || 15;
for (let w = 1; w <= days * 4; w++) {
  let r;
  for (let hh = 0; hh < 6; hh++) r = await sim.run(Math.round(3600 / dt));
  const P = sim.sfcGrid('PACC').v, S = new Float32Array(nx * ny);
  let mx = 0;
  for (let k = 0; k < S.length; k++) { S[k] = P[k] - P0[k]; mx = Math.max(mx, S[k]); }
  P0 = Float32Array.from(P);
  // wiatr ~1.5 km n.p.m. nad środkiem (wiersz środkowy)
  const k15 = zc.findIndex((z) => z > 2500);
  const row = await sim.rowk(Math.floor(ny / 2), k15);
  const um = mean(row.u), vm = mean(row.v), sp = Math.hypot(um, vm);
  const dir = (Math.atan2(-um, -vm) * 180 / Math.PI + 360) % 360;
  // pasmowość: korelacja sumy z sumą przesuniętą o 2 km wzdłuż wiatru / w poprzek
  const corr = (ox, oy) => {
    let sxy = 0, sxx = 0, syy = 0, mxv = 0, myv = 0, n = 0;
    const pts = [];
    for (let j = 8; j < ny - 8; j++) for (let i = 8; i < nx - 8; i++) {
      const i2 = Math.round(i + ox), j2 = Math.round(j + oy);
      if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny) continue;
      pts.push([S[j * nx + i], S[j2 * nx + i2]]);
    }
    for (const [x, y] of pts) { mxv += x; myv += y; n++; }
    mxv /= n; myv /= n;
    for (const [x, y] of pts) { sxy += (x - mxv) * (y - myv); sxx += (x - mxv) ** 2; syy += (y - myv) ** 2; }
    return sxy / Math.sqrt(sxx * syy + 1e-12);
  };
  const L = 2000 / dx, ex = um / (sp || 1), ey = vm / (sp || 1);
  const cAlong = corr(ex * L, ey * L), cAcross = corr(-ey * L, ex * L);
  log(`okno ${w} (do ${r.clock.hour.toFixed(0)}:00, dzień ${Math.floor(r.simHours / 24) + 1}): suma 6 h śr ${mean(S).toFixed(1)} maks ${mx.toFixed(0)} mm | ` +
    `wiatr ~2.5 km ${sp.toFixed(1)} m/s z ${dir.toFixed(0)}° | korelacja 2 km wzdłuż ${cAlong.toFixed(2)} / w poprzek ${cAcross.toFixed(2)} | CAPE śr ${mean(sim.sfcGrid('CAPE').v).toFixed(0)}`);
  if (mx > thr) {
    let out = '';
    for (let rj = Math.floor(ny / 2) - 1; rj >= 0; rj--) {
      let l = '';
      for (let ci = 0; ci < Math.floor(nx / 2); ci++) {
        let m = 0;
        for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) m = Math.max(m, S[(rj * 2 + dj) * nx + ci * 2 + di]);
        l += m < 0.5 ? ' ' : m < 2 ? '.' : m < 5 ? ':' : m < 10 ? '-' : m < 20 ? '=' : m < 40 ? '+' : '#';
      }
      out += l + '\n';
    }
    log('suma okna (. <2, : <5, - <10, = <20, + <40, # ≥40 mm):\n' + out);
  }
}
