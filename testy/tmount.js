// Tatry: średnia dobowa T2 wg pasm wysokości przez 2 doby (lipiec i styczeń), vs Zakopane / Kasprowy
sim.stop();
for (let n = 0; n < 120; n++) { const h = sim.hgt(); if (Math.max(...h) > 1500) break; await new Promise((r) => setTimeout(r, 1000)); }
await new Promise((r) => setTimeout(r, 3000));
for (const date of ['2026-07-15', '2026-01-15']) {
  for (const sd of [1, 2]) {
    sim.stop(); sim.set('date', date); await sim.roll(sd); sim.stop();
    await sim.run(3);
    const h = sim.hgt();
    const bands = [[700, 1000], [1000, 1400], [1400, 1800], [1800, 2300]];
    const acc = bands.map(() => [0, 0, -99, 99]);
    let syT = 0, cs = 0;
    for (let q = 0; q < 48; q++) {
      await sim.run(180);
      const t = sim.sfcGrid('T2').v;
      bands.forEach(([a, b], n) => { let s = 0, c = 0; for (let k = 0; k < t.length; k++) if (h[k] >= a && h[k] < b) { s += t[k]; c++; } const m = s / c; acc[n][0] += m; acc[n][1]++; acc[n][2] = Math.max(acc[n][2], m); acc[n][3] = Math.min(acc[n][3], m); });
      if (q % 6 === 0) { const sy = await sim.syn(); syT += sy.tDay; cs++; }
    }
    log(`${date} seed ${sd}: ` + bands.map(([a, b], n) => `${a}-${b} m: śr ${(acc[n][0] / acc[n][1]).toFixed(1)} (${acc[n][3].toFixed(1)}…${acc[n][2].toFixed(1)})`).join(' | ') + ` | duża skala śr. ${(syT / cs).toFixed(1)}`);
  }
}
