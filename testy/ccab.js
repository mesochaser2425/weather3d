// Porównanie źródeł norm w korekcie klimatu (ten sam model synoptyczny i ta sama pogoda – korekta nie wpływa na model): miejsce z mapy świata, doby od daty,
// co 5 dób T 2 m domeny, na końcu średnie miesięczne domeny, zachmurzenie, poprawka korekty i źródło danych.
// Parametry w adresie: tp=data,ziarno,doby,szer,dł (domyślnie 2027-01-01,1,31,50,20). Szybko: "?dx=8000&nx=40&ny=40&tp=…" (~5 s/dobę).
// Testy: BLOCK_OM=1 (bez Open-Meteo); normy ERA5 Krakowa z pamięci przeglądarki: INITJS=testy/ccera5.js
sim.stop();
const P = (new URLSearchParams(location.search).get('tp') || '2027-01-01,1,31,50,20').split(',');
sim.set('date', P[0]);
await sim.place(+P[3], +P[4]);
sim.stop(); await sim.roll(+P[1]); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600, spd = Math.round(86400 / dt);
const t0 = performance.now(), rows = [], mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
let cov = 0, ncov = 0;
for (let d = 0; d < +P[2]; d++) {
  for (let q = 0; q < 4; q++) {
    await sim.run(Math.round(spd / 4));
    const c = sim.sfcGrid('COVER');
    if (c) { cov += mean(c.v); ncov++; }
  }
  if ((d + 1) % 5 === 0) rows.push(`${d + 1}:${mean(sim.sfcGrid('T2').v).toFixed(1)}`);
}
log(`czas ${((performance.now() - t0) / 1000).toFixed(0)} s; T 2 m co 5 dób: ${rows.join(' ')}; zachmurzenie ${ncov ? (cov / ncov * (cov / ncov <= 1 ? 100 : 1)).toFixed(0) : '?'}%`);
for (const p of sim.ana('m')) log(`${p.label}${p.cur ? '*' : ''}: T ${p.t?.toFixed(2)} Tmax ${p.tx?.toFixed(2)} Tmin ${p.tn?.toFixed(2)} opad ${p.p?.toFixed(1)} mm śnieg ${p.s?.toFixed(1)}`);
const cc = sim.cc();
log('korekta:', cc.nodes.map((n) => `${n.corr.join('/')} fq ${n.fq} fqa ${n.fqa.join('/')} fp ${n.fp}`).join(' | '), '| dane:', cc.src);
