// Przebieg ze scenariusza z linku (#s=…, bez zmiany daty i miejsca): co dobę o 14:00 CAPE (średnia, p90, maks.), MUCAPE, T2, Td2
// (średnia, p90, maks.), opad dobowy (średnia, maks.), korekta klimatu, 1. warstwa vs cel; co 3 doby profil domeny i celu (T, Td)
// oraz kolumna o największym CAPE (inwersje?). Parametry: __days (14).
await new Promise((r) => setTimeout(r, 5000));   // wczytanie scenariusza z linku (asynchronicznie) i restart
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const $v = (id) => document.getElementById(id).value;
log(`scenariusz: data ${$v('date')}, godz. ${$v('hour')}, lat ${$v('lat')}, lon ${$v('lon')}, tryb ${$v('wxMode')}, tanom ${$v('tanom')}, korekta ${document.getElementById('climcorr').checked} ${JSON.stringify(sim.cc())}`);
const pct = (v, p) => { const s = Float32Array.from(v).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (v) => { let s = 0; for (const x of v) s += x; return s / v.length; };
const es = (T) => 6.112 * Math.exp(17.67 * T / (T + 243.5));
const tdq = (q, z) => { const e = q / 622 * 1013 * Math.exp(-z / 8400); const l = Math.log(e / 6.112); return 243.5 * l / (17.67 - l); };
let r = b;
const days = window.__days || 14, rows = [];
let pacc0 = sim.sfcGrid('PACC').v.slice();
for (let d = 0; d < days; d++) {
  while (!(r.clock.hour >= 14 && r.clock.hour < 15 && r.simHours > 24 * d + 2)) r = await sim.run(Math.max(1, Math.round(900 / dt)));
  const CP = sim.sfcGrid('CAPE').v, MU = sim.sfcGrid('MUCAPE').v, T2 = sim.sfcGrid('T2').v, TD = sim.sfcGrid('TD2').v, PA = sim.sfcGrid('PACC').v, CV = sim.sfcGrid('COVER').v;
  const dP = PA.map((x, q) => x - pacc0[q]); pacc0 = PA.slice();
  const dr = await sim.drift();
  log(`doba ${d + 1} 14:00 | CAPE śr ${mean(CP).toFixed(0)} p90 ${pct(CP, 0.9).toFixed(0)} maks ${pct(CP, 1).toFixed(0)} | MUCAPE maks ${pct(MU, 1).toFixed(0)} | T2 ${mean(T2).toFixed(1)} (maks ${pct(T2, 1).toFixed(1)}) | ` +
    `Td2 ${mean(TD).toFixed(1)} p90 ${pct(TD, 0.9).toFixed(1)} maks ${pct(TD, 1).toFixed(1)} | chmury ${(100 * mean(CV)).toFixed(0)}% | opad 24 h śr ${mean(dP).toFixed(1)} maks ${pct(dP, 1).toFixed(0)} mm | ` +
    `1. warstwa − cel T ${(dr.bl.T - dr.bl.Tt).toFixed(1)} K q ${(dr.bl.q - dr.bl.qt).toFixed(1)} (q ${dr.bl.q.toFixed(1)}, cel ${dr.bl.qt.toFixed(1)}) `);
  if (d % 3 === 1) {
    log('  profil (z: T/T_cel, Td/Td_cel): ' + dr.lev.filter((l) => l.z < 6500).filter((_, i) => i % 2 === 0).map((l) => `${l.z}:${l.T.toFixed(1)}/${l.Tt.toFixed(1)} ${tdq(l.q, l.z).toFixed(1)}/${tdq(l.qt, l.z).toFixed(1)}`).join(' '));
    const g = sim.sfcGrid('CAPE'); let im = 0; for (let q = 0; q < CP.length; q++) if (CP[q] > CP[im]) im = q;
    const c = await sim.colq(im % g.nx, Math.floor(im / g.nx));
    log(`  kolumna maks. CAPE ${CP[im].toFixed(0)}: ` + c.filter((x) => x[0] < 6500).filter((_, i) => i % 2 === 0).map((x) => `${x[0]}:${x[1]}/${tdq(x[3], x[0] + 300).toFixed(1)}`).join(' '));
  }
  r = await sim.run(Math.round(3600 / dt));
}
const P = sim.sfcGrid('PACC').v;
log(`RAZEM: opad śr ${mean(P).toFixed(0)} mm, maks ${pct(P, 1).toFixed(0)} mm, p90 ${pct(P, 0.9).toFixed(0)} mm`);
