// słabe obszary opadu: udział siatki (PR − rozłożony PRCUS) i schematu; co je tworzy na siatce (q_r, w, wysokość chmury)
sim.stop();
sim.set('date', '2027-07-10');
await sim.dem(49.93, 19.91, 1.0, 0.8);
sim.stop(); await sim.roll(window.__sd || 4); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const nx = 88, ny = 88;
let r0 = await sim.run(1);
while (!(r0.simHours >= 20 && r0.clock.hour >= 13 && r0.clock.hour < 14)) r0 = await sim.run(Math.round(1800 / dt));
for (let t = 0; t < 3; t++) {
  await sim.run(Math.round(1800 / dt));
  const PR = sim.sfcGrid('PR').v, PS = sim.sfcGrid('PRCUS').v;
  const SP = new Float32Array(PR.length);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { let s = 0, w = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue; const g = Math.exp(-(di * di + dj * dj) / 0.7); s += g * PS[jj * nx + ii]; w += g; } SP[j * nx + i] = s / w; }
  const lab = new Int32Array(PR.length).fill(-1); const comps = [];
  for (let s = 0; s < PR.length; s++) {
    if (PR[s] <= 0.1 || lab[s] >= 0) continue;
    const st = [s]; lab[s] = comps.length; let ar = 0, ps = 0, pg = 0, mx = 0, cells = [];
    while (st.length) { const c = st.pop(); ar++; ps += PR[c]; pg += Math.max(PR[c] - SP[c], 0); mx = Math.max(mx, PR[c]); cells.push(c);
      const i = c % nx, j = (c / nx) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue; const qq = jj * nx + ii; if (PR[qq] > 0.1 && lab[qq] < 0) { lab[qq] = comps.length; st.push(qq); } } }
    comps.push({ ar, ps, pg, mx, cells });
  }
  const weak = comps.filter((c) => c.mx < 1.5);
  const wg = weak.filter((c) => c.pg > 0.5 * c.ps), wsch = weak.length - wg.length;
  // kolumny w centrach słabych obszarów z siatki
  const prof = [];
  for (const c of wg.slice(0, 6)) {
    let best = c.cells[0]; for (const q of c.cells) if (PR[q] > PR[best]) best = q;
    const i = best % nx, j = (best / nx) | 0;
    const col = await sim.colq(i, j);
    let top = 0, wmx = 0, qrm = 0, qcm = 0, qim = 0; for (const L of col) { if ((L.qc || 0) + (L.qi || 0) > 0.01) top = L.z; wmx = Math.max(wmx, L.w || 0); qrm = Math.max(qrm, L.qr || 0); qcm = Math.max(qcm, L.qc || 0); qim = Math.max(qim, L.qi || 0); }
    prof.push(`[${i},${j}] ${c.ar} ocz., maks ${c.mx.toFixed(2)} mm/h, wierzch. ${(top / 1000).toFixed(1)} km, w maks ${wmx.toFixed(2)}, qc ${qcm.toFixed(2)} qi ${qim.toFixed(2)} qr ${qrm.toFixed(2)} g/kg`);
  }
  log(`obszary ${comps.length}, słabe (maks < 1.5 mm/h) ${weak.length}: z siatki ${wg.length}, ze schematu ${wsch}; średnie pole słabych z siatki ${(wg.reduce((s, c) => s + c.ar, 0) / Math.max(wg.length, 1)).toFixed(1)} oczek`);
  log('  ' + prof.join('\n  '));
}
