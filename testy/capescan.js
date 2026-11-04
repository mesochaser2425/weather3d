// Szukanie dnia z konwekcją (lato, domena użytkownika): CAPE i opad o 15:00 drugiej doby dla kolejnych losowań
sim.stop();
sim.set('date', window.__date || '2027-07-10');
await sim.dem(49.93, 19.91, 1.0, 0.8);
for (const sd of (window.__seeds || [1, 2, 3, 4, 5, 6, 7, 8])) {
  sim.stop(); await sim.roll(sd); sim.stop();
  const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
  let r = a; while (!(r.simHours >= 20 && r.clock.hour >= 15 && r.clock.hour < 16)) r = await sim.run(Math.round(1800 / dt));
  const C = sim.sfcGrid('CAPE').v, P = sim.sfcGrid('PR').v, PC = sim.sfcGrid('PRCUS').v;
  let c = 0, cm = 0, p = 0, pc = 0; for (let q = 0; q < C.length; q++) { c += C[q]; cm = Math.max(cm, C[q]); p += P[q]; pc += PC[q]; }
  log(`seed ${sd}: CAPE śr. ${(c / C.length).toFixed(0)} maks ${cm.toFixed(0)} | opad ${(p / P.length).toFixed(3)} mm/h, schemat ${(100 * pc / Math.max(p, 1e-9)).toFixed(0)}% | ${JSON.stringify((await sim.syn()).cls?.key || '')}`);
}
