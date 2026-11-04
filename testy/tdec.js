sim.stop();
for (let n = 0; n < 120; n++) { const h = sim.hgt(); if (Math.max(...h) > 1500) break; await new Promise((r) => setTimeout(r, 1000)); }
await new Promise((r) => setTimeout(r, 3000));
sim.stop();
sim.set('date', '2026-12-05');
await sim.roll(window.__sd || 1); sim.stop();
const h = sim.hgt();
let parent = 0; const days = window.__days || 10;
for (let d = 1; d <= days; d++) { if (d === 1) log("start");
  for (let q = 0; q < 8; q++) { await sim.run(540); const sy = await sim.syn(); parent += sy.pr * 3; }
  const acc = sim.sfcGrid('PACC').v;
  let hi = 0, nh = 0, lo = 0, nl = 0, all = 0, mx = 0;
  for (let k = 0; k < acc.length; k++) { all += acc[k]; mx = Math.max(mx, acc[k]); if (h[k] > 1500) { hi += acc[k]; nh++; } if (h[k] < 700) { lo += acc[k]; nl++; } }
  log(`dzień ${d}: domena ${(all / acc.length).toFixed(1)} mm, >1500 m ${(hi / nh).toFixed(1)}, <700 m ${(lo / nl).toFixed(1)}, maks ${mx.toFixed(0)} | duża skala (środek) ${parent.toFixed(1)} mm | T2 ${sim.sfcStats('T2').mean.toFixed(1)}`);
}
