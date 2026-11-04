sim.stop();
for (let n = 0; n < 120; n++) { const h = sim.hgt(); if (Math.max(...h) > 1500) break; await new Promise((r) => setTimeout(r, 1000)); }
await new Promise((r) => setTimeout(r, 3000));
for (const sd of (window.__seeds || [1, 2])) {
  sim.stop(); sim.set('date', '2026-10-15'); await sim.roll(sd); sim.stop();
  await sim.run(3);
  const h = sim.hgt(), out = [];
  for (let q = 0; q < 8; q++) {
    const r = await sim.run(540);
    const vis = sim.sfcGrid('VIS').v, t2 = sim.sfcGrid('T2').v;
    let nf = 0, nv = 0, tv = 0;
    for (let k = 0; k < h.length; k++) if (h[k] < 800) { nv++; tv += t2[k]; if (vis[k] < 1) nf++; }
    out.push(`${r.clock.hour.toFixed(0)}h mgła ${(100 * nf / nv).toFixed(0)}% T ${(tv / nv).toFixed(1)}`);
  }
  log(`seed ${sd}: ` + out.join(' | '));
}
