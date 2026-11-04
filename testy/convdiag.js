// diagnostyka nowego schematu: oczka z chmurami (CUM), strumień masy, WAPE kopuł, CAPE, PBLH, opad schematu
sim.stop();
sim.set('date', '2026-07-10');
await sim.dem(52.0, 19.3, 1.0, 0.75);
sim.stop(); await sim.roll(window.__sd || 3); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const out = [];
const g0 = sim.sfcGrid('CUM'), A = g0.dx * g0.dx;
for (let hr = 0; hr < (window.__hours || 12); hr++) {
  await sim.run(Math.round(3600 / dt));
  const C = sim.sfcGrid('CUM').v, W = sim.sfcGrid('ORG').v, W2 = sim.sfcGrid('ORGB').v, CA = sim.sfcGrid('CAPE').v, PB = sim.sfcGrid('PBLH').v, PC = sim.sfcGrid('PRCUS').v, PR = sim.sfcGrid('PR').v, H = sim.sfcGrid('H').v;
  let nc = 0, ms = 0, wmx = 0, wn = 0, nca = 0, pbs = 0, pc = 0, pr = 0, hs = 0;
  for (let q = 0; q < C.length; q++) {
    if (C[q] > 1e3) { nc++; ms += C[q] / A; }
    const w = Math.max(W[q], W2[q]); wmx = Math.max(wmx, w); if (w > 2) wn++;
    if (CA[q] > 300) nca++; pbs += PB[q]; pc += PC[q]; pr += PR[q]; hs += H[q];
  }
  const n = C.length;
  out.push(`${hr + 1}h: chmury ${nc} oczek (M śr. ${(nc ? ms / nc : 0).toFixed(3)} kg/m²s) | kopuły>2: ${wn}, maks WAPE ${wmx.toFixed(0)} | CAPE>300: ${nca} | PBLH ${(pbs / n).toFixed(0)} H ${(hs / n).toFixed(0)} | opad schemat ${(pc / n).toFixed(3)} / całość ${(pr / n).toFixed(3)} mm/h`);
}
log('\n' + out.join('\n'));
