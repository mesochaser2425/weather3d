// Konfiguracja siatki i stan bazowy atmosfery (sondaż referencyjny).
//
// Siatka Arakawa C:
//   u na ścianach zachodnich komórek, v na ścianach południowych,
//   w na poziomach "ścian" pionowych (zw), skalary (θ', q_v, q_c, q_r, ciśnienie) w środkach komórek (zc).
// Współrzędna pionowa obliczeniowa S ∈ [0, NZ]: z(S) = H·(A·s + (1−A)·s²), s = S/NZ.
//   S = k     → poziom ściany zw[k]  (w)
//   S = k+0.5 → środek komórki zc[k] (u, v, skalary)

// Siatka z adresu strony: ?lx=…&ly=… (wymiary widocznej domeny [km], także prostokąt), ?res=… (liczba
// komórek na dłuższym boku – szczegółowość; oczko dobiera się samo z „ładnych” wartości) albo ręcznie
// ?dx=… [m]. Zgodność wstecz: ?dx=…&n=… (kwadrat n × n). Domyślnie 25 × 25 km, 100 komórek (250 m).
// Brzegi (?bc=): otwarte (domyślnie) – domena jest wycinkiem większego układu: za krawędzią widocznej
// domeny niewidoczna strefa (jak w ALADIN/AROME): najpierw rampa relaksacji Daviesa do danych z modelu
// synoptycznego, w środku pełne zastąpienie z gładkim przejściem do przeciwległego brzegu, dzięki któremu
// solver ciśnienia może zostać periodyczny; ?bc=per – domena periodyczna (idealizowana).
export { NICE_DX, RES_OPTS, autoDx, dtFor, scaleClass, planGrid } from './gridplan.js';
import { autoDx, dtFor, r4 } from './gridplan.js';
const urlQ = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const urlDt = Number(urlQ.get('dt'));
const OPEN = urlQ.get('bc') !== 'per';
const NI0 = OPEN ? 6 : 0;          // rampa relaksacji za krawędzią widocznej domeny [oczka]
const NE0 = OPEN ? 2 * NI0 + 4 : 0; // cała strefa niewidoczna: rampa + przejście + rampa
// wymiary siatki z parametrów: { dx, nx, ny } (nx, ny – komórki widocznej domeny)
export function gridFrom(q) {
  const dxQ = Number(q.get('dx')), nQ = Number(q.get('n'));
  let nx = Number(q.get('nx')), ny = Number(q.get('ny'));
  if (dxQ > 0 && nx > 0 && ny > 0) return { dx: dxQ, nx: r4(nx), ny: r4(ny) };
  if (dxQ > 0 && nQ > 0) return { dx: dxQ, nx: r4(nQ), ny: r4(nQ) };
  const lx = Number(q.get('lx')) || (dxQ > 0 ? dxQ * 100 / 1000 : 25);
  const ly = Number(q.get('ly')) || lx;
  const res = Number(q.get('res')) || 100;
  const dx = dxQ > 0 ? dxQ : autoDx(lx, ly, res);
  nx = r4(lx * 1000 / dx); ny = r4(ly * 1000 / dx);
  return { dx, nx: Math.min(nx, 512), ny: Math.min(ny, 512) };
}
const GR = gridFrom(urlQ);
const DX0 = GR.dx;
// niewidoczny margines liczony w pełni (prawdziwy teren i duża skala, bez relaksacji) wokół widocznej
// mapy: powietrze „rozkręca się” (chmury, opad, warstwa graniczna), zanim wejdzie w widoczny obszar;
// ~10% boku z każdej strony (parzysta liczba oczek), tylko przy brzegach otwartych (?mg= – ręcznie)
const urlMg = Number(urlQ.get('mg'));
const MG0 = !OPEN ? 0 : urlQ.has('mg') ? 2 * Math.round(Math.max(0, urlMg) / 2)
  : 2 * Math.round(Math.min(24, Math.max(6, 0.1 * Math.max(GR.nx, GR.ny))) / 2);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// liczba węzłów korekty klimatu na bok domeny o długości L [m]: odstęp ≤ 600 km, najwyżej 4 (każdy węzeł to ~1/4 minutowego limitu
// zapytań Open-Meteo – 30 lat danych dobowych; większe mapy mają rzadsze węzły)
export const ccN = (L) => Math.max(1, Math.min(4, Math.ceil(L / 600e3 - 1e-6)));

export const CFG = {
  // liczba warstw pionowych (?nz=, domyślnie 50; koszt prawie liniowy – patrz CLAUDE.md)
  NX: GR.nx + 2 * MG0 + NE0, NY: GR.ny + 2 * MG0 + NE0, NZ: Math.max(30, Math.min(120, Math.round(Number(typeof location !== 'undefined' ? new URLSearchParams(location.search).get('nz') : 0) || 50))),
  NXV: GR.nx + 2 * MG0, NYV: GR.ny + 2 * MG0,   // domena liczona wprost (widoczna + margines MG)
  NXD: GR.nx, NYD: GR.ny,  // widoczna część (wyświetlana)
  MG: MG0,                 // niewidoczny margines wokół widocznej części [oczka]
  NE: NE0,                 // strefa niewidoczna za brzegiem (relaksacja + wyrównanie, periodyczność solvera)
  NI: NI0,                 // rampa relaksacji Daviesa (w strefie niewidocznej, przy krawędzi)
  OPEN,
  GS: 4,                   // odstęp siatki parametrów sondażu [oczka]
  MEB: 16,                 // poziomy nad gruntem z odchyłką warstwy granicznej (recykling na brzegach)
  DX: DX0, DY: DX0,        // [m]
  HTOP: 20000,             // wierzch domeny [m]
  STRA: 0.15,              // rozciągnięcie: dz ≈ 60 m przy ziemi, ≈ 740 m u góry
  DT: urlDt >= 2 && urlDt <= 90 ? urlDt : dtFor(DX0),   // krok czasowy [s] (do testów: ?dt=10)
  // wagi schematów zależnych od skali: warstwa graniczna (K-profil) i konwekcja głęboka
  // (Betts–Miller) – zero na siatkach LES, pełne na siatkach mezoskalowych
  W_PBL: clamp01((DX0 - 800) / 1700),
  W_CU: urlQ.has('wcu') ? clamp01(Number(urlQ.get('wcu'))) : clamp01((DX0 - 2000) / 3000),
  W_SH: clamp01((DX0 - 300) / 1200),   // konwekcja płytka (cumulusy) – od ~0.5 km pełna przy 1.5 km
  Z0: 0.1,                 // szorstkość aerodynamiczna podłoża [m]
};

export const G = 9.81, CP = 1004.0, RD = 287.0, P0 = 100000.0, LV = 2.5e6;

// Pola mapy przy powierzchni (bufor sfc: pole · NXY + kolumna)
export const SFC = ['TS', 'TD', 'W', 'H', 'LE', 'CDU', 'T2', 'TD2', 'PR', 'PACC', 'SW', 'LWP', 'QRAD', 'TB',
  'PBLH', 'WS', 'CUTOP', 'SWE', 'PSN', 'GRN', 'PSL', 'ICE', 'PBASE', 'PRCU', 'CUBASE', 'CLL', 'CLM', 'CLH', 'LINV', 'CUL', 'DBZ', 'TBWV', 'VIS', 'PHEN', 'CAPE', 'FLASH', 'HAIL', 'RUN', 'QOUT', 'U10', 'GUST', 'SUNH', 'TMAX', 'TMIN', 'SNAGE', 'DBZC', 'SHU', 'SHV', 'SHR01', 'SRH03', 'SRH01', 'ORG', 'ORGB', 'MUCAPE', 'T1', 'COVER', 'UA', 'VA', 'PACCC', 'LWPC', 'COVC', 'COVS', 'PRCUS', 'CULS', 'CUBS', 'CUTS', 'SM1', 'SM2', 'SM3', 'W1', 'WMES', 'LIFT', 'MWU', 'MWV', 'SMODE', 'CUM', 'WKSRC', 'EVR', 'CWU', 'CWV', 'MUEL', 'SHACT',
  // fenologia: średnia krocząca T 2 m (dwa stopnie po ~3.75 doby ≈ średnia z ~15 dób) i temperatura fenologiczna z pamięcią [°C]
  'TPHA', 'TPH', 'TPHN',
  // front przy gruncie (mapa „Fronty”): > 0 chłodny (1 łagodny … 2 ostry), < 0 ciepły, × bliskość osi
  'FRT',
  // woda równoważna chmur warstwowych lodowych poniżej −20 °C (kowadła, cirrusy) – satelita rysuje je nad kłębami
  'LWPA',
  // widok „Miesiące”: liczniki bieżącego miesiąca – Σ T 2 m·Δt [°C·s], Σ dobowych T maks. i T min. (pełne doby), opad i śnieg
  // (woda) [mm]; MV – wybrana wielkość zapisanego miesiąca (main.js wpisuje ją do mapy)
  'MTS', 'MTX', 'MTN', 'MPR', 'MSN', 'MV',
  // ekstrema bieżącego miesiąca do analiz (aktualizowane o północy, 0 – brak danych): T maks. absolutna + 1000, 1000 − T min. absolutna [°C],
  // największy opad dobowy [mm]; PD0 – suma opadu PACC o ostatniej północy
  'MXA', 'MNA', 'MPD', 'PD0',
  // grubość pokrywy śnieżnej [m] (gęstość = SWE / SND: świeży śnieg wg temperatury powietrza, potem osiadanie)
  'SND'];

// Parametry sondażu w węzłach siatki parametrów (co GS oczek): T przy morzu [K], gradient [K/m],
// tropopauza [m], podstawa i siła inwersji [m, K], RH dołem i górą, wiatr przy gruncie i ścinanie
// (u0, v0 [m/s], du, dv [1/s]), ruch pionowy w* [m/s], ciśnienie na poziomie morza [hPa]
// + opad modelu synoptycznego [mm/h] i udział konwekcji (napływ chmur i opadu przez brzegi domeny)
export const NPAR = 25;   // 20–23: wilgotność z modelu synoptycznego na 3 / 1.5 / 5 / 6.5 km (względem nasycenia woda → lód), 24: gradient 3–5.6 km

export function zOfS(S, c = CFG) {
  const s = S / c.NZ;
  return c.HTOP * (c.STRA * s + (1 - c.STRA) * s * s);
}

export function sOfZ(z, c = CFG) {
  const q = 1 - c.STRA;
  return (-c.STRA + Math.sqrt(c.STRA * c.STRA + 4 * q * Math.max(z, 0) / c.HTOP)) / (2 * q) * c.NZ;
}

// Ciśnienie pary nasyconej nad wodą (Tetens) → stosunek zmieszania nasycenia; punkt rosy
export function qsat(T, p) {
  const es = 610.78 * Math.exp(17.27 * (T - 273.16) / (T - 35.86));
  return 0.622 * es / Math.max(p - es, 1);
}
export function dewpoint(q, p) {
  const e = Math.max(q * p / (0.622 + q), 1e-3);
  const a = Math.log(e / 610.78);
  return (273.16 * 17.27 - 35.86 * a) / (17.27 - a);
}

// --- Masy powietrza (sondaże) ---
// tsfc: temperatura przy gruncie na poziomie morza [°C], lapse: spadek temperatury w troposferze [K/km],
// rhLow: wilgotność względna w dolnej warstwie [%], rhHigh: wyżej [%], ztrop: wysokość tropopauzy [km],
// zinv: wysokość inwersji [km] (0 = brak), dinv: wzrost temperatury w warstwie inwersji (500 m) [K],
// tnight: nocne wychłodzenie przy gruncie [K] (poranny sondaż: inwersja radiacyjna w dolnych ~350 m)
export const AIRMASSES = {
  cumulus: { name: 'Summer day – cumulus under an inversion', tsfc: 22, lapse: 6.5, rhLow: 55, rhHigh: 20, ztrop: 12, zinv: 3.2, dinv: 5, tnight: 6 },
  storm: { name: 'Storm day (high CAPE, weak inversion – storms from early afternoon)', tsfc: 28, lapse: 7.1, rhLow: 70, rhHigh: 50, ztrop: 13, zinv: 1.8, dinv: 0.8, tnight: 7 },
  dry: { name: 'Dry, warm air mass', tsfc: 26, lapse: 6.0, rhLow: 35, rhHigh: 20, ztrop: 12, zinv: 0, dinv: 0, tnight: 8 },
  humid: { name: 'Humid, stable (foehn, orographic clouds)', tsfc: 16, lapse: 5.5, rhLow: 90, rhHigh: 70, ztrop: 11, zinv: 0, dinv: 0, tnight: 2 },
  cold: { name: 'Cool, polar', tsfc: 8, lapse: 7.0, rhLow: 75, rhHigh: 50, ztrop: 9, zinv: 0, dinv: 0, tnight: 4 },
};

// Stan bazowy z parametrów masy powietrza: T(z), funkcja Exnera π(z) z równowagi hydrostatycznej,
// ciśnienie, gęstość, para wodna. Zwraca funkcje profilu.
export function makeSounding(p, c = CFG) {
  const T0 = p.tsfc + 273.15;
  const gam = Math.min(p.lapse, 9.5) / 1000;
  const zt = p.ztrop * 1000;
  const zi = (p.zinv || 0) * 1000, di = zi > 0 ? (p.dinv || 0) : 0;
  // inwersja: temperatura rośnie o di w warstwie 500 m nad zi (wygładzone; cieńszej siatka nie rozdzieli)
  const inv = (z) => {
    if (di < 0) return di * Math.min(1, Math.max(0, z / (zi + 500)));   // ujemna: szybszy spadek w warstwie granicznej
    const x = Math.min(1, Math.max(0, (z - zi) / 500)); return di * x * x * (3 - 2 * x);
  };
  // Stan bazowy jest gładki (bez nocnej inwersji). Nocne wychłodzenie przy gruncie wchodzi tylko
  // do warunku początkowego (ujemne θ' w dolnych ~350 m nad lokalnym gruntem) – patrz cool().
  // tropopauza wygładzona na ~1 km (ostry załom profilu siatka rozmywa, a fale grawitacyjne
  // tworzyły przy nim sztuczną ciepłą warstwę): spadek γ przechodzi w wzrost 1 K/km
  const wt = 350;
  const soft = (x) => (x > 30 ? x : Math.log1p(Math.exp(x)));
  // drugi gradient od ~5.5 km (górna troposfera; p.lapse2 z modelu synoptycznego, domyślnie = lapse)
  const g2 = Math.min(p.lapse2 || p.lapse, 9.5) / 1000, w2 = 600;
  const T = (z) => T0 - gam * z - (g2 - gam) * w2 * soft((z - 5500) / w2) + (g2 + 0.001) * wt * soft((z - zt) / wt) + inv(z);
  const hn = 350, tn = p.tnight || 0;
  // nocne wychłodzenie zależy od godziny startu: pełne w nocy i o świcie, znika do 10:00,
  // narasta znów wieczorem
  const nightFactor = (h) => (h < 7 ? 1 : h < 10 ? (10 - h) / 3 : h < 18 ? 0 : 0.75 * (h - 18) / 6);
  const cool = (zagl, hour = 6) => (zagl >= 0 && zagl < hn ? nightFactor(hour) * tn * (1 - zagl / hn) ** 2 : 0);
  // ln π(z) = −g/cp ∫ dz / T  (tablica co 10 m)
  const step = 10, n = Math.ceil(c.HTOP / step) + 2;
  const lnpi = new Float64Array(n);
  for (let i = 1; i < n; i++) lnpi[i] = lnpi[i - 1] - (G / CP) * step / T((i - 0.5) * step);
  const pi = (z) => {
    const x = Math.max(z, 0) / step, i = Math.min(Math.floor(x), n - 2);
    return Math.exp(lnpi[i] + (lnpi[i + 1] - lnpi[i]) * (x - i));
  };
  const pres = (z) => P0 * Math.pow(pi(z), CP / RD);
  const theta = (z) => T(z) / pi(z);
  const rho = (z) => pres(z) / (RD * T(z));
  const rh = (z) => {
    if (z > zt) return 0.05;
    const lo = p.rhLow / 100, hi = p.rhHigh / 100;
    // bez inwersji: przejście 1.5–3.5 km; z inwersją: sucho od razu nad nią
    const s = zi > 0 ? Math.min(1, Math.max(0, di)) : 0;     // jak airRH w sim.wgsl
    const z1 = 1500 + s * (zi - 1500), z2 = 3500 + s * (zi + 500 - 3500);
    if (p.rhMid > 0 && s < 0.5) {
      // trzy punkty (jak airRH w sim.wgsl): grunt → 3 km → 6.5 km
      const mid = p.rhMid / 100, za = Math.min(z1, 2500);
      if (z < za) return lo;
      if (z < 3000) return lo + (mid - lo) * (z - za) / (3000 - za);
      if (z < 6500) return mid + (hi - mid) * (z - 3000) / 3500;
      return hi;
    }
    if (z < z1) return lo;
    if (z < z2) return lo + (hi - lo) * (z - z1) / (z2 - z1);
    return hi;
  };
  const qv = (z) => rh(z) * qsat(T(z), pres(z));
  return { T, pi, pres, theta, rho, qv, zt, cool, tn };
}

export function buildGrid(c, snd) {
  const NZ = c.NZ, NXY = c.NX * c.NY;
  const len = [
    ['ZC', NZ], ['ZW', NZ + 1], ['RC', NZ], ['RW', NZ + 1], ['TC', NZ], ['TW', NZ + 1],
    ['DZC', NZ], ['DZW', NZ + 1], ['TA', NZ], ['TCU', NZ],
    ['EXC', NZ],                   // funkcja Exnera w środkach komórek
    ['PRS', NZ],                   // ciśnienie bazowe [Pa]
    ['QV0', NZ],                   // para wodna stanu bazowego [kg/kg]
    ['RCOOL', NZ],                 // radiacyjne ochładzanie atmosfery [K/s w θ]
    ['WLS', NZ],                   // kształt profilu osiadania wielkoskalowego (0..1)
    ['TWD', 2 * c.NX + 2 * c.NY],  // tablice cos/sin dla DFT
    ['KB', NXY],                   // liczba podziemnych komórek w kolumnie
    ['HF', NXY],                   // część najniższej komórki nad gruntem (oczka przycięte do terenu, 0.3…1)
    ['HGT', NXY],                  // wysokość terenu (gładka) [m]
    ['SLX', NXY], ['SLY', NXY],    // nachylenie terenu dz/dx, dz/dy
    ['LAND', NXY],                 // użytkowanie: 0 otwarte, 1 las, 2 zabudowa, 3 woda
    ['VEG', NXY],                  // typ roślinności (biom, climate.js)
    ['ZONE', NXY],                 // waga relaksacji brzegowej (0 – wnętrze, 1 – strefa wyrównania)
    ['RCV', NXY],                  // odbiornik spływu (D8: sąsiad o największym spadku, −1 – bezodpływ)
    ['PGRID', NPAR * (c.NX / c.GS) * (c.NY / c.GS)],   // siatka parametrów sondażu (model synoptyczny)
    ['CCG', 8 * 36],               // korekta klimatu w węzłach (≤ 6 × 6): 4 temperatury [K], mnożniki wilgotności – grunt, 850, 700 hPa – i opadu (main.js ccUpload)
  ];
  const off = {};
  let total = 0;
  for (const [name, n] of len) { off[name] = total; total += n; }
  const d = new Float32Array(total);

  const zc = [], zw = [];
  for (let k = 0; k <= NZ; k++) zw.push(zOfS(k, c));
  for (let k = 0; k < NZ; k++) zc.push(zOfS(k + 0.5, c));

  for (let k = 0; k <= NZ; k++) {
    d[off.ZW + k] = zw[k];
    d[off.RW + k] = snd.rho(zw[k]);
    d[off.TW + k] = snd.theta(zw[k]);
    d[off.DZW + k] = k > 0 && k < NZ ? zc[k] - zc[k - 1] : 1; // odstęp między środkami komórek
  }
  for (let k = 0; k < NZ; k++) {
    const z = zc[k];
    d[off.ZC + k] = z;
    d[off.RC + k] = snd.rho(z);
    d[off.TC + k] = snd.theta(z);
    d[off.DZC + k] = zw[k + 1] - zw[k];
    d[off.EXC + k] = snd.pi(z);
    d[off.PRS + k] = snd.pres(z);
    d[off.QV0 + k] = snd.qv(z);
    // ochładzanie radiacyjne czystej atmosfery ok. 1.5 K/dobę w troposferze, zanika nad tropopauzą
    const fr = Math.min(1, Math.max(0, (snd.zt - z) / 1500));     // zero na tropopauzie
    d[off.RCOOL + k] = -1.5 / 86400 / snd.pi(z) * fr;
    // osiadanie: rośnie liniowo do 1.5 km, stałe w troposferze, zanika ku tropopauzie
    // nie sięga tropopauzy – inaczej ściąga w dół ciepłe (w sensie θ) powietrze stratosfery
    d[off.WLS + k] = Math.min(z / 1500, 1, Math.max(0, (snd.zt - 1500 - z) / 2000));
  }
  // Strefy brzegowe (za krawędzią widocznej domeny): odległość od najbliższej krawędzi e [oczka];
  // waga relaksacji Daviesa (e/(NI+1))² w rampie, 1 dalej (pełne zastąpienie); widoczna domena – 0
  const ext = (i, nv, n) => (i < nv ? 0 : Math.min(i - nv + 1, n - i));
  for (let j = 0; j < c.NY; j++) {
    for (let i = 0; i < c.NX; i++) {
      let w = 0;
      if (c.NE > 0) {
        const e = Math.max(ext(i, c.NXV, c.NX), ext(j, c.NYV, c.NY));
        if (e > 0) w = Math.min(1, (e / (c.NI + 1)) ** 2);
      }
      d[off.ZONE + j * c.NX + i] = w;
    }
  }
  // Współczynniki trójdiagonalne operatora ∂/∂z(ρ0 ∂φ/∂z) (w = 0 na dole i u góry)
  for (let k = 0; k < NZ; k++) {
    const dzc = d[off.DZC + k];
    d[off.TA + k] = k > 0 ? d[off.RW + k] / (d[off.DZW + k] * dzc) : 0;
    d[off.TCU + k] = k < NZ - 1 ? d[off.RW + k + 1] / (d[off.DZW + k + 1] * dzc) : 0;
  }
  // Tablice cos/sin dla dyskretnej transformaty Fouriera w x i y
  const t = off.TWD;
  for (let m = 0; m < c.NX; m++) {
    d[t + m] = Math.cos(2 * Math.PI * m / c.NX);
    d[t + c.NX + m] = Math.sin(2 * Math.PI * m / c.NX);
  }
  for (let n = 0; n < c.NY; n++) {
    d[t + 2 * c.NX + n] = Math.cos(2 * Math.PI * n / c.NY);
    d[t + 2 * c.NX + c.NY + n] = Math.sin(2 * Math.PI * n / c.NY);
  }
  return { data: d, off, zc, zw };
}

// liczba poziomów z wyostrzeniem frontów (środki komórek poniżej 7 km n.p.m.: zimny klin ≤ ~3 km nad gruntem, góry ≤ ~4 km)
export const kfrOf = (grid) => Math.max(1, grid.zc.filter((z) => z < 7000).length);

// Nagłówek WGSL ze stałymi wspólnymi dla JS i shaderów.
// Czynniki długości FFT: 4, potem kolejne liczby pierwsze (radix ≤ 32 – inaczej solver wraca do zwykłej DFT)
export function fftFactors(L) {
  const f = [];
  while (L % 4 === 0 && f.length < 11) { f.push(4); L /= 4; }
  for (let p = 2; L > 1 && f.length < 12; p++) while (L % p === 0) { f.push(p); L /= p; }
  return f;
}
export const fftOk = (c) => [c.NX, c.NY].every((L) => { const f = fftFactors(L); return f.length <= 12 && f.reduce((a, b) => a * b, 1) === L && Math.max(...f) <= 32; });

export function wgslHeader(c, grid) {
  const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
  const NXY = c.NX * c.NY, N = NXY * c.NZ;
  const lines = [
    `const NX: u32 = ${c.NX}u;`, `const NY: u32 = ${c.NY}u;`, `const NZ: u32 = ${c.NZ}u;`,
    `const NXY: u32 = NX * NY;`, `const N: u32 = NXY * NZ;`, `const NW: u32 = NXY * (NZ + 1u);`,
    // stan: u | v | w | θ' | q_v | q_c | q_i | q_r
    `const U_OFF: u32 = 0u;`, `const V_OFF: u32 = N;`, `const W_OFF: u32 = 2u * N;`, `const T_OFF: u32 = 2u * N + NW;`,
    `const QV_OFF: u32 = T_OFF + N;`, `const QC_OFF: u32 = T_OFF + 2u * N;`, `const QI_OFF: u32 = T_OFF + 3u * N;`,
    `const QR_OFF: u32 = T_OFF + 4u * N;`, `const NR_OFF: u32 = T_OFF + 5u * N;`, `const STATE_LEN: u32 = T_OFF + 6u * N;`,
    `const DX: f32 = ${f(c.DX)};`, `const DY: f32 = ${f(c.DY)};`,
    `const HTOP: f32 = ${f(c.HTOP)};`, `const STRA: f32 = ${f(c.STRA)};`,
    `const G: f32 = ${f(G)};`, `const CP: f32 = ${f(CP)};`, `const RD: f32 = ${f(RD)};`,
    `const P0: f32 = ${f(P0)};`, `const LV: f32 = ${f(LV)};`, `const Z0: f32 = ${f(c.Z0)};`,
    `const W_PBL: f32 = ${f(c.W_PBL)};`, `const W_CU: f32 = ${f(c.W_CU)};`,
    `const W_SH: f32 = ${f(c.W_SH)};`,
    // waga odchyłki swobodnej atmosfery z wnętrza na brzegach: 0 dla domen ≤ 300 km, 1 od 1000 km
    `const W_REC: f32 = ${f(Math.min(1, Math.max(0, (c.NXV * c.DX - 300e3) / 700e3)))};`,
    `const CCNX: u32 = ${ccN(c.NXV * c.DX)}u;`, `const CCNY: u32 = ${ccN(c.NYV * c.DY)}u;`,
    `const NXV: u32 = ${c.NXV}u;`, `const NYV: u32 = ${c.NYV}u;`, `const NE: u32 = ${c.NE}u;`, `const NI: u32 = ${c.NI}u;`,
    `const MG: u32 = ${c.MG}u;`, `const NXD: u32 = ${c.NXD}u;`, `const NYD: u32 = ${c.NYD}u;`,
    `const GS: u32 = ${c.GS}u;`, `const NGX: u32 = ${c.NX / c.GS}u;`, `const NGY: u32 = ${c.NY / c.GS}u;`,
    `const NPAR: u32 = ${NPAR}u;`, `const MEB: u32 = ${c.MEB}u;`,
    // pola docelowe (2 terminy z modelu synoptycznego): θ', q_v, u, v (3D), przy gruncie u_g, v_g, p, w, geometria frontu (8 pól)
    // i diagnostyka wykrywania (gradient, skupienie, kontrast)
    `const TG_SLOT: u32 = 4u * N + 15u * NXY;`,
    // wyostrzenie frontów Φ (θ', q_v, u, v) na poziomach poniżej ~7 km (KFR): dwa bufory na zmianę (krok parzysty / nieparzysty)
    // za dwoma terminami w buforze tgt
    `const KFR: u32 = ${kfrOf(grid)}u;`, `const NF: u32 = KFR * NXY;`, `const FPH_OFF: u32 = 3u * TG_SLOT;`,
    `const TW_CX: u32 = ${grid.off.TWD}u;`, `const TW_SX: u32 = ${grid.off.TWD + c.NX}u;`,
    `const TW_CY: u32 = ${grid.off.TWD + 2 * c.NX}u;`, `const TW_SY: u32 = ${grid.off.TWD + 2 * c.NX + c.NY}u;`,
    // bufor roboczy: φ | r | z | p | Ap | sumy częściowe | skalary CG | średnie poziome (4 na poziom)
    `const NPART: u32 = ${Math.ceil(N / 256)}u;`,
    `const W_PHI: u32 = 0u;`, `const W_R: u32 = N;`, `const W_Z: u32 = 2u * N;`, `const W_P: u32 = 3u * N;`,
    `const W_AP: u32 = 4u * N;`, `const W_PART: u32 = 5u * N;`, `const W_SC: u32 = 5u * N + NPART;`,
    `const W_MEAN: u32 = 5u * N + NPART + 8u;`,
    // korekta masy wilgoci: sumy częściowe (6 × NPART) i współczynniki (3)
    `const W_MPART: u32 = W_MEAN + 4u * NZ;`, `const W_MSC: u32 = W_MPART + 8u * NPART;`,
    // średnia odchyłka warstwy granicznej od pola docelowego (4 pola × MEB poziomów nad gruntem)
    `const W_EB: u32 = W_MSC + 4u;`,
    // … i dla θ', q_v na stałych poziomach (cała kolumna: wysuszenie przez opad, ciepło chmur)
    `const W_EA: u32 = W_EB + 4u * MEB;`,
    // średnia dobowa (średnia wykładnicza) odchyłki θ i q_v warstwy granicznej – dryf względem dużej skali
    `const W_EBM: u32 = W_EA + 2u * NZ;`,
    // średni wiatr na poziomach (u, v – sondaż średniej domeny, level_means)
    `const W_MUV: u32 = W_EBM + 2u * MEB;`,
  ];
  SFC.forEach((name, i) => lines.push(`const S_${name}: u32 = ${i}u;`));
  for (const [k, v] of Object.entries(grid.off)) lines.push(`const VG_${k}: u32 = ${v}u;`);
  // FFT (solver ciśnienia): rozkład długości linii NX, NY na czynniki (najpierw 4, potem liczby pierwsze)
  const fx = fftFactors(c.NX), fy = fftFactors(c.NY), arr = (f) => `array<u32, 12>(${[...f, ...Array(12 - f.length).fill(1)].map((v) => v + 'u').join(', ')})`;
  lines.push(`const FFT_LMAX: u32 = ${Math.max(c.NX, c.NY)}u;`, `const FFT_RMAX: u32 = ${Math.min(32, Math.max(...fx, ...fy))}u;`,
    `const FRX = ${arr(fx)};`, `const FNRX: u32 = ${fx.length}u;`, `const FRY = ${arr(fy)};`, `const FNRY: u32 = ${fy.length}u;`);
  // parametry eksperymentalne z adresu (?xp=a,b,…) – tylko do testów strojenia, domyślnie 0
  const xp = (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('xp') || '' : '').split(',');
  for (let i = 0; i < 8; i++) lines.push(`const XP${i}: f32 = ${f(Number(xp[i]) || 0)};`);
  // wyostrzenie frontów (?fr=0 – wyłączone, do porównań)
  lines.push(`const FRON: f32 = ${typeof location !== 'undefined' && new URLSearchParams(location.search).get('fr') === '0' ? '0.0' : '1.0'};`);
  // zaburzenia napływu na siatkach LES (?cpm=0 – wyłączone, do porównań A/B)
  lines.push(`const CPM: f32 = ${typeof location !== 'undefined' && new URLSearchParams(location.search).get('cpm') === '0' ? '0.0' : '1.0'};`);
  // stochastyczne zaburzenia warstwy granicznej w szarej strefie (?psp=0 – wyłączone, do porównań A/B)
  lines.push(`const PSP: f32 = ${typeof location !== 'undefined' && new URLSearchParams(location.search).get('psp') === '0' ? '0.0' : '1.0'};`);
  return lines.join('\n') + '\n';
}

// Wskaźniki sondażu do edytora: cząstka popołudniowa z dołu (T = temperatura masy przy ziemi,
// q z dolnej warstwy) podnoszona suchoadiabatycznie do LCL, potem wilgotnoadiabatycznie.
// CAPE/CIN z temperatury wirtualnej. Zwraca też profile do wykresu (co 100 m).
// ml > 0: cząstka z warstwy wymieszanej 0–ml m (średnia θ i q – jak mapa CAPE, ml = 500), zamiast z samego gruntu
export function soundingIndices(snd, c = CFG, ml = 0) {
  const dz = 50, zmax = Math.min(16000, c.HTOP);
  const q0 = snd.qv(0);
  let T = snd.T(0), q = q0, sat = false;
  if (ml > 0) {
    const p0 = snd.pres(0);
    let th = 0, qm = 0, n = 0;
    for (let z = 0; z <= ml; z += dz) { th += snd.T(z) * Math.pow(p0 / snd.pres(z), RD / CP); qm += snd.qv(z); n++; }
    T = th / n; q = qm / n;
  }
  let lcl = null, lfc = null, el = null, cape = 0, cin = 0, frz = null, pw = 0, negBelow = 0;
  const prof = { z: [], T: [], Td: [], parcel: [] };
  for (let z = 0; z <= zmax; z += dz) {
    const p = snd.pres(z), Te = snd.T(z), qe = snd.qv(z);
    if (z % 100 === 0) {
      prof.z.push(z); prof.T.push(Te - 273.15); prof.Td.push(dewpoint(qe, p) - 273.15); prof.parcel.push(T - 273.15);
    }
    if (frz === null && Te < 273.15) frz = z;
    pw += snd.rho(z) * qe * dz;
    const qp = sat ? qsat(T, p) : q;
    const B = G * (T * (1 + 0.61 * qp) - Te * (1 + 0.61 * qe)) / (Te * (1 + 0.61 * qe));
    // CAPE: dodatnia wyporność nad LFC (do tropopauzy); CIN: ujemna od gruntu do LFC
    if (z <= snd.zt) {
      if (lcl !== null && B > 0) { cape += B * dz; if (lfc === null) { lfc = z; cin = negBelow; } el = z; }
      else if (lfc === null && B < 0) negBelow += B * dz;
    }
    // krok w górę
    if (!sat && q >= qsat(T, p)) { sat = true; lcl = z; }
    if (!sat) T -= G / CP * dz;
    else {
      const qs = qsat(T, p);
      T -= G * (1 + LV * qs / (RD * T)) / (CP + LV * LV * qs * 0.622 / (RD * T * T)) * dz;
    }
  }
  return { lcl, lfc, el, cape, cin: lfc === null ? null : cin, frz, pw, tSfc: snd.T(0) - 273.15, tdSfc: dewpoint(q0, snd.pres(0)) - 273.15, prof };
}
