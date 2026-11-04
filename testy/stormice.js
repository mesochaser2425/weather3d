// Burze 1 km (scenariusz „Burze”): opad, dBZ, błyskawice (FLASH), grad (HAIL) i woda przechłodzona – kontrola po zmianie fizyki lodu
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
let fl = 0, flm = 0, hm = 0, pm = 0, zm = 0;
for (let hr = 0; hr < (window.__hours || 8); hr++) {
  await sim.run(Math.round(3600 / dt));
  const F = sim.sfcGrid('FLASH').v, HL = sim.sfcGrid('HAIL').v, PR = sim.sfcGrid('PR').v, Z = sim.sfcGrid('DBZ').v;
  for (let q = 0; q < F.length; q++) { fl += F[q]; flm = Math.max(flm, F[q]); hm = Math.max(hm, HL[q]); pm = Math.max(pm, PR[q]); zm = Math.max(zm, Z[q]); }
}
const P = sim.sfcGrid('PACC').v; let s = 0, mx = 0; for (const v of P) { s += v; mx = Math.max(mx, v); }
const w = await sim.water();
log(`suma śr. ${(s / P.length).toFixed(2)} mm, maks ${mx.toFixed(0)} | maks ${pm.toFixed(0)} mm/h, ${zm.toFixed(0)} dBZ | błyskawice suma ${fl.toFixed(1)}, maks ${flm.toFixed(2)} | grad maks ${hm.toFixed(1)} | woda chmur ${w.qc.toFixed(3)} kg/m²`);
