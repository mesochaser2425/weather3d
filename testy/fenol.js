// Fenologia: czy ciepły epizod jesienią przywraca zieleń, czy wiosną roślinność się zazielenia? Start window.__date
// (domyślnie 25 IX; Kraków, model synoptyczny), window.__days dób. Codziennie: średnia T 2 m (4 próbki), T gleby TD (dawna
// podstawa fenologii), średnia ~15 dób (TPH), temperatura fenologiczna (TPHN), zieleń pól i lasów liściastych, dawna reguła pól
sim.stop();
sim.set('date', window.__date || '2026-09-25');
await sim.reset();
await sim.run(1);                                  // odczyt pól przy gruncie
const days = window.__days || 50, per = 4;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// klasy roślinności widocznych oczek (row(j) obejmuje margines)
const g0 = sim.sfcGrid('GRN'), r0 = sim.row(0), MG = (r0.length - g0.nx) / 2;
const veg = [];
for (let j = 0; j < g0.ny; j++) { const r = sim.row(j + MG); for (let i = 0; i < g0.nx; i++) veg.push(r[i + MG].veg); }
const gmean = (cls) => { const g = sim.sfcGrid('GRN').v; let s = 0, n = 0; g.forEach((x, k) => { if (veg[k] === cls) { s += x; n++; } }); return n ? (s / n).toFixed(2) : '–'; };
log(`oczek: pola ${veg.filter((v) => v === 0).length}, las liściasty ${veg.filter((v) => v === 1).length}`);
log('doba  T2śr   TD   TPH  TPHN  pola  las  (dawna reguła pól)');
for (let d = 0; d < days; d++) {
  let t2 = 0;
  for (let q = 0; q < per; q++) { await sim.run(Math.round(86400 / per / (window.__dt || 45))); t2 += sim.sfcStats('T2').mean / per; }
  const td = sim.sfcStats('TD').mean - 273.15;
  log(`${String(d + 1).padStart(3)} ${t2.toFixed(1).padStart(6)} ${td.toFixed(1).padStart(5)} ${sim.sfcStats('TPH').mean.toFixed(1).padStart(5)} ${sim.sfcStats('TPHN').mean.toFixed(1).padStart(5)}  ${gmean(0)}  ${gmean(1)}  (${sm(3, 10, td).toFixed(2)})`);
}
