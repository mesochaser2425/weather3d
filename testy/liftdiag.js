sim.stop();
sim.set('date', '2026-07-10');
await sim.dem(52.0, 19.3, 1.0, 0.75);
sim.stop(); await sim.roll(3); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const st = (n) => { const v = sim.sfcGrid(n).v; let s = 0, lo = 1e9, hi = -1e9; for (const x of v) { s += x; lo = Math.min(lo, x); hi = Math.max(hi, x); } return `${n}: śr ${(s / v.length).toPrecision(3)} [${lo.toPrecision(3)}, ${hi.toPrecision(3)}]`; };
for (const h of [1, 3, 9]) {
  await sim.run(Math.round((h === 1 ? 1 : h === 3 ? 2 : 6) * 3600 / dt));
  log(`h${h}: ` + ['W1', 'WMES', 'LIFT'].map(st).join(' | ') + ` | syn w ${(await sim.syn()).w}`);
}
