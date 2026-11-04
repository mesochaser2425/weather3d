sim.stop();
for (let n = 0; n < 120; n++) { const h = sim.hgt(); if (Math.max(...h) > 1500) break; await new Promise((r) => setTimeout(r, 1000)); }
await new Promise((r) => setTimeout(r, 3000));
const NXD = 140;
for (const sd of (window.__seeds || [2, 3, 4, 5])) {
  sim.stop(); await sim.roll(sd); sim.stop();
  const sy = await sim.syn();
  let best = null, maxpr = 0, sumAll = 0;
  for (let hr = 1; hr <= 14; hr++) {
    const r = await sim.run(180);
    const g = sim.sfcGrid('PR').v;
    let n10 = 0, mx = 0, kmx = 0; for (let k = 0; k < g.length; k++) { if (g[k] > 10) n10++; if (g[k] > mx) { mx = g[k]; kmx = k; } }
    if (mx > maxpr) {
      maxpr = mx;
      const i = kmx % NXD, j = Math.floor(kmx / NXD), col = await sim.colq(i, j);
      let top = 0, ttop = 0, wmx = 0, qrmx = 0, qcmx = 0, qimx = 0;
      for (const z of col) { if (z[4] + z[5] > 0.01) { top = z[0]; ttop = z[1]; } wmx = Math.max(wmx, z[2]); qrmx = Math.max(qrmx, z[6]); qcmx = Math.max(qcmx, z[4]); qimx = Math.max(qimx, z[5]); }
      best = `${r.clock.hour.toFixed(0)}h ${mx.toFixed(0)}mm/h n>10 ${n10} top ${(top / 1000).toFixed(1)}km ${ttop}C w${wmx} qc${qcmx} qi${qimx} qr${qrmx} h${Math.round(sim.hgt()[kmx])}m`;
    }
  }
  const acc = sim.sfcGrid('PACC').v, cape = sim.sfcStats('CAPE');
  log(`seed ${sd} ${sy.cls && sy.cls.key} parent pr ${sy.pr.toFixed(2)} | PACC mean ${(acc.reduce((a, b) => a + b, 0) / acc.length).toFixed(1)} max ${Math.max(...acc).toFixed(0)} | max: ${best}`);
}
