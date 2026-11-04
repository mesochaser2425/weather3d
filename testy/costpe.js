// koszt doby symulacji (Tatry, model synoptyczny) – porównanie szerokości kanału (?pex=)
sim.stop(); sim.set('date', '2026-01-10');
await sim.dem(49.25, 20.0, 1.0, 0.9);
sim.stop(); await sim.roll(1); sim.stop();
await sim.run(200);
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const t0 = performance.now(); await sim.run(Math.round(86400 / dt)); const t1 = performance.now();
log(`doba: ${((t1 - t0) / 1000).toFixed(1)} s (${((t1 - t0) / (86400 / dt)).toFixed(2)} ms/krok)`);
