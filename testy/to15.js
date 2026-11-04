sim.stop();
sim.set('date', '2027-07-10');
await sim.dem(49.93, 19.91, 1.0, 0.8);
sim.stop(); await sim.roll(window.__sd || 4); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
let r0 = await sim.run(1);
while (!(r0.simHours >= 20 && r0.clock.hour >= (window.__h || 15) && r0.clock.hour < (window.__h || 15) + 1)) r0 = await sim.run(Math.round(1800 / dt));
