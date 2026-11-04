// Teren: kształty (szum Perlina, grzbiet, góra, dolina), mapa z obrazu, malowanie pędzlem.
// Wysokości trzymamy jako gładkie pole h [m] w kolumnach; model widzi teren schodkowy:
// komórka jest podziemna, gdy leży poniżej h zaokrąglonego do najbliższego poziomu siatki w (zw).
// Domena jest periodyczna, więc kształty też są (grzbiet, dolina i szum zawijają się na brzegach).

import { sOfZ, zOfS } from './grid.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Szum Perlina 2D o okresie `period` węzłów w obu kierunkach
function perlinLayer(period, rand) {
  const g = [];
  for (let n = 0; n < period * period; n++) {
    const a = rand() * 2 * Math.PI;
    g.push([Math.cos(a), Math.sin(a)]);
  }
  const grad = (ix, iy) => g[((iy % period + period) % period) * period + ((ix % period + period) % period)];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const dot = (cx, cy) => { const q = grad(ix + cx, iy + cy); return q[0] * (fx - cx) + q[1] * (fy - cy); };
    const u = fade(fx), v = fade(fy);
    const a = dot(0, 0) + u * (dot(1, 0) - dot(0, 0));
    const b = dot(0, 1) + u * (dot(1, 1) - dot(0, 1));
    return a + v * (b - a);
  };
}

export const SHAPES = {
  flat: 'Flat',
  perlin: 'Hills (Perlin noise)',
  ridge: 'Meridional ridge (foehn with a westerly wind)',
  hill: 'Single mountain',
  valley: 'East–west valley',
  image: 'From an image (load a file)',
  painted: 'Custom (painted)',
  dem: 'From the world map (SRTM data)',
};

// Kształt znormalizowany 0..1 w kolumnach
export function genShape(kind, cfg, seed) {
  const { NX, NY } = cfg;
  const s = new Float32Array(NX * NY);
  const at = (fn) => { for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) s[j * NX + i] = fn((i + 0.5) / NX, (j + 0.5) / NY); };
  // odległość periodyczna od środka domeny (w ułamkach boku)
  const d = (a) => { const x = a - 0.5; return x - Math.round(x); };
  switch (kind) {
    case 'perlin': {
      const rand = rng(seed);
      const oct = [[3, 1.0], [6, 0.5], [12, 0.25]];
      const layers = oct.map(([p]) => perlinLayer(p, rand));
      at((x, y) => oct.reduce((a, [p, amp], o) => a + amp * layers[o](x * p, y * p), 0));
      break;
    }
    case 'ridge': at((x) => Math.exp(-((d(x) / 0.09) ** 2))); break;
    case 'hill': at((x, y) => Math.exp(-((d(x) ** 2 + d(y) ** 2) / 0.12 ** 2))); break;
    case 'valley': at((x, y) => 0.5 * (1 - Math.cos(2 * Math.PI * d(y)))); break;
    default: break;
  }
  return normalize(s);
}

function normalize(s) {
  let lo = Infinity, hi = -Infinity;
  for (const v of s) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!(hi > lo)) return s.fill(0);
  for (let c = 0; c < s.length; c++) s[c] = (s[c] - lo) / (hi - lo);
  return s;
}

// Mapa wysokości z obrazu (jasność = wysokość). Brzegi łagodnie wyrównujemy do średniej z obwodu,
// żeby teren pasował do periodycznych brzegów domeny.
export function shapeFromImage(img, cfg, blendEdges = true) {
  const { NX, NY } = cfg;
  const cv = document.createElement('canvas');
  cv.width = NX; cv.height = NY;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, NX, NY);
  const px = ctx.getImageData(0, 0, NX, NY).data;
  const s = new Float32Array(NX * NY);
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const p = 4 * ((NY - 1 - j) * NX + i);           // góra obrazu = północ
      s[j * NX + i] = (0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2]) / 255;
    }
  }
  if (!blendEdges) return normalize(s);          // brzegi otwarte: obraz bez zmian
  let edge = 0, ne = 0;
  for (let i = 0; i < NX; i++) { edge += s[i] + s[(NY - 1) * NX + i]; ne += 2; }
  for (let j = 0; j < NY; j++) { edge += s[j * NX] + s[j * NX + NX - 1]; ne += 2; }
  edge /= ne;
  const band = 0.08;
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const e = Math.min(i + 0.5, NX - i - 0.5) / NX, f = Math.min(j + 0.5, NY - j - 0.5) / NY;
      const w = Math.min(1, Math.min(e, f) / band);
      const t = w * w * (3 - 2 * w);
      s[j * NX + i] = edge + (s[j * NX + i] - edge) * t;
    }
  }
  return normalize(s);
}

// Pędzel: dodaje (lub odejmuje) gładki "kopczyk" o promieniu r [komórki] w punkcie (x, y) [komórki]
export function paintBrush(h, cfg, x, y, r, amount, hmax, wrap = true) {
  const { NX, NY } = cfg;
  const R = Math.ceil(2 * r);
  for (let dj = -R; dj <= R; dj++) {
    for (let di = -R; di <= R; di++) {
      const ii = Math.floor(x) + di, jj = Math.floor(y) + dj;
      if (!wrap && (ii < 0 || jj < 0 || ii >= NX || jj >= NY)) continue;
      const i = (ii % NX + NX) % NX, j = (jj % NY + NY) % NY;
      const dx = Math.floor(x) + di + 0.5 - x, dy = Math.floor(y) + dj + 0.5 - y;
      const wgt = Math.exp(-(dx * dx + dy * dy) / (r * r));
      const c = j * NX + i;
      h[c] = Math.min(hmax, Math.max(0, h[c] + amount * wgt));
    }
  }
}

// Z wysokości h [m] wyprowadza: kb (liczba podziemnych komórek), hf (część komórki kb nad gruntem), nachylenia,
// czy teren jest płaski. Oczka przycięte do terenu (shaved cells, Adcroft i in. 1997): grunt na prawdziwej wysokości
// wewnątrz komórki kb (część hf ≥ HF_MIN; cieńsza – grunt podniesiony do górnej ściany). Wcześniej grunt zaokrąglany do
// najbliższej ściany komórek: teren schodkowy, na każdym stopniu (kontur terenu na granicy warstw) nieruchoma linia
// wznoszenia (gładka góra 150 m, wiatr 14 m/s: +25 cm/s na stopniu zamiast łagodnego wznoszenia na całym zboczu) –
// termiki, chmury i pasma burz przyklejone do terenu. partial = false – dawny teren schodkowy (?pc=0)
export const HF_MIN = 0.3;
export function deriveTerrain(h, cfg, partial = true) {
  const { NX, NY, NZ, DX, DY } = cfg;
  const kb = new Float32Array(NX * NY), hf = new Float32Array(NX * NY).fill(1), slx = new Float32Array(NX * NY), sly = new Float32Array(NX * NY);
  let flat = true, hmax = 0;
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const c = j * NX + i;
      if (partial) {
        let k = Math.floor(sOfZ(h[c], cfg));
        const z0 = zOfS(k, cfg), z1 = zOfS(k + 1, cfg);
        let f = Math.min(1, (z1 - h[c]) / (z1 - z0));
        if (f < HF_MIN) { k += 1; f = 1; }
        if (k > NZ - 12) { k = NZ - 12; f = 1; }
        kb[c] = k; hf[c] = f;
      } else kb[c] = Math.min(Math.round(sOfZ(h[c], cfg)), NZ - 12);
      if (kb[c] > 0) flat = false;
      hmax = Math.max(hmax, h[c]);
      const e = h[j * NX + (i + 1) % NX], w = h[j * NX + (i + NX - 1) % NX];
      const n = h[((j + 1) % NY) * NX + i], s = h[((j + NY - 1) % NY) * NX + i];
      slx[c] = (e - w) / (2 * DX);
      sly[c] = (n - s) / (2 * DY);
    }
  }
  return { kb, hf, slx, sly, flat, hmax };
}

// Mapa wysokości jako obraz PNG (do zapisania)
export function heightPng(h, cfg, hmax) {
  const { NX, NY } = cfg;
  const cv = document.createElement('canvas');
  cv.width = NX; cv.height = NY;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(NX, NY);
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const v = Math.round(255 * (hmax > 0 ? h[j * NX + i] / hmax : 0));
      const p = 4 * ((NY - 1 - j) * NX + i);
      img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}
