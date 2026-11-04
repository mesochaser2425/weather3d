import { WXS, WX_CMAP0, wxLegendCss, wxColor } from './wxscales.js';
import { VEG_COLORS } from './climate.js';
// Pola do wyświetlenia, ich jednostki, skale kolorów i sposób dobierania zakresu.
// Numeracja zgodna z shaderami: 0–11 pola 3D, 20–30 mapy przy gruncie.
//   cmap: 0 turbo, 1 rozbieżna, 2 wilgotność, 3 para, 4 chmury, 5 deszcz, 6 radar, 7 suma opadu,
//         8 promieniowanie, 9 satelita, 10 teren, 11 klasyczna temperatura (stała −50…+50 °C),
//         12 satelita IR, 13 ciśnienie (niż niebieski – wyż pomarańczowy)
//   range: 'auto' (min–max z danych), 'sym' (symetryczny wokół zera), 'zero' (od zera), 'fixed'

export const FIELDS = {
  0: { name: 'T – air temperature', unit: '°C', cmap: 22, range: 'fixed', fixed: [-50, 50], iso: true },
  1: { name: 'θ – potential temperature', unit: 'K', cmap: 0, range: 'auto', iso: true },
  2: { name: 'θe – equivalent potential temperature', unit: 'K', cmap: 0, range: 'auto', iso: true },
  3: { name: 'RH – relative humidity', unit: '%', cmap: 2, range: 'fixed', fixed: [0, 100] },
  4: { name: 'q_v – water vapour', unit: 'g/kg', cmap: 3, range: 'zero', minHi: 1 },
  5: { name: 'q_c – cloud water', unit: 'g/kg', cmap: 4, range: 'zero', minHi: 0.5 },
  6: { name: 'q_r – precipitation (rain / snow)', unit: 'g/kg', cmap: 5, range: 'zero', minHi: 0.5 },
  13: { name: 'q_i – cloud ice', unit: 'g/kg', cmap: 4, range: 'zero', minHi: 0.05 },
  7: { name: 'w – vertical velocity', unit: 'm/s', cmap: 1, range: 'sym', minHi: 0.5 },
  8: { name: 'u – wind W→E', unit: 'm/s', cmap: 1, range: 'sym', minHi: 1 },
  9: { name: 'v – wind S→N', unit: 'm/s', cmap: 1, range: 'sym', minHi: 1 },
  10: { name: "θ' – potential temperature perturbation", unit: 'K', cmap: 1, range: 'sym', minHi: 0.2 },
  11: { name: "p' – pressure perturbation", unit: 'Pa', cmap: 1, range: 'sym', minHi: 2 },
  12: { name: 'Wind speed', unit: 'm/s', cmap: 23, range: 'fixed', fixed: [0, 40] },
  20: { name: 'T 2 m – air temperature near the ground', unit: '°C', cmap: 22, range: 'fixed', fixed: [-50, 50], iso: true },
  21: { name: 'Td 2 m – dew point', unit: '°C', cmap: 22, range: 'fixed', fixed: [-50, 50], iso: true },
  22: { name: 'Precipitation rate (radar)', unit: 'mm/h', cmap: 25, range: 'fixed', fixed: [0, 100] },
  23: { name: 'Total precipitation', unit: 'mm', cmap: 24, range: 'fixed', fixed: [0, 2000] },
  24: { name: 'Ground surface temperature', unit: '°C', cmap: 22, range: 'fixed', fixed: [-50, 50], iso: true },
  25: { name: 'Sensible heat flux H', unit: 'W/m²', cmap: 1, range: 'sym', minHi: 20 },
  26: { name: 'Latent heat flux LE', unit: 'W/m²', cmap: 1, range: 'sym', minHi: 20 },
  27: { name: 'Solar radiation at the ground', unit: 'W/m²', cmap: 8, range: 'fixed', fixed: [0, 1000] },
  28: { name: 'Plant-available soil water (root zone; 0 – wilting point, 100 – field capacity)', short: 'Plant-available soil water', unit: '%', cmap: 2, range: 'fixed', fixed: [0, 100] },
  62: { name: 'Soil moisture 0–10 cm (volumetric)', unit: '%', cmap: 2, range: 'fixed', fixed: [0, 45] },
  63: { name: 'Soil moisture 10–40 cm (volumetric)', unit: '%', cmap: 2, range: 'fixed', fixed: [0, 45] },
  64: { name: 'Soil moisture 40–100 cm (volumetric)', unit: '%', cmap: 2, range: 'fixed', fixed: [0, 45] },
  29: { name: 'Satellite view (visible)', unit: 'g/m²', cmap: 9, range: 'fixed', fixed: [0, 1] },
  30: { name: 'Terrain height', unit: 'm', cmap: 10, range: 'terrain' },
  79: { name: 'Surface type', unit: '', cmap: 31, range: 'fixed', fixed: [0, 11] },
  31: { name: 'Satellite IR (brightness temperature)', unit: '°C', cmap: 12, range: 'fixed', fixed: [-80, 40] },
  32: { name: 'Snow depth', unit: 'cm', cmap: 26, range: 'fixed', fixed: [0, 100] },
  33: { name: 'Vegetation greenness (phenology)', unit: '', cmap: 2, range: 'fixed', fixed: [0, 1] },
  37: { name: 'Cloud cover by level', unit: 'g/m²', cmap: 9, range: 'fixed', fixed: [0, 1] },
  58: { name: 'Total cloud cover (fraction of the sky)', short: 'Total cloud cover', unit: '%', cmap: 2, range: 'fixed', fixed: [0, 100] },
  38: { name: 'Radar reflectivity (low beams, up to 2 km)', unit: 'dBZ', cmap: 15, range: 'fixed', fixed: [5, 75] },
  39: { name: 'Satellite WV – water vapour 6.2 µm', unit: '°C', cmap: 16, range: 'fixed', fixed: [-75, -10] },
  40: { name: 'Visibility (fog, haze)', unit: 'km', cmap: 17, range: 'fixed', fixed: [0, 10] },
  41: { name: 'Phenomena: fog, hoar frost, rime, glaze, summits in cloud', short: 'Phenomena (fog, frost, glaze…)', unit: '', cmap: 18, range: 'fixed', fixed: [0, 5] },
  42: { name: 'Thunderstorms: column-max radar + lightning', unit: 'dBZ', cmap: 15, range: 'fixed', fixed: [5, 75] },
  43: { name: 'Hail (max. diameter)', unit: 'cm', cmap: 19, range: 'fixed', fixed: [0, 8] },
  44: { name: 'CAPE (parcel from the lowest layer)', unit: 'J/kg', cmap: 27, range: 'fixed', fixed: [0, 3000] },
  57: { name: 'MUCAPE (most unstable parcel from the lowest 3 km – also night storms)', short: 'MUCAPE (most unstable parcel)', unit: 'J/kg', cmap: 27, range: 'fixed', fixed: [0, 3000] },
  65: { name: 'Lift forcing – air lifted over ~3 h (fronts, jet stream, convergence lines)', short: 'Lift forcing (fronts, jet, convergence)', unit: 'm', cmap: 1, range: 'fixed', fixed: [-600, 600] },
  66: { name: 'Storm organisation: 1 single / multicell, 2 lines (QLCS, bow echo), 3 supercells', short: 'Storm organisation', unit: '', cmap: 8, range: 'fixed', fixed: [0, 3] },
  67: { name: 'Cold pools (storm outflows) – WAPE', unit: 'J/kg', cmap: 7, range: 'fixed', fixed: [0, 60] },
  68: { name: 'Fronts: sharp cold (navy), gentle cold (light blue), warm (red), stationary (purple)', short: 'Fronts', unit: '', cmap: 30, range: 'fixed', fixed: [-2, 2] },
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
  34: { name: 'Mean sea level pressure', unit: 'hPa', cmap: 13, range: 'auto', iso: true, isoMin: 1 },
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
  { name: 'Wind shear & helicity', items: [51, 52, 53, 54, 56] },
  { name: 'Composite charts', items: [55, 68] },
  { name: 'Flight meteorology', items: [40, 41] },
  { name: 'Surface & soil', items: [79, 30, 25, 26, 27, 48, 28, 62, 63, 64, 33] },
  { name: 'Rivers & lakes', items: [45] },
  ...LAYER_LEVELS.map(([p, z]) => ({ name: `Pressure level – ${p} hPa / ${z}`, p, items: LEVEL_FIELDS })),
  { name: 'Any height (slider above the map)', z: true, items: FIELDS_3D },
];
export const FIELDS_MAP = [20, 21, 46, 47, 48, 50, 49, 34, 22, 38, 42, 43, 55, 44, 57, 65, 68, 66, 67, 51, 52, 53, 54, 56, 23, 80, 81, 82, 83, 84, 85, 86, 87, 88, 45, 32, 40, 41, 24, 25, 26, 27, 28, 62, 63, 64, 33, 29, 58, 37, 31, 39, 30, 79];

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
    case 'sym': {
      const m = niceStep(Math.max(Math.abs(lo), Math.abs(hi), f.minHi) * opt.contrast / 1.0001);
      return { lo: -m, hi: m, iso: 0 };
    }
    case 'zero': {
      const m = niceStep(Math.max(hi, f.minHi) / 1.0001);
      return { lo: 0, hi: m, iso: 0 };
    }
    default: {
      const pad = Math.max(0.2, 0.05 * (hi - lo));
      lo -= pad; hi += pad;
      const step = Math.max(niceStep((hi - lo) / opt.nIso), f.isoMin || 0);
      if (f.isoMin && hi - lo < 4 * step) { const c = (hi + lo) / 2; lo = c - 2 * step; hi = c + 2 * step; }
      return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, iso: f.iso ? step : 0 };
    }
  }
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
  13: [[0.55, 0.62, 0.90], [0.78, 0.84, 0.97], [0.97, 0.97, 0.95], [0.98, 0.86, 0.72], [0.92, 0.62, 0.50]],
};
const TEMP_CLASSIC = [[0.95, 0.85, 1.00], [0.70, 0.45, 0.85], [0.45, 0.20, 0.70], [0.15, 0.20, 0.75], [0.15, 0.50, 0.95], [0.55, 0.85, 1.00], [0.35, 0.80, 0.35], [1.00, 0.90, 0.20], [1.00, 0.45, 0.05], [0.80, 0.05, 0.05], [0.50, 0.00, 0.25]];
// klasyczna skala temperatury (−50…+50 °C) jako [r, g, b] 0..1 – mapa synoptyczna
export function tempColor(t) {
  const s = Math.min(1, Math.max(0, (t + 50) / 100)) * 10, i = Math.min(9, Math.floor(s)), f = s - i;
  return TEMP_CLASSIC[i].map((a, n) => a + (TEMP_CLASSIC[i + 1][n] - a) * f);
}
const rgb = (c) => `rgb(${c.map((x) => Math.round(255 * Math.min(1, Math.max(0, x)))).join(',')})`;
export const RADAR_STEPS = [0.1, 0.5, 1, 2, 5, 10, 20, 50];
// suma opadu [mm]: 18 klas od 0.5 do 2000 mm (sumy roczne), najwięcej kolorów w dolnym zakresie
export const ACC_STEPS = [0.5, 1, 2, 5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000];
export const ACC_COLORS = [[0.80, 0.92, 1.00], [0.60, 0.82, 1.00], [0.35, 0.65, 1.00], [0.15, 0.45, 0.90],
  [0.10, 0.70, 0.62], [0.20, 0.80, 0.30], [0.05, 0.55, 0.15], [0.65, 0.85, 0.20], [1.00, 0.92, 0.15],
  [1.00, 0.72, 0.10], [1.00, 0.50, 0.00], [0.92, 0.20, 0.10], [0.70, 0.05, 0.10], [0.85, 0.15, 0.60],
  [0.65, 0.10, 0.75], [0.42, 0.12, 0.68], [0.26, 0.06, 0.46], [0.12, 0.03, 0.22]];
// te same klasy jako stałe WGSL (render.wgsl, fn accum)
export const ACC_WGSL = `const ACC_N: u32 = ${ACC_STEPS.length}u;\n`
  + `var<private> ACC_T: array<f32, ${ACC_STEPS.length}> = array<f32, ${ACC_STEPS.length}>(${ACC_STEPS.map((v) => v.toFixed(1)).join(', ')});\n`
  + `var<private> ACC_C: array<vec3f, ${ACC_COLORS.length}> = array<vec3f, ${ACC_COLORS.length}>(${ACC_COLORS.map((c) => `vec3f(${c.join(', ')})`).join(', ')});\n`;
const RADAR_COLORS = [[0.62, 0.90, 1.00], [0.30, 0.70, 1.00], [0.15, 0.80, 0.35], [0.05, 0.58, 0.12],
  [1.00, 0.90, 0.10], [1.00, 0.58, 0.00], [0.92, 0.10, 0.10], [0.82, 0.10, 0.82]];

// kolor opadu [mm/h] jak na radarze (do map rysowanych na CPU)
export function radarColor(r) {
  let n = 0;
  while (n < RADAR_STEPS.length - 1 && r >= RADAR_STEPS[n + 1]) n++;
  return RADAR_COLORS[n];
}

const DBZ_COLORS = [[0.55, 0.85, 0.95], [0.25, 0.65, 0.95], [0.10, 0.35, 0.90], [0.10, 0.85, 0.25], [0.05, 0.65, 0.12],
  [0.02, 0.45, 0.05], [0.98, 0.95, 0.10], [0.90, 0.74, 0.00], [1.00, 0.55, 0.00], [1.00, 0.05, 0.05], [0.80, 0.00, 0.00],
  [0.62, 0.00, 0.10], [0.98, 0.05, 0.98], [0.60, 0.33, 0.78]];

export function legendCss(cm) {
  if (cm >= WX_CMAP0 && cm < WX_CMAP0 + WXS.length) return wxLegendCss(cm - WX_CMAP0);
  if (cm === 15) {
    const n = DBZ_COLORS.length;
    return 'linear-gradient(90deg,' + DBZ_COLORS.map((c, i) => `${rgb(c)} ${(100 * i) / n}% ${(100 * (i + 1)) / n}%`).join(',') + ')';
  }
  if (cm === 21) return 'linear-gradient(90deg, rgb(64,115,242) 0%, rgb(204,204,204) 25%, rgb(255,217,51) 37.5%, rgb(255,140,13) 50%, rgb(235,38,31) 62.5%, rgb(191,51,217) 87.5%)';
  if (cm === 20) return 'linear-gradient(90deg, rgb(115,191,255), rgb(5,38,166))';
  if (cm === 19) return 'linear-gradient(90deg, rgb(179,179,179) 0% 6%, rgb(255,235,64) 6% 25%, rgb(255,140,13) 25% 62%, rgb(217,51,217) 62% 100%)';
  if (cm === 17) return 'linear-gradient(90deg, rgb(247,247,247) 0%, rgb(247,247,247) 2%, rgb(200,196,170) 10%, rgb(170,165,130) 40%, rgb(110,130,110) 100%)';
  if (cm === 18) return 'linear-gradient(90deg, rgb(158,158,158) 0% 20%, rgb(204,204,204) 20% 40%, rgb(153,230,255) 40% 60%, rgb(242,242,255) 60% 80%, rgb(242,26,115) 80% 100%)';
  if (cm === 16) {
    const st = [[-75, [0.3, 0.55, 0.95]], [-55, [0.92, 0.94, 0.97]], [-40, [0.55, 0.55, 0.58]], [-25, [0.3, 0.2, 0.12]], [-10, [0.08, 0.05, 0.03]]];
    return 'linear-gradient(90deg,' + st.map(([t, c]) => `${rgb(c)} ${((t + 75) / 65 * 100).toFixed(1)}%`).join(',') + ')';
  }
  if (cm === 12) {
    // od −80 (lewo) do +40 °C (prawo), jak irColor w render.wgsl
    const st = [[-80, [1, 1, 1]], [-65, [0.3, 0, 0.3]], [-65, [0.85, 0.05, 0.05]], [-55, [1, 0.55, 0.05]],
      [-55, [0.95, 0.9, 0.1]], [-45, [0.1, 0.7, 0.2]], [-45, [0.1, 0.3, 0.9]], [-30, [0.4, 0.8, 1]],
      [-30, [0.88, 0.88, 0.88]], [40, [0.08, 0.08, 0.08]]];
    return 'linear-gradient(90deg,' + st.map(([t, c]) => `${rgb(c)} ${((t + 80) / 120 * 100).toFixed(1)}%`).join(',') + ')';
  }
  if (cm === 11) return 'linear-gradient(90deg,' + TEMP_CLASSIC.map((c, i) => `${rgb(c)} ${i * 10}%`).join(',') + ')';
  if (cm === 0) return 'linear-gradient(90deg,' + Array.from({ length: 11 }, (_, i) => `${rgb(turbo(i / 10))} ${i * 10}%`).join(',') + ')';
  if (cm === 1) return 'linear-gradient(90deg, rgb(48,82,199), rgb(245,245,245), rgb(204,26,31))';
  if (cm === 14) {
    const n = ACC_COLORS.length;
    return 'linear-gradient(90deg,' + ACC_COLORS.map((c, i) => `${rgb(c)} ${(100 * i) / n}% ${(100 * (i + 1)) / n}%`).join(',') + ')';
  }
  if (cm === 6) {
    const n = RADAR_COLORS.length;
    return 'linear-gradient(90deg,' + RADAR_COLORS.map((c, i) => `${rgb(c)} ${(100 * i) / n}% ${(100 * (i + 1)) / n}%`).join(',') + ')';
  }
  if (cm === 9) return 'linear-gradient(90deg, rgb(61,102,51), rgb(245,245,245))';
  if (cm === 31) {
    const n = VEG_COLORS.length;
    return 'linear-gradient(90deg,' + VEG_COLORS.map((c, i) => `${rgb(c[0])} ${(100 * i) / n}% ${(100 * (i + 1)) / n}%`).join(',') + ')';
  }
  if (cm === 30) return 'linear-gradient(90deg, rgb(140,38,178) 0%, rgb(224,26,20) 25%, rgb(219,219,219) 50%, rgb(89,173,255) 75%, rgb(10,31,178) 100%)';
  const r = RAMPS[cm];
  return 'linear-gradient(90deg,' + r.map((c, i) => `${rgb(c)} ${i * 25}%`).join(',') + ')';
}
