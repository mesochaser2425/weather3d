// Lato w domenie użytkownika (352 km, 4 km, środek 49.93°N 19.91°E): „kropeczki” opadu, cumulusy zakrywające niebo,
// plamy punktu rosy. Co godzinę 10–19 (2. doba): opad i udział schematu konwekcji, opad spod „czystego” nieba,
// komórki opadu (obszary > 0.5 mm/h: liczba, średnie pole), zachmurzenie, CAPE, chropowatość pól (d2/d1: 0 gładkie,
// ~1.7 biały szum) dla Td 2 m, T 2 m i opadu. Na końcu zrzut mapy (window.__f – numer pola, domyślnie radar).
sim.stop();
sim.set('date', window.__date || '2027-07-10');
await sim.dem(49.93, 19.91, 1.0, 0.8);
sim.stop(); await sim.roll(window.__sd || 1); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const nx = 88, ny = 88;
const rough = (v) => {
  let d1 = 0, d2 = 0;
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const c = j * nx + i;
    d1 += Math.abs(v[c + 1] - v[c]) + Math.abs(v[c + nx] - v[c]);
    d2 += Math.abs(v[c + 1] - 2 * v[c] + v[c - 1]) + Math.abs(v[c + nx] - 2 * v[c] + v[c - nx]);
  }
  return d2 / Math.max(d1, 1e-9);
};
const cells = (P, thr) => {
  const lab = new Int32Array(P.length).fill(-1); let n = 0, area = 0;
  for (let s = 0; s < P.length; s++) {
    if (P[s] <= thr || lab[s] >= 0) continue;
    const st = [s]; lab[s] = n; let ar = 0;
    while (st.length) {
      const c = st.pop(); ar++;
      const i = c % nx, j = (c / nx) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const q = jj * nx + ii; if (P[q] > thr && lab[q] < 0) { lab[q] = n; st.push(q); }
      }
    }
    n++; area += ar;
  }
  return { n, area: n ? area / n : 0 };
};
// do 10:00 drugiej doby
let r0 = await sim.run(1);
while (!(r0.simHours >= 20 && r0.clock.hour >= 10 && r0.clock.hour < 11)) r0 = await sim.run(Math.round(1800 / dt));
const acc = { pr: 0, cu: 0, clear: 0, cov: 0, ovc: 0, cape: 0, n: 0, cn: 0, ca: 0, rTd: 0, rT: 0, rP: 0 };
for (let hr = 0; hr < (window.__hrs || 10); hr++) {
  await sim.run(Math.round(3600 / dt));
  const PR = sim.sfcGrid('PR').v, PC = sim.sfcGrid('PRCUS').v, CV = sim.sfcGrid('COVER').v, CP = sim.sfcGrid('CAPE').v;
  let pr = 0, cu = 0, clear = 0, cov = 0, ovc = 0, cape = 0;
  for (let q = 0; q < PR.length; q++) {
    pr += PR[q]; cu += PC[q]; cov += CV[q]; ovc += CV[q] > 0.9; cape += CP[q];
    if (CV[q] < 0.2) clear += PR[q];
  }
  const c = cells(PR, 0.5);
  const rTd = rough(sim.sfcGrid('TD2').v), rT = rough(sim.sfcGrid('T2').v), rP = rough(PR);
  const N = PR.length;
  log(`${10 + hr + 1}:00 opad ${(pr / N).toFixed(3)} mm/h (schemat ${(100 * cu / Math.max(pr, 1e-9)).toFixed(0)}%, spod nieba < 20%: ${(100 * clear / Math.max(pr, 1e-9)).toFixed(0)}%) | ` +
    `komórki > 0.5 mm/h: ${c.n}, śr. ${c.area.toFixed(1)} oczek | chmury ${(100 * cov / N).toFixed(0)}%, zachm. > 90%: ${(100 * ovc / N).toFixed(0)}% oczek | CAPE ${(cape / N).toFixed(0)} | d2/d1 Td ${rTd.toFixed(2)} T ${rT.toFixed(2)} opad ${rP.toFixed(2)}`);
  Object.entries({ pr, cu, clear, cov, ovc, cape }).forEach(([k, v]) => { acc[k] += v / (k === 'cu' || k === 'clear' || k === 'pr' ? 1 : N); });
  acc.cn += c.n; acc.ca += c.area; acc.rTd += rTd; acc.rT += rT; acc.rP += rP; acc.n++;
}
const n = acc.n;
log(`RAZEM: schemat ${(100 * acc.cu / acc.pr).toFixed(0)}% opadu, spod nieba < 20% ${(100 * acc.clear / acc.pr).toFixed(0)}% | komórki ${(acc.cn / n).toFixed(0)}/h, śr. ${(acc.ca / n).toFixed(1)} oczek | ` +
  `chmury ${(100 * acc.cov / n).toFixed(0)}%, > 90%: ${(100 * acc.ovc / n).toFixed(0)}% | CAPE ${(acc.cape / n).toFixed(0)} | d2/d1 Td ${(acc.rTd / n).toFixed(2)} T ${(acc.rT / n).toFixed(2)} opad ${(acc.rP / n).toFixed(2)}`);
sim.set('fieldH', window.__f ?? 22);
await sim.draw();
await new Promise((r) => setTimeout(r, 1500));
