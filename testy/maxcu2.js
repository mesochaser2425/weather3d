// Tryb MAX w działającej pętli klatek: tempo symulacji, okres pokoleń cumulusów (Te) i czas życia chmury na ekranie (Te/2/tempo).
sim.stop();
sim.set('date', window.__date || '2027-07-01');
await sim.dem(window.__lat ?? 50.0, window.__lon ?? 19.95, 1.0, 0.8);
sim.stop(); await sim.roll(window.__sd || 2); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
await sim.run(Math.round((window.__h0 ?? 5) * 3600 / dt));
if (window.__map) sim.set('fieldH', 29); else document.querySelector('#viewSeg button[data-v="3d"]').click();
sim.set('speed', window.__speed || 'max');
sim.go();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(2500);
for (let s = 0; s < 6; s++) {
  await wait(1000);
  const c = sim.cu();
  log(`tempo ${c.rate.toFixed(0)}× | okres pokolenia ${(c.Te / 60).toFixed(0)} min | życie chmury na ekranie ${(c.Te / 2 / Math.max(c.rate, 1)).toFixed(1)} s | faza ${c.ph.toFixed(2)}`);
}
sim.stop();
