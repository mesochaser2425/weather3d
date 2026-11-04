// Kowadła burz: co godzinę udział mapy z chmurami wysokimi (woda równoważna > 6 km nad gruntem, CLH) względem obszaru opadu
// konwekcyjnego, zachmurzenie kłębiaste / warstwowe; na końcu widok satelitarny (zrzut: SHOT=plik.png).
// Parametry: __hours (czas od startu scenariusza, domyślnie 10), __from (od której godziny statystyka, domyślnie 6), __field (pole mapy na końcu)
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const hours = window.__hours || 10, from = window.__from || 6;
const mean = (v) => { let s = 0; for (const x of v) s += x; return s / v.length; };
for (let h = 1; h <= hours; h++) {
  await sim.run(Math.round(3600 / dt));
  if (h < from) continue;
  const CLH = sim.sfcGrid('CLH').v, PR = sim.sfcGrid('PR').v, CV = sim.sfcGrid('COVER').v, CC = sim.sfcGrid('COVC').v, CS = sim.sfcGrid('COVS').v;
  const fr = (v, t) => (100 * v.filter((x) => x > t).length / v.length).toFixed(1);
  log(`h ${h}: chmury wysokie CLH > 1 / 5 / 20 g/m²: ${fr(CLH, 1)} / ${fr(CLH, 5)} / ${fr(CLH, 20)}% mapy (maks ${Math.max(...CLH).toFixed(0)}) | opad > 1 / 10 mm/h: ${fr(PR, 1)} / ${fr(PR, 10)}% | ` +
    `zachm. ${(100 * mean(CV)).toFixed(0)}% (kłęb. ${(100 * mean(CC)).toFixed(0)}%, warstw. ${(100 * mean(CS)).toFixed(0)}%)`);
}
// przekrój W–E przez najsilniejszą burzę (co 2. oczko, ±30 oczek): zasięg pionowy lodu chmurowego (q_i > 0.02 g/kg), maks. q_i,
// maks. opadu (śnieg/krupa) powyżej 6 km nad gruntem
{
  const g = sim.sfcGrid('PR');
  let km = 0;
  g.v.forEach((v, k) => { if (v > g.v[km]) km = k; });
  const jm = Math.floor(km / g.nx), im = km % g.nx;
  let line = '';
  for (let i = Math.max(0, im - 30); i <= Math.min(g.nx - 1, im + 30); i += 2) {
    const c = await sim.colq(i, jm), ice = c.filter((r) => r[5] > 0.02), up = c.filter((r) => r[0] > 6000);
    line += `\n  x ${String(((i - im) * g.dx / 1000).toFixed(0)).padStart(4)} km: ` + (ice.length ? `lód ${(ice[0][0] / 1000).toFixed(1)}–${(ice[ice.length - 1][0] / 1000).toFixed(1)} km, ` +
      `maks q_i ${Math.max(...ice.map((r) => r[5])).toFixed(2)} g/kg` : 'lód –') + `, q_r > 6 km maks ${Math.max(...up.map((r) => r[6])).toFixed(2)} | opad ${g.v[jm * g.nx + i].toFixed(1)} mm/h`;
  }
  log(`przekrój W–E przez najsilniejszą burzę (wiersz ${jm}):` + line);
}
sim.set('fieldH', String(window.__field || 29));
await sim.draw();
await new Promise((r) => setTimeout(r, 500));
await sim.draw();
