// MCS? największy zwarty system opadu (> 1 mm/h): powierzchnia, długość (największy wymiar), udział rdzeni > 10 mm/h i opadu warstwowego 1–5 mm/h
sim.stop();
sim.set('date', window.__date || '2026-07-10');
await sim.dem(52.0, 19.3, 1.0, 0.75);
sim.stop(); await sim.roll(window.__sd || 4); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const out = [];
for (let hr = 0; hr < (window.__hours || 30); hr++) {
  await sim.run(Math.round(3600 / dt));
  if (hr % 2) continue;
  const g = sim.sfcGrid('PR'), PR = g.v, nx = g.nx, ny = g.ny, dk = g.dx / 1000, lab = new Int32Array(PR.length);
  let best = null, nsys = 0;
  for (let q = 0; q < PR.length; q++) {
    if (PR[q] <= 1 || lab[q]) continue;
    const st = [q]; lab[q] = 1; let n = 0, nc = 0, ns = 0, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    while (st.length) { const p = st.pop(); const i = p % nx, j = (p / nx) | 0; n++; if (PR[p] > 10) nc++; else if (PR[p] < 5) ns++;
      x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0 = Math.min(y0, j); y1 = Math.max(y1, j);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue; const r = jj * nx + ii; if (PR[r] > 1 && !lab[r]) { lab[r] = 1; st.push(r); } } }
    const len = Math.hypot(x1 - x0 + 1, y1 - y0 + 1) * dk;
    if (len >= 100) nsys++;
    if (!best || n > best.n) best = { n, nc, ns, len };
  }
  if (best) out.push(`${(hr + 7) % 24}:00 największy: ${(best.n * dk * dk).toFixed(0)} km², długość ${best.len.toFixed(0)} km, rdzenie > 10 mm/h ${(100 * best.nc / best.n).toFixed(0)}%, warstwowy 1–5 mm/h ${(100 * best.ns / best.n).toFixed(0)}% | systemów ≥ 100 km: ${nsys}`);
}
log('\n' + out.join('\n'));
