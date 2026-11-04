window.__seeds = [1];
// duża domena (oczko ~25 km): opad domeny vs model synoptyczny na tym samym obszarze, udział schematu, 3 doby
sim.stop();
sim.set('date', window.__date || '2026-07-10');
await sim.dem(52.0, 19.3, 1.0, 0.75);
const rows = [];
for (const sd of (window.__seeds || [1, 3])) {
  sim.stop(); await sim.roll(sd); sim.stop();
  const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
  let pe = 0, all = 0, cu = 0, n = 0;
  for (let hr = 0; hr < 72; hr++) {
    await sim.run(Math.round(3600 / dt));
    const PR = sim.sfcGrid('PR').v, PC = sim.sfcGrid('PRCUS').v;
    let s = 0, c = 0; for (let q = 0; q < PR.length; q++) { s += PR[q]; c += PC[q]; }
    all += s / PR.length; cu += c / PR.length; pe += await sim.pePr();
  }
  const P = sim.sfcGrid('PACC').v, hh = sim.hgt(), gw = sim.sfcGrid('PACC').nx; let mx = 0, im = 0; for (let q = 0; q < P.length; q++) if (P[q] > mx) { mx = P[q]; im = q; }
  const n50 = P.filter((x) => x > 100).length;
  let mi = 0; const gh = P.length / gw; for (let jj = 8; jj < gh - 8; jj++) for (let ii = 8; ii < gw - 8; ii++) mi = Math.max(mi, P[jj * gw + ii]);
  rows.push(`s${sd}: domena ${(all / 3).toFixed(2)} mm/d (schemat ${(100 * cu / Math.max(all, 1e-9)).toFixed(0)}%), model synopt. ${(pe / 3).toFixed(2)} mm/d, maks. suma ${mx.toFixed(0)} mm w (${im % gw}, ${Math.floor(im / gw)}) h ${Math.round(hh[im])} m, oczek > 100 mm: ${n50}, maks. we wnętrzu ${mi.toFixed(0)} mm`);
}
log('\n' + rows.join('\n'));
