// mapa T 2 m nad Tatrami po kilku godzinach – do zrzutu (izotermy)
for (let i = 0; i < 60 && !window.__lcStats; i++) await new Promise((r) => setTimeout(r, 500));
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
await sim.run(Math.round(5 * 3600 / dt));
sim.set('fieldH', 20);
await sim.draw();
await new Promise((r) => setTimeout(r, 1500));
log('gotowe');
