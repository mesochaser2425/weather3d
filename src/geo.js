// Dane geograficzne z otwartych źródeł – przeglądarka pobiera je wprost od dostawców, więc strona działa bez własnego serwera (GitHub Pages):
//  – wysokość terenu i dna morza: AWS Terrain Tiles (format Terrarium: SRTM, GMTED, ETOPO1);
//  – klimat: reanaliza ERA5 przez Open-Meteo (średnie dobowe temperatury i sumy opadu 2015–2020, pamięć podręczna)
//    → normy miesięczne, klasa Köppena i parametry klimatu modelu (kontynentalizm, wilgotność);
//  – pokrycie terenu: ESA WorldCover 2021 (10 m, GeoTIFF/COG 3° × 3°) z Microsoft Planetary Computer.
import { fromUrl } from 'geotiff';

const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const tiles = new Map();

// kafelek 256 × 256 wysokości [m] (ujemne – dno morza)
export function tile(z, x, y) {
  const n = 2 ** z;
  x = ((x % n) + n) % n;
  if (y < 0 || y >= n) return Promise.resolve(null);
  const key = `${z}/${x}/${y}`;
  if (!tiles.has(key)) {
    tiles.set(key, new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';                       // inaczej canvas nie odda pikseli (getImageData)
      // zawieszone połączenie nie blokuje wczytywania: po 20 s kafelek jak nieudany
      const stop = setTimeout(() => { img.onload = null; img.onerror = null; img.src = ''; tiles.delete(key); resolve(null); }, 20000);
      img.onload = () => {
        clearTimeout(stop);
        const c = document.createElement('canvas');
        c.width = 256; c.height = 256;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, 256, 256).data;
        const h = new Float32Array(256 * 256);
        for (let p = 0; p < h.length; p++) h[p] = d[4 * p] * 256 + d[4 * p + 1] + d[4 * p + 2] / 256 - 32768;
        resolve(h);
      };
      img.onerror = () => { clearTimeout(stop); tiles.delete(key); resolve(null); };   // bez zapamiętania błędu – ponowna próba później
      img.src = `${DEM_URL}/${key}.png`;
    }));
  }
  return tiles.get(key);
}

// Web Mercator: współrzędne kafelków (ułamkowe) dla szerokości i długości
export function lonLatToTile(lat, lon, z) {
  const n = 2 ** z, la = Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180;
  return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n];
}
export function tileToLonLat(tx, ty, z) {
  const n = 2 ** z;
  const lon = tx / n * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / n))) * 180 / Math.PI;
  return [lat, lon];
}

// próbnik wysokości z wczytanych kafelków (dwuliniowo); points: [[lat, lon], …]
async function sampler(points, z) {
  const need = new Set();
  for (const [lat, lon] of points) {
    const [tx, ty] = lonLatToTile(lat, lon, z);
    const px = tx * 256 - 0.5, py = ty * 256 - 0.5;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      need.add(`${Math.floor((Math.floor(px) + dx) / 256)},${Math.floor((Math.floor(py) + dy) / 256)}`);
    }
  }
  const got = new Map();
  await Promise.all([...need].map(async (k) => { const [x, y] = k.split(',').map(Number); got.set(k, await tile(z, x, y)); }));
  // bez żadnego kafelka (brak internetu, serwer nie odpowiada) – błąd zamiast cichego „morza” o wysokości 0 na całej mapie
  if (![...got.values()].some((t) => t)) throw new Error('could not download terrain tiles (no internet?)');
  const n = 2 ** z;
  const pix = (X, Y) => {
    const tx = Math.floor(X / 256), ty = Math.floor(Y / 256);
    const t = got.get(`${tx},${ty}`);
    if (!t) return 0;
    const lx = X - tx * 256, ly = Y - ty * 256;
    return t[ly * 256 + lx];
  };
  return ([lat, lon]) => {
    const [tx, ty] = lonLatToTile(lat, lon, z);
    const px = tx * 256 - 0.5, py = Math.min(n * 256 - 1.001, Math.max(0, ty * 256 - 0.5));
    const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
    const a = pix(x0, y0) * (1 - fx) + pix(x0 + 1, y0) * fx;
    const b = pix(x0, y0 + 1) * (1 - fx) + pix(x0 + 1, y0 + 1) * fx;
    return a * (1 - fy) + b * fy;
  };
}

// Teren dla domeny: siatka nx × ny o oczku dx [m] wokół (lat0, lon0) w płaszczyźnie stycznej.
// Każda komórka to średnia z 3 × 3 próbek (wygładzenie do skali oczka). Zwraca wysokości [m]
// (ujemne – morze).
export async function fetchTerrain(lat0, lon0, nx, ny, dx, onProgress) {
  const mPerPx0 = 156543 * Math.cos(lat0 * Math.PI / 180);
  let z = Math.ceil(Math.log2(mPerPx0 / (dx / 2)));
  z = Math.max(2, Math.min(12, z));
  // ograniczenie liczby kafelków (~100)
  const span = Math.max(nx, ny) * dx;
  while (z > 2 && (span / (mPerPx0 / 2 ** z * 256)) ** 2 > 100) z--;
  const pts = [];
  const sub = [-1 / 3, 0, 1 / 3];
  const ll = (x, y) => [lat0 + y / 111320, lon0 + x / (111320 * Math.cos(lat0 * Math.PI / 180))];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      for (const sy of sub) for (const sx of sub) {
        pts.push(ll((i + 0.5 + sx - nx / 2) * dx, (j + 0.5 + sy - ny / 2) * dx));
      }
    }
  }
  if (onProgress) onProgress(`downloading terrain (tiles z = ${z})…`);
  const f = await sampler(pts, z);
  const h = new Float32Array(nx * ny);
  for (let c = 0; c < nx * ny; c++) {
    let s = 0, sea = 0;
    for (let q = 0; q < 9; q++) { const v = f(pts[9 * c + q]); s += v; if (v <= 0) sea++; }
    h[c] = sea >= 5 ? Math.min(-1, s / 9) : Math.max(1, s / 9);
  }
  return { h, z };
}

// Gęstszy teren tylko do obrazu (mapa: cieniowanie stoków, poziomice, kolory wysokości): F × F punktów na oczko widocznej
// domeny (nx × ny), każdy ze średniej 2 × 2 próbek; kafelki o pikselu ~⅔ punktu. Model liczy na siatce (średnia z oczka –
// przy 5 km Tatry to jeden grzbiet ~1900 m), obraz pokazuje grzbiety i doliny.
export async function fetchTerrainHi(lat0, lon0, nx, ny, dx, F, onProgress) {
  const mPerPx0 = 156543 * Math.cos(lat0 * Math.PI / 180);
  let z = Math.max(2, Math.min(12, Math.ceil(Math.log2(mPerPx0 / (dx / F / 1.5)))));
  const span = Math.max(nx, ny) * dx;
  while (z > 2 && (span / (mPerPx0 / 2 ** z * 256)) ** 2 > 150) z--;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180);
  const ll = (x, y) => [lat0 + y / 111320, lon0 + x / kx];
  // punkty co ~pół kafelka – sampler pobiera wszystkie kafelki obszaru
  const step = mPerPx0 / 2 ** z * 128, cov = [];
  for (let y = -ny * dx / 2 - step; y <= ny * dx / 2 + step; y += step) {
    for (let x = -nx * dx / 2 - step; x <= nx * dx / 2 + step; x += step) cov.push(ll(x, y));
  }
  if (onProgress) onProgress(`downloading detailed terrain for the image (tiles z = ${z})…`);
  const f = await sampler(cov, z);
  const W = nx * F, H = ny * F, h = new Float32Array(W * H);
  let hmax = 0;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      let s = 0;
      for (const sy of [-0.25, 0.25]) for (const sx of [-0.25, 0.25]) s += f(ll(((i + 0.5 + sx) / F - nx / 2) * dx, ((j + 0.5 + sy) / F - ny / 2) * dx));
      const v = Math.max(0, s / 4);
      h[j * W + i] = v; hmax = Math.max(hmax, v);
    }
  }
  return { h, w: W, hh: H, hmax, z };
}

// Wierzchołek w pobliżu (lat, lon): najwyższy punkt kafelków z = 12 (~25–40 m) w promieniu r [m] – prawdziwa wysokość
// szczytu (teren do obrazu uśrednia ~0.6 km i zaniża wierzchołki o 100–250 m)
export async function peakFine(lat, lon, r) {
  const z = 12, kx = 111320 * Math.cos(lat * Math.PI / 180);
  const step = 156543 * Math.cos(lat * Math.PI / 180) / 2 ** z, pts = [];
  for (let y = -r; y <= r; y += step) for (let x = -r; x <= r; x += step) if (x * x + y * y <= r * r) pts.push([lat + y / 111320, lon + x / kx]);
  const f = await sampler(pts, z);
  let best = { lat, lon, h: -1e9 };
  for (const p of pts) { const h = f(p); if (h > best.h) best = { lat: p[0], lon: p[1], h }; }
  return best;
}

// mapa świata (z = 2: 1024 × 1024 px Mercatora) – wysokości do rysowania i maski lądu/morza
let world = null;
export async function worldDem() {
  if (world) return world;
  const z = 2, n = 4, W = 256 * n;
  const h = new Float32Array(W * W);
  let ok = 0;
  await Promise.all(Array.from({ length: n * n }, async (_, k) => {
    const tx = k % n, ty = Math.floor(k / n);
    const t = await tile(z, tx, ty);
    if (!t) return;
    ok++;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) h[(ty * 256 + y) * W + tx * 256 + x] = t[y * 256 + x];
  }));
  // bez kafelków cały świat byłby oceanem (wysokość 0) – model synoptyczny bierze wtedy idealizowany rozkład lądu
  if (ok < n * n) throw new Error('could not download the world map (no internet?)');
  world = { z, W, h };
  return world;
}
// wysokość z mapy świata (do maski oceanu modelu synoptycznego). Kafelki nie odróżniają depresji od morza, a mapy pokrycia na całe
// koło szerokości nie ma – duże depresje na lądzie z ręki: [S, N, W, E, poziom wody]. Morze Kaspijskie ma w kafelkach płaskie −26…−28 m
// i dno głębiej, nizina nadkaspijska −1…−25 m; Qattara i Eyre bez wody. Mniejsze (Żuławy, Holandia) nie mają znaczenia przy oczku 75 km.
const DEPRESSIONS = [[36, 50, 44, 57, -26], [28, 30.5, 25.5, 29.5, -1e9], [-29.5, -27.5, 136.5, 138.5, -1e9]];
export function worldElev(w, lat, lon) {
  const [tx, ty] = lonLatToTile(lat, lon, w.z);
  const X = ((Math.floor(tx * 256) % w.W) + w.W) % w.W, Y = Math.min(w.W - 1, Math.max(0, Math.floor(ty * 256)));
  const h = w.h[Y * w.W + X];
  if (h > 0) return h;
  const lo = ((lon + 540) % 360) - 180;                    // kanał modelu synoptycznego wychodzi poza ±180°
  return DEPRESSIONS.some(([s, n, a, b, lv]) => lat >= s && lat <= n && lo >= a && lo <= b && h > lv) ? 1 : h;
}

// mapa regionu (kafelki z, okno 3 × 3 wokół punktu) do dokładnego wyboru miejsca
export async function regionDem(lat, lon, z) {
  const [tx, ty] = lonLatToTile(lat, lon, z);
  const x0 = Math.floor(tx) - 1, y0 = Math.floor(ty) - 1, W = 768;
  const h = new Float32Array(W * W);
  await Promise.all(Array.from({ length: 9 }, async (_, k) => {
    const dx = k % 3, dy = Math.floor(k / 3);
    const t = await tile(z, x0 + dx, y0 + dy);
    if (!t) return;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) h[(dy * 256 + y) * W + dx * 256 + x] = t[y * 256 + x];
  }));
  return { z, x0, y0, W, h };
}

// kolor mapy: morze (głębokość) i ląd (hipsometria) z cieniowaniem
export function demColor(h, shade) {
  if (h <= 0) {
    const d = Math.min(1, -h / 5000);
    return [40 + 40 * (1 - d), 90 + 70 * (1 - d), 150 + 70 * (1 - d)];
  }
  const stops = [[0, [80, 140, 80]], [300, [140, 170, 90]], [800, [200, 190, 120]], [1800, [170, 130, 90]], [3000, [200, 190, 180]], [5000, [255, 255, 255]]];
  let c = stops[stops.length - 1][1];
  for (let s = 1; s < stops.length; s++) {
    if (h < stops[s][0]) {
      const a = (h - stops[s - 1][0]) / (stops[s][0] - stops[s - 1][0]);
      c = stops[s - 1][1].map((v, q) => v + a * (stops[s][1][q] - v));
      break;
    }
  }
  return c.map((v) => Math.min(255, v * shade));
}

// ---------------- klimat z danych (ERA5 przez Open-Meteo) ----------------
const KOPPEN_NAMES = {
  Af: 'tropical rainforest', Am: 'tropical monsoon', Aw: 'savanna (dry winter)', As: 'savanna (dry summer)',
  BWh: 'hot desert', BWk: 'cold desert', BSh: 'hot steppe', BSk: 'cold steppe',
  Csa: 'Mediterranean, hot summer', Csb: 'Mediterranean, warm summer', Csc: 'cool Mediterranean',
  Cwa: 'monsoon subtropical', Cwb: 'subtropical highland', Cwc: 'cool highland',
  Cfa: 'humid subtropical', Cfb: 'temperate oceanic', Cfc: 'subpolar oceanic',
  Dsa: 'continental, dry hot summer', Dsb: 'continental, dry warm summer', Dsc: 'subarctic, dry summer', Dsd: 'extreme subarctic',
  Dwa: 'monsoon continental, hot summer', Dwb: 'monsoon continental, warm summer', Dwc: 'monsoon subarctic', Dwd: 'extreme subarctic (dry winters)',
  Dfa: 'humid continental, hot summer', Dfb: 'humid continental, warm summer', Dfc: 'subarctic', Dfd: 'extreme subarctic',
  ET: 'tundra', EF: 'ice cap',
};

export function koppen(T, P, lat) {
  const tAnn = T.reduce((a, b) => a + b, 0) / 12, Pa = P.reduce((a, b) => a + b, 0);
  const tMin = Math.min(...T), tMax = Math.max(...T);
  const nh = lat >= 0;
  const sumIdx = nh ? [3, 4, 5, 6, 7, 8] : [9, 10, 11, 0, 1, 2];   // półrocze letnie (kwiecień–wrzesień na N)
  const winIdx = nh ? [9, 10, 11, 0, 1, 2] : [3, 4, 5, 6, 7, 8];
  const Ps = sumIdx.reduce((a, m) => a + P[m], 0);
  const pth = 20 * tAnn + (Ps >= 0.7 * Pa ? 280 : Ps >= 0.3 * Pa ? 140 : 0);
  let code;
  if (tMax < 10) code = tMax > 0 ? 'ET' : 'EF';
  else if (Pa < pth) code = (Pa < pth / 2 ? 'BW' : 'BS') + (tAnn >= 18 ? 'h' : 'k');
  else if (tMin >= 18) {
    const pMin = Math.min(...P);
    code = pMin >= 60 ? 'Af' : pMin >= 100 - Pa / 25 ? 'Am' : 'Aw';
  } else {
    const g = tMin > -3 ? 'C' : 'D';
    const sDry = Math.min(...sumIdx.map((m) => P[m])), sWet = Math.max(...sumIdx.map((m) => P[m]));
    const wDry = Math.min(...winIdx.map((m) => P[m])), wWet = Math.max(...winIdx.map((m) => P[m]));
    const s2 = sDry < 40 && sDry < wWet / 3 ? 's' : wDry < sWet / 10 ? 'w' : 'f';
    const warm = T.filter((t) => t >= 10).length;
    const s3 = tMax >= 22 ? 'a' : warm >= 4 ? 'b' : g === 'D' && tMin < -38 ? 'd' : 'c';
    code = g + s2 + s3;
  }
  return { code, name: KOPPEN_NAMES[code] || '' };
}

// Dane z Open-Meteo: tylko w tle, po starcie (main.js ccLoad) – długie zapytania liczą się jako wiele wywołań (limit na minutę i na dobę,
// błąd 429), a zawieszone połączenie to minuty czekania. Limit czasu na zapytanie, pamięć podręczna według oczka ERA5 (0.25°, także między sesjami).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FETCH_MS = 60000;
const cellKey = (lat, lon) => `${(Math.round(lat * 4) / 4).toFixed(2)},${(Math.round(lon * 4) / 4).toFixed(2)}`;
const stored = (name) => { try { const s = localStorage.getItem(name); return s ? JSON.parse(s) : null; } catch { return null; } };
export const cachedNormals = (lat, lon) => stored(`w3d-norm2-${cellKey(lat, lon)}`);
export const MONTH_DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Parametry klimatu modelu z norm miesięcznych: T[12] [°C], P[12] [mm/miesiąc], wysokość punktu [m]
export function climateOf(T, P, elev, lat) {
  const tAnn = T.reduce((a, b) => a + b, 0) / 12, Pa = P.reduce((a, b) => a + b, 0);
  const half = (Math.max(...T) - Math.min(...T)) / 2;
  const a = Math.abs(lat);
  const cont = Math.min(2.5, Math.max(0.5, half / (0.5 + 0.19 * a)));
  // wilgotność klimatu: opad / parowanie potencjalne (przybliżenie z temperatur miesięcznych),
  // suche lato (klimat śródziemnomorski) obniża
  const pet = 250 + 5.5 * T.reduce((s, t) => s + Math.max(t, 0), 0);
  const summer = lat >= 0 ? [5, 6, 7] : [11, 0, 1];
  let hum = Pa / pet;
  if (summer.reduce((s, m) => s + P[m], 0) < 0.12 * Pa && tAnn > 5) hum *= 0.7;
  hum = Math.min(1, Math.max(0.02, hum));
  // poprawka średniej rocznej względem przybliżenia z szerokości (sprowadzona do poziomu morza)
  const bias = tAnn + 0.006 * elev - (28 - 0.0072 * a * a);
  return { T, P, tAnn, Pa, elev, cont, hum, bias, koppen: koppen(T, P, lat) };
}
// klimat miejsca z pamięci przeglądarki: normy ERA5 1991–2020 albo starszy wpis (dane dobowe 2015–2020); null – brak
export function cachedClimate(lat, lon) {
  const n = cachedNormals(lat, lon);
  if (n && n.P) return climateOf(n.T, n.P.map((v, m) => v * MONTH_DAYS[m]), n.elev || 0, lat);
  const js = stored(`w3d-clim-${cellKey(lat, lon)}`);
  if (!js || !js.daily) return null;
  const T = new Array(12).fill(0), P = new Array(12).fill(0), nT = new Array(12).fill(0);
  const years = new Set();
  js.daily.time.forEach((d, k) => {
    const m = Number(d.slice(5, 7)) - 1;
    years.add(d.slice(0, 4));
    const t = js.daily.temperature_2m_mean[k], p = js.daily.precipitation_sum[k];
    if (t !== null) { T[m] += t; nT[m]++; }
    if (p !== null) P[m] += p;
  });
  for (let m = 0; m < 12; m++) { T[m] /= Math.max(1, nT[m]); P[m] /= Math.max(1, years.size); }
  return climateOf(T, P, js.elevation || 0, lat);
}
// Normy klimatyczne 1991–2020 z ERA5 (Open-Meteo archive-api, dobowe T 2 m, punkt rosy i opad → średnie miesięczne) – odniesienie
// korekty klimatu (main.js, cc*); krótsze okresy (2015–2020, 2022–2024) są o ~1–2 K za ciepłe względem normy. Pamięć wg oczka 0.25°.
export async function fetchNormals(lat, lon, onStatus) {
  const key = cellKey(lat, lon);
  const c0 = cachedNormals(lat, lon);
  if (c0) return c0;
  const [la, lo] = key.split(',');
  const url = 'https://archive-api.open-meteo.com/v1/archive?latitude=' + la + '&longitude=' + lo
    + '&start_date=1991-01-01&end_date=2020-12-31&daily=temperature_2m_mean,dew_point_2m_mean,precipitation_sum&timezone=GMT';
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) });
    if (r.ok) {
      const js = await r.json();
      const T = new Array(12).fill(0), Td = new Array(12).fill(0), n = new Array(12).fill(0), P = new Array(12).fill(0), nP = new Array(12).fill(0);
      js.daily.time.forEach((d, k) => {
        const t = js.daily.temperature_2m_mean[k], td = js.daily.dew_point_2m_mean[k], p = js.daily.precipitation_sum[k];
        const m = Number(d.slice(5, 7)) - 1;
        if (p !== null) { P[m] += p; nP[m]++; }
        if (t === null || td === null) return;
        T[m] += t; Td[m] += td; n[m]++;
      });
      if (n.some((x) => x === 0)) throw new Error('incomplete ERA5 normals');
      // opad: średnia dobowa w miesiącu [mm/d]
      const out = { elev: js.elevation || 0, T: T.map((v, m) => +(v / n[m]).toFixed(2)), Td: Td.map((v, m) => +(v / n[m]).toFixed(2)),
        P: nP.every((x) => x > 0) ? P.map((v, m) => +(v / nP[m]).toFixed(3)) : null };
      try { localStorage.setItem('w3d-norm2-' + key, JSON.stringify(out)); } catch { /* pełna pamięć – bez zapisu */ }
      return out;
    }
    // limit minutowy (ciężkie zapytania: wiele lat) – po minucie znów można
    if (r.status !== 429 || attempt >= 2) throw new Error(r.status === 429 ? 'Open-Meteo request limit' : `Open-Meteo: ${r.status}`);
    if (onStatus) onStatus('Open-Meteo request limit – retrying in 60 s…');
    await sleep(60000);
  }
}
// ---------------- Pokrycie terenu: ESA WorldCover 2021 ----------------
// Klasy WorldCover: 10 drzewa, 20 krzewy, 30 trawy, 40 uprawy, 50 zabudowa, 60 goły grunt, 70 śnieg i lód, 80 woda,
// 90 mokradła, 95 namorzyny, 100 mchy i porosty (0 – brak danych). Pliki 3° × 3° nazwane od lewego dolnego rogu
// (N48E018 = 48–51°N, 18–21°E); każdy ma poziomy przeglądowe (COG) – czytamy ten, którego piksel ≈ 1/5 oczka.
// Źródło: Planetary Computer – te same pliki co w kubełku ESA na S3, ale tamten serwer nie pozwala na odczyt z przeglądarki (CORS).
const LC_URL = 'https://ai4edataeuwest.blob.core.windows.net/esa-worldcover/v200/2021/map';
const LC_TOKEN = 'https://planetarycomputer.microsoft.com/api/sas/v1/token/ai4edataeuwest/esa-worldcover';
const lcFiles = new Map();
// Token SAS: bez konta, każda przeglądarka pobiera własny (warunki zabraniają przekazywania tokenów – nie wpisywać go do kodu ani nie pośredniczyć).
// Serwer przez wiele godzin podaje ten sam, więc bywa bliski wygaśnięcia; otwarte pliki mają go w adresie.
let lcTok = null;
async function lcToken() {
  if (!lcTok || Date.parse(lcTok['msft:expiry']) - Date.now() < 300000) {
    const r = await fetch(LC_TOKEN, { signal: AbortSignal.timeout(FETCH_MS) });
    if (!r.ok) throw new Error(`land-cover token: HTTP ${r.status}`);
    lcTok = await r.json();
    lcFiles.clear();
  }
  return lcTok.token;
}
function lcName(la, lo) {
  const ns = la >= 0 ? 'N' : 'S', ew = lo >= 0 ? 'E' : 'W';
  return `${ns}${String(Math.abs(la)).padStart(2, '0')}${ew}${String(Math.abs(lo)).padStart(3, '0')}`;
}
function lcTiff(name, tok) {
  if (!lcFiles.has(name)) {
    const p = fromUrl(`${LC_URL}/ESA_WorldCover_10m_2021_v200_${name}_Map.tif?${tok}`, { allowFullFile: false })
      .catch(() => null);                                  // brak pliku (otwarty ocean) albo brak sieci
    lcFiles.set(name, p);
    p.then((t) => { if (!t) lcFiles.delete(name); });
  }
  return lcFiles.get(name);
}

// Udziały pokrycia w oczkach siatki nx × ny (oczko dx [m], środek lat0, lon0 – jak fetchTerrain):
// { tree, built, water, wet, valid } – Float32Array (0…1); valid = udział próbek z danymi.
export async function fetchLandCover(lat0, lon0, nx, ny, dx, onProgress) {
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180);
  const ll = (x, y) => [lat0 + y / 111320, lon0 + x / kx];
  const [laS] = ll(0, -ny * dx / 2), [laN] = ll(0, ny * dx / 2);
  const loW = ll(-nx * dx / 2, 0)[1], loE = ll(nx * dx / 2, 0)[1];
  const tiles = [];
  for (let la = Math.floor(laS / 3) * 3; la < laN; la += 3) {
    for (let lo = Math.floor(loW / 3) * 3; lo < loE; lo += 3) tiles.push([la, lo]);
  }
  if (tiles.length > 40) throw new Error(`domain too large for the land-cover map (${tiles.length} files 3° × 3°)`);
  if (onProgress) onProgress(`downloading land cover (ESA WorldCover, ${tiles.length} files)…`);
  const needW = 3 * 111320 * 5 / dx;                       // szerokość poziomu, przy której piksel ≈ dx/5
  const tok = await lcToken();
  const got = [];
  let nOk = 0;
  await Promise.all(tiles.map(async ([la, lo]) => {
    const tiff = await lcTiff(lcName(la, lo), tok);
    if (!tiff) return;
    try {
      const n = await tiff.getImageCount();
      let img = await tiff.getImage(0);
      for (let i = n - 1; i >= 0; i--) {                   // najgrubszy poziom, który wystarcza
        const im = await tiff.getImage(i);
        if (im.getWidth() >= needW) { img = im; break; }
      }
      const W = img.getWidth(), H = img.getHeight();
      // okno pikseli: część domeny wewnątrz pliku
      const x0 = Math.max(0, Math.floor((loW - lo) / 3 * W)), x1 = Math.min(W, Math.ceil((loE - lo) / 3 * W));
      const y0 = Math.max(0, Math.floor((la + 3 - laN) / 3 * H)), y1 = Math.min(H, Math.ceil((la + 3 - laS) / 3 * H));
      if (x1 <= x0 || y1 <= y0) return;
      const r = await img.readRasters({ window: [x0, y0, x1, y1], samples: [0], interleave: true });
      got.push({ la, lo, W, H, x0, y0, w: x1 - x0, h: y1 - y0, d: r });
      if (typeof window !== 'undefined' && window.__lcDebug) { const hs = {}; for (const v of r) hs[v] = (hs[v] || 0) + 1; window.__lcDebug.push({ name: lcName(la, lo), W, n, hs }); }
      nOk++;
    } catch (e) { /* uszkodzony / nieosiągalny plik – oczka bez danych */ }
  }));
  if (!nOk) throw new Error('could not download the land-cover map (no internet, or open ocean only)');
  const cls = (la, lo) => {
    for (const t of got) {
      if (la < t.la || la >= t.la + 3 || lo < t.lo || lo >= t.lo + 3) continue;
      const X = Math.floor((lo - t.lo) / 3 * t.W) - t.x0, Y = Math.floor((t.la + 3 - la) / 3 * t.H) - t.y0;
      if (X < 0 || Y < 0 || X >= t.w || Y >= t.h) return 0;
      return t.d[Y * t.w + X];
    }
    return 0;
  };
  const N = nx * ny, out = { tree: new Float32Array(N), built: new Float32Array(N), water: new Float32Array(N),
    wet: new Float32Array(N), valid: new Float32Array(N) };
  const sub = [-0.4, -0.2, 0, 0.2, 0.4];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let t = 0, b = 0, w = 0, m = 0, v = 0;
      for (const sy of sub) for (const sx of sub) {
        const [la, lo] = ll((i + 0.5 + sx - nx / 2) * dx, (j + 0.5 + sy - ny / 2) * dx);
        const k = cls(la, lo);
        if (!k) continue;
        v++;
        if (k === 10 || k === 95) t++; else if (k === 50) b++; else if (k === 80) w++; else if (k === 90) m++;
      }
      const c = j * nx + i, q = Math.max(v, 1);
      out.tree[c] = t / q; out.built[c] = b / q; out.water[c] = w / q; out.wet[c] = m / q; out.valid[c] = v / 25;
    }
  }
  return out;
}

// Miejscowości (> 1000 mieszkańców, GeoNames cities1000, CC BY 4.0) w prostokącie widocznej domeny (lx × ly km wokół lat0, lon0 –
// ten sam rzut co teren). Dane w projekcie (public/cities, kafle 5° × 5°) – działa bez sieci; publiczne serwery Overpass (OSM)
// były zawodne (502/504). Klasa 2 duże / 1 średnie / 0 małe z liczby mieszkańców względem wielkości mapy (Tatry: Nowy Targ,
// Poprad, Zakopane duże; Polska: miasta > ~200 tys.) – liczona na mapie dla widocznego fragmentu (stations.js).
// Zwraca [{ name, xkm, ykm, pop }] od największych (położenie od lewego dolnego rogu widocznej mapy).
const cityTiles = new Map();
async function cityTile(la, lo) {
  const k = `${la}_${lo}`;
  if (!cityTiles.has(k)) {
    cityTiles.set(k, fetch(`cities/${k}.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []));
  }
  return cityTiles.get(k);
}
export async function fetchCities(lat0, lon0, lx, ly) {
  const L = Math.max(lx, ly);
  const kx = 111.32 * Math.cos(lat0 * Math.PI / 180);
  const s = lat0 - ly / 2 / 111.32, n = lat0 + ly / 2 / 111.32, w = lon0 - lx / 2 / kx, e = lon0 + lx / 2 / kx;
  const jobs = [];
  for (let la = Math.floor(s / 5) * 5; la < n; la += 5) {
    for (let lo = Math.floor(w / 5) * 5; lo < e; lo += 5) {
      const lw = ((lo + 180) % 360 + 360) % 360 - 180;          // przez południk 180°
      jobs.push(cityTile(la, lw));
    }
  }
  const raw = (await Promise.all(jobs)).flat();
  // wszystkie miejscowości potrzebne do największego przybliżenia (×16); klasy i wybór rysowanych liczy mapa (stations.js)
  const pMin = 25000 * (L / 1600) ** 0.9 / 40;
  const out = raw.map(([name, la, lo, pop]) => {
    let d = lo - lon0; d -= 360 * Math.round(d / 360);
    return { name, pop, xkm: d * kx + lx / 2, ykm: (la - lat0) * 111.32 + ly / 2 };
  }).filter((c) => c.xkm >= 0 && c.xkm <= lx && c.ykm >= 0 && c.ykm <= ly && c.pop >= pMin)
    .sort((a, b) => b.pop - a.pop).slice(0, 20000);
  return out;
}
