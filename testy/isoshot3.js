window.__f = 22;
// zrzuty: T 2 m (izotermy) i opad (radar) – scenariusz Burze 1 km
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
await sim.run(Math.round((window.__h || 7) * 3600 / dt));
sim.set('fieldH', window.__f ?? 20);
await sim.draw();
await new Promise((r) => setTimeout(r, 1500));
log('gotowe');
