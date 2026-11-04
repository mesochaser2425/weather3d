// konwekcja a wymuszenie: suma opadu domeny vs model synoptyczny, udział opadu w strefach wypiętrzenia (LIFT > 100 m)
sim.stop();
sim.set('date', window.__date || '2026-07-10');
await sim.dem(50.06, 19.94, 1.0, 0.75);
const rows = [];
for (const sd of (window.__seeds || [1, 3])) {
  sim.stop(); await sim.roll(sd); sim.stop();
  const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
  let pe = 0, inL = 0, all = 0, aL = 0, n = 0, wet = 0;
  for (let hr = 0; hr < 48; hr++) {
    await sim.run(Math.round(3600 / dt));
    const PR = sim.sfcGrid('PR').v; const L = sim.sfcGrid('LIFT') ? sim.sfcGrid('LIFT').v : null;
    for (let q = 0; q < PR.length; q++) { all += PR[q]; if (L && L[q] > 100) { inL += PR[q]; aL++; } if (PR[q] > 1) wet++; n++; }
    const sy = await sim.syn(); pe += sy.pr || 0;
  }
  const P = sim.sfcGrid('PACC').v; let s = 0, mx = 0; for (const v of P) { s += v; mx = Math.max(mx, v); }
  rows.push(`s${sd}: domena ${(s / P.length).toFixed(1)} mm (maks. ${mx.toFixed(0)}), model synopt. ${pe.toFixed(1)} mm | oczka > 1 mm/h ${(100 * wet / n).toFixed(1)}% | LIFT>100: ${(100 * aL / n).toFixed(0)}% pow., ${(100 * inL / Math.max(all, 1e-9)).toFixed(0)}% opadu`);
}
log('\n' + rows.join('\n'));
