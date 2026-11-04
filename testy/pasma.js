// Stacjonarne pasma opadu (np. @testy/pasma250.url): co 10 min opad w każdym oczku; co godzinę statystyka; na końcu mapa trwałości
// (udział czasu z opadem > 1 mm/h) i sumy w blokach 4 × 4 oczka obok mapy wysokości terenu – skąd startują pasma i czy stoją w miejscu.
// Parametry: __hours (domyślnie 8), __skip (godzin bez zapisu na początku, 0)
sim.stop();
for (let n = 0; n < 600 && !(await sim.syn()).cls; n++) await new Promise((r) => setTimeout(r, 500));
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
if (window.__skip) await sim.run(Math.round(window.__skip * 3600 / dt));
const H = window.__hours || 8;
const g0 = sim.sfcGrid('PR'), nx = g0.nx, ny = g0.ny;
const h = sim.hgt();
const pers = new Float32Array(nx * ny);
const P0 = Float32Array.from(sim.sfcGrid('PACC').v);
let ns = 0, hr = { pm: 0, rain: 0, n: 0 };
const mean = (v) => { let s = 0; for (const x of v) s += x; return s / v.length; };
for (let s = 1; s <= H * 6; s++) {
  const r = await sim.run(Math.round(600 / dt));
  const PR = sim.sfcGrid('PR').v;
  let rain = 0, pm = 0;
  for (let k = 0; k < PR.length; k++) { if (PR[k] > 1) { pers[k]++; rain++; } pm = Math.max(pm, PR[k]); }
  ns++; hr.pm = Math.max(hr.pm, pm); hr.rain += rain; hr.n++;
  if (s % 6 === 0) {
    log(`${r.clock.hour.toFixed(1)} h: opad > 1 mm/h ${(100 * hr.rain / hr.n / PR.length).toFixed(1)}% mapy, maks ${hr.pm.toFixed(0)} mm/h | CAPE śr ${mean(sim.sfcGrid('CAPE').v).toFixed(0)} | ` +
      `T2 ${mean(sim.sfcGrid('T2').v).toFixed(1)} Td2 ${mean(sim.sfcGrid('TD2').v).toFixed(1)} | wiatr 10 m ${mean(sim.sfcGrid('U10').v).toFixed(1)} m/s`);
    hr = { pm: 0, rain: 0, n: 0 };
  }
}
const P = sim.sfcGrid('PACC').v;
const sum = new Float32Array(nx * ny);
for (let k = 0; k < sum.length; k++) sum[k] = P[k] - P0[k];
let mx = 0, km = 0;
sum.forEach((v, k) => { if (v > mx) { mx = v; km = k; } });
const fr = (t) => (100 * Array.from(pers).filter((x) => x / ns > t).length / pers.length).toFixed(1);
log(`suma ${H} h: średnio ${mean(sum).toFixed(1)} mm, maks ${mx.toFixed(0)} mm w (${km % nx}, ${Math.floor(km / nx)}), teren ${h[km].toFixed(0)} m | oczek z opadem > 1 mm/h przez > 25% / 50% czasu: ${fr(0.25)} / ${fr(0.5)}%`);
// mapy w blokach 4 × 4 (wiersze od północy): trwałość 0–9 (×10% czasu), suma (znak wg progów), teren (setki m)
const B = 4, cols = Math.floor(nx / B), rows = Math.floor(ny / B);
const sym = ' .:-=+*#%@';
let out = 'trwałość opadu | suma (· <5, : <20, + <50, # ≥50 mm) | teren [×300 m]\n';
for (let rj = rows - 1; rj >= 0; rj--) {
  let l1 = '', l2 = '', l3 = '';
  for (let ci = 0; ci < cols; ci++) {
    let p = 0, sm = 0, hh = 0;
    for (let dj = 0; dj < B; dj++) for (let di = 0; di < B; di++) { const k = (rj * B + dj) * nx + ci * B + di; p = Math.max(p, pers[k] / ns); sm = Math.max(sm, sum[k]); hh += h[k] / (B * B); }
    l1 += sym[Math.min(9, Math.floor(p * 10))];
    l2 += sm < 0.5 ? ' ' : sm < 5 ? '·' : sm < 20 ? ':' : sm < 50 ? '+' : '#';
    l3 += String(Math.min(9, Math.floor(hh / 300)));
  }
  out += `${l1} | ${l2} | ${l3}\n`;
}
log(out);
