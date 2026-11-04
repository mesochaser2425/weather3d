// Cumulusy nocą: co 3 h (18–06) zachmurzenie ogólne, kłębiaste (COVC) i warstwowe (COVS), woda cumulusów schematu (CULS),
// MUCAPE i jego wierzchołek (MUEL), ciepło z gruntu. Parametry: __date (2027-07-01), __sd, __days (4), __lat/__lon.
sim.stop();
sim.set('date', window.__date || '2027-07-01');
await sim.dem(window.__lat ?? 50.0, window.__lon ?? 19.95, 1.0, 0.8);
sim.stop(); await sim.roll(window.__sd || 1); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const mean = (v) => { let s = 0; for (const x of v) s += x; return s / v.length; };
const frac = (v, t) => { let s = 0; for (const x of v) s += x > t; return 100 * s / v.length; };
const days = window.__days || 4;
let r = b;
for (let h = 0; h < days * 8; h++) {
  r = await sim.run(Math.round(3 * 3600 / dt));
  const hr = r.clock.hour;
  const CV = sim.sfcGrid('COVER').v, CC = sim.sfcGrid('COVC').v, CS = sim.sfcGrid('COVS').v, CU = sim.sfcGrid('CULS').v;
  const MU = sim.sfcGrid('MUCAPE').v, ME = sim.sfcGrid('MUEL').v, H = sim.sfcGrid('H').v;
  log(`${(r.simHours).toFixed(0)} h (${hr}:00) | chmury ${(100 * mean(CV)).toFixed(0)}% kłęb. ${(100 * mean(CC)).toFixed(0)}% warstw. ${(100 * mean(CS)).toFixed(0)}% | CULS ${mean(CU).toFixed(1)} (> 1: ${frac(CU, 1).toFixed(0)}%) | MUCAPE ${mean(MU).toFixed(0)} (> 30: ${frac(MU, 30).toFixed(0)}%) MUEL ${mean(ME).toFixed(0)} m | H ${mean(H).toFixed(0)} W/m²`);
}
