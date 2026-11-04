sim.stop();
for (let n = 0; n < 120; n++) { const h = sim.hgt(); if (Math.max(...h) > 1500) break; await new Promise((r) => setTimeout(r, 1000)); }
await new Promise((r) => setTimeout(r, 3000));
sim.stop();
if (window.__seedSyn) { await sim.roll(window.__seedSyn); sim.stop(); }
const NXD = 140;
for (let hr = 1; hr <= (window.__hours || 14); hr++) {
  const r = await sim.run(180);
  const g = sim.sfcGrid('PR').v, acc = sim.sfcGrid('PACC').v;
  let n10 = 0, n30 = 0, mx = 0, cand = [];
  for (let k = 0; k < g.length; k++) { if (g[k] > 10) { n10++; cand.push([g[k], k]); } if (g[k] > 30) n30++; mx = Math.max(mx, g[k]); }
  cand.sort((a, b) => b[0] - a[0]);
  const cols = [];
  for (const [p, k] of cand.slice(0, 3)) {
    const i = k % NXD, j = Math.floor(k / NXD), col = await sim.colq(i, j);
    let top = 0, ttop = 0, wmx = 0, qrmx = 0, qcmx = 0, qimx = 0;
    for (const z of col) { if (z[4] + z[5] > 0.01) { top = z[0]; ttop = z[1]; } wmx = Math.max(wmx, z[2]); qrmx = Math.max(qrmx, z[6]); qcmx = Math.max(qcmx, z[4]); qimx = Math.max(qimx, z[5]); }
    cols.push(`${p.toFixed(0)}mm/h top ${(top / 1000).toFixed(1)}km ${ttop}C w${wmx} qc${qcmx} qi${qimx} qr${qrmx}`);
  }
  const ma = acc.reduce((a, b) => a + b, 0) / acc.length;
  log(`${r.clock.hour.toFixed(0)}h PRmax ${mx.toFixed(0)} n>10 ${n10} n>30 ${n30} PACCmean ${ma.toFixed(2)} | ${cols.join(' ; ')}`);
}
