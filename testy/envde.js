// środowisko burz (Niemcy 2 km, s2): ścinanie 0–6 km, średni wiatr 0–6 km, CAPE, MUCAPE, liczba komórek > 5 mm/h co godzinę
sim.stop();
sim.set('date', '2026-07-10');
await sim.dem(52.7, 10.2, 1.0, 0.8);
sim.stop(); await sim.roll(window.__sd || 2); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const out = [];
for (let hr = 0; hr < 13; hr++) {
  await sim.run(Math.round(3600 / dt));
  if (hr % 2) continue;
  const g = sim.sfcGrid('PR'), PR = g.v, nx = g.nx, ny = g.ny;
  const SU = sim.sfcGrid('SHU').v, SV = sim.sfcGrid('SHV').v, MU = sim.sfcGrid('MWU').v, MV = sim.sfcGrid('MWV').v, CA = sim.sfcGrid('CAPE').v, SR = sim.sfcGrid('SRH03').v;
  let sh = 0, mw = 0, ca = 0, cmx = 0, srh = 0, n = 0;
  for (let q = 0; q < PR.length; q += 3) { sh += Math.hypot(SU[q], SV[q]); mw += Math.hypot(MU[q], MV[q]); ca += CA[q]; cmx = Math.max(cmx, CA[q]); srh += SR[q]; n++; }
  // komórki: spójne obszary > 5 mm/h
  const lab = new Int32Array(PR.length); let cells = 0, area = 0;
  for (let q = 0; q < PR.length; q++) {
    if (PR[q] <= 5 || lab[q]) continue;
    cells++; const st = [q]; lab[q] = cells;
    while (st.length) { const p = st.pop(); area++; const i = p % nx, j = (p / nx) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue; const r = jj * nx + ii; if (PR[r] > 5 && !lab[r]) { lab[r] = cells; st.push(r); } } }
  }
  out.push(`${hr + 7}:00 ścinanie 0–6 ${(sh / n).toFixed(1)} m/s, wiatr 0–6 ${(mw / n).toFixed(1)} m/s, SRH03 ${(srh / n).toFixed(0)}, CAPE śr ${(ca / n).toFixed(0)} maks ${cmx.toFixed(0)} | komórek > 5 mm/h: ${cells} (śr. ${(cells ? area / cells * g.dx * g.dx / 1e6 : 0).toFixed(0)} km²)`);
}
log('\n' + out.join('\n'));
