// Stacjonarność i wydłużenie opadu chwilowego (A/B z ?cpm=0): co godzinę mapa opadu chwilowego i druga 30 min później;
// gdy opad > 1 mm/h na > 0.5% mapy: korelacja obu map (1 – obraz stoi w miejscu) i wydłużenie wzdłuż wiatru ~3 km
// (korelacja mapy z nią samą przesuniętą o 1 km wzdłuż wiatru minus w poprzek; > 0 – pasma wzdłuż wiatru).
// Na końcu średnie i sumy opadu. Parametry: __hours (24), __skip (6)
sim.stop();
for (let n = 0; n < 600 && !(await sim.syn()).cls; n++) await new Promise((r) => setTimeout(r, 500));
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
await sim.run(Math.round((window.__skip ?? 6) * 3600 / dt));
const g0 = sim.sfcGrid('PR'), nx = g0.nx, ny = g0.ny, dx = g0.dx, B = sim.base(), zc = sim.levels();
const k3 = zc.findIndex((z) => z > 3000);
const corr = (A, C, ox = 0, oy = 0) => {
  let sxy = 0, sxx = 0, syy = 0, ma = 0, mc = 0, n = 0;
  const pts = [];
  for (let j = 6; j < ny - 6; j++) for (let i = 6; i < nx - 6; i++) {
    const i2 = Math.round(i + ox), j2 = Math.round(j + oy);
    if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny) continue;
    pts.push([A[j * nx + i], C[j2 * nx + i2]]);
  }
  for (const [x, y] of pts) { ma += x; mc += y; n++; }
  ma /= n; mc /= n;
  for (const [x, y] of pts) { sxy += (x - ma) * (y - mc); sxx += (x - ma) ** 2; syy += (y - mc) ** 2; }
  return sxy / Math.sqrt(sxx * syy + 1e-12);
};
const P0 = Float32Array.from(sim.sfcGrid('PACC').v);
const st = [], el = [];
for (let hh = 0; hh < (window.__hours || 24); hh++) {
  const P1 = Float32Array.from(sim.sfcGrid('PR').v);
  const row = await sim.rowk(Math.floor(ny / 2), k3);
  const um = row.u.reduce((x, y) => x + y, 0) / row.u.length, vm = row.v.reduce((x, y) => x + y, 0) / row.v.length, sp = Math.hypot(um, vm) || 1;
  await sim.run(Math.round(1800 / dt));
  const P2 = Float32Array.from(sim.sfcGrid('PR').v);
  await sim.run(Math.round(1800 / dt));
  const rain = P1.filter((x) => x > 1).length / P1.length;
  if (rain > 0.005) {
    const L = 1000 / dx, ex = um / sp, ey = vm / sp;
    const s = corr(P1, P2), e = corr(P1, P1, ex * L, ey * L) - corr(P1, P1, -ey * L, ex * L);
    st.push(s); el.push(e);
    log(`godz. ${hh}: opad > 1 mm/h ${(100 * rain).toFixed(1)}% | po 30 min korelacja ${s.toFixed(2)} | wydłużenie wzdłuż wiatru ${e.toFixed(2)} | wiatr ~3 km ${sp.toFixed(0)} m/s`);
  }
}
const P = sim.sfcGrid('PACC').v;
let sum = 0, mx = 0;
for (let k = 0; k < P.length; k++) { const d = P[k] - P0[k]; sum += d; mx = Math.max(mx, d); }
const avg = (v) => (v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN);
log(`ŚREDNIO (${st.length} godz. z opadem): korelacja po 30 min ${avg(st).toFixed(2)}, wydłużenie ${avg(el).toFixed(2)} | suma średnio ${(sum / P.length).toFixed(1)} mm, maks ${mx.toFixed(0)} mm`);
