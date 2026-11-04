// Plan siatki z wymiarów domeny – osobny moduł bez stanu, używany też przez stronę tytułową (grid.js czyta adres strony przy wczytaniu,
// więc strona tytułowa nie może go importować, zanim ustali adres).

// oczka siatki do wyboru [m]
export const NICE_DX = [100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000,
  7500, 10000, 15000, 20000, 25000];
export const RES_OPTS = [64, 100, 128, 160, 200, 256];
export const r4 = (n) => Math.max(16, 4 * Math.round(n / 4));   // wielokrotność odstępu siatki parametrów
// oczko dla domeny lx × ly [km] przy szczegółowości res (komórek na dłuższym boku)
export function autoDx(lx, ly, res) {
  const L = Math.max(lx, ly) * 1000;
  return NICE_DX.find((d) => L / d <= res * 1.02) || NICE_DX[NICE_DX.length - 1];
}
// krok czasowy rośnie z oczkiem (adwekcja semi-lagrangeowska jest stabilna, ograniczają go fale
// grawitacyjne N·Δt < 2 i dokładność)
export const dtFor = (dx) => (dx <= 1000 ? 20 : dx <= 2000 ? 30 : dx <= 5000 ? 45 : 60);

// Kategoria skali symulacji z wielkości widocznej mapy (dłuższy bok [km]) – określa, do czego mapa służy
export function scaleClass(Lkm) {
  if (Lkm <= 40) return { key: 'micro', name: 'microscale', use: 'thermals, single cumulus clouds, microclimate of a town, forest and slope' };
  if (Lkm <= 400) return { key: 'meso', name: 'mesoscale', use: 'storms, convergence lines, breezes, foehn, valleys, local climate of a region' };
  return { key: 'syn', name: 'synoptic scale', use: 'fronts, lows and highs, precipitation bands, weather over many days' };
}

// siatka dla domeny lx × ly [km]: dxSel – 'auto' (z res) albo oczko [m]; cost – koszt doby względem 1 km, 100 × 100 (~30 s doby w trybie
// MAX na RTX 5060 Ti); mg – niewidoczny margines [oczka]
export function planGrid(lx, ly, res, dxSel = 'auto', per = false) {
  lx = Math.max(5, lx); ly = Math.max(5, ly);
  const dx = dxSel === 'auto' ? autoDx(lx, ly, res) : Number(dxSel);
  const nx = Math.min(512, r4(lx * 1000 / dx)), ny = Math.min(512, r4(ly * 1000 / dx));
  const ne = per ? 0 : 16, mg = per ? 0 : 2 * Math.round(Math.min(24, Math.max(6, 0.1 * Math.max(nx, ny))) / 2);
  const cells = (nx + 2 * mg + ne) * (ny + 2 * mg + ne);
  const cost = cells / (108 * 108) * Math.sqrt((nx + ny) / 200) * 20 / dtFor(dx);
  return { dx, nx, ny, mg, cost, sc: scaleClass(Math.max(nx, ny) * dx / 1000) };
}
