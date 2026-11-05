// Jednostki na ekranie: przełącznik metryczne / imperialne (w3d-units w pamięci przeglądarki). Model, stan, CSV i pełny zapis przebiegu zawsze metryczne –
// tu tylko to, co widać. Bez stanu modelu i bez importów, więc także dla strony tytułowej.
const KEY = 'w3d-units';
let imp = false;
try { imp = localStorage.getItem(KEY) === 'imperial'; } catch { /* bez pamięci przeglądarki – metryczne */ }
const subs = [];
export const isImp = () => imp;
export const onUnits = (f) => { subs.push(f); };
export function setImp(v) {
  imp = !!v;
  try { localStorage.setItem(KEY, imp ? 'imperial' : 'metric'); } catch { /* bez pamięci */ }
  for (const f of subs) f();
}

// jednostka metryczna → [mnożnik, jednostka imperialna, liczba miejsc po przecinku (null – jak w metrycznych)]
const T = {
  'm/s': [2.23694, 'mph', null], 'km/h': [0.621371, 'mph', null], 'cm/s': [0.393701, 'in/s', 1],
  mm: [1 / 25.4, 'in', 2], 'mm/h': [1 / 25.4, 'in/h', 2], 'mm/d': [1 / 25.4, 'in/d', 2], cm: [1 / 2.54, 'in', 1],
  km: [0.621371, 'mi', null], m: [3.28084, 'ft', 0], hPa: [0.02953, 'inHg', 2], 'm³/s': [35.3147, 'ft³/s', null],
};
export const toD = (v, u) => (!imp ? v : u === '°C' ? v * 1.8 + 32 : T[u] ? v * T[u][0] : v);
export const fromD = (v, u) => (!imp ? v : u === '°C' ? (v - 32) / 1.8 : T[u] ? v / T[u][0] : v);
export const unitD = (u) => (!imp ? u : u === '°C' ? '°F' : T[u] ? T[u][1] : u);
// sama liczba w jednostce na ekranie; d – miejsca po przecinku w metrycznych
export const nD = (v, u, d = 0) => toD(v, u).toFixed(imp && T[u] && T[u][2] !== null ? T[u][2] : d);
export const fm = (v, u, d = 0) => `${nD(v, u, d)} ${unitD(u)}`;
export const fT = (c, d = 1) => fm(c, '°C', d);
// różnica temperatur (K ↔ °F); znak – z plusem
export const fdT = (k, d = 1, znak = false) => {
  const x = imp ? k * 1.8 : k;
  return `${znak && x > 0 ? '+' : ''}${x.toFixed(d)} ${imp ? '°F' : 'K'}`;
};
// wysokość: metry albo stopy z separatorem tysięcy
export const fmH = (m) => (imp ? `${Math.round(m * 3.28084).toLocaleString('en-US')} ft` : `${Math.round(m)} m`);
// wysokość z suwaka w km: metrycznie jak jest, imperialnie stopy co 100
export const fmZ = (km) => (imp ? `${(Math.round(km * 32.8084) * 100).toLocaleString('en-US')} ft` : `${km} km`);
// odległość w km do odczytu: metrycznie jak jest, imperialnie mile
export const fmD = (km, d = 0) => (imp ? `${(km * 0.621371).toFixed(km < 10 ? 1 : d)} mi` : `${km} km`);
// oczko siatki [m]
export const fmDx = (m) => (imp ? (m < 1609 ? fmH(m) : `${+(m / 1609.34).toFixed(1)} mi`) : m < 1000 ? `${m} m` : `${m / 1000} km`);
// widzialność [km]
export const fmVis = (km) => (imp ? (km >= 49 ? '> 30 mi' : `${(km * 0.621371).toFixed(1)} mi`) : km >= 49 ? '> 50 km' : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);
// „ładny” podpis liczby przeliczonej na skali o stałych progach
export const rnd = (v) => +v.toPrecision(v < 1 ? 1 : 2);
