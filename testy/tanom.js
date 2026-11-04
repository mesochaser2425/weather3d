sim.stop();
sim.set('date', '2026-07-10');
await sim.dem(50.06, 19.94, 1.0, 0.75);
const out = [];
for (const an of [0, 3]) {
  document.getElementById('tanom').value = an;
  sim.stop(); await sim.roll(1); sim.stop();
  const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
  const h = sim.hgt(); let t = 0, td = 0, k = 0, mx = -99, mn = 99;
  for (let hr = 0; hr < 36; hr++) {
    await sim.run(Math.round(3600 / dt));
    if (hr < 12) continue;
    const T2 = sim.sfcGrid('T2').v, TD = sim.sfcGrid('TD2').v;
    let st = 0, sd = 0, c = 0; for (let q = 0; q < h.length; q++) if (h[q] < 300) { st += T2[q]; sd += TD[q]; c++; }
    t += st / c; td += sd / c; k++; mx = Math.max(mx, st / c); mn = Math.min(mn, st / c);
  }
  out.push(`anomalia ${an}: T ${(t / k).toFixed(1)} (${mn.toFixed(1)}–${mx.toFixed(1)}) Td ${(td / k).toFixed(1)}`);
}
log('\n' + out.join('\n'));
