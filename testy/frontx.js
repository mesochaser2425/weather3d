// Przekrój przez najsilniejszy front w chwili h (window.__h): T, wiatr domeny i dużej skali na ~100 m, w na 0.5 / 1 / 1.5 km, opad
sim.stop();
sim.set('date', window.__date || '2027-05-15');
await sim.roll(window.__seed || 4);
await sim.run(1);
const zc = sim.levels(), kOf = (z) => zc.reduce((b, x, k) => (Math.abs(x - z) < Math.abs(zc[b] - z) ? k : b), 0);
const dt = window.__dt || 45;
let hNow = 0;
for (const hh of (window.__hs || [window.__h || 45])) {
await sim.run(Math.max(1, Math.round((hh - hNow) * 3600 / dt))); hNow = hh;
const fr = sim.sfcGrid('FRT'), NXD = fr.nx, dx = fr.dx, pr = sim.sfcGrid('PR').v, t2 = sim.sfcGrid('T2').v;
let fm = 0, km = 0; fr.v.forEach((v, k) => { if (Math.abs(v) > Math.abs(fm)) { fm = v; km = k; } });
const j = Math.floor(km / NXD), i0 = km % NXD;
const r1 = await sim.rowk(j, kOf(100)), r5 = await sim.rowk(j, kOf(500)), r10 = await sim.rowk(j, kOf(1000)), r15 = await sim.rowk(j, kOf(1500));
log(`h=${hh}: FRT ${fm.toFixed(2)} w wierszu ${j}, x ${((i0 + 0.5) * dx / 1000).toFixed(0)} km`);
log('  x[km]  FRT    T2   T100 d/c   u100 d/c   v100 d/c   w0.5 w1.0 w1.5 [cm/s]  opad');
for (let i = Math.max(0, i0 - 20); i <= Math.min(NXD - 1, i0 + 20); i++) {
  log(`  ${((i + 0.5) * dx / 1000).toFixed(0).padStart(4)}  ${fr.v[j * NXD + i].toFixed(2).padStart(5)}  ${t2[j * NXD + i].toFixed(1).padStart(5)}  ${r1.T[i].toFixed(1)}/${r1.Tt[i].toFixed(1)}  ${r1.u[i].toFixed(1)}/${r1.ut[i].toFixed(1)}  ${r1.v[i].toFixed(1)}/${r1.vt[i].toFixed(1)}   ${(100 * r5.w[i]).toFixed(0).padStart(4)} ${(100 * r10.w[i]).toFixed(0).padStart(4)} ${(100 * r15.w[i]).toFixed(0).padStart(4)}   ${pr[j * NXD + i].toFixed(1)}`);
}
}
