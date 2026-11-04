// Zagnieżdżenie domeny w większym układzie.
// Siatka parametrów sondażu (co GS oczek) z modelu synoptycznego albo ze stałej masy powietrza;
// GPU buduje z niej pola docelowe (tgt_build w sim.wgsl). W niewidocznej strefie wyrównania za
// brzegiem parametry przechodzą gładko od wschodniego brzegu do zachodniego (i od północnego do
// południowego) – pola są wtedy periodyczne i solver ciśnienia może zostać periodyczny.
// Tu też rozszerzanie map z widocznej siatki (teren, pokrycie) na pełną siatkę obliczeniową.

import { CFG, NPAR } from './grid.js';

const sm = (x) => x * x * (3 - 2 * x);

// Wektor parametrów z opisu masy powietrza (jednostki jak w edytorze: °C, K/km, km, %)
export function parVec(a) {
  const zi = a.zinv > 0 ? a.zinv * 1000 : 0;
  return [a.tsfc + 273.15, Math.min(a.lapse, 9.5) / 1000, a.ztrop * 1000, zi, zi > 0 ? a.dinv || 0 : 0,
    a.rhLow / 100, a.rhHigh / 100, a.u0 || 0, a.v0 || 0, a.du || 0, a.dv || 0, a.w || 0, a.psl ?? 1013.25, a.pr || 0, a.prc || 0,
    Math.min(a.lapse2 || a.lapse, 9.5) / 1000, a.d0u || 0, a.d0v || 0, a.d3u || 0, a.d3v || 0,
    a.rhMid > 0 ? a.rhMid / 100 : 0, 0, 0, 0,   // 21–23 tylko z modelu synoptycznego (0 – profil wilgotności z dwóch węzłów)
    0];                                         // 24 gradient 3–5.6 km (0 – jak dolny: stała masa powietrza ma jeden gradient)
}

// sample(x, y) → wektor parametrów; x, y – położenie względem środka widocznej domeny [m]
// Wynik: Float32Array w kolejności [parametr][gy][gx]
export function paramGrid(sample, cfg = CFG) {
  const NGX = cfg.NX / cfg.GS, NGY = cfg.NY / cfg.GS, NG = NGX * NGY;
  const out = new Float32Array(NPAR * NG);
  // położenie węzła na osi (w oczkach); w strefie wyrównania – dwa brzegi z wagami
  const axis = (X, NV) => (X <= NV ? [[X, 1]] : [[NV, 1 - sm((X - NV) / cfg.NE)], [0, sm((X - NV) / cfg.NE)]]);
  const cache = new Map();
  const at = (X, Y) => {
    const key = X * 100003 + Y;
    let v = cache.get(key);
    if (!v) { v = sample((X - cfg.NXV / 2) * cfg.DX, (Y - cfg.NYV / 2) * cfg.DY); cache.set(key, v); }
    return v;
  };
  for (let gy = 0; gy < NGY; gy++) {
    for (let gx = 0; gx < NGX; gx++) {
      const acc = new Float64Array(NPAR);
      for (const [xa, wx] of axis(gx * cfg.GS, cfg.NXV)) {
        for (const [ya, wy] of axis(gy * cfg.GS, cfg.NYV)) {
          const v = at(xa, ya), w = wx * wy;
          if (w > 0) for (let p = 0; p < NPAR; p++) acc[p] += w * v[p];
        }
      }
      for (let p = 0; p < NPAR; p++) out[p * NG + gy * NGX + gx] = acc[p];
    }
  }
  return out;
}

// Parametry w punkcie (X, Y) w oczkach (środek komórki i: X = i + 0.5), interpolacja dwuliniowa
export function paramAt(grid, X, Y, cfg = CFG) {
  const NGX = cfg.NX / cfg.GS, NGY = cfg.NY / cfg.GS, NG = NGX * NGY;
  const gx = X / cfg.GS, gy = Y / cfg.GS, xf = Math.floor(gx), yf = Math.floor(gy), fx = gx - xf, fy = gy - yf;
  const i0 = ((xf % NGX) + NGX) % NGX, i1 = (i0 + 1) % NGX, j0 = ((yf % NGY) + NGY) % NGY, j1 = (j0 + 1) % NGY;
  const out = new Array(NPAR);
  for (let p = 0; p < NPAR; p++) {
    const b = p * NG;
    const a = grid[b + j0 * NGX + i0] + fx * (grid[b + j0 * NGX + i1] - grid[b + j0 * NGX + i0]);
    const c = grid[b + j1 * NGX + i0] + fx * (grid[b + j1 * NGX + i1] - grid[b + j1 * NGX + i0]);
    out[p] = a + fy * (c - a);
  }
  return out;
}

// Temperatura masy powietrza na wysokości z [m] z wektora parametrów (jak airT w sim.wgsl)
export function airTz(pv, z) {
  const [ts, gam, ztr, zi, di] = pv;
  const gu = pv[24] > 0 ? pv[24] : gam, g2 = pv[15] > 0 ? pv[15] : gu, wt = 350, w2 = 600, w3 = 400;
  const soft = (x) => (x > 30 ? x : Math.log1p(Math.exp(x)));
  let t = ts - gam * z - (gu - gam) * w3 * soft((z - 3000) / w3) - (g2 - gu) * w2 * soft((z - 5500) / w2) + (g2 + 0.001) * wt * soft((z - ztr) / wt);
  if (zi > 0) {
    if (di >= 0) { const s = Math.min(1, Math.max(0, (z - zi) / 500)); t += di * s * s * (3 - 2 * s); }
    else t += di * Math.min(1, Math.max(0, z / (zi + 500)));   // ujemna „inwersja”: większy spadek T w warstwie granicznej (jak airT)
  }
  return t;
}

// Pole z widocznej siatki (NXV × NYV) na pełną (NX × NY): w strefie wyrównania gładkie przejście
// między przeciwległymi brzegami (nearest – klasy: bliższy brzeg)
export function embed(v, cfg = CFG, nearest = false) {
  const { NX, NY, NXV, NYV, NE } = cfg;
  if (NE === 0) return Float32Array.from(v);
  const out = new Float32Array(NX * NY);
  const blend = (a, b, s) => (nearest ? (s < 0.5 ? a : b) : a + (b - a) * sm(s));
  const rowVal = (i, j) => (i < NXV ? v[j * NXV + i] : blend(v[j * NXV + NXV - 1], v[j * NXV], (i - NXV + 0.5) / NE));
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      out[j * NX + i] = j < NYV ? rowVal(i, j) : blend(rowVal(i, NYV - 1), rowVal(i, 0), (j - NYV + 0.5) / NE);
    }
  }
  return out;
}

// Widoczna część pełnego pola
export function visible(full, cfg = CFG) {
  const { NX, NXV, NYV } = cfg;
  const out = new Float32Array(NXV * NYV);
  for (let j = 0; j < NYV; j++) for (let i = 0; i < NXV; i++) out[j * NXV + i] = full[j * NX + i];
  return out;
}
