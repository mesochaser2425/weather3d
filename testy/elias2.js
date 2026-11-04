sim.stop();
sim.set('date', '2026-01-15');
await sim.dem(60.0, -140.5, 0.8, 0.9);
sim.stop(); await sim.roll(5); sim.stop();
await sim.run(3);
const NXD = 100;
for (let q = 1; q <= 8; q++) {
  const r = await sim.run(360);
  if (q < 4 || q > 7) continue;
  const pr = sim.sfcGrid('PR').v;
  const idx = [...pr.keys()].sort((a, b) => pr[b] - pr[a]).slice(0, 3);
  for (const k of idx) {
    const col = await sim.colq(k % NXD, Math.floor(k / NXD));
    let top = 0, ttop = 0, wmx = 0, qrmx = 0, qcmx = 0, qimx = 0, zq = 0;
    for (const z of col) { if (z[4] + z[5] > 0.01) { top = z[0]; ttop = z[1]; } wmx = Math.max(wmx, z[2]); if (z[6] > qrmx) { qrmx = z[6]; zq = z[0]; } qcmx = Math.max(qcmx, z[4]); qimx = Math.max(qimx, z[5]); }
    log(`${r.clock.hour.toFixed(0)}h ${pr[k].toFixed(1)} mm/h: top ${(top / 1000).toFixed(1)} km ${ttop}°C, w ${wmx}, qc ${qcmx}, qi ${qimx}, qr ${qrmx} (na ${zq} m), T1 ${col[0][1]}`);
  }
}
