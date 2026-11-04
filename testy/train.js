// „trening” burz: udział 5% najmokrzejszych oczek w opadzie domeny, maks. suma, średnia (Polska, lipiec, 36 h)
sim.stop();
sim.set('date', window.__date || '2026-07-10');
await sim.dem(52.0, 19.3, 1.0, 0.75);
const rows = [];
for (const sd of (window.__seeds || [2, 3, 4])) {
  sim.stop(); await sim.roll(sd); sim.stop();
  const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
  let cu = 0, all = 0;
  for (let hr = 0; hr < 36; hr++) { await sim.run(Math.round(3600 / dt)); const PR = sim.sfcGrid('PR').v, PC = sim.sfcGrid('PRCUS').v; for (let q = 0; q < PR.length; q++) { all += PR[q]; cu += PC[q]; } }
  const P = sim.sfcGrid('PACC').v.slice().sort((x, y) => y - x);
  const tot = P.reduce((x, y) => x + y, 0), top = P.slice(0, Math.ceil(P.length * 0.05)).reduce((x, y) => x + y, 0);
  rows.push(`s${sd}: średnio ${(tot / P.length).toFixed(1)} mm, maks. ${P[0].toFixed(0)} mm, 5% oczek = ${(100 * top / Math.max(tot, 1e-9)).toFixed(0)}% opadu, oczek > 20 mm: ${P.filter((x) => x > 20).length}, schemat ${(100 * cu / Math.max(all, 1e-9)).toFixed(0)}%`);
}
log('\n' + rows.join('\n'));
