// Zimne wypływy przy miejscu z mapy świata (model synoptyczny): co godzinę ΔT2 pod opadem > 2 mm/h względem pierścienia 8–20 km
// bez opadu (jak cpstorm.js), maks. natężenie; co 3 h wiersz; na końcu średnia ΔT2, suma opadu (średnia, maks.), udział 5% oczek.
// Parametry: __lat, __lon (Kraków), __date (2027-07-01), __sd (2), __hours (48)
sim.stop();
sim.set('date', window.__date || '2027-07-01');
await sim.place(window.__lat ?? 50.06, window.__lon ?? 19.94);
sim.stop(); await sim.roll(window.__sd || 2); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const H = window.__hours || 48;
let cpS = 0, cpN = 0, prMax = 0, row = { n: 0, ds: 0, pm: 0 };
for (let hr = 1; hr <= H; hr++) {
  const r = await sim.run(Math.round(3600 / dt));
  const g = sim.sfcGrid('T2'), T = g.v, PR = sim.sfcGrid('PR').v, nx = g.nx, ny = g.ny;
  const r0 = Math.max(1, Math.round(8000 / g.dx)), r1 = Math.max(r0 + 1, Math.round(20000 / g.dx)), st = Math.max(1, Math.round(2000 / g.dx));
  let pm = 0;
  for (const x of PR) pm = Math.max(pm, x);
  for (let j = r1; j < ny - r1; j += st) for (let i = r1; i < nx - r1; i += st) {
    if (PR[j * nx + i] < 2) continue;
    let s = 0, c = 0;
    for (let dj = -r1; dj <= r1; dj += st) for (let di = -r1; di <= r1; di += st) {
      const d = Math.hypot(di, dj);
      if (d < r0 || d > r1) continue;
      const q = (j + dj) * nx + i + di;
      if (PR[q] < 0.05) { s += T[q]; c++; }
    }
    if (c > 5) { row.ds += T[j * nx + i] - s / c; row.n++; }
  }
  row.pm = Math.max(row.pm, pm); prMax = Math.max(prMax, pm);
  if (hr % 3 === 0) {
    if (row.n) { cpS += row.ds; cpN += row.n; }
    log(`${String(hr).padStart(2)} h (${r.clock.hour.toFixed(0)}:00): opad > 2 mm/h ${row.n} oczek, ΔT2 ${row.n ? (row.ds / row.n).toFixed(1) : '–'} K, maks ${row.pm.toFixed(0)} mm/h`);
    row = { n: 0, ds: 0, pm: 0 };
  }
}
const P = Array.from(sim.sfcGrid('PACC').v).sort((x, y) => y - x);
const tot = P.reduce((x, y) => x + y, 0), top = P.slice(0, Math.ceil(P.length * 0.05)).reduce((x, y) => x + y, 0);
log(`RAZEM ${H} h: zimne wypływy śr. ${(cpS / Math.max(cpN, 1)).toFixed(2)} K (${cpN} oczko·h) | maks ${prMax.toFixed(0)} mm/h | suma śr. ${(tot / P.length).toFixed(2)} mm, maks ${P[0].toFixed(0)} mm, p99 ${P[Math.floor(0.01 * P.length)].toFixed(0)} | 5% oczek = ${(100 * top / Math.max(tot, 1e-9)).toFixed(0)}% opadu`);
