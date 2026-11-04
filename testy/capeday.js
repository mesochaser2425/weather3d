// Lato w domenie podobnej do S_PL (Polska południowa, ~240 × 350 km): co dobę o 14:00 (czas słoneczny) statystyka domeny –
// CAPE (średnia, mediana, p90, udział oczek > 1000 J/kg), MUCAPE, zachmurzenie ogólne i kłębiaste, udział oczek bezchmurnych
// (COVER < 0.1), T2, Td2, PBLH, opad dobowy. Pozwala ocenić, czy prawie każdy dzień ma duże CAPE i cumulusy.
// Parametry: window.__date (domyślnie 2027-07-01), __sd (losowanie), __days (14), __lat/__lon.
sim.stop();
sim.set('date', window.__date || '2027-07-01');
await sim.dem(window.__lat ?? 50.0, window.__lon ?? 19.95, 1.0, 0.8);
sim.stop(); await sim.roll(window.__sd || 1); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const pct = (v, p) => { const s = Float32Array.from(v).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (v) => { let s = 0; for (const x of v) s += x; return s / v.length; };
let r = await sim.run(1);
const days = window.__days || 14, rows = [];
let pacc0 = mean(sim.sfcGrid('PACC').v);
for (let d = 0; d < days; d++) {
  while (!(r.clock.hour >= 14 && r.clock.hour < 15 && r.simHours > 24 * d + 6)) r = await sim.run(Math.max(1, Math.round(900 / dt)));
  const CP = sim.sfcGrid('CAPE').v, MU = sim.sfcGrid('MUCAPE').v, CV = sim.sfcGrid('COVER').v, CC = sim.sfcGrid('COVC').v;
  const T2 = sim.sfcGrid('T2').v, TD = sim.sfcGrid('TD2').v, PB = sim.sfcGrid('PBLH').v, PA = sim.sfcGrid('PACC').v;
  let clear = 0, big = 0;
  for (let q = 0; q < CV.length; q++) { clear += CV[q] < 0.1; big += CP[q] > 1000; }
  const pa = mean(PA);
  const dr = await sim.drift(), SW = mean(sim.sfcGrid('SW').v);
  // źródła chmur: woda siatki (LWP, w tym kłębiasta LWPC), cumulusy schematu (CULS), piętra (CLL/CLM/CLH)
  const LW = sim.sfcGrid('LWP').v, LWC = sim.sfcGrid('LWPC').v, CU = sim.sfcGrid('CULS').v;
  let cu1 = 0; for (const x of CU) cu1 += x > 1;
  const src = `LWP ${(1000 * mean(LW)).toFixed(0)} (kłęb. ${(1000 * mean(LWC)).toFixed(0)}) g/m², CULS ${mean(CU).toFixed(1)} (oczek > 1: ${(100 * cu1 / CU.length).toFixed(0)}%), piętra ${mean(sim.sfcGrid('CLL').v).toFixed(2)}/${mean(sim.sfcGrid('CLM').v).toFixed(2)}/${mean(sim.sfcGrid('CLH').v).toFixed(2)}`;
  const row = { d: d + 1, date: r.clock.date || '', cape: mean(CP), capeMed: pct(CP, 0.5), cape90: pct(CP, 0.9), big: 100 * big / CP.length,
    mu: mean(MU), cov: 100 * mean(CV), covc: 100 * mean(CC), clear: 100 * clear / CV.length, T2: mean(T2), Td: mean(TD), pblh: mean(PB), P: pa - pacc0,
    dT1: dr.bl.T - dr.bl.Tt, dq1: dr.bl.q - dr.bl.qt, q1: dr.bl.q, SW };
  pacc0 = pa; rows.push(row);
  log(`doba ${row.d} 14:00 CAPE śr ${row.cape.toFixed(0)} med ${row.capeMed.toFixed(0)} p90 ${row.cape90.toFixed(0)} >1000: ${row.big.toFixed(0)}% | MUCAPE ${row.mu.toFixed(0)} | ` +
    `chmury ${row.cov.toFixed(0)}% (kłęb. ${row.covc.toFixed(0)}%), bezchm. oczek ${row.clear.toFixed(0)}% | T2 ${row.T2.toFixed(1)} Td ${row.Td.toFixed(1)} PBLH ${row.pblh.toFixed(0)} | 1. warstwa − cel: T ${row.dT1.toFixed(1)} K, q ${row.dq1.toFixed(1)} g/kg (q ${row.q1.toFixed(1)}) | SW ${row.SW.toFixed(0)} W/m² | opad 24 h ${row.P.toFixed(1)} mm | ${src}`);
  r = await sim.run(Math.round(3600 / dt));
}
const M = (k) => mean(rows.map((x) => x[k]));
log(`RAZEM (${days} dób, 14:00): CAPE śr ${M('cape').toFixed(0)} med ${M('capeMed').toFixed(0)} p90 ${M('cape90').toFixed(0)} | dni z medianą CAPE < 100: ${rows.filter((x) => x.capeMed < 100).length}` +
  ` | chmury ${M('cov').toFixed(0)}% (kłęb. ${M('covc').toFixed(0)}%) | dni z zachm. < 20%: ${rows.filter((x) => x.cov < 20).length}, < 40%: ${rows.filter((x) => x.cov < 40).length}` +
  ` | T2 ${M('T2').toFixed(1)} Td ${M('Td').toFixed(1)} PBLH ${M('pblh').toFixed(0)} | 1. warstwa − cel T ${M('dT1').toFixed(1)} K q ${M('dq1').toFixed(1)} g/kg | SW ${M('SW').toFixed(0)} | opad ${M('P').toFixed(1)} mm/d`);
