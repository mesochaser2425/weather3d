// burze 1 km (scenariusz „Burze”): zimne wypływy (T2 pod opadem > 2 mm/h − pierścień 8–20 km bez opadu), maks. natężenie, dBZ, suma
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const rows = []; let cpS = 0, cpN = 0, prMax = 0, zMax = 0;
for (let hr = 0; hr < (window.__hours || 10); hr++) {
  await sim.run(Math.round(3600 / dt));
  const g = sim.sfcGrid('T2'), T = g.v, PR = sim.sfcGrid('PR').v, Z = sim.sfcGrid('DBZ').v, nx = g.nx, ny = g.ny;
  const r0 = Math.round(8000 / g.dx), r1 = Math.round(20000 / g.dx);
  let ds = 0, n = 0, pm = 0, zm = 0;
  for (let q = 0; q < PR.length; q++) { pm = Math.max(pm, PR[q]); zm = Math.max(zm, Z[q]); }
  for (let j = r1; j < ny - r1; j += 2) for (let i = r1; i < nx - r1; i += 2) {
    if (PR[j * nx + i] < 2) continue;
    let s = 0, c = 0;
    for (let dj = -r1; dj <= r1; dj += 2) for (let di = -r1; di <= r1; di += 2) { const d = Math.hypot(di, dj); if (d < r0 || d > r1) continue; const q = (j + dj) * nx + i + di; if (PR[q] < 0.05) { s += T[q]; c++; } }
    if (c > 5) { ds += T[j * nx + i] - s / c; n++; }
  }
  if (n) { cpS += ds; cpN += n; }
  prMax = Math.max(prMax, pm); zMax = Math.max(zMax, zm);
  rows.push(`${hr + 1}h: opad>2: ${n} oczek, ΔT2 ${n ? (ds / n).toFixed(1) : '–'}, maks ${pm.toFixed(0)} mm/h, ${zm.toFixed(0)} dBZ`);
}
const P = sim.sfcGrid('PACC').v; let s = 0, mx = 0; for (const v of P) { s += v; mx = Math.max(mx, v); }
log('\n' + rows.join('\n') + `\nRAZEM: zimne wypływy śr. ${(cpS / Math.max(cpN, 1)).toFixed(2)} K; maks. ${prMax.toFixed(0)} mm/h, ${zMax.toFixed(0)} dBZ; suma śr. ${(s / P.length).toFixed(2)} mm, maks. ${mx.toFixed(0)} mm`);
