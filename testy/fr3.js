window.__sd = 3; window.__h = 32; window.__f = 22;
sim.stop();
sim.set('date', '2026-07-10');
await sim.dem(52.0, 19.3, 1.0, 0.75);
sim.stop(); await sim.roll(window.__sd || 1); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
await sim.run(Math.round((window.__h || 48) * 3600 / dt));
sim.set('fieldH', window.__f ?? 23);

await sim.draw();
await new Promise((r) => setTimeout(r, 1500));
log('ok');
