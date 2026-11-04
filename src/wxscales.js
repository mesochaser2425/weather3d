// Skale kolorów – klasy progowe [od wartości → kolor]: temperatura i punkt rosy, suma opadu, pokrywa śnieżna (cm) – z obrazków
// użytkownika; wiatr (km/h), natężenie opadu i CAPE – jak na WX Charts (wxcharts.com). Jedna definicja dla mapy (WGSL),
// legend (CSS) i map rysowanych na CPU (mapa synoptyczna).

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

export const WXS = [
  // temperatura – skala z obrazka użytkownika (X 2026): klasy po 1 °C od −30 do 39 °C (części klas o tym samym kolorze), na skrajach
  // szersze (−42…−30 co 2 °C, 39…44 co 5/3, 44…50 co 2); kolory odczytane z pikseli obrazka
  { key: 'temp', unit: '°C', tk: [-30, -24, -18, -12, -6, 0, 6, 12, 18, 24, 30, 36, 44],
    t: [-42, -40, -38, -36, -34, -32, -30, -29, -28, -27, -26, -25, -24, -23, -22, -21, -20, -19, -18, -17, -16, -15, -14, -13, -12, -11,
       -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
       16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40.67, 42.33,
       44, 46, 48, 50],
    c: ['#ff6eff', '#ff46f8', '#f627eb', '#e522de', '#d41dd1', '#c318c4', '#b414b9', '#a510ae', '#960ca3', '#870898', '#78048d', '#4b007f',
      '#4b007f', '#4b007f', '#4b007f', '#4b007f', '#00397f', '#00397f', '#00397f', '#00397f', '#00528f', '#0062af', '#0072cf', '#0082ef',
      '#1392ff', '#259aff', '#49acff', '#5bb4ff', '#6dbcff', '#7fc4ff', '#9ad0ff', '#9ad0ff', '#9ad0ff', '#b5dcff', '#c7e4ff', '#d9ecff',
      '#b1f1d6', '#95dfbc', '#87d3ab', '#62af88', '#4a9775', '#07a127', '#08b30f', '#21bb0e', '#39c20c', '#52ca0b', '#84d908', '#9ce106',
      '#b5e805', '#cef003', '#e6f702', '#f3fb01', '#ebe816', '#f4cb0b', '#f4cb0b', '#f4cb0b', '#f4a20b', '#f47a0b', '#f47a0b', '#f47a0b',
      '#f4520b', '#e83709', '#dc2708', '#c41a0a', '#b51111', '#b51111', '#8c0000', '#780000', '#640000', '#8c3232', '#b46464', '#c87878',
      '#f0a0a0', '#ffb4b4', '#ffc8c8', '#ffdcdc', '#fff0f0', '#e2e2e2', '#c5c5c5', '#a8a8a8', '#8a8a8a', '#6d6d6d'] },
  { key: 'wind', unit: 'km/h',
    t: [0, 9, 19, 28, 37, 46, 56, 65, 74, 83, 93, 102, 111, 120, 130, 139, 148, 157, 167, 176, 185, 194, 204, 213, 222, 231, 241, 259],
    c: ['#e4f0fa', '#a8d0f0', '#7090d8', '#5a3a9a', '#3a9a3a', '#a8d040', '#f0e030', '#f0a020', '#e84020', '#b01818', '#781838',
      '#c030b0', '#e070d0', '#f0b8e8', '#d8d8d8', '#b0b0b0', '#888888', '#404040', '#706040', '#988850', '#b8b878', '#90a888',
      '#508878', '#285858', '#e08070', '#f05868', '#f8a0b0', '#fcd8e0'] },
  // suma opadu [mm] – skala z obrazka użytkownika (X 2026; poniżej 0.1 mm bez koloru)
  { key: 'psum', unit: 'mm',
    t: [0.1, 1, 2, 3, 5, 7, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200, 250, 300, 400, 500],
    c: ['#dedef2', '#b4d7ff', '#75baff', '#359aff', '#0482ff', '#0069d2', '#00367f', '#148f1b', '#1acf05', '#63ed07', '#fff42b', '#e8dc00',
      '#f06000', '#ff7f27', '#ffa66a', '#f84e78', '#f71e54', '#bf0000', '#880000', '#64007f', '#c200fb', '#dd66ff', '#eba6ff', '#f9e6ff',
      '#d4d4d4', '#969696'] },
  // natężenie opadu – deszcz [mm/h], skala „Rain” z WX Charts (obrazek użytkownika, odcienie przybliżone)
  { key: 'prate', unit: 'mm/h',
    t: [0.1, 0.25, 0.4, 0.6, 0.8, 1.1, 1.5, 2, 2.5, 3.2, 4, 5.5, 7.5, 11, 15, 22, 30, 45, 60, 100, 240],
    c: ['#b8e4ee', '#78c4f0', '#3a7ee8', '#2040e0', '#1818b8', '#4a2ab8', '#0e6a14', '#2ea02e', '#f4ec10', '#f8c010', '#f88a10',
      '#f04a14', '#d81414', '#a80c0c', '#780a0a', '#4a0c0a', '#5a2a1e', '#8a5a48', '#b89488', '#dcc4bc', '#f4ece8'] },
  // pokrywa śnieżna [cm] – skala z obrazka użytkownika (X 2026; poniżej 0.1 cm bez koloru)
  { key: 'snow', unit: 'cm',
    t: [0.1, 0.5, 1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 40, 50, 60, 70, 80, 100, 150, 200, 250, 300, 400],
    c: ['#dcdcfa', '#aaaac8', '#75baff', '#359aff', '#0482ff', '#0069d2', '#004f9d', '#00327f', '#4b007f', '#64007f', '#9100bb', '#c200fb',
      '#d135ff', '#eba6ff', '#f4ceff', '#fab2cb', '#ff9697', '#ff6e6e', '#df093f', '#bf0000', '#a40000', '#880000', '#460000'] },
  { key: 'cape', unit: 'J/kg',
    t: [0, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600, 2800, 3000, 3400, 3800, 4200, 4600, 5000, 5400, 5800, 6200, 7000],
    c: ['#d8d8dc', '#b4b4b8', '#909094', '#80c080', '#40a040', '#f8f800', '#f8d000', '#f8a000', '#f86c00', '#f02000', '#c00018',
      '#d02048', '#d83c78', '#e054a8', '#f070d8', '#f0b8e8', '#c8a8d8', '#a888b8', '#808090', '#484850', '#3a1a8a', '#4a3aa8',
      '#5a60c0', '#6a90d8', '#a0e8f8'] },
  // natężenie opadu śniegu [mm/h warstwy śniegu ≈ 10 × woda], skala „Snow” z WX Charts (tylko na mapie natężenia opadu)
  { key: 'psnow', unit: 'mm/h',
    t: [2, 5, 10, 20, 30, 40, 70, 100, 150],
    c: ['#e0b4ec', '#b070d0', '#7a2a9a', '#8c1e7e', '#a83c98', '#c060b0', '#d68cd0', '#e8b4e4', '#fae8fa'] },
];
for (const s of WXS) s.rgb = s.c.map(hex);
export const WX_INDEX = Object.fromEntries(WXS.map((s, i) => [s.key, i]));
// identyfikatory skal w render.wgsl / fields.js (cmap): 22 + numer skali
export const WX_CMAP0 = 22;

// kolor płynnie interpolowany między progami (kolor progu = kolor klasy z WX Charts)
export function wxColor(key, v) {
  const s = WXS[WX_INDEX[key]];
  let n = 0;
  while (n < s.t.length - 1 && v >= s.t[n + 1]) n++;
  if (n >= s.t.length - 1) return s.rgb[n];
  const f = Math.min(1, Math.max(0, (v - s.t[n]) / (s.t[n + 1] - s.t[n])));
  return s.rgb[n].map((c, k) => c + (s.rgb[n + 1][k] - c) * f);
}
const rgbCss = (c) => `rgb(${c.map((x) => Math.round(255 * x)).join(',')})`;
// pasek legendy: równe klasy (jak na WX Charts)
export function wxLegendCss(i) {
  const s = WXS[i], n = s.rgb.length;
  return 'linear-gradient(90deg,' + s.rgb.map((c, k) => `${rgbCss(c)} ${(100 * k / (n - 1)).toFixed(2)}%`).join(',') + ')';
}
// podziałka legendy: co któryś próg (albo wybrane progi tk), położenie na początku klasy
export function wxTicks(i) {
  const s = WXS[i], n = s.t.length, step = n > 26 ? 3 : 2;
  if (s.tk) return s.tk.map((v) => [v, s.t.indexOf(v) / (n - 1)]);
  return s.t.map((t, k) => [t, k / (n - 1)]).filter((x, k) => k > 0 && k < n - 1 && k % step === 0);
}
// stałe WGSL: progi i kolory każdej skali + funkcja wxPal(p, v)
export const WX_WGSL = WXS.map((s, i) => `var<private> WXT${i}: array<f32, ${s.t.length}> = array<f32, ${s.t.length}>(${s.t.map((v) => v.toFixed(2)).join(', ')});\n`
  + `var<private> WXC${i}: array<vec3f, ${s.t.length}> = array<vec3f, ${s.t.length}>(${s.rgb.map((c) => `vec3f(${c.map((x) => x.toFixed(4)).join(', ')})`).join(', ')});\n`).join('')
  + `fn wxPal(p: u32, v: f32) -> vec3f {\n  switch p {\n`
  + WXS.map((s, i) => `    case ${i}u: { var n = 0u; for (var k = 1u; k < ${s.t.length}u; k++) { if (v >= WXT${i}[k]) { n = k; } } let m = min(n + 1u, ${s.t.length - 1}u); return mix(WXC${i}[n], WXC${i}[m], clamp((v - WXT${i}[n]) / max(WXT${i}[m] - WXT${i}[n], 1e-6), 0.0, 1.0)); }\n`).join('')
  + `    default: { return vec3f(0.5); }\n  }\n}\n`
  + `fn wxMin(p: u32) -> f32 {\n  switch p {\n` + WXS.map((s, i) => `    case ${i}u: { return ${s.t[0].toFixed(2)}; }\n`).join('') + `    default: { return 0.0; }\n  }\n}\n`;
