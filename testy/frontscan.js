// Szukanie silnych frontów chłodnych: dla kilku losowań sam model synoptyczny (kopia, bez domeny) – średnie dobowe w okolicy
// domeny; największy spadek T ~1.5 km i przy gruncie z doby na dobę. Parametry: window.__date, __seeds, __days
sim.stop();
sim.set('date', window.__date || '2026-10-20');
for (const seed of (window.__seeds || [1, 2, 4, 5, 6, 7])) {
  await sim.roll(seed);
  const y = await sim.peYear(window.__days || 8);
  let best = { d: 0, dt15: 0, dts: 0 };
  for (let d = 1; d < y.length; d++) { const dt15 = y[d - 1].t15 - y[d].t15; if (dt15 > best.dt15) best = { d, dt15, dts: y[d - 1].ts - y[d].ts }; }
  log(`seed ${seed}: T1.5 km dobowo ${y.map((x) => x.t15.toFixed(1)).join(' ')} | największy spadek ${best.dt15.toFixed(1)} K (doba ${best.d}), przy gruncie ${best.dts.toFixed(1)} K`);
}
