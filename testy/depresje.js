// Depresje i poldery: oczka poniżej poziomu morza mają być lądem, a morze i jeziora w depresjach wodą (miejsce jak z mapy świata).
// Adres z nx, np. "?dx=8000&nx=40&ny=32", BLOCK_OM=1, ~2 min; window.__places albo domyślna lista. Mapa: ~ woda, . pola, T las, # zabudowa.
sim.stop();
const PL = window.__places || [['Zulawy', 54.25, 19.0], ['Holandia', 52.3, 5.0], ['Nizina nadkaspijska', 46.5, 50.5], ['Morze Martwe', 31.5, 35.5]];
const CH = ['.', 'T', '#', '~'];
for (const [name, lat, lon] of PL) {
  await sim.place(lat, lon);
  const cls = sim.landGrid(), h = sim.hgt();
  const nx = +new URLSearchParams(location.search).get('nx'), ny = cls.length / nx;
  const rows = [];
  for (let j = ny - 1; j >= 0; j--) rows.push(Array.from({ length: nx }, (_, i) => CH[Math.round(cls[j * nx + i])]).join(''));
  let w = 0; for (const c of cls) if (Math.round(c) === 3) w++;
  log(`=== ${name} ${lat}, ${lon}: woda ${(100 * w / cls.length).toFixed(0)}% oczek, grunt ${Math.min(...h).toFixed(0)}...${Math.max(...h).toFixed(0)} m; ${JSON.stringify(window.__lcStats)}\n${rows.join('\n')}`);
}
