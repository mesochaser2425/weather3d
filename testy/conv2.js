// Polska (cała), lipiec: opad domeny vs model synoptyczny, udział konwekcji parametryzowanej (PRCUS),
// udział opadu w strefach wypiętrzenia (LIFT > 100 m), odsetek oczek z opadem > 1 mm/h
sim.stop();
sim.set('date', window.__date || '2026-07-10');
await sim.dem(52.0, 19.3, 1.0, 0.75);
const rows = [];
for (const sd of (window.__seeds || [1, 3])) {
  sim.stop(); await sim.roll(sd); sim.stop();
  const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
  let pe = 0, inL = 0, all = 0, cu = 0, aL = 0, n = 0, wet = 0;
  for (let hr = 0; hr < (window.__hours || 48); hr++) {
    await sim.run(Math.round(3600 / dt));
    const PR = sim.sfcGrid('PR').v, PC = sim.sfcGrid('PRCUS').v, L = sim.sfcGrid('LIFT')?.v;
    for (let q = 0; q < PR.length; q++) { all += PR[q]; cu += PC[q]; if (L && L[q] > 100) { inL += PR[q]; aL++; } if (PR[q] > 1) wet++; n++; }
    const sy = await sim.syn(); pe += sy.pr || 0;
  }
  const P = sim.sfcGrid('PACC').v; let s = 0, mx = 0; for (const v of P) { s += v; mx = Math.max(mx, v); }
  rows.push(`s${sd}: domena ${(s / P.length).toFixed(1)} mm (maks. ${mx.toFixed(0)}), środek wg modelu synopt. ${pe.toFixed(1)} mm | param. ${(100 * cu / Math.max(all, 1e-9)).toFixed(0)}% | oczka > 1 mm/h ${(100 * wet / n).toFixed(1)}% | LIFT>100: ${(100 * aL / n).toFixed(0)}% pow., ${(100 * inL / Math.max(all, 1e-9)).toFixed(0)}% opadu`);
}
log(`dx ${window.__sim.grid ? '' : ''}\n` + rows.join('\n'));
