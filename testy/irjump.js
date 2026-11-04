// Skoki zachmurzenia na obrazie IR: co 5 min średnia |ΔTB| w domenie (czy skoki przy terminach dużej skali co 30 min) i średni
// |ΔTB| między sąsiednimi oczkami wg położenia w siatce parametrów (co GS = 4 oczka; rytm 4 oczek = bloki siatki parametrów).
// Parametry: __date, __sd, __spin (godzin rozbiegu, 5), __hours (2)
sim.stop();
sim.set('date', window.__date || '2026-10-20');
await sim.roll(window.__sd || 4);
if (window.__const) { sim.stop(); await sim.mode('const'); }
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
let r = await sim.run(Math.round((window.__spin || 5) * 3600 / dt));
const B = sim.base();
let prev = Float32Array.from(sim.sfcGrid('TB').v);
const g0 = sim.sfcGrid('TB'), nx = g0.nx, ny = g0.ny;
const ph = [0, 0, 0, 0], phn = [0, 0, 0, 0];
const rows = [];
const n5 = Math.max(1, Math.round(300 / dt));
for (let s = 0; s < (window.__hours || 2) * 12; s++) {
  r = await sim.run(n5);
  const T = Float32Array.from(sim.sfcGrid('TB').v);
  let d = 0, big = 0;
  for (let k = 0; k < T.length; k++) { const x = Math.abs(T[k] - prev[k]); d += x; if (x > 10) big++; }
  const tmin = (r.simHours * 60) % 30;
  rows.push(`${r.clock.hour.toFixed(2)} h (min. w terminie ${tmin.toFixed(0)}): |ΔTB| śr ${(d / T.length).toFixed(2)} K, oczek > 10 K: ${big}`);
  for (let j = 0; j < ny; j++) for (let i = 0; i + 1 < nx; i++) { const p = (i + B.mg) % 4; ph[p] += Math.abs(T[j * nx + i + 1] - T[j * nx + i]); phn[p]++; }
  prev = T;
}
log(rows.join('\n'));
log(`|TB(i+1) − TB(i)| wg (i mod 4) siatki parametrów: ${ph.map((x, p) => (x / phn[p]).toFixed(2)).join(' / ')} K`);
