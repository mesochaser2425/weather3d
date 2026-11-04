// Teren schodkowy: oczka niższe od obu sąsiadów W–E (lub S–N) – ściany po obu stronach najniższej warstwy,
// wiatr w tym kierunku = 0. Domena użytkownika: 352 km, 4 km, środek 49.93°N 19.91°E; stacja Rybnik (78.1, 194.6 km).
sim.stop();
await sim.dem(49.93, 19.91, 1.0, 0.8);
sim.stop();
const H = sim.hgt(), KB = sim.kbGrid(), nx = 88, ny = 88;
let pw = 0, ps = 0, both = 0;
for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
  const k = KB[j * nx + i];
  const we = KB[j * nx + i - 1] > k && KB[j * nx + i + 1] > k, sn = KB[(j - 1) * nx + i] > k && KB[(j + 1) * nx + i] > k;
  pw += we; ps += sn; both += we && sn;
}
const tot = (nx - 2) * (ny - 2);
log(`oczek: ${tot}; zamknięte W–E ${pw} (${(100 * pw / tot).toFixed(1)}%), S–N ${ps} (${(100 * ps / tot).toFixed(1)}%), oba ${both}`);
const ri = Math.floor(78.1 / 4), rj = Math.floor(194.6 / 4);
for (let j = rj + 1; j >= rj - 1; j--) log(`j=${j}: ` + [-1, 0, 1].map((d) => `h ${H[j * nx + ri + d].toFixed(0)} kb ${KB[j * nx + ri + d]}`).join(' | '));
await sim.run(Math.round(6 * 3600 / 45));
const g = (n) => sim.sfcGrid(n).v;
const UA = g('UA'), VA = g('VA'), U10 = g('U10');
let zu = 0, n = 0, wsP = 0, wsO = 0, nP = 0;
for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
  const c = j * nx + i, k = KB[c];
  const pit = (KB[c - 1] > k && KB[c + 1] > k) || (KB[c - nx] > k && KB[c + nx] > k);
  if (pit) { wsP += U10[c]; nP++; if (Math.abs(UA[c]) < 1e-6 || Math.abs(VA[c]) < 1e-6) zu++; } else { wsO += U10[c]; n++; }
}
log(`po 6 h: U10 w oczkach-dołkach ${(wsP / nP).toFixed(2)} m/s (${nP}), pozostałe ${(wsO / n).toFixed(2)} m/s; dołki z UA lub VA = 0: ${zu}`);
log(`Rybnik: UA ${UA[rj * nx + ri].toFixed(2)} VA ${VA[rj * nx + ri].toFixed(2)} U10 ${U10[rj * nx + ri].toFixed(2)}`);
