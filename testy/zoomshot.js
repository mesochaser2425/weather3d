// zrzut mapy T 2 m z zoomem 4× (Tatry) – izotermy, strzałki, podziałka, sonda
for (let i = 0; i < 60 && !window.__lcStats; i++) await new Promise((r) => setTimeout(r, 500));
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
await sim.run(Math.round(4 * 3600 / dt));
sim.set('fieldH', 20);
sim.set('windArrows', true);
sim.zoom(4, 0.5, 0.55);
await sim.draw();
await new Promise((r) => setTimeout(r, 1500));
log('gotowe');
