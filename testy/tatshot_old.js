for (let i = 0; i < 60 && !window.__lcStats; i++) await new Promise((r) => setTimeout(r, 500));
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
await sim.run(Math.round((window.__h || 30) * 3600 / dt));
sim.set('fieldH', window.__f ?? 23);
await sim.draw();
await new Promise((r) => setTimeout(r, 1500));
const P = sim.sfcGrid('PACC').v; let s = 0, mx = 0; for (const v of P) { s += v; mx = Math.max(mx, v); }
log(`suma śr. ${(s / P.length).toFixed(1)} mm, maks. ${mx.toFixed(0)} mm`);
