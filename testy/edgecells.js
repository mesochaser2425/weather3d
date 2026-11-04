// Gdzie powstają burze? Suma opadu i „narodziny” komórek (pierwszy opad > 5 mm/h w oczku) w pasach co 10% szerokości mapy:
// z zachodu na wschód i z południa na północ (przy wietrze z SW brzegi napływu to W i S). Równomierny rozkład – dobrze; skupienie
// w pierwszych pasach – burze rodzą się przy brzegu napływu (rozbieg warstwy granicznej) i płyną seriami w głąb domeny.
// Parametry: __wind (wiatr scenariusza [m/s], zmiana przed startem), __hours (domyślnie 10)
sim.stop();
if (window.__wind) { const e = document.getElementById('wind'); e.value = window.__wind; e.dispatchEvent(new Event('input')); await sim.reset(); sim.stop(); }
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const H = window.__hours || 10;
const g0 = sim.sfcGrid('PACC'), nx = g0.nx, ny = g0.ny;
const first = new Float32Array(nx * ny).fill(-1);
for (let s = 0; s < H * 4; s++) {
  await sim.run(Math.round(900 / dt));
  const PR = sim.sfcGrid('PR').v;
  for (let k = 0; k < PR.length; k++) if (first[k] < 0 && PR[k] > 5) first[k] = (s + 1) / 4;
}
const P = sim.sfcGrid('PACC').v;
// narodziny: oczko z pierwszym opadem > 5 mm/h, w którym 15 min wcześniej w promieniu 2 oczek nie było opadu > 5 mm/h
const birth = new Uint8Array(nx * ny);
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const t = first[j * nx + i];
  if (t < 0) continue;
  let isNew = true;
  for (let dj = -2; dj <= 2 && isNew; dj++) for (let di = -2; di <= 2; di++) {
    const ii = i + di, jj = j + dj;
    if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
    const f = first[jj * nx + ii];
    if (f >= 0 && f < t) { isNew = false; break; }
  }
  birth[j * nx + i] = isNew ? 1 : 0;
}
const bands = (arr, axis) => {
  const out = [];
  for (let bnd = 0; bnd < 10; bnd++) {
    let s = 0, n = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const t = axis === 'x' ? i / nx : j / ny;
      if (Math.floor(t * 10) === bnd) { s += arr[j * nx + i]; n++; }
    }
    out.push(arr === birth ? String(s) : (s / n).toFixed(1));
  }
  return out.join(' ');
};
let tot = 0, mx = 0;
for (const v of P) { tot += v; mx = Math.max(mx, v); }
log(`suma opadu: średnio ${(tot / P.length).toFixed(2)} mm, maks ${mx.toFixed(0)} mm`);
log(`suma w pasach W→E [mm]: ${bands(P, 'x')}`);
log(`suma w pasach S→N [mm]: ${bands(P, 'y')}`);
log(`narodziny komórek W→E: ${bands(birth, 'x')}`);
log(`narodziny komórek S→N: ${bands(birth, 'y')}`);
