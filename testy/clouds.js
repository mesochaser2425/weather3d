// zachmurzenie w domenie o 13:00 (2. doba): ogólne, udział powierzchni z chmurami niskimi/średnimi/wysokimi (LWP piętra > 10 g/m²)
sim.stop();
for (const date of ['2026-04-15', '2026-07-15', '2026-10-15']) {
  for (const sd of [1, 2]) {
    sim.stop(); sim.set('date', date); await sim.roll(sd); sim.stop();
    const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
    await sim.run(Math.round(31 * 3600 / dt));
    const g = (n) => sim.sfcGrid(n).v;
    const L = g('CLL'), M = g('CLM'), H = g('CLH'), C = g('COVER');
    const fr = (x) => (x.filter((v) => v > 10).length / x.length).toFixed(2);
    const sy = await sim.syn();
    log(`${date} s${sd} ${sy.cls && sy.cls.key}: COVER ${(C.reduce((p, q) => p + q, 0) / C.length).toFixed(2)} | niskie ${fr(L)} średnie ${fr(M)} wysokie ${fr(H)} | cel rhl ${sy.air.rhLow.toFixed(0)} rhh ${sy.air.rhHigh.toFixed(0)} w ${(100 * sy.w).toFixed(1)} cm/s pr ${sy.pr.toFixed(2)} | T2 ${sim.sfcStats('T2').mean.toFixed(1)} Td ${sim.sfcStats('TD2').mean.toFixed(1)}`);
  }
}
