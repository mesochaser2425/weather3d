// lato w domenie: Tmax/Tmin/średnia dobowa T2 (średnie po domenie) przez kilka dób vs duża skala
sim.stop();
sim.set('date', window.__date || '2026-07-15');
for (const sd of (window.__seeds || [1, 2, 3])) {
  sim.stop(); await sim.roll(sd); sim.stop();
  const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
  const out = [];
  for (let d = 0; d < (window.__days || 3); d++) {
    let mx = -99, mn = 99, s = 0, n = 0, tdS = 0, syT = 0, cs = 0;
    for (let h = 0; h < 24; h++) {
      await sim.run(Math.round(3600 / dt));
      const t = sim.sfcStats('T2').mean; mx = Math.max(mx, t); mn = Math.min(mn, t); s += t; n++; tdS += sim.sfcStats('TD2').mean;
      if (h % 6 === 0) { const sy = await sim.syn(); syT += sy.tDay; cs++; }
    }
    out.push(`d${d + 1}: Tmax ${mx.toFixed(1)} Tmin ${mn.toFixed(1)} śr ${(s / n).toFixed(1)} Td ${(tdS / n).toFixed(1)} | duża skala śr. ${(syT / cs).toFixed(1)} | PACC ${sim.sfcStats('PACC').mean.toFixed(1)}`);
  }
  log(`seed ${sd}: ` + out.join(' ; '));
}
