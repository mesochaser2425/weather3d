// koszt liczby warstw: ms na krok po rozkręceniu burz (scenariusz „Burze”, 1 km, 100 × 100)
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
await sim.run(Math.round(5 * 3600 / dt));
await sim.bench(20);
const ms = await sim.bench(100);
log(`ms/krok ${ms.toFixed(2)}, doba = ${(86400 / dt * ms / 1000).toFixed(0)} s obliczeń`);
