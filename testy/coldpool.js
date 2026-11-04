// zimne wypływy: T2 i θ' najniższej warstwy pod opadem > 2 mm/h vs okolica bez opadu (pierścień 30–60 km), Polska, s4
sim.stop();
sim.set('date', '2026-07-10');
await sim.dem(52.0, 19.3, 1.0, 0.75);
sim.stop(); await sim.roll(window.__sd || 4); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const out = [];
for (const h of [28, 31, 34]) {
  await sim.run(Math.round((h === 28 ? 28 : 3) * 3600 / dt));
  const g = sim.sfcGrid('T2'), T = g.v, PR = sim.sfcGrid('PR').v, nx = g.nx, ny = g.ny, r0 = Math.round(30000 / g.dx), r1 = Math.round(60000 / g.dx);
  let dsum = 0, n = 0;
  for (let j = r1; j < ny - r1; j++) for (let i = r1; i < nx - r1; i++) {
    if (PR[j * nx + i] < 2) continue;
    let s = 0, c = 0;
    for (let dj = -r1; dj <= r1; dj++) for (let di = -r1; di <= r1; di++) { const d = Math.hypot(di, dj); if (d < r0 || d > r1) continue; const q = (j + dj) * nx + i + di; if (PR[q] < 0.1) { s += T[q]; c++; } }
    if (c > 5) { dsum += T[j * nx + i] - s / c; n++; }
  }
  out.push(`h${h}: oczek z opadem > 2 mm/h ${n}, T2 pod opadem − otoczenie ${n ? (dsum / n).toFixed(1) : '–'} K`);
}
log(out.join(' | '));
