// Manipulacja atmosfery, opad: suma opadu, T, punkt rosy i zachmurzenie domeny przy tej samej pogodzie. Adres z &rnf=, &tp=ziarno,doby, np. ?dx=8000&nx=40&ny=40&start=52,19,6&rnf=2&tp=3,12
while (!sim.ready()) await new Promise((r) => setTimeout(r, 300));
sim.stop();
const P = (new URLSearchParams(location.search).get('tp') || '3,12').split(',');
await sim.roll(+P[0]);
while (!sim.ready()) await new Promise((r) => setTimeout(r, 300));
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600, nd = Math.round(86400 / dt);
const mean = (v) => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i]; return s / v.length; };
const sum = { t: 0, td: 0, cov: 0, n: 0 }, day = [];
let p0 = 0, mx = 0;
for (let d = 0; d < +P[1]; d++) {
  for (let k = 0; k < 4; k++) {
    await sim.run(Math.round(nd / 4));
    const g = sim.sfcGrid('T2');
    sum.t += mean(g.v); sum.td += mean(sim.sfcGrid('TD2').v); sum.cov += mean(sim.sfcGrid('COVER').v); sum.n++;
  }
  const pg = sim.sfcGrid('PACC').v, p1 = mean(pg);
  day.push(+(p1 - p0).toFixed(1)); p0 = p1;
  for (let i = 0; i < pg.length; i++) mx = Math.max(mx, pg[i]);
}
log(JSON.stringify({ R: sim.manip().R.to, opad: +p0.toFixed(1), maksOczko: +mx.toFixed(0), T: +(sum.t / sum.n).toFixed(1), Td: +(sum.td / sum.n).toFixed(1), chmury: +(100 * sum.cov / sum.n).toFixed(0), doby: day }));
