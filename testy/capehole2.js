// „dziura” w CAPE po burzy: CAPE w oczkach, gdzie w ostatnich 2 h padało > 2 mm/h, a teraz już nie (< 0.3), vs oczka bez opadu
sim.stop();
if (window.__dem) { sim.set('date', '2026-07-10'); await sim.dem(52.7, 10.2, 1.0, 0.8); sim.stop(); await sim.roll(2); sim.stop(); }
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
await sim.run(Math.round((window.__h0 || 4) * 3600 / dt));
const n0 = sim.sfcGrid('PR').v.length; let rained = new Float32Array(n0); const out = [];
for (let s = 0; s < 36; s++) {
  await sim.run(Math.round(600 / dt));
  const PR = sim.sfcGrid('PR').v, CA = sim.sfcGrid('CAPE').v, T2 = sim.sfcGrid('T2').v, TD = sim.sfcGrid('TD2').v;
  for (let q = 0; q < n0; q++) rained[q] = PR[q] > (window.__thr || 2) ? 12 : Math.max(rained[q] - 1, 0);   // pamięć 2 h (12 × 10 min)
  if (s % 6 !== 5) continue;
  let ch = 0, nh = 0, cc = 0, nc = 0, th = 0, tc = 0, dh = 0, dc = 0;
  for (let q = 0; q < n0; q++) {
    if (rained[q] > 0 && PR[q] < 0.3) { ch += CA[q]; th += T2[q]; dh += TD[q]; nh++; }
    else if (rained[q] === 0 && PR[q] < 0.05) { cc += CA[q]; tc += T2[q]; dc += TD[q]; nc++; }
  }
  out.push(`+${(s + 1) / 6}h: po burzy CAPE ${(ch / Math.max(nh, 1)).toFixed(0)} (T2 ${(th / Math.max(nh, 1)).toFixed(1)}, Td ${(dh / Math.max(nh, 1)).toFixed(1)}, ${nh} oczek) | bez burzy CAPE ${(cc / Math.max(nc, 1)).toFixed(0)} (T2 ${(tc / Math.max(nc, 1)).toFixed(1)}, Td ${(dc / Math.max(nc, 1)).toFixed(1)})`);
}
log('\n' + out.join('\n'));
