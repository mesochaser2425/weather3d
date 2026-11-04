// CAPE w scenariuszu ze stałą masą powietrza w ciągu dnia: co godzinę mapa CAPE (śr., p90, maks.), T2, Td2, maks. opad.
// Parametry: __air (zmiany presetu masy powietrza scenariusza, np. { rhLow: 55 }), __scen (domyślnie 'storms'), __hours (domyślnie 9)
// (suwaki masy powietrza w zakładce Atmosfera; „Zastosuj” = stała masa i restart; reszta scenariusza bez zmian)
if (window.__air || window.__soil !== undefined) {
  sim.stop();
  for (const [k, v] of Object.entries(window.__air || {})) document.getElementById(k).value = v;
  if (window.__soil !== undefined) document.getElementById('soil').value = window.__soil;
  document.getElementById('applyAir').click();
  await sim.mode('const');
}
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const pct = (v, p) => { const s = Float32Array.from(v).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (v) => { let s = 0; for (const x of v) s += x; return s / v.length; };
for (let h = 1; h <= (window.__hours || 9); h++) {
  const r = await sim.run(Math.round(3600 / dt));
  const C = sim.sfcGrid('CAPE').v, PR = sim.sfcGrid('PR').v;
  log(`${r.clock.hour.toFixed(0)}:00 CAPE śr ${mean(C).toFixed(0)} p90 ${pct(C, 0.9).toFixed(0)} maks ${Math.max(...C).toFixed(0)} | T2 ${mean(sim.sfcGrid('T2').v).toFixed(1)} Td2 ${mean(sim.sfcGrid('TD2').v).toFixed(1)} | opad maks ${Math.max(...PR).toFixed(0)} mm/h, > 1 mm/h ${(100 * PR.filter((x) => x > 1).length / PR.length).toFixed(1)}%`);
}
const P = sim.sfcGrid('PACC').v;
log(`suma opadu średnio ${mean(P).toFixed(2)} mm, maks ${Math.max(...P).toFixed(0)} mm`);
