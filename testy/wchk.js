sim.stop();
sim.set('date', '2026-07-10');
await sim.dem(50.06, 19.94, 1.0, 0.75);
const h = sim.hgt(); let w = 0, mx = 0; for (const v of h) { if (v <= 1) w++; mx = Math.max(mx, v); }
log(`oczek z h<=1: ${w}/${h.length}, max h ${mx}`);
