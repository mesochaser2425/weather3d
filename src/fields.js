import { wxLegendCss, wxOf, WX_INDEX } from './wxscales.js';
import { VEG_COLORS } from './climate.js';
// Pola do wyświetlenia, ich jednostki, skale kolorów i sposób dobierania zakresu.
// Numeracja zgodna z shaderami: 0–13 pola 3D, od 20 mapy przy gruncie (80–90 – analizy okresów).
//   cmap: numer skali kolorów – legenda w legendCss niżej, mapa w render.wgsl (cmapOf – osobna tabela pole → skala,
//         przy zmianie skali poprawiać oba miejsca); od WX_CMAP0 skale WX Charts z wxscales.js
//   range: 'static' (stała skala z wysokości mapy, wierzchu przekroju i oczka siatki – staticRange), 'zero' (od zera do maksimum
//         danych – tylko dni upalne i noce tropikalne), 'fixed', 'terrain'. Skale nie zależą od bieżących danych (użytkownik: wszystkie
//         skale statyczne – wcześniej zakres θ, θe, q, w, u, v, θ', p' szedł za min–max pola i przeskakiwał z każdą kopią pól)

export const FIELDS = {
  0: { name: 'T – air temperature', unit: '°C', cmap: 22, range: 'fixed', fixed: [-50, 50], iso: true },
  1: { name: 'θ – potential temperature', unit: 'K', cmap: 0, range: 'static', iso: true },
  2: { name: 'θe – equivalent potential temperature', unit: 'K', cmap: 0, range: 'static', iso: true },
  3: { name: 'RH – relative humidity', unit: '%', cmap: 2, range: 'fixed', fixed: [0, 100] },
  4: { name: 'q_v – water vapour', unit: 'g/kg', cmap: 3, range: 'static' },
  5: { name: 'q_c – cloud water', unit: 'g/kg', cmap: 4, range: 'fixed', fixed: [0, 2] },
  6: { name: 'q_r – precipitation (rain / snow)', unit: 'g/kg', cmap: 5, range: 'fixed', fixed: [0, 4] },
  13: { name: 'q_i – cloud ice', unit: 'g/kg', cmap: 4, range: 'fixed', fixed: [0, 0.5] },
  7: { name: 'w – vertical velocity', unit: 'm/s', cmap: 1, range: 'static' },
  8: { name: 'u – wind W→E', unit: 'm/s', cmap: 1, range: 'static' },
  9: { name: 'v – wind S→N', unit: 'm/s', cmap: 1, range: 'static' },
  10: { name: "θ' – potential temperature perturbation", unit: 'K', cmap: 1, range: 'static' },
  11: { name: "p' – pressure perturbation", unit: 'Pa', cmap: 1, range: 'static' },
  12: { name: 'Wind speed', unit: 'm/s', cmap: 23, range: 'fixed', fixed: [0, 40] },
  20: { name: 'T 2 m – air temperature near the ground', unit: '°C', cmap: 22, range: 'fixed', fixed: [-50, 50], iso: true },
  21: { name: 'Td 2 m – dew point', unit: '°C', cmap: 22, range: 'fixed', fixed: [-50, 50], iso: true },
  22: { name: 'Precipitation rate', unit: 'mm/h', cmap: 25, range: 'fixed', fixed: [0, 100] },
  23: { name: 'Total precipitation', unit: 'mm', cmap: 24, range: 'fixed', fixed: [0, 2000] },
  24: { name: 'Ground surface temperature', unit: '°C', cmap: 22, range: 'fixed', fixed: [-50, 50], iso: true },
  25: { name: 'Sensible heat flux H', unit: 'W/m²', cmap: 1, range: 'fixed', fixed: [-500, 500] },
  26: { name: 'Latent heat flux LE', unit: 'W/m²', cmap: 1, range: 'fixed', fixed: [-500, 500] },
  27: { name: 'Solar radiation at the ground', unit: 'W/m²', cmap: 8, range: 'fixed', fixed: [0, 1000] },
  28: { name: 'Plant-available soil water (root zone; 0 – wilting point, 100 – field capacity)', short: 'Plant-available soil water', unit: '%', cmap: 2, range: 'fixed', fixed: [0, 100] },
  62: { name: 'Soil moisture 0–10 cm (volumetric)', unit: '%', cmap: 2, range: 'fixed', fixed: [0, 45] },
  63: { name: 'Soil moisture 10–40 cm (volumetric)', unit: '%', cmap: 2, range: 'fixed', fixed: [0, 45] },
  64: { name: 'Soil moisture 40–100 cm (volumetric)', unit: '%', cmap: 2, range: 'fixed', fixed: [0, 45] },
  29: { name: 'Satellite view (visible)', unit: 'g/m²', cmap: 9, range: 'fixed', fixed: [0, 1] },
  30: { name: 'Terrain height', unit: 'm', cmap: 10, range: 'terrain' },
  79: { name: 'Surface type', unit: '', cmap: 31, range: 'fixed', fixed: [0, 11] },
  31: { name: 'Satellite IR (brightness temperature)', unit: '°C', cmap: 29, range: 'fixed', fixed: [-90, 50] },
  32: { name: 'Snow depth', unit: 'cm', cmap: 26, range: 'fixed', fixed: [0, 100] },
  33: { name: 'Vegetation greenness (phenology)', unit: '', cmap: 2, range: 'fixed', fixed: [0, 1] },
  37: { name: 'Cloud cover by level', unit: 'g/m²', cmap: 9, range: 'fixed', fixed: [0, 1] },
  58: { name: 'Total cloud cover (fraction of the sky)', short: 'Total cloud cover', unit: '%', cmap: 2, range: 'fixed', fixed: [0, 100] },
  38: { name: 'Radar reflectivity (low beams, up to 2 km)', unit: 'dBZ', cmap: 15, range: 'fixed', fixed: [-2.5, 67.5] },
  39: { name: 'Satellite WV – water vapour 6.2 µm', unit: '°C', cmap: 16, range: 'fixed', fixed: [-75, -10] },
  40: { name: 'Visibility (fog, haze)', unit: 'km', cmap: 17, range: 'fixed', fixed: [0, 10] },
  41: { name: 'Phenomena: fog, hoar frost, rime, glaze, summits in cloud', short: 'Phenomena (fog, frost, glaze…)', unit: '', cmap: 18, range: 'fixed', fixed: [0, 5] },
  42: { name: 'Thunderstorms: column-max radar + lightning', unit: 'dBZ', cmap: 15, range: 'fixed', fixed: [-2.5, 67.5] },
  43: { name: 'Hail (max. diameter)', unit: 'cm', cmap: 19, range: 'fixed', fixed: [0, 8] },
  44: { name: 'CAPE (parcel from the lowest layer)', unit: 'J/kg', cmap: 27, range: 'fixed', fixed: [0, 3000] },
  57: { name: 'MUCAPE (most unstable parcel from the lowest 3 km – also night storms)', short: 'MUCAPE (most unstable parcel)', unit: 'J/kg', cmap: 27, range: 'fixed', fixed: [0, 3000] },
  65: { name: 'Lift forcing – air lifted over ~3 h (fronts, jet stream, convergence lines)', short: 'Lift forcing (fronts, jet, convergence)', unit: 'm', cmap: 1, range: 'fixed', fixed: [-600, 600] },
  // diagnostyka źródła opadu (użytkownik: plamy i pasma słabego opadu przy dużym CAPE): opad schematu konwekcji przy gruncie (PRCG), opad z siatki (PR − PRCG)
  // i droga schematu, która dała opad (PRK: 1 głęboka – także domknięcie CAPE, 2 podniesiona / zimowa, 3 płytka; szary – tylko rozłożenie z sąsiada)
  69: { name: 'Diagnostic: precipitation from the convection scheme', short: 'Precip. – convection scheme', unit: 'mm/h', cmap: 25, range: 'fixed', fixed: [0, 100] },
  70: { name: 'Diagnostic: precipitation resolved on the grid', short: 'Precip. – grid (resolved)', unit: 'mm/h', cmap: 25, range: 'fixed', fixed: [0, 100] },
  71: { name: 'Diagnostic: scheme path giving rain (1 deep, 2 elevated / winter, 3 shallow; grey – spread from a neighbour)', short: 'Scheme rain path', unit: '', cmap: 32, range: 'fixed', fixed: [0, 3] },
  66: { name: 'Storm organisation: 1 single / multicell, 2 lines (QLCS, bow echo), 3 supercells', short: 'Storm organisation', unit: '', cmap: 8, range: 'fixed', fixed: [0, 3] },
  67: { name: 'Cold pools (storm outflows) – WAPE', unit: 'J/kg', cmap: 7, range: 'fixed', fixed: [0, 60] },
  68: { name: 'Fronts: sharp cold (navy), gentle cold (light blue), warm (red), stationary (purple)', short: 'Fronts', unit: '', cmap: 30, range: 'fixed', fixed: [-1, 2] },
  45: { name: 'Runoff and rivers – discharge', unit: 'm³/s', cmap: 20, range: 'fixed', fixed: [0.5, 1000] },
  46: { name: 'T max (since midnight)', unit: '°C', cmap: 22, range: 'fixed', fixed: [-50, 50], iso: true },
  47: { name: 'T min (since midnight)', unit: '°C', cmap: 22, range: 'fixed', fixed: [-50, 50], iso: true },
  48: { name: 'Sunshine duration (since midnight)', unit: 'h', cmap: 8, range: 'fixed', fixed: [0, 16] },
  49: { name: 'Wind gusts (10 m)', unit: 'm/s', cmap: 23, range: 'fixed', fixed: [0, 40] },
  50: { name: 'Wind 10 m above ground (with arrows)', unit: 'm/s', cmap: 23, range: 'fixed', fixed: [0, 30] },
  55: { name: 'Storm parameters: CAPE + SRH 0–3 km + shear 0–6 km', unit: 'J/kg', cmap: 27, range: 'fixed', fixed: [0, 3000] },
  51: { name: 'Wind shear 0–6 km (with arrows)', unit: 'm/s', cmap: 23, range: 'fixed', fixed: [0, 40] },
  52: { name: 'Wind shear 0–1 km', unit: 'm/s', cmap: 23, range: 'fixed', fixed: [0, 25] },
  53: { name: 'SRH 0–3 km (storm-relative helicity)', unit: 'm²/s²', cmap: 21, range: 'fixed', fixed: [-200, 600] },
  54: { name: 'SRH 0–1 km', unit: 'm²/s²', cmap: 21, range: 'fixed', fixed: [-200, 600] },
  56: { name: 'SCP – supercell composite', unit: '', cmap: 8, range: 'fixed', fixed: [0, 10] },
  34: { name: 'Mean sea level pressure', unit: 'hPa', cmap: 40, range: 'fixed', fixed: [900, 1050], iso: true, isoMin: 1 },
  // analizy klimatyczne (zakładka – poza listą warstw): wybrany okres – miesiąc, pora roku albo rok symulacji; w toku – do tej chwili
  80: { name: 'Period: mean temperature', unit: '°C', cmap: 22, range: 'fixed', fixed: [-50, 50], iso: true },
  81: { name: 'Period: T max (mean of daily maxima)', unit: '°C', cmap: 22, range: 'fixed', fixed: [-50, 50], iso: true },
  82: { name: 'Period: T min (mean of daily minima)', unit: '°C', cmap: 22, range: 'fixed', fixed: [-50, 50], iso: true },
  83: { name: 'Period: total precipitation', unit: 'mm', cmap: 24, range: 'fixed', fixed: [0, 2000] },
  84: { name: 'Period: rain', unit: 'mm', cmap: 24, range: 'fixed', fixed: [0, 2000] },
  85: { name: 'Period: snow (water equivalent)', unit: 'mm', cmap: 24, range: 'fixed', fixed: [0, 2000] },
  86: { name: 'Period: absolute T max', unit: '°C', cmap: 22, range: 'fixed', fixed: [-50, 50], iso: true },
  87: { name: 'Period: absolute T min', unit: '°C', cmap: 22, range: 'fixed', fixed: [-50, 50], iso: true },
  88: { name: 'Period: highest daily precipitation', unit: 'mm', cmap: 24, range: 'fixed', fixed: [0, 2000] },
  89: { name: 'Period: hot days (T max ≥ 30 °C)', unit: 'days', cmap: 0, range: 'zero', minHi: 10 },
  90: { name: 'Period: tropical nights (T min ≥ 20 °C)', unit: 'days', cmap: 0, range: 'zero', minHi: 10 },
};

export const FIELDS_3D = [0, 1, 2, 3, 4, 5, 13, 6, 12, 7, 8, 9, 10, 11];

// Znaczniki legendy: "ładne" wartości w zakresie [lo, hi]
export function legendTicks(lo, hi, n = 5) {
  const step = niceStep((hi - lo) / n);
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
// Lista warstw (zakładka Layers): grupy jak na Meteologix, dopasowane do pól modelu. items: numer pola albo { id, acc – okres sumy opadu,
// name }; p – poziom ciśnienia (mapa na wysokości tego poziomu w stanie bazowym), z – wysokość z suwaka nad mapą
export const LAYER_LEVELS = [[925, '~750 m'], [850, '~1,500 m'], [700, '~3,000 m'], [500, '~5,500 m'], [300, '~9,200 m']];
const LEVEL_FIELDS = [0, 2, 3, 4, 5, 13, 12, 7];
export const LAYER_GROUPS = [
  { name: 'Temperature & humidity', items: [20, 21, 46, 47, 24] },
  { name: 'Precipitation & snow', items: [22, 38, { id: 23, acc: 0, name: 'Total precipitation – since start' }, { id: 23, acc: 7, name: 'Total precipitation – last 7 days' },
    { id: 23, acc: 30, name: 'Total precipitation – last 30 days' }, { id: 23, acc: 60, name: 'Total precipitation – last 60 days' },
    { id: 23, acc: 90, name: 'Total precipitation – last 90 days' }, 32] },
  { name: 'Wind & pressure', items: [50, 49, 34] },
  { name: 'Clouds & satellite', items: [58, 37, 29, 31, 39] },
  { name: 'Thunderstorms & convection', items: [42, 43, 44, 57, 65, 67, 66] },
  { name: 'Diagnostics: precipitation source', items: [69, 70, 71] },
  { name: 'Wind shear & helicity', items: [51, 52, 53, 54, 56] },
  { name: 'Composite charts', items: [55, 68] },
  { name: 'Flight meteorology', items: [40, 41] },
  { name: 'Surface & soil', items: [79, 30, 25, 26, 27, 48, 28, 62, 63, 64, 33] },
  { name: 'Rivers & lakes', items: [45] },
  ...LAYER_LEVELS.map(([p, z]) => ({ name: `Pressure level – ${p} hPa / ${z}`, p, items: LEVEL_FIELDS })),
  { name: 'Any height (slider above the map)', z: true, items: FIELDS_3D },
];
export const FIELDS_MAP = [20, 21, 46, 47, 48, 50, 49, 34, 22, 38, 42, 43, 55, 44, 57, 65, 68, 66, 67, 69, 70, 71, 51, 52, 53, 54, 56, 23, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 45, 32, 40, 41, 24, 25, 26, 27, 28, 62, 63, 64, 33, 29, 58, 37, 31, 39, 30, 79];

// "Ładny" krok skali/izolinii: najmniejszy z 1, 2, 5 × 10^n nie mniejszy niż x
export function niceStep(x) {
  const e = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1e-9))));
  for (const m of [1, 2, 5, 10]) if (m * e >= x) return m * e;
  return 10 * e;
}

// Zakres kolorów z wartości min/max pola na danym przekroju
// (contrast – mnożnik z suwaka dla pól symetrycznych, nIso – docelowa liczba izolinii)
export function rangeFor(id, lo, hi, opt) {
  const f = FIELDS[id];
  if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
  switch (f.range) {
    // stała skala; izotermy co 5 °C na przekroju pionowym i co 1 °C na mapie / przekroju poziomym
    // mapa: zawsze ten sam układ (shader): co 1 °C kreskowana, co 2 °C cienka, co 5 °C gruba – wcześniej odstęp zależał
    // od rozpiętości temperatur na mapie i przy szybkich zmianach cała siatka linii przeskakywała 1 → 2 → 5 °C
    case 'fixed':
      return { lo: f.fixed[0], hi: f.fixed[1], iso: f.iso ? (opt.vertical ? 5 : 1) : 0 };
    case 'terrain': return { lo: 0, hi: Math.max(opt.hmax, 1), iso: 0 };
    case 'zero': {
      const m = niceStep(Math.max(hi, f.minHi) / 1.0001);
      return { lo: 0, hi: m, iso: 0 };
    }
    default: return staticRange(id, opt);
  }
}

// Standardowa atmosfera: θ [K] na wysokości z [m] – środek stałych skal θ i θe na danej wysokości
function thStd(z) {
  const t = z < 11000 ? 288.15 - 0.0065 * z : 216.65;
  const p = z < 11000 ? 1013.25 * Math.pow(t / 288.15, 5.2559) : 226.32 * Math.exp(-(z - 11000) / 6341.6);
  return t * Math.pow(1000 / p, 0.2857);
}
const r5 = (x) => 5 * Math.round(x / 5);
// zaokrąglenie w górę do 1, 1.5, 2, 3, 4, 5, 6, 8 × 10^n (gęściej niż niceStep – zakres bliżej wartości)
function niceUp(x) {
  const e = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1e-9))));
  for (const m of [1, 1.5, 2, 3, 4, 5, 6, 8, 10]) if (m * e >= x * 0.999) return m * e;
  return 10 * e;
}
// Stałe skale pól 3D: zależą tylko od wysokości mapy (opt.z [m]), wierzchu przekroju pionowego (opt.zt [m]), oczka siatki (opt.dx)
// i suwaka kontrastu (pola zaburzeń), nie od bieżących danych
function staticRange(id, opt) {
  const z = opt.vertical ? 0 : opt.z, top = opt.vertical ? opt.zt : opt.z;
  const sym = (m) => { const c = niceUp(m * opt.contrast); return { lo: -c, hi: c, iso: 0 }; };
  switch (id) {
    case 1: return { lo: r5(thStd(z) - 30), hi: r5(thStd(top) + 30), iso: opt.vertical ? 5 : 2 };
    case 2: return { lo: r5(thStd(z) - 25), hi: r5(thStd(top) + 20 + 40 * Math.exp(-z / 3000)), iso: opt.vertical ? 5 : 2 };
    case 4: return { lo: 0, hi: niceUp(20 * Math.exp(-z / 3000)), iso: 0 };   // ~20 g/kg przy gruncie, 12 na 1.5 km, 3 na 5.5 km
    case 7: return sym(opt.dx <= 1000 ? 10 : opt.dx <= 3000 ? 5 : opt.dx <= 10000 ? 2 : 1);
    case 8: case 9: return sym(opt.vertical ? 40 : 15 + 25 * Math.min(z / 9000, 1));
    case 10: return sym(10);
    case 11: return sym(100);
  }
  return { lo: 0, hi: 1, iso: 0 };
}

// ---------- legendy (te same skale co w render.wgsl) ----------
function turbo(x) {
  x = Math.min(1, Math.max(0, x));
  const v4 = [1, x, x * x, x * x * x], v2 = [x ** 4, x ** 5];
  const d = (a, b) => a.reduce((s, ai, i) => s + ai * b[i], 0);
  return [
    d(v4, [0.13572138, 4.61539260, -42.66032258, 132.13108234]) + d(v2, [-152.94239396, 59.28637943]),
    d(v4, [0.09140261, 2.19418839, 4.84296658, -14.18503333]) + d(v2, [4.27729857, 2.82956604]),
    d(v4, [0.10667330, 12.64194608, -60.58204836, 110.36276771]) + d(v2, [-89.90310912, 27.34824973]),
  ];
}
const RAMPS = {
  2: [[0.50, 0.36, 0.20], [0.85, 0.72, 0.45], [0.70, 0.85, 0.55], [0.30, 0.65, 0.45], [0.15, 0.35, 0.75]],
  3: [[0.97, 0.97, 0.92], [0.75, 0.90, 0.70], [0.35, 0.75, 0.60], [0.15, 0.50, 0.70], [0.10, 0.20, 0.55]],
  4: [[0.42, 0.60, 0.85], [0.62, 0.74, 0.90], [0.80, 0.86, 0.94], [0.92, 0.94, 0.97], [1, 1, 1]],
  5: [[0.97, 0.97, 0.97], [0.55, 0.85, 0.55], [0.15, 0.65, 0.25], [0.98, 0.85, 0.15], [0.90, 0.15, 0.10]],
  7: [[0.97, 0.97, 0.97], [0.65, 0.85, 0.95], [0.30, 0.55, 0.90], [0.35, 0.25, 0.75], [0.55, 0.10, 0.55]],
  8: [[0.05, 0.03, 0.10], [0.45, 0.08, 0.30], [0.85, 0.30, 0.10], [0.98, 0.70, 0.15], [1.0, 0.98, 0.80]],
  10: [[0.30, 0.52, 0.30], [0.58, 0.68, 0.38], [0.80, 0.72, 0.45], [0.62, 0.48, 0.36], [0.93, 0.93, 0.93]],
};
const rgb = (c) => `rgb(${c.map((x) => Math.round(255 * Math.min(1, Math.max(0, x)))).join(',')})`;

export function legendCss(cm) {
  if (wxOf(cm) >= 0) return wxLegendCss(wxOf(cm));
  if (cm === 32) return 'linear-gradient(90deg, rgb(115,115,115) 0% 25%, rgb(217,38,38) 25% 50%, rgb(153,77,217) 50% 75%, rgb(26,179,179) 75% 100%)';
  if (cm === 15) return wxLegendCss(WX_INDEX.radar);   // radar: skala z obrazka użytkownika (wxscales.js, −2.5…67.5 dBZ)
  if (cm === 21) return 'linear-gradient(90deg, rgb(64,115,242) 0%, rgb(204,204,204) 25%, rgb(255,217,51) 37.5%, rgb(255,140,13) 50%, rgb(235,38,31) 62.5%, rgb(191,51,217) 87.5%)';
  if (cm === 20) return 'linear-gradient(90deg, rgb(115,191,255), rgb(5,38,166))';
  if (cm === 19) return 'linear-gradient(90deg, rgb(179,179,179) 0% 6%, rgb(255,235,64) 6% 25%, rgb(255,140,13) 25% 62%, rgb(217,51,217) 62% 100%)';
  if (cm === 17) return 'linear-gradient(90deg, rgb(247,247,247) 0%, rgb(247,247,247) 2%, rgb(200,196,170) 10%, rgb(170,165,130) 40%, rgb(110,130,110) 100%)';
  if (cm === 18) return 'linear-gradient(90deg, rgb(158,158,158) 0% 20%, rgb(204,204,204) 20% 40%, rgb(153,230,255) 40% 60%, rgb(242,242,255) 60% 80%, rgb(242,26,115) 80% 100%)';
  if (cm === 16) {
    const st = [[-75, [0.3, 0.55, 0.95]], [-55, [0.92, 0.94, 0.97]], [-40, [0.55, 0.55, 0.58]], [-25, [0.3, 0.2, 0.12]], [-10, [0.08, 0.05, 0.03]]];
    return 'linear-gradient(90deg,' + st.map(([t, c]) => `${rgb(c)} ${((t + 75) / 65 * 100).toFixed(1)}%`).join(',') + ')';
  }
  if (cm === 0) return 'linear-gradient(90deg,' + Array.from({ length: 11 }, (_, i) => `${rgb(turbo(i / 10))} ${i * 10}%`).join(',') + ')';
  if (cm === 1) return 'linear-gradient(90deg, rgb(48,82,199), rgb(245,245,245), rgb(204,26,31))';
  if (cm === 9) return 'linear-gradient(90deg, rgb(61,102,51), rgb(245,245,245))';
  if (cm === 31) {
    const n = VEG_COLORS.length;
    return 'linear-gradient(90deg,' + VEG_COLORS.map((c, i) => `${rgb(c[0])} ${(100 * i) / n}% ${(100 * (i + 1)) / n}%`).join(',') + ')';
  }
  if (cm === 30) return 'linear-gradient(90deg, rgb(224,26,20) 0%, rgb(140,38,178) 33.3%, rgb(89,173,255) 66.7%, rgb(10,31,178) 100%)';
  const r = RAMPS[cm];
  return 'linear-gradient(90deg,' + r.map((c, i) => `${rgb(c)} ${i * 25}%`).join(',') + ')';
}
