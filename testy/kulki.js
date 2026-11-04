// „kulki” słabego opadu: Niemcy (Hamburg–Harz), 2 km, lipiec; godziny 10–19: opad, udział schematów, oczka 0.1–1 mm/h ze schematu
sim.stop();
sim.set('date', '2026-07-10');
await sim.dem(52.7, 10.2, 1.0, 0.8);
const rows = [];
for (const sd of (window.__seeds || [2, 4])) {
  sim.stop(); await sim.roll(sd); sim.stop();
  const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
  await sim.run(Math.round(3 * 3600 / dt));
  let all = 0, cu = 0, dotsP = 0, dotsR = 0, heavy = 0, n = 0;
  for (let hr = 0; hr < 10; hr++) {
    await sim.run(Math.round(3600 / dt));
    const PR = sim.sfcGrid('PR').v, PC = sim.sfcGrid('PRCUS').v;
    for (let q = 0; q < PR.length; q++) {
      all += PR[q]; cu += PC[q]; n++;
      if (PR[q] > 0.1 && PR[q] < 1) { if (PC[q] > 0.5 * PR[q]) dotsP++; else dotsR++; }
      if (PR[q] > 5) heavy++;
    }
  }
  const P = sim.sfcGrid('PACC').v; let s = 0, mx = 0; for (const v of P) { s += v; mx = Math.max(mx, v); }
  rows.push(`s${sd}: suma śr. ${(s / P.length).toFixed(2)} mm (maks ${mx.toFixed(0)}) | schematy ${(100 * cu / Math.max(all, 1e-9)).toFixed(0)}% | słaby opad ze schematu ${(100 * dotsP / n).toFixed(2)}% oczko·h, z siatki ${(100 * dotsR / n).toFixed(2)}% | > 5 mm/h ${(100 * heavy / n).toFixed(2)}%`);
}
log('\n' + rows.join('\n'));
