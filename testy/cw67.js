window.__sd = 4; window.__h = 8; window.__f = 67;
sim.stop();
sim.set('date', '2026-07-10');
await sim.dem(52.0, 19.3, 1.0, 0.75);
sim.stop(); await sim.roll(window.__sd || 1); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
await sim.run(Math.round((window.__h || 32) * 3600 / dt));
sim.set('fieldH', window.__f ?? 22);
await sim.draw();
await new Promise((r) => setTimeout(r, 1500));
const C = sim.sfcGrid('CAPE').v; let c = 0, cm = 0; for (const v of C) { c += v; cm = Math.max(cm, v); }
log(`CAPE śr. ${(c / C.length).toFixed(0)} maks. ${cm.toFixed(0)}; syn: ${JSON.stringify((await sim.syn()).air).slice(0, 200)}`);
