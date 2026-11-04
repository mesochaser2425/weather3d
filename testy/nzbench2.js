sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
await sim.run(Math.round(5 * 3600 / dt));
const col = await sim.colq(50, 50);
const kp = sim.kprofile ? await sim.kprofile() : null;
const ms = await sim.bench(60);
log(`NZ (kolumna) ${col.length}, ms/krok ${ms.toFixed(2)} | ` + (kp ? JSON.stringify(kp).slice(0, 600) : ''));
