sim.stop();
sim.set('date', window.__date || '2027-07-10');
await sim.dem(49.25, 20.0, 1.0, 0.9);
sim.stop(); await sim.roll(window.__sd || 1); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
let r0 = await sim.run(1);
while (!(r0.simHours >= 20 && r0.clock.hour >= 12 && r0.clock.hour < 13)) r0 = await sim.run(Math.round(1800 / dt));
const nx = 140, ny = 140, H = sim.hgt();
const corr = (A, B, sx, sy, low) => { let ma = 0, mb = 0, n = 0; const idx = [];
  for (let j = 20; j < ny - 20; j++) for (let i = 20; i < nx - 20; i++) { if (low && H[j * nx + i] > 800) continue; idx.push([j * nx + i, (j + sy) * nx + i + sx]); }
  for (const [p, q] of idx) { ma += A[p]; mb += B[q]; } ma /= idx.length; mb /= idx.length;
  let c = 0, va = 0, vb = 0; for (const [p, q] of idx) { c += (A[p] - ma) * (B[q] - mb); va += (A[p] - ma) ** 2; vb += (B[q] - mb) ** 2; } return c / Math.sqrt(va * vb); };
// wiatr ~1.5 km w środku
const col = await sim.colq(70, 70);
log('kolumna (fragment):', JSON.stringify(col).slice(0, 300));
for (const mins of [10, 30]) {
  const L0 = sim.sfcGrid('LWP').v.slice();
  await sim.run(Math.round(mins * 60 / dt));
  const L1 = sim.sfcGrid('LWP').v;
  const row = []; for (let s = -2; s <= 20; s += 2) row.push(`${s}:${corr(L0, L1, s, 0, true).toFixed(2)}`);
  const rowN = []; for (let s = -6; s <= 6; s += 2) rowN.push(`${s}:${corr(L0, L1, 0, s, true).toFixed(2)}`);
  log(`po ${mins} min (niziny < 800 m): korelacja przy przesunięciu na E [km] ${row.join(' ')} | na N ${rowN.join(' ')}`);
}
