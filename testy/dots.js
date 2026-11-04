// Źródło „kropek” opadu (352 km, 4 km, lipiec): piksele słabego opadu 0.1–1 mm/h i małe obszary opadu (≤ 4 oczka) –
// udział schematu konwekcji (PRCUS) vs siatki; wieże schematu: liczba kolumn z CUL, głębokość i woda
sim.stop();
sim.set('date', window.__date || '2027-07-10');
await sim.dem(49.93, 19.91, 1.0, 0.8);
sim.stop(); await sim.roll(window.__sd || 4); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const nx = 88, ny = 88;
let r0 = await sim.run(1);
while (!(r0.simHours >= 20 && r0.clock.hour >= 11 && r0.clock.hour < 12)) r0 = await sim.run(Math.round(1800 / dt));
for (let hr = 0; hr < 6; hr++) {
  await sim.run(Math.round(3600 / dt));
  const PR = sim.sfcGrid('PR').v, PC = sim.sfcGrid('PRCUS').v, CU = sim.sfcGrid('CULS').v, CB = sim.sfcGrid('CUBS').v, CT = sim.sfcGrid('CUTS').v;
  let nw = 0, nwS = 0, prW = 0, prA = 0, prS = 0;
  for (let q = 0; q < PR.length; q++) { prA += PR[q]; prS += PC[q]; if (PR[q] > 0.1 && PR[q] < 1) { nw++; prW += PR[q]; if (PC[q] > 0.5 * PR[q]) nwS++; } }
  // obszary opadu > 0.1
  const lab = new Int32Array(PR.length).fill(-1); const comps = [];
  for (let s = 0; s < PR.length; s++) {
    if (PR[s] <= 0.1 || lab[s] >= 0) continue;
    const st = [s]; lab[s] = comps.length; let ar = 0, ps = 0, pc = 0, mx = 0;
    while (st.length) { const c = st.pop(); ar++; ps += PR[c]; pc += PC[c]; mx = Math.max(mx, PR[c]);
      const i = c % nx, j = (c / nx) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue; const qq = jj * nx + ii; if (PR[qq] > 0.1 && lab[qq] < 0) { lab[qq] = comps.length; st.push(qq); } } }
    comps.push({ ar, ps, pc, mx });
  }
  const small = comps.filter((c) => c.ar <= 4), weak = comps.filter((c) => c.mx < 1);
  const sh = (L) => (100 * L.reduce((s, c) => s + c.pc, 0) / Math.max(L.reduce((s, c) => s + c.ps, 0), 1e-9)).toFixed(0);
  // wieże schematu
  let nt = 0, dsum = 0, culs = [], deep = 0;
  for (let q = 0; q < CU.length; q++) if (CU[q] > 0.02 && CT[q] > CB[q] + 300) { nt++; dsum += CT[q] - CB[q]; culs.push(CU[q]); if (CT[q] - CB[q] > 4000) deep++; }
  culs.sort((x, y) => x - y);
  const qn = (p) => (culs.length ? culs[Math.floor(p * (culs.length - 1))].toFixed(1) : '-');
  log(`${12 + hr}:00 opad śr. ${(prA / PR.length).toFixed(3)} mm/h, schemat ${(100 * prS / prA).toFixed(0)}% | piksele 0.1–1 mm/h: ${nw} (${(100 * nw / PR.length).toFixed(0)}% mapy), z przewagą schematu ${(100 * nwS / Math.max(nw, 1)).toFixed(0)}%, ${(100 * prW / prA).toFixed(0)}% opadu | ` +
    `obszary: ${comps.length}, małe ≤4 oczka ${small.length} (schemat ${sh(small)}%), słabe max<1 ${weak.length} (schemat ${sh(weak)}%) | wieże: ${nt} kolumn (${(100 * nt / CU.length).toFixed(0)}%), głębokie >4 km ${deep}, śr. ${(dsum / Math.max(nt, 1) / 1000).toFixed(1)} km, CUL p10/50/90 ${qn(0.1)}/${qn(0.5)}/${qn(0.9)} g/m²`);
}
