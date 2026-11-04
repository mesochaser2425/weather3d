// CAPE przy miejscu z mapy świata (klimat ERA5, teren, WorldCover, model synoptyczny): co dobę o 14:00 (czas słoneczny) mapa CAPE
// (śr., p90, maks.), MUCAPE p90, T2, Td2, wysokość warstwy granicznej, średnie odchyłki domena − cel (q i T najniższej warstwy,
// q na ~1 km), gradient 1.5–5.5 km domeny; na końcu rozkład CAPE we wszystkich oczkach i dniach (udział > 500 / 1000 / 2000 / 3000).
// Parametry: __lat, __lon (domyślnie Poznań), __date (2027-07-01), __sd (losowanie), __days (20)
sim.stop();
sim.set('date', window.__date || '2027-07-01');
const pl = await sim.place(window.__lat ?? 52.4, window.__lon ?? 16.9);
log(`miejsce: kontynentalizm ${pl.cont.toFixed(2)}, wilgotność ${pl.hum.toFixed(2)}, poprawka ${pl.bias.toFixed(1)} K, ${pl.koppen}`);
sim.stop(); await sim.roll(window.__sd || 1); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const pct = (v, p) => { const s = Float32Array.from(v).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (v) => { let s = 0; for (const x of v) s += x; return s / v.length; };
let r = await sim.run(1);
const days = window.__days || 20, all = [], rows = [];
for (let d = 0; d < days; d++) {
  while (!(r.clock.hour >= 14 && r.clock.hour < 15 && r.simHours > 24 * d + 6)) r = await sim.run(Math.max(1, Math.round(900 / dt)));
  const C = sim.sfcGrid('CAPE').v, MU = sim.sfcGrid('MUCAPE').v, T2 = sim.sfcGrid('T2').v, TD = sim.sfcGrid('TD2').v, PB = sim.sfcGrid('PBLH').v, PR = sim.sfcGrid('PR').v;
  for (const x of C) all.push(x);
  const dr = await sim.drift();
  const lev = dr.lev, at = (z) => lev.reduce((p, x) => (Math.abs(x.z - z) < Math.abs(p.z - z) ? x : p), lev[0]);
  const l1 = at(1000 + 150), l15 = at(1500 + 150), l55 = at(5500 + 150);
  const gam = (l15.T - l55.T) / ((l55.z - l15.z) / 1000), gamT = (l15.Tt - l55.Tt) / ((l55.z - l15.z) / 1000);
  let rain = 0; for (const x of PR) rain += x > 0.5;
  const row = { cape: mean(C), c90: pct(C, 0.9), cmax: Math.max(...C), mu90: pct(MU, 0.9), t2: mean(T2), td: mean(TD), pb: mean(PB),
    dq0: dr.bl.q - dr.bl.qt, dT0: dr.bl.T - dr.bl.Tt, dq1: l1.q - l1.qt, gam, gamT, rain: 100 * rain / PR.length };
  rows.push(row);
  log(`doba ${String(d + 1).padStart(2)} ${r.clock.date || ''} | CAPE śr ${row.cape.toFixed(0).padStart(4)} p90 ${row.c90.toFixed(0).padStart(4)} maks ${row.cmax.toFixed(0).padStart(4)} | MUCAPE p90 ${row.mu90.toFixed(0).padStart(4)} | ` +
    `T2 ${row.t2.toFixed(1)} Td2 ${row.td.toFixed(1)} PBLH ${row.pb.toFixed(0)} | dół − cel: T ${row.dT0.toFixed(1)} K, q ${row.dq0.toFixed(1)} g/kg; q 1 km ${row.dq1.toFixed(1)} | ` +
    `Γ 1.5–5.5 km ${row.gam.toFixed(2)} (cel ${row.gamT.toFixed(2)}) | opad > 0.5 mm/h ${row.rain.toFixed(1)}%`);
  r = await sim.run(Math.round(3600 / dt));
}
const M = (k, n = 0) => mean(rows.map((x) => x[k])).toFixed(n);
const fr = (t) => (100 * all.filter((x) => x > t).length / all.length).toFixed(1);
log(`RAZEM ${days} dób 14:00: CAPE śr ${M('cape')} p90 ${M('c90')} | dni z p90 > 1000: ${rows.filter((x) => x.c90 > 1000).length}, > 2000: ${rows.filter((x) => x.c90 > 2000).length} | ` +
  `oczko·doba CAPE > 500 / 1000 / 2000 / 3000: ${fr(500)} / ${fr(1000)} / ${fr(2000)} / ${fr(3000)}% | T2 ${M('t2', 1)} Td2 ${M('td', 1)} PBLH ${M('pb')} | ` +
  `dół − cel T ${M('dT0', 1)} q ${M('dq0', 1)}, q 1 km ${M('dq1', 1)} | Γ ${M('gam', 2)} (cel ${M('gamT', 2)})`);
