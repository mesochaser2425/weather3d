// pokrycie terenu z ESA WorldCover: Kraków, 200 km – udziały klas i czas pobierania
sim.stop();
const t0 = performance.now();
await sim.dem(50.06, 19.94, 1.0, 0.75);
log(`czas ${((performance.now() - t0) / 1000).toFixed(1)} s: ` + JSON.stringify(window.__lcStats || 'brak'));
