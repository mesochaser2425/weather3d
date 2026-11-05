// Model synoptyczny „rodzic” na GPU: równania pierwotne (hydrostatyczne, anelastyczne), kanał
// okresowy W–E (pełne koło szerokości) ze ścianami na N i S (7200 km), oczko 75 km, 12 warstw do 16 km, góry jako oczka
// przycięte do terenu (własne miejsce z mapy świata)
// (shaders/pe.wgsl). Fizyka: promieniowanie krótko- i długofalowe z cyklem dobowym (para wodna, CO₂, chmury),
// bilans energii lądu (gleba dwuwarstwowa), SST z klimatologii, warstwa graniczna (K-profil), tarcie, kondensacja
// z opadem i konwekcja Bettsa–Millera; przy ścianach N i S strefy brzegowe z profilem klimatycznym (tropiki /
// Arktyka za ścianą). Niże, wyże i fronty powstają same z niestabilności baroklinicznej. Nasza domena leży w środku kanału; parametry sondażu dla niej
// liczy GPU (pe_params) i zapisuje wprost do bufora domeny – bez odczytu na CPU.

import { climate } from './climate.js';
import { zonClimT, zonClimU } from './zonclim.js';
import { zonWave, NMW } from './zonwave.js';
import { soilClim } from './soilclim.js';
import { baseLand } from './climbase.js';
import peSrc from './shaders/pe.wgsl?raw';

export const NYP = 96, NZP = 12;
export const DXP = 75e3;
export const LYP = NYP * DXP;
export const DTQ = 1800;                 // odstęp terminów pól docelowych [s]
const DT = 450;                          // krok modelu [s]
const SPI = DTQ / DT;                    // kroków na termin
const NW = NZP + 1;
// Szerokość kanału W–E: pełne koło szerokości geograficznej miejsca (128–400 oczek). Przy stałych 9600 km na 49°N
// kanał obejmował 46°W–86°E i za „szwem” powietrze z Syberii wchodziło od razu nad środek Atlantyku – nad Europę
// docierało po ~2600 km oceanu zamiast znad Ameryki Płn. i całego Atlantyku: zima 850–500 hPa o 4–6 K za zimna.
// Słońce w modelu i tak obiega kanał w 24 h (jak pełne koło). ?pex= – szerokość ręcznie (test).
const PEX = typeof location !== 'undefined' ? +(new URLSearchParams(location.search).get('pex') || 0) : 0;
export let NXP = 128, LXP = NXP * DXP;
let N2, N3, WK_TL, WK_TM_OFF, WK_D24, WK_SM;
// Środek pasa szerokości kanału. Kanał wyśrodkowany na domenie przesuwał z nią pasy ciśnienia (położenie wyznaczają ściany):
// styczeń, 30 dób, środek 38 / 42 / 46°N – pas wyżów 24–36 / 28–32 / 32°N, niżów 53 / 52–57 / 56°N (realnie ~30–35 i ~60°N); domena
// w Polsce dostawała niże ~73°N. Teraz stały środek 48°N dla szerokości umiarkowanych, domena w swoim miejscu kanału (P.cy);
// domeny tropikalne i polarne – kanał przesunięty tak, by domena była ≤ 20° od środka (≥ 12° od ściany). ?pbc= – inny środek,
// ?pbc=0 – dawny kanał wyśrodkowany na domenie (porównania)
export function bandCenter(lat) {
  const pbc = QP.get('pbc');
  if (pbc === '0') return lat;
  const c = pbc ? +pbc : 48, s = lat < 0 ? -1 : 1, a = Math.abs(lat);
  return s * Math.min(Math.max(c, a - 20), a + 20);
}
export function channelCells(lat) {
  if (PEX >= 64) return 2 * Math.round(PEX / 2);
  return Math.min(400, Math.max(128, 2 * Math.round(40075e3 * Math.cos(lat * Math.PI / 180) / DXP / 2)));
}
function setWidth(nx) {
  NXP = nx; LXP = NXP * DXP; N2 = NXP * NYP; N3 = N2 * NZP;
  WK_TL = 6 * N2 + 5 * N3 + 48 * N2 + 32 + N2;   // temperatura powierzchni lądu w buforze wk (jak w pe.wgsl)
  WK_TM_OFF = N2 + N3 + 8 * N2 + NW * N2;         // … warstwa dobowa gleby (WK_TM − WK_TL)
  WK_D24 = WK_TL + WK_TM_OFF + N2;                // średnie dobowe dla domeny (5·N2: θ' warstw 0, 1, q warstwy 0, θ' i q warstwy 2)
  WK_SM = WK_D24 + 5 * N2;                        // woda w glebie lądu 0…1 (N2)
}
setWidth(channelCells(50));
const ZW = [0, 400, 900, 1500, 2200, 3000, 4000, 5200, 6600, 8200, 10000, 12500, 16000];
const OMEGA = 7.292e-5, G = 9.81, CP = 1004, RD = 287;
const QP = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new Map();   // parametry testowe (?nu4h=, ?xpn=, ?xps=)
const KZM_DEF = 2e6;                     // dyfuzja południkowa średniej strefowej θ' [m²/s] (pe_zm)
// skala wysokości gór (?posc=1 – pełne): teren schodkowy przy grubych warstwach przy gruncie (0.4–0.6 km) hamuje wiatr zachodni
// za mocno (jak w modelach ze schodkami, np. Eta) – pełne góry: lipiec, 45–60°N, wiatr ~1.5 km 0.5–2.5 m/s (bez gór 3.2–3.5,
// realnie ~4–5), latem zastój nad Europą (wyż nad Skandynawią, PPk tygodniami); połowa wysokości – 2.7–3.1 m/s
const TOPO_SCALE = +(QP.get('posc') || 0.5);
// średnia strefowa temperatury (średnia z koła szerokości na każdym poziomie) przyciągana do klimatologii NCEP 1991–2020
// (zonclim.js) z czasem ZCN dób (?zcn=, 0 – bez) – zastępuje komórkę Hadleya i resztę atmosfery poza kanałem; zaburzenia
// (niże, wyże, fronty, fale upałów) bez zmian. ?zct=0 – dawny profil ścian i stanu początkowego (Held–Suarez + AFGL)
const ZCN = +(QP.get('zcn') ?? 3);
const ZCI = +(QP.get('zci') ?? 3);
// … i średni strefowy wiatr zachodni (?zcu=, 0 – bez): w kanale bez kulistości Ziemi prąd strumieniowy przy realnym rozkładzie
// temperatury siedział za daleko na południe (styczeń, 45–60°N: 1.4–4.5 przy 4.7 m/s w NCEP)
const ZCU = +(QP.get('zcu') ?? 3);
const ZCT_ON = QP.get('zct') !== '0';
// … oraz długie fale (liczby falowe 1…NMW wzdłuż koła szerokości) T, u i v – fale stacjonarne z klimatologii NCEP (zonwave.js):
// niż islandzki, wyż azorski, prąd strumieniowy nad Atlantykiem, które na Ziemi wymuszają góry i kontrast ląd–morze, a kanał
// z górami w połowie wysokości ich nie odtwarza (styczeń: strumień nad Atlantykiem na ~30°N zamiast ~47°N, nad Europą ciśnienie
// rosnące ku północy, niże przez Europę Środkową i Śródziemnomorze). Regulator PI na każdym poziomie i w każdym pasie: w rozbiegu
// silny (część proporcjonalna WVS dób, całkująca WVS² dób² – uczy się brakującego wymuszenia), potem część proporcjonalna WVN dób
// z błędu wygładzonego średnią kroczącą WVF dób, całkująca WVI² dób² – niże i wyże (kilka dób) prawie bez tłumienia (z chwilowego
// błędu: τ 10 dób – ciśnienie nad Polską zimą odchylenie std. 8 przy 11 hPa w NCEP; τ 3 doby – 5 hPa), utrwalony zły układ
// poprawiany, wymuszenie dalej dopasowuje się do pory roku. ?wv=0 – bez
const WV_ON = QP.get('wv') !== '0';
const WVS = +(QP.get('wvs') ?? 3);
const WVN = +(QP.get('wvn') ?? 7);
const WVI = +(QP.get('wvi') ?? 20);
const WVF = +(QP.get('wvf') ?? 5);
// konwekcja Bettsa–Millera: woda z warstwy podchmurowej dla chmur głębokich (?bms=0 – bez)
const BMS = +(QP.get('bms') ?? 1);
// woda w glebie lądu przyciągana do klimatologii NCEP (soilclim.js) z czasem SMT dób (?smt=, 0 – bez)
const SMT = +(QP.get('smt') ?? 20);
// gradient temperatury w dolnych 1.5 km stanu początkowego [K/km]: 0 – zależny od klimatu (zimą słabszy), ?pegl=6.5 – dawny
const PEGL = +(QP.get('pegl') || 0);
const NU4 = DXP ** 4 / (64 * +(QP.get('nu4h') || 12) * 3600);  // ∇⁴: najkrótsze fale tłumione w ~12 h (4 h tłumiło niże – za słaby transport ciepła na północ, lato 45–53°N ~2 K za zimne)
const UBYTES = 96, USLOT = 256;
const GRADF = 1.0;                     // wzmocnienie gradientu temperatury równowagi względem klimatu
const S0 = 1361;                         // stała słoneczna [W/m²]
// promieniowanie długofalowe: pasmo nieprzezroczyste (para wodna τ ∝ u^0.45 – „silne linie”, CO₂ ∝ p·m) i okno
// 8–12 µm (kontinuum pary ∝ e·u), źródło liniowe w grubości optycznej; współczynniki dopasowane do profili AFGL
// (OLR i promieniowanie zwrotne tropików, lata i zimy umiarkowanej, zimy subarktycznej: średni błąd ~3 W/m²)
// i do profili ochładzania z obliczeń linia po linii (−1.5…−2.3 K/dobę w środkowej troposferze)
const LW_CO2 = 0.0213, LW_NCO2 = 0.651;
const NBND = 6;                          // szerokość strefy brzegowej przy ścianach N i S [pasy]
// profil tropikalny AFGL (co 1 km od 0 do 16 km) [K]
const TROP_T = [299.7, 293.7, 287.7, 283.7, 277.0, 270.3, 263.6, 257.0, 250.3, 243.6, 237.0, 230.1, 223.6, 217.0, 210.3, 203.7, 197.0];
// profile subarktyczne AFGL (zima / lato, co 1 km od 0 do 16 km) [K] – cel strefy brzegowej przy ścianie N (~78–82°N)
const SAW_T = [257.2, 259.1, 255.9, 252.7, 247.7, 240.9, 234.1, 227.3, 220.6, 217.2, 217.2, 217.2, 217.2, 217.2, 217.2, 217.2, 216.6];
const SAS_T = [287.2, 281.7, 276.3, 270.9, 265.5, 260.1, 253.1, 246.1, 239.2, 232.2, 225.2, 225.2, 225.2, 225.2, 225.2, 225.2, 225.2];
const prof1 = (P, z) => { const x = Math.min(15.999, Math.max(0, z / 1000)), i = Math.floor(x); return P[i] + (P[i + 1] - P[i]) * (x - i); };
const tropT = (z) => { const x = Math.min(15.999, Math.max(0, z / 1000)), i = Math.floor(x); return TROP_T[i] + (TROP_T[i + 1] - TROP_T[i]) * (x - i); };

// Klimatologia temperatury powierzchni oceanu (wschodnia część basenu – jak Atlantyk na zachód od Europy, ocean
// „pod wiatr” domeny): średnia roczna i półamplituda wg szerokości (dane OISST w przybliżeniu), minimum na początku
// marca, maksimum pod koniec sierpnia. Wcześniej SST = klimat lądu ze zmniejszoną amplitudą: na 60°N w styczniu lód
// (w rzeczywistości ~+7 °C) – zimowy ocean nie ogrzewał lądu, zimy w modelu z promieniowaniem o ~8 K za zimne.
const SST_LAT = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
// 80°N i dalej: lód morski cały rok (punkt zamarzania; wcześniej ~0 °C – otwarty, ciepły Ocean Arktyczny: Arktyka w modelu
// o ~9–11 K za ciepła, pochłaniała słońce latem i grzała powietrze zimą)
const SST_MEAN = [27, 27, 25.5, 22, 17, 12.5, 9, 5, -1.8, -1.8];
const SST_AMP = [0.5, 0.8, 1.5, 2.5, 4, 3.5, 2.5, 2, 0, 0];
export function sstClim(lat, doy) {
  const a = Math.min(89.9, Math.abs(lat)) / 10, i = Math.floor(a), f = a - i;
  const mean = SST_MEAN[i] + f * (SST_MEAN[i + 1] - SST_MEAN[i]), amp = SST_AMP[i] + f * (SST_AMP[i + 1] - SST_AMP[i]);
  const sh = lat < 0 ? 182.5 : 0;
  return Math.max(-1.8, mean - amp * Math.cos(2 * Math.PI * (doy - 60 - sh) / 365));
}

export function qsat(T, p) {
  const es = 610.78 * Math.exp(17.27 * (T - 273.16) / (T - 35.86));
  return 0.622 * es / Math.max(p - es, 1);
}
// Lód morski: granica na półkuli północnej w marcu (maksimum zasięgu; mediana NSIDC 1981–2010, uproszczona) w funkcji długości
// geograficznej [°E] – Morze Karskie i Peczorskie zamarznięte do brzegu, Barentsa ~73–77°N (zachód otwarty – Prąd Norweski),
// Grenlandzkie ~72–75°N, Ochockie do ~47°N, Beringa ~58–60°N, Zatoka Hudsona cała; we wrześniu ~77°N (Atlantyk ~80°N).
// Wcześniej lód tylko od 80°N przez cały rok (zimą Morze Karskie i wschód Barentsa otwarte i ciepłe – powietrze arktyczne zawsze
// szło nad wodą)
const ICE_MAX = [[-180, 60], [-170, 58], [-160, 59], [-150, 61], [-130, 61], [-120, 60], [-95, 52], [-80, 52], [-70, 53], [-60, 52],
  [-55, 52], [-50, 58], [-45, 62], [-35, 65], [-25, 67], [-15, 72], [-5, 75], [5, 78], [15, 77], [25, 75], [35, 73], [45, 70], [55, 68],
  [65, 66], [120, 66], [135, 56], [140, 47], [150, 50], [160, 58], [170, 60], [180, 60]];
function iceMaxLat(lon) {
  const lo = ((((lon + 180) % 360) + 360) % 360) - 180;
  for (let n = 1; n < ICE_MAX.length; n++) {
    const [x1, y1] = ICE_MAX[n];
    if (lo <= x1) { const [x0, y0] = ICE_MAX[n - 1]; return y0 + (y1 - y0) * (lo - x0) / (x1 - x0); }
  }
  return ICE_MAX[ICE_MAX.length - 1][1];
}
// pora lodu: 0 – minimum (~10 IX), 1 – maksimum (~10 III); jesienią lód narasta szybko, wiosną topnieje wolniej
function iceSeason(doy) {
  const d = ((doy % 365) + 365) % 365;
  if (d >= 69 && d < 253) return 0.5 + 0.5 * Math.cos(Math.PI * (d - 69) / 184);
  return Math.pow(Math.sin(0.5 * Math.PI * Math.min(((d - 253 + 365) % 365) / 181, 1)), 0.7);
}
// granica lodu [° szerokości, wartość bezwzględna] dla długości lon (null – bez geografii: przeciętna granica) i dnia roku
function iceEdge(lon, lat, doy) {
  if (lat < 0) return 67 - 9 * iceSeason(doy + 182.5);           // Antarktyka: wrzesień ~58°S, luty ~67°S
  const mn = lon !== null && lon >= -30 && lon <= 70 ? 80 : 77;
  return mn + ((lon === null ? 70 : iceMaxLat(lon)) - mn) * iceSeason(doy);
}
// losowania deterministyczne (ziarno pogody, dzień, rodzaj, składowa) – kopie modelu i prognoza dostają te same
function h32(a, b, c, d) {
  let h = (a * 374761393 + b * 668265263 + c * 2246822519 + d * 3266489917) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (((h ^ (h >>> 16)) >>> 0) + 0.5) / 4294967296;
}
const gauss = (a, b, c, d) => Math.sqrt(-2 * Math.log(h32(a, b, c, d))) * Math.cos(2 * Math.PI * h32(a, b, c, d + 7919));
// proces AR(1) o wariancji 1 i pamięci tau dób, wartość w dniu `day` (suma ważona losowań z 5·tau poprzednich dób)
function arValue(seed, day, kind, m, tau) {
  const a = Math.exp(-1 / tau), n = Math.ceil(5 * tau);
  let x = 0;
  for (let k = 0; k < n; k++) x += a ** k * gauss(seed, day - k, kind, m);
  return Math.sqrt(1 - a * a) * x;
}

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

// profil odniesienia (atmosfera standardowa)
const ZC = ZW.slice(0, NZP).map((z, k) => 0.5 * (z + ZW[k + 1]));
const T0z = (z) => (z < 11000 ? 288.15 - 0.0065 * z : 216.65);
function p0z(z) {
  if (z < 11000) return 101325 * (T0z(z) / 288.15) ** (G / (RD * 0.0065));
  return 22632 * Math.exp(-G * (z - 11000) / (RD * 216.65));
}
const piz = (z) => (p0z(z) / 1e5) ** (RD / CP);
const th0z = (z) => T0z(z) / piz(z);

// rozmieszczenie lądu i morza (jak w poprzednim modelu): ocean „pod wiatr” – na zachód od domeny
// (w tropikach na wschód) w odległości zależnej od kontynentalizmu, szerokość 3000 km
function seaMask(lat, cont) {
  const D = Math.max(0, 1500e3 * (cont - 0.5)), W = cont > 2.2 ? 0 : 3000e3;
  const sgn = Math.abs(lat) < 23 ? 1 : -1;
  const sea = new Float32Array(N2);
  for (let i = 0; i < NXP; i++) {
    const x = (i + 0.5) * DXP - LXP / 2;
    let d = sgn * x - D;
    d = ((d % LXP) + LXP) % LXP;
    const s = W > 0 && d >= 0 && d < W ? 1 : 0;
    for (let j = 0; j < NYP; j++) sea[j * NXP + i] = s;
  }
  return sea;
}

let shared = null;   // potoki i wspólne bufory (na urządzenie)

function header() {
  return `const NXP: u32 = ${NXP}u;\nconst NYP: u32 = ${NYP}u;\nconst NZP: u32 = ${NZP}u;\nconst NW: u32 = ${NW}u;\n`
    + `const N2: u32 = ${N2}u;\nconst N3: u32 = ${N3}u;\nconst DXP: f32 = ${DXP.toFixed(1)};\n`
    + `const KVB: f32 = ${(+(QP.get('pkv') ?? 30)).toFixed(3)};\nconst XPS: f32 = ${(+(QP.get('xps') || 1)).toFixed(3)};\nconst XPN: f32 = ${(+(QP.get('xpn') || 0.33)).toFixed(3)};\n`
    + `const KZM: f32 = ${(+(QP.get('kzm') ?? KZM_DEF)).toExponential(3)};\nconst ZCN: f32 = ${ZCN.toFixed(3)};\nconst ZCI: f32 = ${ZCI.toFixed(3)};\nconst ZCU: f32 = ${ZCU.toFixed(3)};\n`
    + `const WVM: u32 = ${NMW}u;\nconst BMS: f32 = ${BMS.toFixed(3)};\nconst SMR: f32 = ${(SMT > 0 ? 1 / (SMT * 86400) : 0).toExponential(4)};\n`;
}

async function getShared(device) {
  if (shared && shared.device === device && shared.nxp === NXP) return shared;
  if (shared) { shared.B.destroy(); shared.C.destroy(); shared = null; }
  const mod = device.createShaderModule({ code: header() + peSrc, label: 'pe' });
  const info = await mod.getCompilationInfo();
  const errs = info.messages.filter((x) => x.type === 'error');
  if (errs.length) throw new Error('pe.wgsl:\n' + errs.map((e) => `${e.lineNum}:${e.linePos} ${e.message}`).join('\n'));
  const C = GPUShaderStage.COMPUTE;
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: UBYTES } },
      { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: C, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: C, buffer: { type: 'read-only-storage' } },
      ...[4, 5, 6, 7].map((b) => ({ binding: b, visibility: C, buffer: { type: 'storage' } })),
    ],
  });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const pipes = {};
  for (const e of ['pe_zm', 'pe_wv', 'pe_rad', 'pe_diag', 'pe_stage', 'pe_div', 'pe_dft', 'pe_tri', 'pe_idft', 'pe_acc', 'pe_res', 'pe_pmean', 'pe_proj', 'pe_column', 'pe_lap',
    'pe_hyper', 'pe_params', 'pe_center', 'pe_hist', 'pe_map']) {
    pipes[e] = await device.createComputePipelineAsync({ layout: pl, compute: { module: mod, entryPoint: e } });
  }
  const U = GPUBufferUsage;
  const sb = () => device.createBuffer({ size: 5 * N3 * 4, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC });
  shared = { device, layout, pipes, B: sb(), C: sb(), nxp: NXP };
  return shared;
}

export class PEModel {
  // opts: { lat, cont, hum, doy, seed, nest: { vgBuf, pgOff, nodes (Float32Array 12 / węzeł), nodeCount } }
  static async create(device, opts) {
    // szerokość kanału wg szerokości geograficznej (stare modele innego miejsca muszą być już zniszczone)
    const nx = channelCells(opts.lat);
    if (nx !== NXP) setWidth(nx);
    const sh = await getShared(device);
    const m = new PEModel(sh, opts);
    m.init(opts.seed || 1);
    return m;
  }

  // model z pełnego zapisu przebiegu: info – saveInfo(), data – { S, wk, dg } (tablice f32); opts.land – ląd, morze, teren i klimat podłoża z pliku (bez mapy świata)
  static async restore(device, opts, info, data) {
    const nx = channelCells(info.lat);
    if (nx !== NXP) setWidth(nx);
    if (NXP !== info.nxp || NYP !== info.nyp || NZP !== info.nzp) throw new Error('the file needs a different synoptic model grid');
    const sh = await getShared(device);
    const m = new PEModel(sh, { ...opts, forcV: info.forcV ?? 1, lat: info.lat, lon: info.lon, cont: info.cont, hum: info.hum, seed: info.seed, doy: info.doy, doyRef: info.doyRef, tRef: info.tRef, hour0: info.hour0,
      geo: info.geoLon === null ? null : { lon: info.geoLon } });
    if (m.wkLen !== info.wkLen) { m.destroy(); throw new Error('the file comes from an incompatible version (synoptic model layout)'); }
    Object.assign(m, { p: 0, time: info.time, hslot: info.hslot, nhist: info.nhist });
    device.queue.writeBuffer(m.S[0], 0, data.S);
    device.queue.writeBuffer(m.wk, 0, data.wk);
    device.queue.writeBuffer(m.dg, 0, data.dg);
    m.writeUniforms();
    return m;
  }

  // opis modelu do pełnego zapisu przebiegu (bufory S, wk i dg czyta main.js)
  saveInfo() {
    return { lat: this.lat, lon: this.lon, cont: this.cont, hum: this.hum, seed: this.seed, doy: this.doy, doyRef: this.doyRef, tRef: this.tRef, hour0: this.hour0,
      forcV: this.forcV, time: this.time, hslot: this.hslot, nhist: this.nhist, geoLon: this.geo ? this.geo.lon : null, nxp: NXP, nyp: NYP, nzp: NZP, wkLen: this.wkLen };
  }

  constructor(sh, opts, from = null) {
    this.sh = sh;
    const d = sh.device, U = GPUBufferUsage;
    this.device = d;
    Object.assign(this, { lat: opts.lat, lon: opts.lon ?? 20, cont: opts.cont, hum: opts.hum, doy: opts.doy, seed: opts.seed, nest: opts.nest, geo: opts.geo || null });
    // środek pasa kanału i położenie domeny w kanale (na północ od środka) [m]
    this.latC = bandCenter(this.lat);
    this.yc = (this.lat - this.latC) * 111.2e3;
    const sb = () => d.createBuffer({ size: 5 * N3 * 4, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC });
    this.S = [sb(), sb()];
    this.dg = d.createBuffer({ size: (N3 + N2 * NW) * 4, usage: U.STORAGE | U.COPY_SRC | U.COPY_DST });
    // … wektor środka (32), opad konwekcyjny (N2), temperatura lądu (N2), grzanie radiacyjne (N3), diagnostyka (8·N2),
    // współczynnik mieszania warstwy granicznej (NW·N2), warstwa dobowa gleby (N2), średnie dobowe dla domeny (3·N2)
    // … regulator długich fal: część całkująca, wymuszenie, błąd wygładzony (3 × 6·NMW na pas i poziom), diagnostyka konwekcji (3·N2)
    this.wkLen = 6 * N2 + 5 * N3 + 48 * N2 + 32 + N2 + N2 + N3 + 8 * N2 + NW * N2 + N2 + 5 * N2 + N2 + NYP * NZP + 3 * N2 + 4 + 3 * NYP * NZP
      + 18 * NMW * NYP * NZP + 3 * N2;
    this.wk = d.createBuffer({ size: this.wkLen * 4, usage: U.STORAGE | U.COPY_SRC | U.COPY_DST });
    this.ub = d.createBuffer({ size: 4 * USLOT, usage: U.UNIFORM | U.COPY_DST });
    this.doyRef = opts.doyRef ?? opts.doy;   // data odpowiadająca chwili tRef modelu
    this.tRef = opts.tRef ?? 0;
    this.varAt = opts.varAt ?? null;   // manipulacja atmosfery: zmienność pogody w chwili t [s czasu symulacji, ujemne – rozbieg]
    this.forcV = opts.forcV ?? null;   // wartość użyta w ostatnich wymuszeniach
    this.hour0 = opts.hour0 ?? opts.hour ?? 12;   // godzina słoneczna w środku kanału (domena) w chwili tRef
    if (opts.land) Object.assign(this, opts.land);
    if (from) {
      // własna kopia tablic wymuszeń (pory roku: każda kopia może być w innym dniu)
      this.vzData = from.vzData.slice(); this.vzOff = from.vzOff; this.sea = from.sea; this.encl = from.encl; this.tNorm = from.tNorm;
      this.hgt = from.hgt; this.nIter = from.nIter; this.warm = from.warm;
      this.halfDiur = from.halfDiur; this.summer = from.summer; this.nodeCount = from.nodeCount; this.wvOn = from.wvOn;
      this.forcDay = from.forcDay; this.doy = from.doy; this.lc = from.lc;
      this.vz = d.createBuffer({ size: this.vzData.byteLength, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC });
      d.queue.writeBuffer(this.vz, 0, this.vzData);
    } else {
      this.buildForcing();
    }
    this.p = 0;            // który bufor S jest bieżący
    this.time = 0;
    this.hslot = 0; this.nhist = 0;
    this.center = null;    // ostatni odczyt wektora środka
    this.map = null;       // ostatni odczyt pól mapy
    this.makeBindGroups();
    this.writeUniforms();
  }

  // tablice wymuszeń i profile (vz) – z klimatu miejsca i daty
  buildForcing() {
    const { lat, cont, hum } = this;
    const doy = this.doy;
    const lens = { ZC: NZP, ZW: NW, DZ: NZP, RC: NZP, RW: NW, TH0: NZP, PI0: NZP, P0: NZP, DTH0: NZP, KV: NW, CO2: NZP,
      F: NYP, FV: NYP, TN: NYP, TEQ: NYP * NZP, TS: N2, SEA: N2, COS: NXP, SIN: NXP, BETA: N2, SLAT: NYP, CLAT: NYP, ALB: N2, TDEEP: N2, QEQ: NYP * NZP, BW: NYP,
      ARC: NXP, ARQ: NXP, HGT: N2, AU: N2, AV: N2, AC: N2, MB: 4, ZCT: NYP * NZP, UCT: NYP * NZP, WVT: 6 * NMW * NYP * NZP, SMC: N2 };
    const nodes = this.nest ? this.nest.nodes : new Float32Array(12);
    const off = {};
    let tot = 0;
    for (const [k, n] of Object.entries(lens)) { off[k] = tot; tot += n; }
    off.NODES = tot; tot += nodes.length;
    const v = new Float32Array(tot);
    for (let k = 0; k < NZP; k++) {
      const z = ZC[k];
      v[off.ZC + k] = z; v[off.DZ + k] = ZW[k + 1] - ZW[k];
      v[off.RC + k] = p0z(z) / (RD * T0z(z)); v[off.TH0 + k] = th0z(z); v[off.PI0 + k] = piz(z); v[off.P0 + k] = p0z(z);
      v[off.DTH0 + k] = (th0z(z + 50) - th0z(z - 50)) / 100;
    }
    // grubość optyczna CO₂ w warstwach (pasmo nieprzezroczyste): ∝ (ścieżka ważona ciśnieniem od góry)^n
    {
      const mt = new Array(NW).fill(0);
      for (let k = NZP - 1; k >= 0; k--) mt[k] = mt[k + 1] + v[off.RC + k] * v[off.DZ + k] * v[off.P0 + k] / 1e5;
      for (let k = 0; k < NZP; k++) v[off.CO2 + k] = LW_CO2 * ((mt[k] / mt[0]) ** LW_NCO2 - (mt[k + 1] / mt[0]) ** LW_NCO2);
    }
    for (let k = 0; k < NW; k++) {
      const z = ZW[k];
      v[off.ZW + k] = z; v[off.RW + k] = p0z(z) / (RD * T0z(z));
      v[off.KV + k] = 2 + +(QP.get('pkv') ?? 30) * Math.exp(-z / 700);
    }
    const latY = (y) => Math.max(-89.5, Math.min(89.5, this.latC + y / 111.2e3));
    const fAt = (y) => 2 * OMEGA * Math.sin(latY(y) * Math.PI / 180);
    // profil klimatyczny pasa: stan początkowy rozbiegu i cel strefy brzegowej przy ścianach N i S (tylko tam
    // jest wymuszeniem). Temperatura przy gruncie: kształt jak w teście Held–Suarez (∝ sin²φ), różnica 25°–75°
    // z klimatu (pora roku); w górę 6.5 K/km w klimacie chłodnym, w ciepłym (≥ 25 °C) zmierzony profil tropikalny
    // (AFGL; temperatura troposfery tropików jest prawie jednakowa w poziomie – tylko ½ różnicy przy gruncie),
    // wilgotność 75% przy gruncie → 25% w górnej troposferze
    const tc0 = climate(lat, doy, 1).tDay;
    const hs = lat >= 0 ? 1 : -1;
    const s2 = (la) => Math.sin(la * Math.PI / 180) ** 2;
    const dTy = (climate(25 * hs, doy, 1).tDay - climate(75 * hs, doy, 1).tDay) / (s2(75) - s2(25));
    const tsEq = (y) => tc0 - GRADF * dTy * (s2(latY(y)) - s2(lat)) + 273.15;
    this.tNorm = new Float32Array(NYP);
    for (let j = 0; j < NYP; j++) {
      const y = (j + 0.5) * DXP - LYP / 2, yf = j * DXP - LYP / 2;
      v[off.F + j] = fAt(y); v[off.FV + j] = fAt(yf);
      const tn = climate(latY(y), doy, cont).tDay + 273.15;
      v[off.TN + j] = tn; this.tNorm[j] = tn;
      const la = latY(y);
      const ts = ZCT_ON ? zonClimT(la, 0, doy) + 273.15 : tsEq(y), ztr = Math.min(16000, Math.max(8500, 11200 + 110 * (ts - 283)));
      const wm = Math.min(1, Math.max(0, (ts - 283.15) / 15));
      for (let k = 0; k < NZP; k++) {
        const z = ZC[k], zt = Math.min(z, ztr);
        // klimatologia średniej strefowej: cel przyciągania (θ') i – domyślnie – profil ścian i stanu początkowego
        const tz = zonClimT(la, z, doy) + 273.15;
        v[off.ZCT + j * NZP + k] = tz / piz(z) - th0z(z);
        v[off.UCT + j * NZP + k] = zonClimU(la, z, doy);
        const tTr = tropT(zt) + 0.5 * (ts - TROP_T[0]);
        // w dolnych 1.5 km gradient zależny od klimatu: zimą przy gruncie inwersje i słabszy spadek (~3.9 K/km – 850 hPa nad
        // Krakowem w styczniu ~−6 °C), latem ~6 K/km; wyżej 6.5 K/km. Wcześniej 6.5 K/km od gruntu – zimą troposfera ~5 K za zimna
        // na starcie, model nadrabiał to tygodniami (przebieg od 1 I: styczeń–marzec o 6–8 K za zimne)
        const gLow = PEGL > 0 ? PEGL / 1000 : Math.min(0.0065, Math.max(0.0035, 0.004 + 0.0001 * (ts - 273.15)));
        const z15 = Math.min(zt, 1500);
        let t = (1 - wm) * (ts - gLow * z15 - 0.0065 * (zt - z15)) + wm * tTr + (z > ztr ? 0.001 * (z - ztr) : 0);
        // pasy przy ścianie N (powyżej środka kanału): profil arktyczny z AFGL (subarktyczny −6 K zimą, −4 K latem) z inwersją
        // przy gruncie zimą – wcześniej grunt z formuły (~−38 °C) i 6.5 K/km w górę: 850 hPa −48 zamiast ~−22 °C, ogromny
        // upust ciepła z całego kanału
        if (ZCT_ON) t = tz;
        else if (y > 0) {
          const sf = 0.5 - 0.5 * Math.cos(2 * Math.PI * (doy - 20) / 365) * (lat >= 0 ? 1 : -1);
          const tArc = (1 - sf) * (prof1(SAW_T, z) - 6) + sf * (prof1(SAS_T, z) - 4);
          const wa = Math.min(1, Math.max(0, (latY(y) - 70) / 8));
          t = t + wa * (tArc - t);
        }
        v[off.TEQ + j * NZP + k] = t / piz(z) - th0z(z);
        const rh = z > ztr ? 0.05 : 0.75 - 0.5 * Math.min(1, z / 9000);
        v[off.QEQ + j * NZP + k] = rh * qsat(t, p0z(z));
      }
      // strefa brzegowa przy ścianach (6 pasów, 450 km): za ścianą jest reszta atmosfery – na południu tropiki, skąd
      // komórka Hadleya przenosi ~3 PW energii (bez tego cały kanał był o ~5 K za zimny); przyciąganie do profilu
      // klimatycznego, τ = 1 doba przy ścianie, słabnie w głąb jak ((6 − d)/6)²
      const dw = Math.min(j, NYP - 1 - j);
      v[off.BW + j] = dw < NBND ? ((NBND - dw) / NBND) ** 2 / 86400 : 0;
      // szerokość pasa (położenie słońca liczy pe_rad z godziny w uniformach)
      v[off.SLAT + j] = Math.sin(latY(y) * Math.PI / 180); v[off.CLAT + j] = Math.cos(latY(y) * Math.PI / 180);
    }
    // Manipulacja atmosfery „zmienność pogody” (V): kontrast południkowy temperatury w celu regulatora średniej strefowej i w profilu ścian (wokół średniej
    // z kanału na danym poziomie, ważonej cos φ) i wiatr zachodni celu × V, do ~10 km, wyżej zanika. Większy kontrast to silniejsza chwiejność baroklinowa:
    // głębsze niże i silniejsze fronty, a nie przesunięcie klimatu (kopia do korekty klimatu ma to samo, więc korekta zabiera ewentualną zmianę średniej).
    // W rozbiegu i przy konstruktorze – wartość z chwili ujemnej (start) albo z pliku zapisu.
    const VF = this.time === undefined ? (this.forcV ?? (this.varAt ? this.varAt(-1) : 1)) : (this.varAt ? this.varAt(this.time - this.tRef) : 1);
    this.forcV = VF;
    if (VF !== 1) {
      for (let k = 0; k < NZP; k++) {
        const vk = 1 + (VF - 1) * (1 - Math.min(1, Math.max(0, (ZC[k] - 10000) / 4000)));
        let sw = 0, sz = 0, se = 0;
        for (let j = 0; j < NYP; j++) { const w = v[off.CLAT + j]; sw += w; sz += w * v[off.ZCT + j * NZP + k]; se += w * v[off.TEQ + j * NZP + k]; }
        for (let j = 0; j < NYP; j++) {
          const q = j * NZP + k;
          v[off.ZCT + q] = sz / sw + vk * (v[off.ZCT + q] - sz / sw);
          v[off.TEQ + q] = se / sw + vk * (v[off.TEQ + q] - se / sw);
          v[off.UCT + q] *= vk;
        }
      }
    }
    if (!this.sea) this.makeSea(latY);
    // długość geograficzna kolumny (jak w makeSea; bez geografii – null)
    const fullC = LXP >= 0.9 * 40075e3 * Math.cos(lat * Math.PI / 180);
    const lonAt = (la, i) => (this.geo ? this.geo.lon : this.lon) + (fullC ? 360 * ((i + 0.5) / NXP - 0.5)
      : ((i + 0.5) * DXP - LXP / 2) / (111.32e3 * Math.max(0.2, Math.cos(la * Math.PI / 180))));
    const lonOf = this.geo ? lonAt : null;
    // Klimat podłoża w każdym oczku (miejsce z mapy świata): normy miesięczne z climbase.js (stacje GHCN_CAMS, GPCC) – głębsza gleba, śnieg, albedo, morza zamknięte.
    // Wcześniej szerokość + kontynentalizm, poprawka i wilgotność miejsca domeny na całym kole szerokości: Rosja i Syberia z amplitudą roczną jak Polska (zimą głębsza
    // gleba i brak śniegu – wnętrze kontynentu +6…+8 K), Sahara z albedo pól. ?plc=0 – dawny klimat z szerokości (porównania A/B)
    if (this.geo && QP.get('plc') !== '0' && !this.lc) {
      const Ts = new Float32Array(12 * N2), ha = new Float32Array(N2), ta = new Float32Array(N2);
      const MD = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      for (let j = 0; j < NYP; j++) {
        const la = latY((j + 0.5) * DXP - LYP / 2);
        for (let i = 0; i < NXP; i++) {
          const c = j * NXP + i, b = baseLand(la, lonAt(la, i));
          let sT = 0, sP = 0, sPos = 0, sP3 = 0;
          const n = la >= 0 ? [5, 6, 7] : [11, 0, 1];
          for (let m = 0; m < 12; m++) {
            Ts[m * N2 + c] = b.T[m] + 0.0065 * b.elev;
            const p = b.P[m] * MD[m];
            sT += b.T[m]; sP += p; sPos += Math.max(b.T[m], 0);
            if (n.includes(m)) sP3 += p;
          }
          // wilgotność klimatu jak climateOf w geo.js: opad / parowanie potencjalne, suche lato obniża
          let hu = sP / (250 + 5.5 * sPos);
          if (sP3 < 0.12 * sP && sT / 12 > 5) hu *= 0.7;
          ha[c] = Math.min(1, Math.max(0.02, hu));
          ta[c] = (sT / 12) + 0.0065 * b.elev;
        }
      }
      this.lc = { Ts, ha, ta };
    }
    const lc = this.lc;
    const lcAt = (c, d) => {
      const x = ((((d - 15.2) / 30.44) % 12) + 12) % 12, m0 = Math.floor(x), f = x - m0;
      return lc.Ts[m0 * N2 + c] + f * (lc.Ts[((m0 + 1) % 12) * N2 + c] - lc.Ts[m0 * N2 + c]);
    };
    // cel regulatora długich fal: współczynniki fal 1…NMW (T jako θ', u, v) z klimatologii NCEP, obrócone do układu kanału
    // (punkt x ↔ długość λ = λ0 + 360°·(x/LXP − 0.5), czyli λ = φ + λ0 − 180° dla φ = 2π·x/LXP); kanał krótszy niż koło
    // szerokości (domeny polarne) – bez regulatora
    this.wvOn = WV_ON && fullC;
    if (this.wvOn) {
      const D = ((this.geo ? this.geo.lon : this.lon) - 180) * Math.PI / 180, cf = new Float32Array(2 * NMW);
      for (let j = 0; j < NYP; j++) {
        const la = latY((j + 0.5) * DXP - LYP / 2);
        for (let k = 0; k < NZP; k++) {
          for (let vr = 0; vr < 3; vr++) {
            zonWave(la, ZC[k], doy, vr, cf);
            const sc = vr === 0 ? 1 / piz(ZC[k]) : 1, o = off.WVT + ((j * NZP + k) * 3 + vr) * 2 * NMW;
            for (let m = 1; m <= NMW; m++) {
              const a = cf[2 * m - 2], b = cf[2 * m - 1], cm = Math.cos(m * D), sm = Math.sin(m * D);
              v[o + 2 * m - 2] = sc * (a * cm + b * sm);
              v[o + 2 * m - 1] = sc * (b * cm - a * sm);
            }
          }
        }
      }
    }
    // Rdzeń arktyczny: odchylenie temperatury i wilgotności profilu przy ścianie N (cel strefy brzegowej) losowane z rozkładu
    // normalnego – powoli (pamięć ~8 dób, proces AR(1)), zmienne z długością (fale 0–2 wokół kanału): kolejne wtargnięcia arktyczne
    // różnią się siłą mrozu i wilgotnością; odchylenie std. temperatury ~3.8 K zimą, ~1.9 K latem, wilgotności ~30% (× zmiana
    // nasycenia z temperaturą). Deterministycznie z ziarna pogody i dnia – kopie modelu i prognoza mają te same losowania.
    // (półkula południowa – bez losowania)
    {
      const day = Math.floor(doy), sc = 0.75 + 0.25 * Math.cos(2 * Math.PI * (doy - 20) / 365);
      const sT = [2.5, 2.0, 2.0, 2.0, 2.0], sQ = [0.16, 0.13, 0.13, 0.13, 0.13], seed = this.seed || 1;
      const cT = sT.map((s, m) => s * arValue(seed, day, 1, m, 8)), cQ = sQ.map((s, m) => s * arValue(seed, day, 2, m, 8));
      for (let i = 0; i < NXP; i++) {
        const ph = 2 * Math.PI * (i + 0.5) / NXP, b = [1, Math.cos(ph), Math.sin(ph), Math.cos(2 * ph), Math.sin(2 * ph)];
        let dT = 0, dq = 0;
        for (let m = 0; m < 5; m++) { dT += cT[m] * b[m]; dq += cQ[m] * b[m]; }
        v[off.ARC + i] = lat >= 0 ? sc * dT : 0;
        v[off.ARQ + i] = lat >= 0 ? Math.exp(sc * dq + 0.07 * sc * dT) : 1;
      }
    }
    for (let j = 0; j < NYP; j++) {
      const y = (j + 0.5) * DXP - LYP / 2, la = latY(y);
      const tLand = climate(la, doy, cont).tDay + 273.15;
      // głębsza gleba (~1 m): amplituda roczna ~0.5, opóźnienie ~45 dób
      const cd = climate(la, doy - 45, cont), tDeep = cd.tAnn + 0.5 * (cd.tDay - cd.tAnn) + 273.15;
      const tSea = sstClim(la, doy) + 273.15;
      // morza zamknięte (Bałtyk, Czarne, Kaspijskie, częściowo Śródziemne) – jak duże jeziora: temperatura ciągnięta do
      // klimatu lądu z opóźnieniem ~25 dób (zimą zimne, latem ciepłe); wcześniej klimatologia Atlantyku na danej szerokości
      // (Bałtyk w styczniu ~7.5 °C zamiast 2–3) – mroźne powietrze nad „ciepłym” morzem brało dużo pary (za mokra zima)
      const tLag0 = climate(la, doy - 25, cont).tDay + 273.15, tLag = Math.max(tLag0, 271.35);
      for (let i = 0; i < NXP; i++) {
        const c = j * NXP + i, s = this.sea[c];
        v[off.SEA + c] = s;
        const tLandC = lc ? lcAt(c, doy) + 273.15 : tLand;
        const tDeepC = lc ? lc.ta[c] + 0.5 * (lcAt(c, doy - 45) - lc.ta[c]) + 273.15 : tDeep;
        const tLag0C = lc ? lcAt(c, doy - 25) + 273.15 : tLag0, tLagC = Math.max(tLag0C, 271.35);
        // lód morski (TS < 271.5 – powierzchnia z bilansem energii jak ląd, albedo 0.55, mało pary): ocean za granicą lodu dla tej
        // długości i pory roku; morza zamknięte (Zatoka Botnicka, Fińska, Morze Białe, północny Kaspij), gdy ląd wokół (z opóźnieniem
        // ~25 dób) ma < −4 °C – Bałtyk środkowy i południowy zostaje otwarty
        const ice = s && (Math.abs(la) >= iceEdge(lonOf ? lonOf(la, i) : null, la, doy) || (this.encl[c] >= 0.4 && tLag0C < 269.15));
        // ląd w górach: klimat z poziomu morza sprowadzony gradientem 6.5 K/km (podłoże, głębsza gleba, śnieg)
        const dTh = 0.0065 * this.hgt[c];
        v[off.TS + c] = s ? (ice ? 271.15 : tSea + 0.75 * this.encl[c] * (tLagC - tSea)) : tLandC - dTh;
        v[off.BETA + c] = s ? 1 : 0.15 + 0.4 * hum;
        // albedo bez śniegu (śnieg i lód – w pe_rad): morze 0.07, ląd 0.16 (pustynie do 0.28)
        v[off.ALB + c] = s ? 0.07 : 0.16 + 0.12 * (1 - Math.min(1, (lc ? lc.ha[c] : hum) / 0.4));
        v[off.TDEEP + c] = tDeepC - dTh;
        // klimatologia wody w glebie (NCEP 1991–2020, strefa korzeni) – cel przyciągania wiadra i stan początkowy
        v[off.SMC + c] = s ? 0 : soilClim(la, lonAt(la, i), doy);
      }
    }
    this.smClim = v.slice(off.SMC, off.SMC + N2);
    for (let i = 0; i < NXP; i++) { v[off.COS + i] = Math.cos(2 * Math.PI * i / NXP); v[off.SIN + i] = Math.sin(2 * Math.PI * i / NXP); }
    // Teren: wysokość oczka i „przewodność” ścian dla rzutu barotropowego – masa słupa nad gruntem otwarta na ścianie
    // (ściana otwarta nad wyższym z dwóch sąsiednich gruntów, jak w domenie); AC – M / masa słupa nad gruntem oczka: napięcie
    // wstępne rzutu Δ⁻¹(r/A) – nad płaskim terenem dokładne, test na kanale z płaskowyżem (A 0.47): reszta 9% / 0.8% po 1 / 2
    // iteracjach (stała masa M̄ = (A_min + M)/2: 36% / 13%)
    {
      const M = ZC.reduce((s, z, k) => s + v[off.RC + k] * v[off.DZ + k], 0);
      const colA = (h) => ZC.reduce((s, z, k) => s + v[off.RC + k] * v[off.DZ + k] * Math.min(1, Math.max(0, (ZW[k + 1] - h) / (ZW[k + 1] - ZW[k]))), 0);
      let aMin = M;
      for (let j = 0; j < NYP; j++) for (let i = 0; i < NXP; i++) {
        const c = j * NXP + i, h = this.hgt[c];
        v[off.HGT + c] = h;
        v[off.AU + c] = colA(Math.max(h, this.hgt[j * NXP + ((i + NXP - 1) % NXP)]));
        v[off.AV + c] = j > 0 ? colA(Math.max(h, this.hgt[(j - 1) * NXP + i])) : 0;
        v[off.AC + c] = M / colA(h);
        aMin = Math.min(aMin, v[off.AU + c], j > 0 ? v[off.AV + c] : M);
      }
      v[off.MB] = 1;
      // płaski kanał: rzut dokładny w jednej iteracji; z górami 2 iteracje od ciśnienia poprzedniego etapu (?pit= – liczba
      // iteracji, test). Masa słupa nad Tybetem ~0.47 pełnej.
      this.warm = aMin < 0.999 * M;
      v[off.MB + 1] = this.warm ? 1 : 0;
      this.nIter = +(QP.get('pit') || 0) || (this.warm ? 2 : 1);
    }
    v.set(nodes, off.NODES);
    this.vzOff = off;
    this.vzData = v;
    if (!this.vz) this.vz = this.device.createBuffer({ size: v.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    this.device.queue.writeBuffer(this.vz, 0, v);
    this.nodeCount = this.nest ? this.nest.nodeCount : 0;
    this.forcDay = Math.floor(doy);
    // połowa amplitudy dobowej (temperatura „popołudniowej” sondażu), nasłonecznienie lata
    const decl = 23.44 * Math.sin(2 * Math.PI * (doy - 81) / 365);
    const sunNoon = Math.cos((Math.abs(lat) - Math.sign(lat || 1) * decl) * Math.PI / 180);
    const sunf = Math.min(1, Math.max(0, (sunNoon - 0.25) / 0.65));
    this.halfDiur = 1.5 + 4 * sunf + 3 * (1 - hum);
    this.summer = sunf;
  }

  // rozkład lądu i morza w kanale (raz): parametrycznie albo z mapy świata (własne miejsce)
  makeSea(latY) {
    const { lat, cont } = this;
    this.sea = seaMask(lat, cont);
    if (this.geo) {
      // własne miejsce: prawdziwy rozkład lądu i oceanu wokół (mapa świata), kanał okresowy w x
      // kanał na pełne koło: w każdym wierszu całe 360° długości (bez „szwu”; kształty kontynentów poza szerokością
      // domeny ściśnięte / rozciągnięte w x); węższy kanał (tropiki, ?pex=) – odległości wierne, ze szwem
      const full = LXP >= 0.9 * 40075e3 * Math.cos(this.lat * Math.PI / 180);
      for (let j = 0; j < NYP; j++) {
        const la = latY((j + 0.5) * DXP - LYP / 2);
        const kmDeg = 111.32e3 * Math.max(0.2, Math.cos(la * Math.PI / 180));
        for (let i = 0; i < NXP; i++) {
          const lo = this.geo.lon + (full ? 360 * ((i + 0.5) / NXP - 0.5) : ((i + 0.5) * DXP - LXP / 2) / kmDeg);
          this.sea[j * NXP + i] = this.geo.elev(la, lo) <= 0 ? 1 : 0;
        }
      }
    }
    // Teren (własne miejsce): średnia wysokość oczka z mapy świata (3 × 3 próbki, morze = 0) × TOPO_SCALE. Najniższa warstwa nad gruntem
    // ma co najmniej połowę grubości: grunt w górnej połowie warstwy obniżony do jej połowy albo (w górnej ćwiartce) podniesiony
    // do górnej ściany – cieńsza warstwa przy gruncie wymagałaby krótszego kroku (strumienie z podłoża jawnie). Najwyżej 5.2 km.
    this.hgt = new Float32Array(NXP * NYP);
    if (this.geo && QP.get('poro') !== '0') {
      const full = LXP >= 0.9 * 40075e3 * Math.cos(this.lat * Math.PI / 180);
      for (let j = 0; j < NYP; j++) {
        const yc = (j + 0.5) * DXP - LYP / 2, la = latY(yc);
        const kmDeg = 111.32e3 * Math.max(0.2, Math.cos(la * Math.PI / 180));
        const dLon = full ? 360 / NXP : DXP / kmDeg;
        for (let i = 0; i < NXP; i++) {
          const c = j * NXP + i;
          if (this.sea[c]) continue;
          const lo = this.geo.lon + (full ? 360 * ((i + 0.5) / NXP - 0.5) : ((i + 0.5) * DXP - LXP / 2) / kmDeg);
          let s = 0;
          for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) s += Math.max(0, this.geo.elev(latY(yc + b * DXP / 3), lo + a * dLon / 3));
          let h = Math.min(TOPO_SCALE * s / 9, ZW[7]);
          let k = 0;
          while (k < NZP - 1 && ZW[k + 1] <= h) k++;
          const f = (ZW[k + 1] - h) / (ZW[k + 1] - ZW[k]);
          if (f < 0.25) h = ZW[k + 1];
          else if (f < 0.5) h = 0.5 * (ZW[k] + ZW[k + 1]);
          this.hgt[c] = h;
        }
      }
    }
    // „zamknięcie” morza: udział morza w promieniu ~750 km (10 oczek); otwarty ocean ≥ 0.65 → 0, morze śródlądowe → 1
    const R = 10;
    this.encl = new Float32Array(NXP * NYP);
    for (let j = 0; j < NYP; j++) for (let i = 0; i < NXP; i++) {
      if (!this.sea[j * NXP + i]) continue;
      let ns = 0, n = 0;
      for (let dj = -R; dj <= R; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= NYP) continue;
        for (let di = -R; di <= R; di++) {
          if (di * di + dj * dj > R * R) continue;
          ns += this.sea[jj * NXP + ((i + di + NXP) % NXP)]; n++;
        }
      }
      this.encl[j * NXP + i] = Math.min(1, Math.max(0, (0.65 - ns / n) / 0.45));
    }
  }
  // temperatura morza [°C] najbliższego oczka morskiego modelu (≤ 4 oczka) w punkcie (x, y) względem środka kanału
  seaTemp(x, y) {
    const i0 = Math.floor(x / DXP + NXP / 2), j0 = Math.floor((y + this.yc) / DXP + NYP / 2);
    for (let r = 0; r <= 4; r++) {
      let best = null, bd = 1e9;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        const j = j0 + dj, i = (i0 + di + NXP) % NXP;
        if (j < 0 || j >= NYP || !this.sea[j * NXP + i]) continue;
        const d = di * di + dj * dj;
        if (d < bd) { bd = d; best = this.vzData[this.vzOff.TS + j * NXP + i]; }
      }
      if (best !== null) return best - 273.15;
    }
    return null;
  }

  // data (dzień roku) w chwili t modelu
  doyAt(t) { return this.doyRef + (t - this.tRef) / 86400; }

  makeBindGroups() {
    const { device, layout } = { device: this.device, layout: this.sh.layout };
    const { B, C } = this.sh;
    const nestBuf = this.nest ? this.nest.vgBuf : (this.sh.dummy ??= device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE }));
    const bg = (sIn, sBase, sOut) => device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.ub, size: UBYTES } },
        { binding: 1, resource: { buffer: this.vz } },
        { binding: 2, resource: { buffer: sIn } },
        { binding: 3, resource: { buffer: sBase } },
        { binding: 4, resource: { buffer: sOut } },
        { binding: 5, resource: { buffer: this.dg } },
        { binding: 6, resource: { buffer: this.wk } },
        { binding: 7, resource: { buffer: nestBuf } },
      ],
    });
    // [parzystość][etap]: etap 0 A→B, 1 B→C, 2 C→D; post: stan bieżący jako sOut
    this.bgs = [0, 1].map((p) => {
      const A = this.S[p], D = this.S[1 - p];
      return [bg(A, A, B), bg(B, A, C), bg(C, A, D), bg(B, C, A)];
    });
  }

  writeUniforms() {
    const ab = new ArrayBuffer(4 * USLOT);
    // regulator długich fal: w rozbiegu silny z chwilowego błędu, potem słabszy z wygładzonego (część proporcjonalna [1/s],
    // całkująca [1/s²], włączony, błąd wygładzony, tempo wygładzania [1/s])
    const wt = this.spinning ? WVS : WVN, wi = this.spinning ? WVS : WVI;
    const wvP = this.wvOn && wt > 0 ? 1 / (wt * 86400) : 0, wvI = this.wvOn && wi > 0 ? 1 / (wi * wi * 86400 * 86400) : 0;
    for (let s = 0; s < 4; s++) {
      const f = new Float32Array(ab, s * USLOT, 24), u = new Uint32Array(ab, s * USLOT, 24);
      f[16] = wvP; f[17] = wvI; f[18] = this.wvOn ? 1 : 0; f[19] = this.spinning || !(WVF > 0) ? 0 : 1; f[20] = WVF > 0 ? 1 / (WVF * 86400) : 0;
      f[0] = s < 3 ? [DT / 3, DT / 2, DT][s] : DT; f[1] = DT; u[2] = Math.min(s, 2); f[3] = NU4;
      f[4] = this.halfDiur; f[5] = this.summer; u[6] = this.nodeCount; u[7] = this.nest ? this.nest.pgOff : 0;
      u[8] = this.hslot; u[9] = this.nhist; f[10] = 0; f[11] = this.yc;   // środek domeny w kanale
      // słońce w połowie terminu (30 min): godzina słoneczna w środku kanału, deklinacja, stała słoneczna × odległość
      const tm = this.time + DTQ / 2, dd = this.doyRef + (this.hour0 + (tm - this.tRef) / 3600) / 24;
      const de = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + dd) / 365);
      f[12] = ((((this.hour0 + (tm - this.tRef) / 3600) % 24) + 24) % 24); f[13] = Math.sin(de); f[14] = Math.cos(de);
      f[15] = S0 * (1 + 0.033 * Math.cos(2 * Math.PI * dd / 365));
    }
    this.device.queue.writeBuffer(this.ub, 0, ab);
  }

  // stan początkowy: przepływ strefowy w równowadze wiatru termicznego z temperaturą równowagi,
  // zaburzenia temperatury (fale 4–9 wokół kanału) – zarodki niżów; para 60% nasycenia
  init(seed) {
    const rand = rng(seed * 2654435761 + 7);
    const off = this.vzOff, v = this.vzData;
    const st = new Float32Array(5 * N3);
    const waves = Array.from({ length: 8 }, () => ({ k: 4 + Math.floor(rand() * 6), ph: 2 * Math.PI * rand(), a: 0.5 + rand(), y0: (rand() - 0.5) * 0.4 * LYP }));
    for (let k = 0; k < NZP; k++) {
      for (let j = 0; j < NYP; j++) {
        const y = (j + 0.5) * DXP - LYP / 2;
        for (let i = 0; i < NXP; i++) {
          const x = (i + 0.5) * DXP;
          let pert = 0;
          for (const w of waves) pert += w.a * Math.cos(2 * Math.PI * w.k * x / LXP + w.ph) * Math.exp(-(((y - w.y0) / 1.2e6) ** 2));
          const c = (k * NYP + j) * NXP + i;
          const th = v[off.TEQ + j * NZP + k] + 0.6 * pert * Math.exp(-ZC[k] / 6000);
          st[2 * N3 + c] = th;
          const T = (v[off.TH0 + k] + th) * v[off.PI0 + k];
          st[3 * N3 + c] = 0.6 * qsat(T, v[off.P0 + k]) * (ZC[k] < 10000 ? 1 : 0.1);
        }
      }
    }
    // wiatr termiczny: f ∂u/∂z = −(g/θ0) ∂θ'/∂y, u = 0 przy gruncie
    for (let j = 0; j < NYP; j++) {
      const f0 = v[off.F + j], f = Math.sign(f0 || 1) * Math.max(Math.abs(f0), 3e-5);
      const jm = Math.max(0, j - 1), jp = Math.min(NYP - 1, j + 1);
      for (let i = 0; i < NXP; i++) {
        let u = 0;
        for (let k = 0; k < NZP; k++) {
          const c = (k * NYP + j) * NXP + i;
          const dth = (st[2 * N3 + (k * NYP + jp) * NXP + i] - st[2 * N3 + (k * NYP + jm) * NXP + i]) / ((jp - jm) * DXP);
          const dz = k === 0 ? ZC[0] : ZC[k] - ZC[k - 1];
          if (k > 0) u += -G / (f * v[off.TH0 + k]) * dth * dz;
          st[c] = Math.max(-60, Math.min(80, u));
        }
      }
    }
    this.device.queue.writeBuffer(this.S[this.p], 0, st);
    const wk0 = new Float32Array(this.wkLen);
    wk0.set(v.subarray(off.TS, off.TS + N2), WK_TL);      // temperatura gleby na start: klimat (powierzchnia, warstwa dobowa)
    wk0.set(v.subarray(off.TS, off.TS + N2), WK_TL + WK_TM_OFF);
    // średnie dobowe (kroczące) θ' warstw 0, 1 i q warstwy 0 – parametry dla domeny
    wk0.set(st.subarray(2 * N3, 2 * N3 + 2 * N2), WK_D24);
    wk0.set(st.subarray(3 * N3, 3 * N3 + N2), WK_D24 + 2 * N2);
    wk0.set(st.subarray(2 * N3 + 2 * N2, 2 * N3 + 3 * N2), WK_D24 + 3 * N2);   // θ' i q warstwy 2 (~1.2 km)
    wk0.set(st.subarray(3 * N3 + 2 * N2, 3 * N3 + 3 * N2), WK_D24 + 4 * N2);
    // woda w glebie na start: z klimatologii NCEP (bez przyciągania – dawny wzór: sucho w pasie zwrotnikowym (~20–32°), wilgotniej
    // w strefie umiarkowanej i chłodnej); dalej – z bilansu opad − parowanie (rozbieg 15 dób)
    if (SMT > 0) wk0.set(this.smClim, WK_SM);
    else for (let j = 0; j < NYP; j++) {
      const la = Math.min(89.5, Math.abs(this.latC + ((j + 0.5) * DXP - LYP / 2) / 111.2e3));
      const dry = Math.max(0, Math.min(1, (la - 32) / 13)) + Math.max(0, Math.min(1, (16 - la) / 6));
      // pora roku: gleba najwilgotniejsza po zimie, najsuchsza pod koniec sierpnia (rozbieg 15 dób nie zdąży jej wysuszyć –
      // pamięć gleby to miesiące); półkula wg znaku szerokości
      const dSeason = 0.5 - 0.5 * Math.cos(2 * Math.PI * (this.doy - 50 - (this.lat < 0 ? 182.5 : 0)) / 365);
      const w0 = Math.min(1, (0.15 + 0.6 * Math.min(1, dry)) * Math.max(0.4, Math.min(1.3, this.hum / 0.75)) * (1 - 0.15 * dSeason));
      for (let i = 0; i < NXP; i++) wk0[WK_SM + j * NXP + i] = w0;
    }
    this.device.queue.writeBuffer(this.wk, 0, wk0);
    this.time = 0; this.hslot = 0; this.nhist = 0;
    this.writeUniforms();
  }

  // zapis dyspozycji n kroków do przebiegu obliczeń
  encodeSteps(pass, n) {
    const P = this.sh.pipes;
    const d1 = (name, total, bg, slot) => {
      pass.setPipeline(P[name]); pass.setBindGroup(0, bg, [slot * USLOT]);
      pass.dispatchWorkgroups(Math.ceil(total / 64));
    };
    for (let s = 0; s < n; s++) {
      const g = this.bgs[this.p];
      d1('pe_zm', NYP * NZP, g[0], 0);
      // regulator długich fal: grupa robocza na pas i poziom
      if (this.wvOn) { pass.setPipeline(P.pe_wv); pass.setBindGroup(0, g[0], [0]); pass.dispatchWorkgroups(NYP * NZP); }
      d1('pe_rad', N2, g[0], 0);
      for (let st = 0; st < 3; st++) {
        d1('pe_diag', N2, g[st], st);
        // (ostatni etap: średnia część hydrostatyczna ciśnienia przy z = 0 – ciśnienie na poziomie morza ze średnią 1013 hPa)
        if (st === 2) { pass.setPipeline(P.pe_pmean); pass.setBindGroup(0, g[st], [st * USLOT]); pass.dispatchWorkgroups(1); }
        d1('pe_stage', N3, g[st], st);
        d1('pe_div', N2, g[st], st);
        // rzut ze zmienną masą słupa (góry): iteracja z rozwiązaniem dla płaskiego kanału jako napięciem wstępnym, start od
        // ciśnienia poprzedniego etapu (reszta równania na starcie)
        if (this.warm) d1('pe_res', N2, g[st], st);
        for (let it = 0; it < this.nIter; it++) {
          d1('pe_dft', N2, g[st], st);
          d1('pe_tri', NXP, g[st], st);
          d1('pe_idft', N2, g[st], st);
          d1('pe_acc', N2, g[st], st);
          if (it < this.nIter - 1) d1('pe_res', N2, g[st], st);
        }
        d1('pe_proj', N3, g[st], st);
      }
      d1('pe_column', N2, g[2], 2);
      d1('pe_lap', 5 * N3, g[2], 2);
      d1('pe_hyper', 5 * N3, g[2], 2);
      this.p = 1 - this.p;
    }
  }

  // jeden termin (30 min); co 3 h zapis wiatru do historii trajektorii
  step() {
    // pory roku: raz na dobę modelu nowe wymuszenia (temperatura równowagi, ląd, morze)
    const dNow = this.doyAt(this.time);
    if (Math.floor(dNow) !== this.forcDay) { this.doy = dNow; this.buildForcing(); this.writeUniforms(); }
    this.writeUniforms();
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    this.encodeSteps(pass, SPI);
    this.time += DTQ;
    const hist = Math.round(this.time / DTQ) % 6 === 0;
    if (hist) {
      this.hslot = (this.hslot + 1) % 24; this.nhist = Math.min(24, this.nhist + 1);
      this.writeUniforms();
      pass.setPipeline(this.sh.pipes.pe_hist); pass.setBindGroup(0, this.bgs[this.p][3], [3 * USLOT]);
      pass.dispatchWorkgroups(Math.ceil(N2 / 64));
    }
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  // rozbieg: n dób (porcjami, z oddaniem sterowania przeglądarce)
  async spinup(days, onProgress) {
    const steps = Math.round(days * 86400 / DTQ);
    this.tRef = this.time + steps * DTQ;        // koniec rozbiegu = data startu symulacji
    this.doy = this.doyAt(this.time); this.buildForcing();
    this.spinning = true; this.writeUniforms();   // regulator długich fal: silny (uczy się wymuszenia)
    for (let s = 0; s < steps; s++) {
      this.step();
      if (s % 24 === 23) { await this.device.queue.onSubmittedWorkDone(); if (onProgress) onProgress((s + 1) / steps); }
    }
    this.spinning = false; this.writeUniforms();
    await this.device.queue.onSubmittedWorkDone();
  }

  // parametry sondażu dla domeny zagnieżdżonej → bufor vg domeny (przed tgt_build)
  encodeParams(pass) {
    if (!this.nest || !this.nodeCount) return;
    pass.setPipeline(this.sh.pipes.pe_params); pass.setBindGroup(0, this.bgs[this.p][3], [3 * USLOT]);
    pass.dispatchWorkgroups(Math.ceil(this.nodeCount / 64));
  }

  // odczyt wektora środka domeny (parametry, T, anomalia, opad, trajektoria) – asynchronicznie
  async readCenter() {
    const d = this.device;
    const rb = d.createBuffer({ size: 32 * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = d.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.sh.pipes.pe_center); pass.setBindGroup(0, this.bgs[this.p][3], [3 * USLOT]);
    pass.dispatchWorkgroups(1);
    pass.end();
    enc.copyBufferToBuffer(this.wk, (6 * N2 + 5 * N3 + 48 * N2) * 4, rb, 0, 32 * 4);
    d.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const a = new Float32Array(rb.getMappedRange()).slice();
    rb.unmap(); rb.destroy();
    this.center = decodeCenter(a, this);
    return this.center;
  }

  // pola 2D do mapy: ciśnienie, T przy gruncie, opad, T ~1.5 km
  async readMap() {
    const d = this.device;
    const rb = d.createBuffer({ size: 24 * N2 * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = d.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.sh.pipes.pe_map); pass.setBindGroup(0, this.bgs[this.p][3], [3 * USLOT]);
    pass.dispatchWorkgroups(Math.ceil(N2 / 64));
    pass.end();
    enc.copyBufferToBuffer(this.wk, 6 * N2 * 4, rb, 0, 24 * N2 * 4);
    d.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const a = new Float32Array(rb.getMappedRange()).slice();
    rb.unmap(); rb.destroy();
    const sl = (k) => a.subarray(k * N2, (k + 1) * N2);
    this.map = { psl: sl(0), ts: sl(1), pr: sl(2), t15: sl(3), t3: sl(4), t5: sl(5), u15: sl(6), v15: sl(7), u5: sl(8), v5: sl(9),
      z5: sl(10), prc: sl(11), olr: sl(12), asr: sl(13), cloud: sl(14), tsfc: sl(15),
      swSfc: sl(16), lwNet: sl(17), sh: sl(18), lh: sl(19), soil: sl(20), cape: sl(21), bmAct: sl(22), bmBlk: sl(23),
      hgt: this.hgt, time: this.time };
    return this.map;
  }

  // zaburzenie stanu: θ' ± amp [K] w każdym oczku (ziarno) – kopia z własną pogodą (po ~2 tygodniach niezależną)
  async perturb(seed, amp = 0.1) {
    const d = this.device, off = 2 * N3 * 4;
    const rb = d.createBuffer({ size: N3 * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = d.createCommandEncoder();
    enc.copyBufferToBuffer(this.S[this.p], off, rb, 0, N3 * 4);
    d.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const a = new Float32Array(rb.getMappedRange()).slice();
    rb.unmap(); rb.destroy();
    const r = rng(seed);
    for (let i = 0; i < N3; i++) a[i] += amp * (2 * r() - 1);
    d.queue.writeBuffer(this.S[this.p], off, a);
  }

  // kopia modelu (stan, historia, opad) – wspólne tablice wymuszeń
  clone() {
    const m = new PEModel(this.sh, { ...this, doyRef: this.doyRef, tRef: this.tRef, hour0: this.hour0 }, this);
    m.p = 0;
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.S[this.p], 0, m.S[0], 0, 5 * N3 * 4);
    enc.copyBufferToBuffer(this.wk, 0, m.wk, 0, this.wkLen * 4);
    enc.copyBufferToBuffer(this.dg, 0, m.dg, 0, (N3 + N2 * NW) * 4);
    this.device.queue.submit([enc.finish()]);
    m.time = this.time; m.hslot = this.hslot; m.nhist = this.nhist; m.center = this.center; m.map = this.map;
    m.writeUniforms();
    return m;
  }

  destroy() { for (const b of [...this.S, this.dg, this.wk, this.ub, this.vz]) b.destroy(); }
}

// wektor środka → obiekt jak airAt + diagnostyka
function decodeCenter(a, m) {
  const p = Array.from(a.slice(0, 13));
  const [ts, gam, ztr, zi, di, rhl, rhh, u0, v0, du, dv, w, psl] = p;
  return {
    pv: p,
    air: {
      // (sondaż bazowy ma jeden gradient do ~5.5 km – średnia z dolnego 1.5–3 i górnego 3–5.6 km)
      tsfc: ts - 273.15, lapse: (a[23] > 0 ? (1.5 * gam + 2.6 * a[23]) / 4.1 : gam) * 1000, lapse2: a[20] * 1000, ztrop: ztr / 1000, zinv: zi / 1000, dinv: di,
      rhLow: 100 * rhl, rhHigh: 100 * rhh, tnight: 2 + 6 * Math.min(1, Math.max(0, 1 - rhl)),
    },
    u0, v0, du, dv, w, psl, tDay: a[13], tAnom: a[14], ql: a[15], pr: a[16], sea: a[17], dY: a[18], dX: a[19], soil: a[21], rhMid: 100 * a[22],
    open: a[24], yMax: a[25], yMin: a[26], seaO: a[27],
    lat: m.lat,
  };
}

// Klasyfikacja masy powietrza nad środkiem jak w polskiej praktyce synoptycznej (Woś, Niedźwiedź): obszar źródłowy z trajektorii
// wstecznej 72 h (wiatr ~1.5 km) – szerokość początku, najdalej ku biegunowi po drodze, część drogi nad otwartą wodą (bez lodu);
// anomalia temperatury przy gruncie (względem normy strefowej modelu) jako potwierdzenie:
//   PAm / PAk – arktyczne (start ≥ ~68°): morskie – droga nad otwartym Morzem Norweskim i Barentsa (wilgotne, śnieżne),
//               kontynentalne – nad lodem i lądem (suche, mróz i słońce);
//   PPm – polarne morskie świeże (z W–NW, chłodne), PPmc – polarne morskie ciepłe (z W–SW, przetransformowane nad Atlantykiem;
//         zimą odwilż – wcześniej nazywane zwrotnikowym: PZ przy napływie z ~700 km na południe i anomalii +0.5 K);
//   PPk – polarne kontynentalne; PZm / PZk – zwrotnikowe (start ≤ ~40°, przy dużej anomalii ≤ ~45°); PR – równikowe
export function classifyCenter(c) {
  const a = Math.abs(c.lat), north = c.lat >= 0, humid = c.ql / qsat(273.15 + c.tDay - 6, 85000) > 0.55;
  const dY = north ? c.dY : -c.dY;                         // > 0: powietrze od bieguna
  const lat0 = a + dY / 111195;                            // szerokość początku trajektorii
  const latP = a + (north ? (c.yMax ?? 0) : -(c.yMin ?? 0)) / 111195;   // najdalej ku biegunowi po drodze
  const open = c.open ?? c.sea;
  // anomalia względem typowego stanu modelu synoptycznego (przy gruncie średnio ~1 K chłodniejszy od normy; Polska, rok,
  // z regulatorem średniej strefowej: mediana −0.6…−1.5 K, wcześniej −2.1 K) – progi mas jak dla prawdziwej anomalii
  const ta = c.tAnom + 1;
  // masa morska: start nad oceanem przy napływie z zachodu albo ≥ 25% drogi nad otwartą wodą (powietrze atlantyckie po 1–2 dobach
  // nad Europą Zachodnią to wciąż PPm – przy progu 35% drogi nad morzem było 43% PPk przy ~20–25% w klimatologii)
  const westerly = (north ? 1 : 1) * (c.dX ?? 0) < -500e3;
  const maritime = open >= 0.25 || ((c.seaO ?? 0) > 0.5 && westerly);
  let key;
  if (a < 23) key = humid ? 'PR' : 'PZk';
  else if ((lat0 >= 70 || latP >= 73) && ta < 2) key = open >= 0.3 ? 'PAm' : 'PAk';
  // zwrotnikowe tylko przy wyraźnym cieple (ta > 4 K, start 41–45°: > 6 K) – przy ta > 1 K powietrze atlantyckie spod ~40°N
  // było PZ w ~16% dni (klimatologia ~5–8%); słabiej ogrzane to PPmc
  else if ((lat0 <= 41 && ta > 4) || (lat0 <= 45 && ta > 6)) key = open >= 0.3 ? 'PZm' : 'PZk';
  else if (maritime) key = lat0 < a - 2 || ta > 2.5 ? 'PPmc' : 'PPm';
  else key = 'PPk';
  return { key, sea: open, dY, lat0, tAnom: c.tAnom };
}

// węzły siatki parametrów domeny zagnieżdżonej (jak paramGrid w nesting.js): 4 × (x, y, waga)
export function nestNodes(cfg) {
  const NGX = cfg.NX / cfg.GS, NGY = cfg.NY / cfg.GS;
  const sm = (x) => x * x * (3 - 2 * x);
  const axis = (X, NV) => (X <= NV ? [[X, 1]] : [[NV, 1 - sm((X - NV) / cfg.NE)], [0, sm((X - NV) / cfg.NE)]]);
  const nodes = new Float32Array(NGX * NGY * 12);
  for (let gy = 0; gy < NGY; gy++) {
    for (let gx = 0; gx < NGX; gx++) {
      let s = 0;
      const o = (gy * NGX + gx) * 12;
      for (const [xa, wx] of axis(gx * cfg.GS, cfg.NXV)) {
        for (const [ya, wy] of axis(gy * cfg.GS, cfg.NYV)) {
          nodes[o + 3 * s] = (xa - cfg.NXV / 2) * cfg.DX;
          nodes[o + 3 * s + 1] = (ya - cfg.NYV / 2) * cfg.DY;
          nodes[o + 3 * s + 2] = wx * wy;
          s++;
        }
      }
    }
  }
  return { nodes, nodeCount: NGX * NGY };
}
