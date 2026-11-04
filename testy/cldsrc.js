// Źródła zachmurzenia latem (15:00 drugiej doby): LWP siatki vs chmur kłębiastych (LWPC), krycie z LWP (pasek, satelita)
// vs pole COVER, woda konwekcji parametryzowanej (CULS)
sim.stop();
sim.set('date', window.__date || '2027-07-10');
await sim.dem(49.93, 19.91, 1.0, 0.8);
sim.stop(); await sim.roll(window.__sd || 4); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
let r = a; while (!(r.simHours >= 20 && r.clock.hour >= 15 && r.clock.hour < 16)) r = await sim.run(Math.round(1800 / dt));
const L = sim.sfcGrid('LWP').v, LC = sim.sfcGrid('LWPC').v, CV = sim.sfcGrid('COVER').v, CU = sim.sfcGrid('CULS').v;
const CL = sim.sfcGrid('CLL').v, CM = sim.sfcGrid('CLM').v, CH = sim.sfcGrid('CLH').v;
sim.set("fieldH", window.__f ?? 22); await sim.draw(); await new Promise((r) => setTimeout(r, 1500));
const N = L.length; let l = 0, lc = 0, op = 0, op9 = 0, cv = 0, cv9 = 0, cu = 0, cu0 = 0, cl = 0, cm = 0, ch = 0;
for (let q = 0; q < N; q++) {
  const o = 1 - Math.exp(-0.15 * 1000 * L[q]);
  l += 1000 * L[q]; lc += 1000 * LC[q]; op += o; op9 += o > 0.9; cv += CV[q]; cv9 += CV[q] > 0.9; cu += CU[q]; cu0 += CU[q] > 1; cl += CL[q]; cm += CM[q]; ch += CH[q];
}
log(`LWP śr. ${(l / N).toFixed(0)} g/m² (kłębiaste ${(100 * lc / l).toFixed(0)}%) | krycie z LWP ${(100 * op / N).toFixed(0)}% (> 90%: ${(100 * op9 / N).toFixed(0)}% oczek) | COVER ${(100 * cv / N).toFixed(0)}% (> 90%: ${(100 * cv9 / N).toFixed(0)}%) | ` +
  `CULS śr. ${(cu / N).toFixed(1)}, oczek z CULS > 1: ${(100 * cu0 / N).toFixed(0)}% | woda pięter niskie/średnie/wysokie ${(cl / N).toFixed(0)}/${(cm / N).toFixed(0)}/${(ch / N).toFixed(0)} g/m²`);
