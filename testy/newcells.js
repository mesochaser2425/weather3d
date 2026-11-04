// gdzie rodzą się nowe komórki (> 3 mm/h) względem istniejących: pod wiatr (back-building), z wiatrem, z boku, osobno
sim.stop();
sim.set('date', '2026-07-10');
await sim.dem(window.__lat || 52.7, window.__lon || 10.2, 1.0, 0.8);
sim.stop(); await sim.roll(window.__sd || 2); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
await sim.run(Math.round(4.5 * 3600 / dt));
const cellsOf = () => {
  const g = sim.sfcGrid('PR'), PR = g.v, nx = g.nx, ny = g.ny, lab = new Int32Array(PR.length), out = [];
  for (let q = 0; q < PR.length; q++) {
    if (PR[q] <= 3 || lab[q]) continue;
    const st = [q]; lab[q] = 1; let sx = 0, sy = 0, n = 0;
    while (st.length) { const p = st.pop(); const i = p % nx, j = (p / nx) | 0; sx += i; sy += j; n++;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue; const r = jj * nx + ii; if (PR[r] > 3 && !lab[r]) { lab[r] = 1; st.push(r); } } }
    if (n >= 2) out.push([sx / n * g.dx / 1000, sy / n * g.dx / 1000, n]);
  }
  return out;
};
const MU = sim.sfcGrid('MWU').v, MV = sim.sfcGrid('MWV').v; let mu = 0, mv = 0; for (let q = 0; q < MU.length; q++) { mu += MU[q]; mv += MV[q]; } mu /= MU.length; mv /= MV.length;
const sp = Math.hypot(mu, mv), ex = mu / sp, ey = mv / sp;
let prev = cellsOf(); const cnt = { up: 0, down: 0, side: 0, alone: 0 }; let tot = 0;
const step = 600;
for (let s = 0; s < 36; s++) {
  await sim.run(Math.round(step / dt));
  const cur = cellsOf();
  const adv = prev.map(([x, y]) => [x + mu * step / 1000, y + mv * step / 1000]);
  for (const [x, y] of cur) {
    let best = 1e9, bx = 0, by = 0;
    for (const [px, py] of adv) { const d = Math.hypot(x - px, y - py); if (d < best) { best = d; bx = x - px; by = y - py; } }
    if (best < 8) continue;                       // ta sama komórka (przesunięta z wiatrem)
    tot++;
    if (best > 40) { cnt.alone++; continue; }
    const al = bx * ex + by * ey, cr = -bx * ey + by * ex;
    if (Math.abs(al) > Math.abs(cr)) { if (al < 0) cnt.up++; else cnt.down++; } else cnt.side++;
  }
  prev = cur;
}
const p = (k) => `${(100 * cnt[k] / Math.max(tot, 1)).toFixed(0)}%`;
log(`wiatr 0–6 km ${sp.toFixed(1)} m/s; nowych komórek ${tot}: pod wiatr (za starą) ${p('up')}, z wiatrem (przed) ${p('down')}, z boku ${p('side')}, osobno (> 40 km) ${p('alone')}`);
