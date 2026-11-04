// Zima w domenie podobnej do S_PL: czy przy ciepłej adwekcji (cel 1. warstwy z modelu synoptycznego rośnie) domena nadąża,
// czy zimna, zaśnieżona warstwa przy gruncie trwa. Co 3 h: 1. warstwa domeny i celu (średnie po domenie), T2, wiatr 10 m,
// udział oczek ze śniegiem, zachmurzenie. Na końcu epizody ocieplenia celu ≥ 4 K w 24 h i opóźnienie domeny.
// Parametry: window.__date (2027-12-20), __sd, __days (20).
sim.stop();
sim.set('date', window.__date || '2027-12-20');
await sim.dem(window.__lat ?? 50.0, window.__lon ?? 19.95, 1.0, 0.8);
sim.stop(); await sim.roll(window.__sd || 1); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const mean = (v) => { let s = 0; for (const x of v) s += x; return s / v.length; };
const days = window.__days || 20, rows = [];
for (let h = 0; h < days * 8; h++) {
  await sim.run(Math.round(3 * 3600 / dt));
  const dr = await sim.drift();
  const SWE = sim.sfcGrid('SWE').v; let sn = 0; for (const x of SWE) sn += x > 1;
  const row = { h: 3 * (h + 1), T1: dr.bl.T, Tt: dr.bl.Tt, q1: dr.bl.q, qt: dr.bl.qt, T2: mean(sim.sfcGrid('T2').v), u10: mean(sim.sfcGrid('U10').v),
    snow: 100 * sn / SWE.length, cov: 100 * mean(sim.sfcGrid('COVER').v), lev: dr.lev };
  rows.push(row);
  if (h % 4 === 3) log(`h ${row.h} | 1. warstwa ${row.T1.toFixed(1)} cel ${row.Tt.toFixed(1)} (Δ ${(row.T1 - row.Tt).toFixed(1)} K) | q ${row.q1.toFixed(2)}/${row.qt.toFixed(2)} | T2 ${row.T2.toFixed(1)} | U10 ${row.u10.toFixed(1)} | śnieg ${row.snow.toFixed(0)}% | chmury ${row.cov.toFixed(0)}%`);
}
// epizody: cel 1. warstwy rośnie o ≥ 4 K w 24 h; jak szybko domena dogania (Δ = domena − cel na początku, po 24 i 48 h)
const ep = [];
for (let i = 0; i + 16 < rows.length; i++) {
  const up = rows[i + 8].Tt - rows[i].Tt;
  if (up >= 4 && (!ep.length || i - ep[ep.length - 1].i > 8)) ep.push({ i, up });
}
for (const e of ep) {
  const r0 = rows[e.i], r1 = rows[e.i + 8], r2 = rows[e.i + 16];
  // profil odchyłki domeny od celu na poziomach (do ~2 km) na końcu ocieplenia
  const prof = r1.lev.filter((l) => l.z < 2500).map((l) => `${l.z}:${(l.T - l.Tt).toFixed(1)}`).join(' ');
  log(`EPIZOD h ${r0.h}: cel +${e.up.toFixed(1)} K/24 h | Δ domena−cel: start ${(r0.T1 - r0.Tt).toFixed(1)}, +24 h ${(r1.T1 - r1.Tt).toFixed(1)}, +48 h ${(r2.T1 - r2.Tt).toFixed(1)} | U10 ${r1.u10.toFixed(1)} | śnieg ${r0.snow.toFixed(0)} → ${r2.snow.toFixed(0)}% | profil Δ (z: K) ${prof}`);
}
const d = rows.map((r) => r.T1 - r.Tt);
log(`RAZEM: Δ 1. warstwy domena−cel śr ${mean(d).toFixed(2)} K, min ${Math.min(...d).toFixed(1)}, maks ${Math.max(...d).toFixed(1)} | T2 ${mean(rows.map((r) => r.T2)).toFixed(1)} | cel ${mean(rows.map((r) => r.Tt)).toFixed(1)} | śnieg ${mean(rows.map((r) => r.snow)).toFixed(0)}%`);
