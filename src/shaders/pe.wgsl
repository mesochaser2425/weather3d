// Model synoptyczny „rodzic”: równania pierwotne (hydrostatyczne, anelastyczne) na siatce C,
// kanał okresowy w kierunku W–E, ściany na N i S. Poziomy z (12 warstw do 16 km), sztywna pokrywa.
// Krok: promieniowanie (krótko- i długofalowe, bilans energii lądu), Runge–Kutta 3 (Wicker–Skamarock), po każdym
// etapie rzut barotropowy (∇·∫ρ0 u dz = 0 – równanie Poissona: DFT w x, Thomas w y; z górami ∇·(A∇χ) – iteracyjnie).
// Po kroku: kondensacja z opadem, przystosowanie konwekcyjne (suche i wilgotne), hiperlepkość ∇⁴.
// Góry: oczka przycięte do terenu (jak w domenie) – ściany otwarte tylko nad gruntem, najniższa warstwa nad gruntem (kb)
// jest warstwą przy powierzchni (strumienie, tarcie, fizyka kolumny); oczka w gruncie wypełnione wartością z kb (θ' i q stałe
// w dół – „sprowadzenie do poziomu morza” dla domeny i map), bez wpływu na powietrze nad nimi.
// Stałe wstrzykiwane z JS: NXP, NYP, NZP, N2, N3, DXP, NW (= NZP + 1).
// Indeks: (k·NYP + j)·NXP + i; i – wschód (okresowo), j – północ (ściany przy j = 0 i NYP).
// Stan: u (ściana zachodnia komórki), v (ściana południowa), θ' (od profilu odniesienia θ0(z)), q.

struct PP {
  dts: f32,        // krok etapu RK [s]
  dt: f32,         // pełny krok [s]
  stage: u32,      // 0, 1, 2
  nu4: f32,        // hiperlepkość [m⁴/s]
  halfDiur: f32,   // połowa amplitudy dobowej (do temperatury „popołudniowej” sondażu)
  summer: f32,
  nodeCount: u32,  // liczba węzłów siatki parametrów domeny zagnieżdżonej
  pgOff: u32,      // przesunięcie siatki parametrów w buforze vg domeny
  hslot: u32,      // slot historii wiatru (trajektorie wsteczne)
  nhist: u32,      // liczba zapełnionych slotów
  cx: f32,         // środek domeny zagnieżdżonej w kanale [m]
  cy: f32,
  shour: f32,      // godzina słoneczna w środku kanału (domena)
  sdec: f32,       // sin i cos deklinacji słońca
  cdec: f32,
  s0: f32,         // stała słoneczna × poprawka odległości Ziemia–Słońce [W/m²]
  wvP: f32,        // regulator długich fal (pe.js): część proporcjonalna [1/s] (w rozbiegu silna, potem słaba)
  wvI: f32,        // … część całkująca [1/s²]
  wvOn: f32,       // … 1 – włączony (kanał na pełne koło szerokości)
  wvE: f32,        // … 1 – część proporcjonalna z błędu wygładzonego w czasie (po rozbiegu), 0 – z chwilowego (rozbieg)
  wvF: f32,        // … tempo wygładzania błędu [1/s]
  wvX1: f32,
  wvX2: f32,
  wvX3: f32,
}

@group(0) @binding(0) var<uniform> P: PP;
@group(0) @binding(1) var<storage, read> vz: array<f32>;          // profile i tablice wymuszeń
@group(0) @binding(2) var<storage, read> sIn: array<f32>;         // stan etapu (sąsiedzi)
@group(0) @binding(3) var<storage, read> sBase: array<f32>;       // stan na początku kroku
@group(0) @binding(4) var<storage, read_write> sOut: array<f32>;  // wynik etapu
@group(0) @binding(5) var<storage, read_write> dg: array<f32>;    // φ (N3) | w (N2·NW)
@group(0) @binding(6) var<storage, read_write> wk: array<f32>;    // robocze: rzut, opad, historia, środek
@group(0) @binding(7) var<storage, read_write> nest: array<f32>;  // bufor vg domeny zagnieżdżonej

const G: f32 = 9.81;
const CP: f32 = 1004.0;
const LV: f32 = 2.5e6;
const RV: f32 = 461.5;
const PI2: f32 = 6.283185307;
const TCOND: f32 = 1800.0;     // skala czasowa kondensacji wielkoskalowej [s]

// --- tablice w vz ---
// pionowe (NZP lub NW): zc, zw, dz, rc, rw, th0, pi0, p0, dth0
const VZ_ZC: u32 = 0u;
const VZ_ZW: u32 = NZP;
const VZ_DZ: u32 = VZ_ZW + NW;
const VZ_RC: u32 = VZ_DZ + NZP;
const VZ_RW: u32 = VZ_RC + NZP;
const VZ_TH0: u32 = VZ_RW + NW;
const VZ_PI0: u32 = VZ_TH0 + NZP;
const VZ_P0: u32 = VZ_PI0 + NZP;
const VZ_DTH0: u32 = VZ_P0 + NZP;
const VZ_KV: u32 = VZ_DTH0 + NZP;             // współczynnik dyfuzji pionowej na ścianach (NW)
const VZ_CO2: u32 = VZ_KV + NW;               // grubość optyczna CO₂ warstwy (pasmo nieprzezroczyste, NZP)
// w kierunku y (NYP): f w środkach, f na ścianach v, norma temperatury przy gruncie [K]
const VZ_F: u32 = VZ_CO2 + NZP;
const VZ_FV: u32 = VZ_F + NYP;
const VZ_TN: u32 = VZ_FV + NYP;
// θ' profilu początkowego (NYP·NZP), temperatura klimatyczna podłoża [K] (N2: morze – SST, ląd – głębsza gleba),
// morze 0/1 (N2), twiddle cos/sin (NXP)
const VZ_TEQ: u32 = VZ_TN + NYP;
const VZ_TS: u32 = VZ_TEQ + NYP * NZP;
const VZ_SEA: u32 = VZ_TS + N2;
const VZ_COS: u32 = VZ_SEA + N2;
const VZ_SIN: u32 = VZ_COS + NXP;
const VZ_BETA: u32 = VZ_SIN + NXP;            // wydajność parowania podłoża (N2)
const VZ_SLAT: u32 = VZ_BETA + N2;            // sin i cos szerokości pasa (NYP)
const VZ_CLAT: u32 = VZ_SLAT + NYP;
const VZ_ALB: u32 = VZ_CLAT + NYP;            // albedo podłoża bez śniegu i lodu (N2)
const VZ_TDEEP: u32 = VZ_ALB + N2;            // temperatura głębszej gleby (~1 m, z opóźnieniem sezonowym) [K] (N2)
const VZ_QEQ: u32 = VZ_TDEEP + N2;            // wilgotność profilu klimatycznego (NYP·NZP)
const VZ_BW: u32 = VZ_QEQ + NYP * NZP;        // 1/τ strefy brzegowej przy ścianach N i S (NYP)
const VZ_ARC: u32 = VZ_BW + NYP;              // rdzeń arktyczny: odchylenie temperatury celu strefy przy ścianie N [K] (NXP)
const VZ_ARQ: u32 = VZ_ARC + NXP;             // … i mnożnik wilgotności (NXP)
const VZ_HGT: u32 = VZ_ARQ + NXP;             // wysokość terenu oczka [m] (N2)
const VZ_AU: u32 = VZ_HGT + N2;               // masa słupa nad gruntem otwarta na ścianie zachodniej oczka [kg/m²] (N2, rzut)
const VZ_AV: u32 = VZ_AU + N2;                // … na ścianie południowej (N2)
const VZ_AC: u32 = VZ_AV + N2;                // M / masa słupa nad gruntem oczka – napięcie wstępne rzutu Δ⁻¹(r/A) (N2)
const VZ_MB: u32 = VZ_AC + N2;                // rzut: [0] M̄/M, [1] 1 – start od ciśnienia poprzedniego etapu (góry) (4)
const VZ_ZCT: u32 = VZ_MB + 4u;               // cel średniej strefowej θ' – klimatologia NCEP 1991–2020 (NYP·NZP, jak TEQ)
const VZ_UCT: u32 = VZ_ZCT + NYP * NZP;       // cel średniej strefowej wiatru zachodniego u – klimatologia NCEP (NYP·NZP)
// cel regulatora długich fal – klimatologia NCEP (zonwave.js, pe.js): na pas i poziom współczynniki cos/sin fal 1…WVM w układzie
// kanału (φ = 2π·x/LXP) dla θ', u i v (6·WVM)
const VZ_WVT: u32 = VZ_UCT + NYP * NZP;
const VZ_SMC: u32 = VZ_WVT + 6u * WVM * NYP * NZP;     // klimatologia wody w glebie lądu (wypełnienie wiadra, NCEP 1991–2020) (N2)
const VZ_NODES: u32 = VZ_SMC + N2;                    // węzły siatki parametrów: 4 × (x, y, waga) na węzeł

// --- obszary wk ---
const WK_D: u32 = 0u;                         // dywergencja transportu barotropowego (N2)
const WK_HR: u32 = N2;                        // DFT: część rzeczywista (N2)
const WK_HI: u32 = 2u * N2;                   // … urojona
const WK_CHI: u32 = 3u * N2;                  // potencjał poprawki χ (N2)
const WK_PS: u32 = 4u * N2;                   // φ przy gruncie = χ/Δt ostatniego etapu (N2)
const WK_PR: u32 = 5u * N2;                   // opad [kg/m²/s] (N2)
const WK_LAP: u32 = 6u * N2;                  // laplasjan stanu (4·N3)
const WK_HIST: u32 = WK_LAP + 5u * N3;        // historia wiatru ~1.5 km: 24 sloty × 2 × N2
const WK_CEN: u32 = WK_HIST + 48u * N2;       // wektor środka domeny (32)
const WK_PRC: u32 = WK_CEN + 32u;             // opad konwekcyjny [kg/m²/s] (N2)
const WK_TL: u32 = WK_PRC + N2;               // temperatura powierzchni lądu (i lodu morskiego) [K] (N2)
const WK_QR: u32 = WK_TL + N2;                // grzanie radiacyjne jako dθ/dt [K/s] (N3)
const WK_RD: u32 = WK_QR + N3;                // diagnostyka: OLR, SW pochłonięte, zachmurzenie, bilans powierzchni,
                                              // SW przy gruncie, LW netto, ciepło jawne, utajone (8·N2)
const WK_KP: u32 = WK_RD + 8u * N2;           // współczynnik mieszania warstwy granicznej na ścianach warstw (NW·N2)
const WK_TM: u32 = WK_KP + NW * N2;           // temperatura warstwy dobowej gleby / lodu [K] (N2)
const WK_D24: u32 = WK_TM + N2;               // średnie dobowe (kroczące, τ = 1 doba): θ' warstw 0 i 1, q warstwy 0, θ' i q warstwy 2 (5·N2)
const WK_SM: u32 = WK_D24 + 5u * N2;           // woda w glebie lądu (wiadro Manabe, 0…1 z 150 mm) (N2)
const WK_ZM: u32 = WK_SM + N2;                // średnia strefowa θ' na poziomach (NYP·NZP) – dyfuzja południkowa ciepła
const WK_B: u32 = WK_ZM + NYP * NZP;          // rzut: dywergencja transportu (prawa strona) (N2)
const WK_CHIT: u32 = WK_B + N2;               // … potencjał χ – suma iteracji (N2)
const WK_PB: u32 = WK_CHIT + N2;              // … ciśnienie barotropowe χ/Δt ostatniego etapu – start iteracji (N2)
const WK_PM: u32 = WK_PB + N2;                // średnia po kanale części hydrostatycznej φ przy z = 0 (pe_pmean) (4)
const WK_ZH: u32 = WK_PM + 4u;                // regulator średniej strefowej: część całkująca – brakujące ogrzewanie [K/s] (NYP·NZP)
const WK_ZMU: u32 = WK_ZH + NYP * NZP;        // średnia strefowa u na poziomach (NYP·NZP)
const WK_ZHU: u32 = WK_ZMU + NYP * NZP;       // … część całkująca regulatora wiatru [m/s²] (NYP·NZP)
const WK_WI: u32 = WK_ZHU + NYP * NZP;        // regulator długich fal: część całkująca – współczynniki fal (6·WVM·NYP·NZP)
const WK_WF: u32 = WK_WI + 6u * WVM * NYP * NZP;   // … wymuszenie (część proporcjonalna + całkująca) dla pe_stage
const WK_WE: u32 = WK_WF + 6u * WVM * NYP * NZP;   // … błąd wygładzony w czasie (średnia krocząca)
const WK_BMD: u32 = WK_WE + 6u * WVM * NYP * NZP;  // diagnostyka konwekcji Bettsa–Millera: CAPE cząstki, opad, blokada przez suchą chmurę (3·N2)
const WCAP_PE: f32 = 150.0;
// próg CAPE konwekcji Bettsa–Millera: 50 J/kg (było 400 – latem prawie nie działała, ~2% opadu konwekcyjnego, dolna troposfera
// bez ogrzewania przez kondensację: T850 o 3–4 K za zimna; teraz ~18% opadu, T850 nad Krakowem ~10 °C)
const BM_CAPE: f32 = 50.0;
// grubość optyczna chmur w promieniowaniu: warstwa wodna 1.5, lodowa 0.5, słup ≤ 15 (R ≤ 0.6). Wcześniej 2.5 / 0.7 / 25
// (R do 0.71): lipiec 50°N pochłaniał ~250 W/m² słońca zamiast ~290–300 (CERES) – albedo planety 0.47 zamiast ~0.36,
// lato o 2–3 K za zimne (teraz środek kanału: średnia dobowa 18.7–19.6, T850 9.6–11.2 °C)
const CTAU_W: f32 = 1.5;
const CTAU_MAX: f32 = 15.0;
// strefa brzegowa przy ścianie N (~82°N) dla θ i q 10× słabsza niż S (τ 10 dób): profil klimatyczny Arktyki z formuły
// jest zimą ~−38 °C przy gruncie, a model ~−16 – przyciąganie z τ 1 doby działało jak ogromny upust ciepła (~1000 W/m²
// w pasie przy ścianie) i ochładzało cały kanał (zima 50°N −9 zamiast ~−1 °C; teraz −3.4)
// XPS – siła strefy przy ścianie S (×2 ochładzało środek kanału o ~1.5 K, ×0.5 bez zmian); XPN – τ ~3 doby przy ścianie N
// (cel: profil arktyczny z AFGL – patrz pe.js); obie stałe wstrzykiwane z pe.js (header)

fn ix(i: i32, j: i32, k: i32) -> u32 {
  let ii = u32(((i % i32(NXP)) + i32(NXP)) % i32(NXP));
  let jj = u32(clamp(j, 0, i32(NYP) - 1));
  let kk = u32(clamp(k, 0, i32(NZP) - 1));
  return (kk * NYP + jj) * NXP + ii;
}
fn c2(i: i32, j: i32) -> u32 {
  return u32(clamp(j, 0, i32(NYP) - 1)) * NXP + u32(((i % i32(NXP)) + i32(NXP)) % i32(NXP));
}
// pola stanu etapu z warunkami brzegowymi: u, θ', q – zerowy gradient przy ścianach; v – zero na
// ścianach (j = 0 i j = NYP), za ścianą antysymetrycznie
fn su(i: i32, j: i32, k: i32) -> f32 { return sIn[ix(i, j, k)]; }
fn sv(i: i32, j: i32, k: i32) -> f32 {
  if (j <= 0) { return select(0.0, -sIn[N3 + ix(i, -j, k)], j < 0); }
  if (j >= i32(NYP)) { return select(0.0, -sIn[N3 + ix(i, 2 * i32(NYP) - j, k)], j > i32(NYP)); }
  return sIn[N3 + ix(i, j, k)];
}
fn st(i: i32, j: i32, k: i32) -> f32 { return sIn[2u * N3 + ix(i, j, k)]; }
fn sq(i: i32, j: i32, k: i32) -> f32 { return sIn[3u * N3 + ix(i, j, k)]; }
fn sqc(i: i32, j: i32, k: i32) -> f32 { return sIn[4u * N3 + ix(i, j, k)]; }   // woda chmurowa
fn phi(i: i32, j: i32, k: i32) -> f32 { return dg[ix(i, j, k)]; }
fn ww(i: i32, j: i32, kw: i32) -> f32 {
  return dg[N3 + u32(clamp(kw, 0, i32(NZP))) * N2 + c2(i, j)];
}
// teren: wysokość gruntu oczka, część warstwy k nad gruntem, najniższa warstwa nad gruntem
fn hgt(c: u32) -> f32 { return vz[VZ_HGT + c]; }
fn fracZ(h: f32, k: u32) -> f32 { return clamp((vz[VZ_ZW + k + 1u] - h) / vz[VZ_DZ + k], 0.0, 1.0); }
fn kbot(h: f32) -> u32 {
  var kb = 0u;
  for (var k = 0u; k + 1u < NZP; k++) { if (vz[VZ_ZW + k + 1u] <= h) { kb = k + 1u; } }
  return kb;
}
// ściana u (zachodnia oczka i, j) i v (południowa) – otwarta nad wyższym z dwóch gruntów
fn hU(i: i32, j: i32) -> f32 { return max(hgt(c2(i, j)), hgt(c2(i - 1, j))); }
fn hV(i: i32, j: i32) -> f32 { return max(hgt(c2(i, j)), hgt(c2(i, j - 1))); }
fn opn(i: i32, j: i32, k: i32) -> bool { return vz[VZ_ZW + u32(k) + 1u] > hgt(c2(i, j)); }
// szablon adwekcji (m2, m1, p1, p2) pola f wzdłuż (di, dj) z maską gruntu: oczko w gruncie dostaje wartość sąsiada bliżej
// środka (brak przepływu przez zbocze – zerowy gradient), dalsze za nim tak samo
fn sten(f: u32, i: i32, j: i32, k: i32, di: i32, dj: i32, c0: f32) -> array<f32, 4> {
  let m1o = opn(i - di, j - dj, k);
  let p1o = opn(i + di, j + dj, k);
  let m1 = select(c0, sIn[f * N3 + ix(i - di, j - dj, k)], m1o);
  let p1 = select(c0, sIn[f * N3 + ix(i + di, j + dj, k)], p1o);
  let m2 = select(m1, sIn[f * N3 + ix(i - 2 * di, j - 2 * dj, k)], m1o && opn(i - 2 * di, j - 2 * dj, k));
  let p2 = select(p1, sIn[f * N3 + ix(i + 2 * di, j + 2 * dj, k)], p1o && opn(i + 2 * di, j + 2 * dj, k));
  return array<f32, 4>(m2, m1, p1, p2);
}

fn qsat(t: f32, p: f32) -> f32 {
  let es = 610.78 * exp(17.27 * (t - 273.16) / (t - 35.86));
  return 0.622 * es / max(p - es, 1.0);
}
// nasycenie dla kondensacji, chmur i parowania opadu: nad wodą powyżej 0 °C, nad lodem poniżej −40 °C, płynnie
// pomiędzy (jak w modelach klimatu). Wcześniej tylko nad wodą: górna troposfera i stratosfera zostawały przesycone
// względem lodu (14 km: RH 74% wzgl. wody ≈ 130% wzgl. lodu, ~6× za dużo pary) – brak „wymrażania” przy tropopauzie
fn qsatM(t: f32, p: f32) -> f32 {
  let ew = 610.78 * exp(17.27 * (t - 273.16) / (t - 35.86));
  let ei = 611.2 * exp(21.875 * (t - 273.16) / (t - 7.66));
  let es = mix(ei, ew, clamp((t - 233.15) / 40.0, 0.0, 1.0));
  return 0.622 * es / max(p - es, 1.0);
}

// pochodna z różnicami pod wiatr 3. rzędu
fn d3(m2: f32, m1: f32, c0: f32, p1: f32, p2: f32, vel: f32, h: f32) -> f32 {
  if (vel >= 0.0) { return (m2 - 6.0 * m1 + 3.0 * c0 + 2.0 * p1) / (6.0 * h); }
  return -(p2 - 6.0 * p1 + 3.0 * c0 + 2.0 * m1) / (6.0 * h);
}
// pochodna pionowa centralna (nieregularna siatka), przy dnie (warstwa kb nad gruntem) i u góry jednostronna
fn dzc(m: f32, c0: f32, p: f32, k: i32, kb: i32) -> f32 {
  let km = max(k - 1, kb);
  let kp = min(k + 1, i32(NZP) - 1);
  let a = select(m, c0, k == kb);
  let b = select(p, c0, k == i32(NZP) - 1);
  return (b - a) / max(vz[VZ_ZC + u32(kp)] - vz[VZ_ZC + u32(km)], 1.0);
}
// dyfuzja pionowa (postać strumieniowa, zerowy strumień na dole i u góry)
// K na ścianie kw kolumny c: tło (vz) albo warstwa graniczna (pe_rad), większe z nich
// jawnie (w etapach RK) tylko tło; mieszanie warstwy granicznej (K-profil, do 150 m²/s) – niejawnie w pe_column
// (jawne przy Δt = 450 s było niestabilne: zimą wiatr przy ścianie kanału rósł skokowo do NaN po ~4–6 tygodniach)
// (tło 2 + 30·exp(−z/700) m²/s, z nad gruntem – jak tablica VZ_KV dla płaskiego kanału)
fn kvAt(c: u32, kw: u32) -> f32 { return 2.0 + KVB * exp(-max(vz[VZ_ZW + kw] - hgt(c), 0.0) / 700.0); }
fn kpbl(c: u32, kw: u32) -> f32 { return max(wk[WK_KP + kw * N2 + c] - kvAt(c, kw), 0.0); }
// niejawna dyfuzja pionowa w kolumnie: x − Δt/dz_k·[K_{k+1}(x_{k+1} − x_k)/dzc_{k+1} − K_k(x_k − x_{k−1})/dzc_k] = x_stare
// (algorytm Thomasa; kw – współczynniki na ścianach warstw, kw[0] = kw[NZP] = 0, w górach zero na ścianach ≤ kb;
// warstwa kb ma grubość fb·dz – część nad gruntem)
fn implDiff(x: ptr<function, array<f32, NZP>>, kw: ptr<function, array<f32, NW>>, dt: f32, kb: u32, fb: f32) {
  var cp: array<f32, NZP>;
  var dp: array<f32, NZP>;
  for (var k = 0u; k < NZP; k++) {
    let dz = vz[VZ_DZ + k] * select(1.0, fb, k == kb);
    let a = select(0.0, -dt * (*kw)[k] / (dz * (vz[VZ_ZC + k] - vz[VZ_ZC + k - 1u])), k > 0u);
    let cc = select(0.0, -dt * (*kw)[k + 1u] / (dz * (vz[VZ_ZC + k + 1u] - vz[VZ_ZC + k])), k + 1u < NZP);
    let b = 1.0 - a - cc;
    if (k == 0u) { cp[k] = cc / b; dp[k] = (*x)[k] / b; }
    else {
      let den = b - a * cp[k - 1u];
      cp[k] = cc / den;
      dp[k] = ((*x)[k] - a * dp[k - 1u]) / den;
    }
  }
  (*x)[NZP - 1u] = dp[NZP - 1u];
  for (var kk = i32(NZP) - 2; kk >= 0; kk--) { let k = u32(kk); (*x)[k] = dp[k] - cp[k] * (*x)[k + 1u]; }
}
// (kb – warstwa przy gruncie: bez strumienia przez dno, grubość części nad gruntem fb·dz)
fn vdiff(m: f32, c0: f32, p: f32, k: i32, c: u32, kb: i32, fb: f32) -> f32 {
  let ku = u32(k);
  var fu = 0.0;
  var fd = 0.0;
  if (k < i32(NZP) - 1) { fu = kvAt(c, ku + 1u) * (p - c0) / (vz[VZ_ZC + ku + 1u] - vz[VZ_ZC + ku]); }
  if (k > kb) { fd = kvAt(c, ku) * (c0 - m) / (vz[VZ_ZC + ku] - vz[VZ_ZC + ku - 1u]); }
  return (fu - fd) / (vz[VZ_DZ + ku] * select(1.0, fb, k == kb));
}

// ---------------- promieniowanie i bilans energii powierzchni (raz na krok, stan z początku kroku) ----------------
// Kolumna: zachmurzenie z wilgotności (Sundqvist, RHc 80%), krótkofalowe (nasłonecznienie dobowe, pochłanianie przez
// parę – Lacis–Hansen, ozon 2.5% w górnej warstwie, rozpraszanie Rayleigha i aerozol, odbicie od chmur i podłoża
// z wielokrotnymi odbiciami), długofalowe dwustrumieniowe w dwóch pasmach (nieprzezroczyste: para τ ∝ u^0.45
// i CO₂; okno 8–12 µm: kontinuum pary ∝ e·u), chmury jako ciało szare o pokryciu cf. Słońce chwilowe (cykl
// dobowy: godzina słoneczna rośnie o 24 h na długość kanału – okresowo). Ląd i lód morski: gleba dwuwarstwowa
// (force-restore): powierzchnia ~0.1 m (cykl dobowy) i warstwa ~0.8 m (zmiany z dnia na dzień) przewodząca do
// głębszej gleby (średnia roczna z amplitudą 0.5 i opóźnieniem ~1.5 miesiąca); morze: SST z klimatologii.
// Średnie dobowe są pamiętane osobno – domena dostaje temperaturę i wilgotność dobową, cykl dobowy liczy sama.
const SIGMA: f32 = 5.67e-8;
const LW_KWV: f32 = 0.599;     // para wodna, pasmo nieprzezroczyste: τ = k·u^n (u [kg/m²] od góry)
const LW_NWV: f32 = 0.444;
const LW_KCONT: f32 = 0.0120;  // kontinuum w oknie: dτ = k·u·e[kPa]
const LW_KW0: f32 = 0.03;      // okno: pozostałe gazy (cała kolumna)
const RHC: f32 = 0.9;          // krytyczna wilgotność zachmurzenia (oczko 75 km)
const C_SKIN: f32 = 3.0e5;     // pojemność cieplna warstwy powierzchniowej gleby (~0.1 m) [J/m²K]
const K_SKIN: f32 = 20.0;      // przewodzenie powierzchnia ↔ warstwa dobowa (force-restore: 2π/doba · C_SKIN) [W/m²K]
const C_MID: f32 = 2.0e6;      // pojemność warstwy dobowej (~0.8 m) [J/m²K]
const K_DEEP: f32 = 3.0;       // przewodzenie do głębszej gleby [W/m²K]
fn fwin(t: f32) -> f32 { return clamp(0.184 + 0.002 * (t - 288.0), 0.1, 0.4); }
fn planck(t: f32, b: u32) -> f32 { return select(fwin(t), 1.0 - fwin(t), b == 0u) * SIGMA * t * t * t * t; }
// źródło liniowe w grubości optycznej (temperatura zmienia się w warstwie): część emisji zależna od różnicy B
fn linTau(tr: f32) -> f32 {
  let ta = max(-log(max(tr, 1e-12)), 1e-6);
  return select((1.0 - tr * (1.0 + ta)) / ta, 0.5 * ta, ta < 1e-3);
}
fn lhA(u: f32) -> f32 { return 2.9 * u / (pow(1.0 + 141.5 * u, 0.635) + 5.925 * u); }   // Lacis–Hansen, u [cm]
// czy kolumna ma powierzchnię z bilansem energii (ląd albo morze zamarznięte)
fn landLike(c: u32) -> bool { return vz[VZ_SEA + c] < 0.5 || vz[VZ_TS + c] < 271.5; }
fn tSurf(c: u32) -> f32 { return select(vz[VZ_TS + c], wk[WK_TL + c], landLike(c)); }
// wydajność parowania: morze 1, lód morski 0.5, ląd z wilgotności gleby (Manabe 1969: β = W/0.75, pełne przy 75%) –
// wcześniej stała 0.15 + 0.4·hum dla całego lądu kanału (pustynie parowały jak pola, gleba nie wysychała latem)
// oraz minimalny opór szparkowy roślin r_s = 70 s/m szeregowo z oporem aerodynamicznym r_a = 1/(C_E·U) (Penman–Monteith):
// nawet wilgotny ląd paruje ~0.5–0.6 potencjalnego (bez tego Bowen ~0.28 zamiast obserwowanych 0.5–0.7 latem)
fn betaS(c: u32, spd: f32, ch: f32) -> f32 {
  if (vz[VZ_SEA + c] >= 0.5) { return select(1.0, 0.5, vz[VZ_TS + c] < 271.5); }
  let ra = 1.0 / (ch * spd);
  return clamp(wk[WK_SM + c] / 0.75, 0.03, 1.0) * ra / (ra + 40.0);
}
// Współczynnik wymiany ciepła i pary z podłożem dla wiatru i temperatury 1. poziomu modelu (~200 m): prawo logarytmiczne
// z szorstkością (morze 0.2 mm, lód 1 mm, ląd 0.3 m; dla ciepła z0/10) i poprawka na stateczność Louisa (1979) –
// jak w domenie. Wcześniej stałe 1.2e-3 (ciepło) i 1.6e-3 (para) – wartości dla wiatru na 10 m, a model bierze wiatr
// z ~200 m (o 30–40% silniejszy): nad gładkim morzem parowanie ~2× za duże (zimą 10 mm/dobę i 150–200 W/m² ciepła
// jawnego średnio przez miesiąc – stały „wylew zimnego powietrza”, opad nad oceanem 6–9 mm/dobę); nad szorstkim lądem
// wymiana za słaba; brak wzmocnienia przy chwiejności i osłabienia nocą.
// z1 – środek warstwy przy gruncie nad gruntem [m], pis – Exner przy gruncie
fn chExch(c: u32, spd: f32, thAir: f32, ts: f32, z1: f32, pis: f32) -> f32 {
  let open = vz[VZ_SEA + c] >= 0.5 && vz[VZ_TS + c] >= 271.5;
  let z0 = select(select(0.3, 1e-3, vz[VZ_SEA + c] >= 0.5), 2e-4, open);
  let lz = log(z1 / z0);
  let cn = 0.16 / (lz * log(z1 / (0.1 * z0)));
  let rib = clamp(G * z1 * (thAir - ts / pis) / (thAir * spd * spd), -10.0, 10.0);
  var fh = 1.0 / (1.0 + 10.0 * rib);
  if (rib < 0.0) { fh = 1.0 - 15.0 * rib / (1.0 + 75.0 * cn * sqrt(z1 / z0 * (-rib))); }
  return max(cn * fh, 2e-4);
}

@compute @workgroup_size(64)
fn pe_rad(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x;
  if (c >= N2) { return; }
  let i = i32(c % NXP);
  let j = i32(c / NXP);
  var T: array<f32, NZP>;
  var qv: array<f32, NZP>;
  var m: array<f32, NZP>;
  var cf: array<f32, NZP>;
  var liq: array<f32, NZP>;
  var hr: array<f32, NZP>;
  var uT: array<f32, NW>;        // ścieżka pary od góry [kg/m²] (na ścianach warstw)
  // góry: kolumna od warstwy kb (część nad gruntem), pod nią nic (masa 0, bez chmur, przezroczyste)
  let hc = hgt(c);
  let kb = kbot(hc);
  for (var k = 0u; k < NZP; k++) {
    T[k] = (vz[VZ_TH0 + k] + st(i, j, i32(k))) * vz[VZ_PI0 + k];
    qv[k] = max(sq(i, j, i32(k)), 0.0);
    m[k] = vz[VZ_RC + k] * vz[VZ_DZ + k] * fracZ(hc, k);
    let rh = qv[k] / qsatM(T[k], vz[VZ_P0 + k]);
    // zachmurzenie oczka 75 km: z wilgotności (Sundqvist) najwyżej 85%, pełne dopiero przy grubej chmurze (woda chmurowa
    // ≥ ~0.2 g/kg) – nasycone oczko z cienką chmurą ma przerwy (wcześniej każde nasycone oczko = 100%, zima ~0.97)
    let qck = sIn[4u * N3 + ix(i, j, i32(k))];
    cf[k] = select(min(1.0 - sqrt(clamp((1.0 - rh) / (1.0 - RHC), 0.0, 1.0)), 0.85 + 0.15 * smoothstep(0.0, 2e-4, qck)), 0.0, T[k] < 195.0 || k < kb);
    liq[k] = smoothstep(233.0, 258.0, T[k]);
  }
  uT[NZP] = 0.0;
  for (var kk = i32(NZP) - 1; kk >= 0; kk--) { let k = u32(kk); uT[k] = uT[k + 1u] + qv[k] * m[k]; }
  let land = landLike(c);
  let tsc = vz[VZ_TS + c];
  let ts = tSurf(c);
  let sea = vz[VZ_SEA + c] >= 0.5;
  // albedo: śnieg na lądzie wg temperatury klimatycznej sezonu (las częściowo zasłania), lód morski 0.55
  let snow = clamp((271.65 - tsc) / 5.0, 0.0, 1.0);
  let alb = select(mix(vz[VZ_ALB + c], 0.5, snow), select(0.07, 0.55, tsc < 271.5), sea);

  // --- krótkofalowe: położenie słońca (godzina słoneczna rośnie o 24 h na długość kanału) ---
  let hloc = P.shour + 24.0 * (f32(i) + 0.5 - 0.5 * f32(NXP)) / f32(NXP);
  let cz = vz[VZ_SLAT + u32(j)] * P.sdec + vz[VZ_CLAT + u32(j)] * P.cdec * cos((hloc - 12.0) * 0.2617994);
  let S = P.s0 * max(cz, 0.0);
  let mu = max(cz, 0.05);
  let mag = 35.0 / sqrt(1224.0 * mu * mu + 1.0);
  let o3 = 0.025 * S;
  // chmury: pokrycie słupa przy nakładaniu maksymalno-losowym (sąsiednie warstwy jedna nad drugą), grubość
  // optyczna warstwy chmurowej: woda 2.5, lód 0.7 (ISCCP: chmury typowo 3–10 w słupie), słup ≤ 25; odbicie słupa R = τ/(τ + 10)
  // rozdzielone na warstwy wg ich udziału w τ (miejsce odbicia – dla pochłaniania przez parę nad chmurą)
  var clr = 1.0 - cf[0];
  var tsum = cf[0] * mix(0.5, CTAU_W, liq[0]);
  for (var k = 1u; k < NZP; k++) {
    clr *= (1.0 - max(cf[k], cf[k - 1u])) / max(1.0 - cf[k - 1u], 1e-3);
    tsum += cf[k] * mix(0.5, CTAU_W, liq[k]);
  }
  let ctot = clamp(1.0 - clr, 0.0, 1.0);
  let tauIn = min(tsum / max(ctot, 0.02), CTAU_MAX);
  let rcol = ctot * tauIn / (tauIn + 10.0);
  var cur = S * (1.0 - 0.07 - 0.05 * (1.0 - mu)) - o3;
  var u = 0.0;
  for (var kk = i32(NZP) - 1; kk >= 0; kk--) {
    let k = u32(kk);
    let un = u + mag * qv[k] * m[k] * 0.1;
    let a = cur * (lhA(un) - lhA(u)) / max(1.0 - lhA(u), 0.5);
    cur -= a;
    hr[k] = a;
    let wt = cf[k] * mix(0.5, CTAU_W, liq[k]) / max(tsum, 1e-6);
    let rc = rcol * wt;
    let ac = 0.05 * ctot * wt;
    hr[k] += S * ac;
    cur = max(cur - S * (rc + ac), 0.0);
    u = un;
  }
  let trc = 1.0 - rcol;
  // ozon pochłania ~2.5% słońca głównie na 20–50 km, nad sztywną pokrywą modelu (16 km): słońce przy gruncie jest
  // o to mniejsze, ale górną warstwę grzeje tylko ~10% (ozon poniżej 16 km); całe 2.5% w jednej warstwie, która
  // słabo wypromieniowuje w podczerwieni, dawało w tropikach stratosferę +30…+50 K i po ~4 tygodniach NaN
  // udział górnej warstwy (12.5–16 km) w stratosferze: tropopauza ~ 11.2 km + 110 m/K·(T przy gruncie − 10 °C)
  // (tropiki ~16 km – warstwa troposferyczna, zimna; umiarkowane ~10–11 km – stratosfera ogrzewana przez ozon)
  let ztrc = clamp(11200.0 + 110.0 * (T[kb] + 0.0065 * (vz[VZ_ZC + kb] - vz[VZ_ZC]) - 283.15), 8500.0, 16500.0);
  let fstr = smoothstep(ztrc, ztrc + 3000.0, vz[VZ_ZC + NZP - 1u]);
  hr[NZP - 1u] += (0.1 + 0.3 * fstr) * o3;
  var swAtm = 0.0;
  for (var k = 0u; k < NZP; k++) { swAtm += hr[k]; }
  let swDn = cur / (1.0 - alb * (1.0 - trc));
  let swSfc = swDn * (1.0 - alb);

  // --- długofalowe (dwa pasma) ---
  var fu: array<f32, NW>;
  var fd: array<f32, NW>;
  var olr = 0.0;
  var lwDn = 0.0;
  var lwUp = 0.0;
  // temperatury na granicach warstw: liniowo między środkami, przy gruncie ekstrapolacja, u góry izotermicznie
  var Ti: array<f32, NW>;
  for (var k = kb + 1u; k < NZP; k++) {
    Ti[k] = T[k - 1u] + (T[k] - T[k - 1u]) * (vz[VZ_ZW + k] - vz[VZ_ZC + k - 1u]) / (vz[VZ_ZC + k] - vz[VZ_ZC + k - 1u]);
  }
  Ti[kb] = T[kb] + (T[kb] - T[kb + 1u]) * (vz[VZ_ZC + kb] - hc) / (vz[VZ_ZC + kb + 1u] - vz[VZ_ZC + kb]);
  Ti[NZP] = T[NZP - 1u];
  for (var b = 0u; b < 2u; b++) {
    var tr: array<f32, NZP>;
    var Bi: array<f32, NW>;
    for (var k = 0u; k < NW; k++) { Bi[k] = planck(Ti[k], b); }
    for (var k = 0u; k < NZP; k++) {
      var dt = 0.0;
      if (b == 0u) {
        dt = vz[VZ_CO2 + k] * fracZ(hc, k) + LW_KWV * (pow(max(uT[k], 1e-9), LW_NWV) - pow(max(uT[k + 1u], 1e-9), LW_NWV));
      } else {
        let e = qv[k] * vz[VZ_P0 + k] / 0.622;
        dt = LW_KCONT * qv[k] * m[k] * e * 1e-3 + LW_KW0 * m[k] / 10200.0;
      }
      // emisyjność chmury: wodna ~1, lodowa (cirrus) ~0.55
      let ec = 1.0 - exp(-1.66 * mix(0.5, 5.0, liq[k]));
      tr[k] = select(exp(-1.66 * dt) * (1.0 - cf[k] * ec), 1.0, k < kb);
    }
    fd[NZP] = 0.0;
    for (var kk = i32(NZP) - 1; kk >= i32(kb); kk--) {
      let k = u32(kk);
      fd[k] = fd[k + 1u] * tr[k] + Bi[k] * (1.0 - tr[k]) + (Bi[k + 1u] - Bi[k]) * linTau(tr[k]);
    }
    fu[kb] = 0.98 * planck(ts, b) + 0.02 * fd[kb];
    for (var k = kb; k < NZP; k++) { fu[k + 1u] = fu[k] * tr[k] + Bi[k + 1u] * (1.0 - tr[k]) + (Bi[k] - Bi[k + 1u]) * linTau(tr[k]); }
    for (var k = kb; k < NZP; k++) { hr[k] += fu[k] - fu[k + 1u] + fd[k + 1u] - fd[k]; }
    olr += fu[NZP];
    lwDn += fd[kb];
    lwUp += fu[kb];
  }
  for (var k = 0u; k < NZP; k++) { wk[WK_QR + k * N2 + c] = select(hr[k] / (CP * m[k] * vz[VZ_PI0 + k]), 0.0, k < kb); }
  let rn = swSfc - (lwUp - lwDn);
  // strumienie przy powierzchni (jak w pe_stage, stan z początku kroku)
  // (warstwa przy gruncie kb: środek części nad gruntem z1, Exner przy gruncie pis)
  let kbi = i32(kb);
  let uc = 0.5 * (su(i, j, kbi) + su(i + 1, j, kbi));
  let vc = 0.5 * (sv(i, j, kbi) + sv(i, j + 1, kbi));
  let spd = sqrt(uc * uc + vc * vc) + 2.0;
  let rho = vz[VZ_RC + kb];
  let pis = vz[VZ_PI0 + kb] + G / (CP * vz[VZ_TH0 + kb]) * (vz[VZ_ZC + kb] - hc);
  let thA = vz[VZ_TH0 + kb] + st(i, j, kbi);
  let chs = chExch(c, spd, thA, ts, 0.5 * (vz[VZ_ZW + kb + 1u] - hc), pis);
  let sh = rho * CP * chs * spd * (ts - thA * pis);
  // --- warstwa graniczna (K-profil jak YSU): za dnia ciepło z gruntu miesza się do 1–2.5 km i zostaje tam w nocy
  // (warstwa rezydualna). Wysokość: cząstka z dołu z małą nadwyżką (∝ ciepłu jawnemu) do poziomu, gdzie θ_v otoczenia
  // ją przewyższa; K = κ w* z (1 − z/h)², w* z bieżącego strumienia ciepła; nocą (strumień ujemny) tylko tło.
  {
    let shd = max(sh, 0.0);
    // (wysokości nad gruntem)
    let thv0 = thA * (1.0 + 0.61 * qv[kb]) + clamp(0.005 * shd, 0.0, 1.5);
    var h = vz[VZ_ZW + kb + 1u] - hc;
    for (var k = kb + 1u; k < NZP; k++) {
      let thv = (vz[VZ_TH0 + k] + st(i, j, i32(k))) * (1.0 + 0.61 * qv[k]);
      if (thv > thv0) {
        let thvb = (vz[VZ_TH0 + k - 1u] + st(i, j, i32(k) - 1)) * (1.0 + 0.61 * qv[k - 1u]);
        let f = clamp((thv0 - thvb) / max(thv - thvb, 1e-3), 0.0, 1.0);
        h = mix(vz[VZ_ZC + k - 1u], vz[VZ_ZC + k], f) - hc;
        break;
      }
      h = vz[VZ_ZC + k] - hc;
    }
    h = clamp(h, 300.0, 3000.0);
    let wst = pow(G / T[kb] * shd / (rho * CP) * h, 1.0 / 3.0);
    for (var k = 0u; k < NW; k++) {
      let z = vz[VZ_ZW + k] - hc;
      let x = clamp(1.0 - z / h, 0.0, 1.0);
      wk[WK_KP + k * N2 + c] = select(min(0.4 * wst * z * x * x, 150.0), 0.0, k <= kb || k == NZP);
    }
  }
  // --- bilans energii powierzchni lądu / lodu ---
  if (land) {
    let lh = rho * LV * chs * spd * betaS(c, spd, chs) * max(qsat(ts, vz[VZ_P0 + kb]) - qv[kb], -0.2 * qv[kb]);
    // gleba (lód): powierzchnia ↔ warstwa dobowa ↔ głębsza gleba (lód: woda pod spodem 271.4 K)
    let tm = wk[WK_TM + c];
    let g1 = K_SKIN * (ts - tm);
    let g2 = select(K_DEEP, 6.0, sea) * (tm - select(vz[VZ_TDEEP + c], tsc, sea));
    wk[WK_TL + c] = ts + P.dt * (rn - sh - lh - g1) / C_SKIN;
    wk[WK_TM + c] = tm + P.dt * (g1 - g2) / C_MID;
    wk[WK_RD + 6u * N2 + c] = sh;
    wk[WK_RD + 7u * N2 + c] = lh;
    // bilans wody w glebie: opad (całkowity z poprzedniego kroku) − parowanie; nadmiar ponad pojemność odpływa.
    // Przyciąganie do klimatologii NCEP (SMR = 1/τ, τ 20 dób; podobnie jak w samej reanalizie NCEP R1): zastępuje głębszą glebę,
    // wody gruntowe i resztę obiegu, których wiadro nie ma. Bez niego latem kontynent wysychał do zera i przestawał padać (Polska,
    // przebieg od grudnia: woda w glebie V 0.47 → VII 0.04, opad w lipcu 0.2 przy 3.9 mm/d w NCEP, Bowen ~2, T przy gruncie +5.6 K,
    // na 1.5 km +5 K – upał w domenie mimo korekty klimatu); głębsze wiadro (250 mm) i zmiany konwekcji tylko opóźniały suszę
    if (vz[VZ_SEA + c] < 0.5) {
      wk[WK_SM + c] = clamp(wk[WK_SM + c] + P.dt * ((wk[WK_PR + c] - lh / LV) / WCAP_PE + SMR * (vz[VZ_SMC + c] - wk[WK_SM + c])), 0.0, 1.0);
    }
  }
  if (!land) {
    // diagnostyka nad morzem: ciepło jawne i utajone (jak w pe_stage)
    wk[WK_RD + 6u * N2 + c] = sh;
    wk[WK_RD + 7u * N2 + c] = rho * LV * chs * spd * betaS(c, spd, chs) * max(qsat(ts, vz[VZ_P0 + kb]) - qv[kb], -0.2 * qv[kb]);
  }
  wk[WK_RD + 4u * N2 + c] = swSfc;
  wk[WK_RD + 5u * N2 + c] = lwUp - lwDn;
  // średnie dobowe (kroczące) dla domeny i mapy
  let a24 = P.dt / 86400.0;
  wk[WK_D24 + c] += a24 * (st(i, j, 0) - wk[WK_D24 + c]);
  wk[WK_D24 + N2 + c] += a24 * (st(i, j, 1) - wk[WK_D24 + N2 + c]);
  wk[WK_D24 + 2u * N2 + c] += a24 * (qv[0] - wk[WK_D24 + 2u * N2 + c]);
  // warstwa 2 (~1.2 km, nad cyklem dobowym) – odniesienie bieżącej zmiany masy powietrza przy gruncie (air, fronty)
  wk[WK_D24 + 3u * N2 + c] += a24 * (st(i, j, 2) - wk[WK_D24 + 3u * N2 + c]);
  wk[WK_D24 + 4u * N2 + c] += a24 * (qv[2] - wk[WK_D24 + 4u * N2 + c]);
  wk[WK_RD + c] = olr;
  wk[WK_RD + N2 + c] = swAtm + swSfc;                    // pochłonięte krótkofalowe (atmosfera + podłoże)
  wk[WK_RD + 2u * N2 + c] = ctot;
  wk[WK_RD + 3u * N2 + c] = rn;
}

// ---------------- diagnostyka: φ hydrostatyczne i w z ciągłości (kolumna) ----------------
@compute @workgroup_size(64)
fn pe_diag(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x;
  if (c >= N2) { return; }
  let i = i32(c % NXP);
  let j = i32(c / NXP);
  // φ całkowane od pokrywy w dół: ciśnienie na poziomie zależy tylko od powietrza nad nim – wypełnienie oczek w gruncie
  // nie działa na powietrze nad górami (część zależną tylko od x, y dokłada rzut barotropowy – w płaskim kanale prędkości
  // dokładnie jak przy całkowaniu od dołu)
  var ph = 0.0;
  var bUp = 0.0;
  for (var kk = i32(NZP) - 1; kk >= 0; kk--) {
    let ku = u32(kk);
    let b = G * st(i, j, kk) / vz[VZ_TH0 + ku];
    if (kk == i32(NZP) - 1) { ph = -b * (vz[VZ_ZW + NZP] - vz[VZ_ZC + ku]); }
    else { ph -= 0.5 * (bUp + b) * (vz[VZ_ZC + ku + 1u] - vz[VZ_ZC + ku]); }
    bUp = b;
    dg[ix(i, j, kk)] = ph;
  }
  // w z ciągłości: strumienie przez ściany tylko w części nad gruntem (w gruncie i na jego powierzchni w = 0).
  // Reszta dywergencji słupa po rzucie (z górami iteracja nie jest dokładna; płasko – błędy zaokrągleń) rozłożona na słup
  // wg masy warstw nad gruntem: w = 0 pod pokrywą. Całkowana od dołu dawała fałszywe w u góry (mała gęstość) – przy dwóch
  // iteracjach rzutu w ~cm/s w stratosferze, grzanie i chłodzenie po kilkadziesiąt K/dobę, NaN w ciągu doby.
  let hc = hgt(c);
  let he = max(hc, hgt(c2(i + 1, j)));
  let hw = max(hc, hgt(c2(i - 1, j)));
  let hn = max(hc, hgt(c2(i, j + 1)));
  let hs = max(hc, hgt(c2(i, j - 1)));
  var mdiv: array<f32, NZP>;
  var ftot = 0.0;
  var mf = 0.0;
  for (var k = 0; k < i32(NZP); k++) {
    let ku = u32(k);
    let div = (fracZ(he, ku) * su(i + 1, j, k) - fracZ(hw, ku) * su(i, j, k)) / DXP
            + (fracZ(hn, ku) * sv(i, j + 1, k) - fracZ(hs, ku) * sv(i, j, k)) / DXP;
    mdiv[ku] = vz[VZ_DZ + ku] * vz[VZ_RC + ku] * div;
    ftot += mdiv[ku];
    mf += vz[VZ_DZ + ku] * vz[VZ_RC + ku] * fracZ(hc, ku);
  }
  var flux = 0.0;          // ρ0 w na ścianie
  dg[N3 + c] = 0.0;
  for (var k = 0u; k < NZP; k++) {
    flux -= mdiv[k] - ftot * vz[VZ_DZ + k] * vz[VZ_RC + k] * fracZ(hc, k) / mf;
    dg[N3 + (k + 1u) * N2 + c] = select(flux / vz[VZ_RW + k + 1u], 0.0, k == NZP - 1u);
  }
}

// ---------------- tendencje i etap RK ----------------
// Średnia strefowa θ' (wiersz j, poziom k) raz na krok – do dyfuzji południkowej średniej strefowej w pe_stage
@compute @workgroup_size(64)
fn pe_zm(@builtin(global_invocation_id) gid: vec3u) {
  let id = gid.x;
  if (id >= NYP * NZP) { return; }
  let j = i32(id % NYP);
  let k = i32(id / NYP);
  var s = 0.0;
  var n = 0.0;
  for (var i = 0; i < i32(NXP); i++) { if (opn(i, j, k)) { s += st(i, j, k); n += 1.0; } }
  let zm = select(0.0, s / n, n > 0.0);
  wk[WK_ZM + id] = zm;
  // regulator PI średniej strefowej (pe.js): część całkująca uczy się brakującego ogrzewania (komórka Hadleya, błędy fizyki)
  if (ZCN > 0.0 && ZCI > 0.0) {
    let e = zcW(u32(k)) * (vz[VZ_ZCT + u32(j) * NZP + u32(k)] - zm);
    wk[WK_ZH + id] = clamp(wk[WK_ZH + id] + P.dt * e / (ZCN * ZCI * 86400.0 * 86400.0), -3.0 / 86400.0, 3.0 / 86400.0);
  }
  // to samo dla wiatru zachodniego (ściany otwarte nad gruntem): położenie i siła prądu strumieniowego jak w klimatologii –
  // w kanale bez kulistości Ziemi strumień przy realnym rozkładzie temperatury siedzi za daleko na południe
  var su0 = 0.0;
  var nu = 0.0;
  for (var i = 0; i < i32(NXP); i++) { if (vz[VZ_ZW + u32(k) + 1u] > hU(i, j)) { su0 += su(i, j, k); nu += 1.0; } }
  let zmu = select(0.0, su0 / nu, nu > 0.0);
  wk[WK_ZMU + id] = zmu;
  if (ZCU > 0.0 && ZCI > 0.0) {
    let e = zcW(u32(k)) * (vz[VZ_UCT + u32(j) * NZP + u32(k)] - zmu);
    wk[WK_ZHU + id] = clamp(wk[WK_ZHU + id] + P.dt * e / (ZCU * ZCI * 86400.0 * 86400.0), -5.0 / 86400.0, 5.0 / 86400.0);
  }
}
// Regulator długich fal (pe.js, zonwave.js) – grupa robocza na pas j i poziom k (po pe_zm: średnie θ' i u z wiersza): rzut różnicy
// cel − model na fale 1…WVM (θ' i v w środkach oczek, u na ścianach zachodnich; model bez średniej z wiersza – cel ma tylko fale).
// Gdzie model nie może odpowiedzieć (oczko albo ściana w gruncie) – bez błędu: część całkująca nie narasta przez góry i nie
// rozlewa się na resztę koła szerokości. Strefy przy ścianach N i S (profil klimatyczny bez fal) – bez regulatora. Wynik:
// wymuszenie (współczynniki fal) dla pe_stage.
const WV_CD: f32 = cos(0.5 * PI2 / f32(NXP));     // obrót o pół oczka (ściana zachodnia → środek)
const WV_SD: f32 = sin(0.5 * PI2 / f32(NXP));
var<workgroup> wsum: array<f32, 384u * WVM>;      // 64 wątki × 6·WVM
@compute @workgroup_size(64)
fn pe_wv(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let id = wg.x;                                  // k·NYP + j
  let j = i32(id % NYP);
  let k = i32(id / NYP);
  let ku = u32(k);
  let base = (u32(j) * NZP + ku) * 6u * WVM;
  // średnia v w pasie
  var vs = 0.0;
  for (var i = i32(li); i < i32(NXP); i += 64) { vs += sv(i, j, k); }
  wsum[li] = vs;
  workgroupBarrier();
  var vm = 0.0;
  for (var q = 0u; q < 64u; q++) { vm += wsum[q]; }
  vm /= f32(NXP);
  workgroupBarrier();
  let zm = wk[WK_ZM + id];
  let zmu = wk[WK_ZMU + id];
  let ztop = vz[VZ_ZW + ku + 1u];
  var e: array<f32, 6u * WVM>;
  for (var n = 0u; n < 6u * WVM; n++) { e[n] = 0.0; }
  for (var i = i32(li); i < i32(NXP); i += 64) {
    // cos/sin φ na ścianie zachodniej oczka (u) i w jego środku (θ', v); kolejne fale – mnożenie przez e^{iφ}
    let c1f = vz[VZ_COS + u32(i)];
    let s1f = vz[VZ_SIN + u32(i)];
    let c1c = c1f * WV_CD - s1f * WV_SD;
    let s1c = s1f * WV_CD + c1f * WV_SD;
    var cf = c1f;
    var sf = s1f;
    var cc = c1c;
    var sc = s1c;
    var tg = vec3f(0.0);
    for (var m = 0u; m < WVM; m++) {
      let b = VZ_WVT + base + 2u * m;
      tg.x += vz[b] * cc + vz[b + 1u] * sc;
      tg.y += vz[b + 2u * WVM] * cf + vz[b + 2u * WVM + 1u] * sf;
      tg.z += vz[b + 4u * WVM] * cc + vz[b + 4u * WVM + 1u] * sc;
      let af = cf * c1f - sf * s1f; sf = sf * c1f + cf * s1f; cf = af;
      let ac = cc * c1c - sc * s1c; sc = sc * c1c + cc * s1c; cc = ac;
    }
    let dT = select(0.0, tg.x - (st(i, j, k) - zm), opn(i, j, k));
    let dU = select(0.0, tg.y - (su(i, j, k) - zmu), ztop > hU(i, j));
    let dV = select(0.0, tg.z - (sv(i, j, k) - vm), j > 0 && ztop > hV(i, j));
    cf = c1f; sf = s1f; cc = c1c; sc = s1c;
    for (var m = 0u; m < WVM; m++) {
      e[2u * m] += dT * cc;
      e[2u * m + 1u] += dT * sc;
      e[2u * WVM + 2u * m] += dU * cf;
      e[2u * WVM + 2u * m + 1u] += dU * sf;
      e[4u * WVM + 2u * m] += dV * cc;
      e[4u * WVM + 2u * m + 1u] += dV * sc;
      let af = cf * c1f - sf * s1f; sf = sf * c1f + cf * s1f; cf = af;
      let ac = cc * c1c - sc * s1c; sc = sc * c1c + cc * s1c; cc = ac;
    }
  }
  for (var n = 0u; n < 6u * WVM; n++) { wsum[n * 64u + li] = e[n]; }
  workgroupBarrier();
  if (li < 6u * WVM) {
    var s = 0.0;
    for (var q = 0u; q < 64u; q++) { s += wsum[li * 64u + q]; }
    let en = zcW(ku) * select(1.0, 0.0, vz[VZ_BW + u32(j)] > 0.0) * 2.0 / f32(NXP) * s;
    let lim = select(5.0, 3.0, li < 2u * WVM) / 86400.0;          // θ' ≤ 3 K/dobę, wiatr ≤ 5 m/s/dobę na falę
    let ii = WK_WI + base + li;
    wk[ii] = clamp(wk[ii] + P.dt * P.wvI * en, -lim, lim);
    // po rozbiegu część proporcjonalna z błędu wygładzonego w czasie: niże i wyże (kilka dób) prawie bez tłumienia, utrwalony
    // zły układ – poprawiany
    let ie = WK_WE + base + li;
    wk[ie] += min(P.dt * P.wvF, 1.0) * (en - wk[ie]);
    wk[WK_WF + base + li] = P.wvP * select(en, wk[ie], P.wvE > 0.5) + wk[ii];
  }
}
// wymuszenie regulatora długich fal w oczku i (vr: 0 – θ', 1 – u, 2 – v; mid – środek oczka, inaczej ściana zachodnia)
fn wvF(j: i32, k: u32, vr: u32, i: i32, mid: bool) -> f32 {
  let b = WK_WF + (u32(j) * NZP + k) * 6u * WVM + vr * 2u * WVM;
  var c1 = vz[VZ_COS + u32(i)];
  var s1 = vz[VZ_SIN + u32(i)];
  if (mid) { let a = c1 * WV_CD - s1 * WV_SD; s1 = s1 * WV_CD + c1 * WV_SD; c1 = a; }
  var c = c1;
  var s = s1;
  var f = 0.0;
  for (var m = 0u; m < WVM; m++) {
    f += wk[b + 2u * m] * c + wk[b + 2u * m + 1u] * s;
    let cn = c * c1 - s * s1;
    s = s * c1 + c * s1;
    c = cn;
  }
  return f;
}
// waga regulatora średniej strefowej z wysokością: przy gruncie temperaturę ustala podłoże (morze z klimatologii, bilans
// lądu) – od 0 na ~0.4 km do pełnej od ~1.4 km
fn zcW(k: u32) -> f32 { return clamp((vz[VZ_ZC + k] - 400.0) / 1000.0, 0.0, 1.0); }

@compute @workgroup_size(64)
fn pe_stage(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let id = gid.x + gid.y * nwg.x * 64u;
  if (id >= N3) { return; }
  let i = i32(id % NXP);
  let j = i32((id / NXP) % NYP);
  let k = i32(id / (NXP * NYP));
  let ku = u32(k);
  let c = c2(i, j);
  let sea = vz[VZ_SEA + c];
  let hc = hgt(c);

  // ---- u (ściana zachodnia; w gruncie – góry – zero) ----
  {
    let hu = hU(i, j);
    let au = fracZ(hu, ku);
    if (au <= 0.0) { sOut[id] = 0.0; }
    else {
      let kbu = i32(kbot(hu));
      let u = su(i, j, k);
      let vb = 0.25 * (sv(i - 1, j, k) + sv(i, j, k) + sv(i - 1, j + 1, k) + sv(i, j + 1, k));
      let wb = 0.25 * (ww(i - 1, j, k) + ww(i, j, k) + ww(i - 1, j, k + 1) + ww(i, j, k + 1));
      var t = -u * d3(su(i - 2, j, k), su(i - 1, j, k), u, su(i + 1, j, k), su(i + 2, j, k), u, DXP)
              - vb * d3(su(i, j - 2, k), su(i, j - 1, k), u, su(i, j + 1, k), su(i, j + 2, k), vb, DXP)
              - wb * dzc(su(i, j, k - 1), u, su(i, j, k + 1), k, kbu);
      t += vz[VZ_F + u32(j)] * vb - (phi(i, j, k) - phi(i - 1, j, k)) / DXP;
      t += 0.5 * (vdiff(su(i, j, k - 1), u, su(i, j, k + 1), k, c, kbu, au) + vdiff(su(i, j, k - 1), u, su(i, j, k + 1), k, c2(i - 1, j), kbu, au));
      // średnia strefowa u przyciągana do klimatologii (regulator PI jak dla θ', pe_zm) – cały wiersz o tyle samo
      if (ZCU > 0.0) {
        let iz = ku * NYP + u32(j);
        t += zcW(ku) * (vz[VZ_UCT + u32(j) * NZP + ku] - wk[WK_ZMU + iz]) / (ZCU * 86400.0) + wk[WK_ZHU + iz];
      }
      // długie fale przyciągane do klimatologii (regulator w pe_zm)
      if (P.wvOn > 0.5) { t += wvF(j, ku, 1u, i, false); }
      // tarcie przy gruncie: w najniższej otwartej części ściany (w górach – nad wyższym z dwóch gruntów)
      if (k == kbu) {
        let spd = sqrt(u * u + vb * vb) + 1.0;
        let cd = mix(2.5e-3, 1.6e-3, 0.5 * (sea + vz[VZ_SEA + c2(i - 1, j)]));
        t -= cd * spd * u / (au * vz[VZ_DZ + ku]);
      }
      // warstwa tłumiąca: tylko zaburzenia (odchyłka od średniej z sąsiedztwa ±8 oczek w x) – tłumienie
      // całego wiatru zabierało atmosferze zachodni pęd prądu strumieniowego; bilans pędu wymuszał wtedy wiatry
      // wschodnie przy gruncie i ciśnienie rosnące ku biegunowi (pas wyżów nad 50°N)
      if (k == i32(NZP) - 1) {
        var um = 0.0;
        for (var n = -8; n <= 8; n++) { um += su(i + n, j, k); }
        t -= (u - um / 17.0) / (2.0 * 86400.0);
      }
      // strefa brzegowa przy ścianach N i S (jak relaksacja Daviesa w modelach regionalnych – wszystkie zmienne):
      // tłumienie wiatru; bez tego przy ścianie zwrotnikowej (małe f) prąd w górnej troposferze rósł bez końca
      // (165 → 280 m/s, niestabilność inercyjna, NaN po ~7 tygodniach zimy)
      t -= vz[VZ_BW + u32(j)] * u;
      sOut[id] = sBase[id] + P.dts * t;
    }
  }
  // ---- v (ściana południowa; na ścianie kanału i w gruncie zero) ----
  {
    if (j == 0) { sOut[N3 + id] = 0.0; }
    else {
      let hv = hV(i, j);
      let av = fracZ(hv, ku);
      if (av <= 0.0) { sOut[N3 + id] = 0.0; }
      else {
        let kbv = i32(kbot(hv));
        let v = sv(i, j, k);
        let ub = 0.25 * (su(i, j - 1, k) + su(i + 1, j - 1, k) + su(i, j, k) + su(i + 1, j, k));
        let wb = 0.25 * (ww(i, j - 1, k) + ww(i, j, k) + ww(i, j - 1, k + 1) + ww(i, j, k + 1));
        var t = -ub * d3(sv(i - 2, j, k), sv(i - 1, j, k), v, sv(i + 1, j, k), sv(i + 2, j, k), ub, DXP)
                - v * d3(sv(i, j - 2, k), sv(i, j - 1, k), v, sv(i, j + 1, k), sv(i, j + 2, k), v, DXP)
                - wb * dzc(sv(i, j, k - 1), v, sv(i, j, k + 1), k, kbv);
        t += -vz[VZ_FV + u32(j)] * ub - (phi(i, j, k) - phi(i, j - 1, k)) / DXP;
        t += 0.5 * (vdiff(sv(i, j, k - 1), v, sv(i, j, k + 1), k, c, kbv, av) + vdiff(sv(i, j, k - 1), v, sv(i, j, k + 1), k, c2(i, j - 1), kbv, av));
        if (k == kbv) {
          let spd = sqrt(v * v + ub * ub) + 1.0;
          let cd = mix(2.5e-3, 1.6e-3, 0.5 * (sea + vz[VZ_SEA + c2(i, j - 1)]));
          t -= cd * spd * v / (av * vz[VZ_DZ + ku]);
        }
        if (k == i32(NZP) - 1) {
          var vm = 0.0;
          for (var n = -8; n <= 8; n++) { vm += sv(i + n, j, k); }
          t -= (v - vm / 17.0) / (2.0 * 86400.0);
        }
        t -= 0.5 * (vz[VZ_BW + u32(j)] + vz[VZ_BW + u32(j - 1)]) * v;   // strefa brzegowa N/S (jak dla u)
        if (P.wvOn > 0.5) { t += wvF(j, ku, 2u, i, true); }
        sOut[N3 + id] = sBase[N3 + id] + P.dts * t;
      }
    }
  }
  // ---- θ', q (środek komórki) ----
  {
    let fc = fracZ(hc, ku);
    if (fc <= 0.0) {
      // oczko w gruncie: bez zmian (wypełnienie wartością z warstwy nad gruntem – pe_column)
      sOut[2u * N3 + id] = sBase[2u * N3 + id];
      sOut[3u * N3 + id] = sBase[3u * N3 + id];
      sOut[4u * N3 + id] = sBase[4u * N3 + id];
    } else {
      let kb = i32(kbot(hc));
      let uc = 0.5 * (su(i, j, k) + su(i + 1, j, k));
      let vc = 0.5 * (sv(i, j, k) + sv(i, j + 1, k));
      let wc = 0.5 * (ww(i, j, k) + ww(i, j, k + 1));
      let th = st(i, j, k);
      // szablony adwekcji z maską gruntu (sąsiad w gruncie – zerowy gradient, bez napływu „z wnętrza góry”)
      let tx = sten(2u, i, j, k, 1, 0, th);
      let ty = sten(2u, i, j, k, 0, 1, th);
      var tt = -uc * d3(tx[0], tx[1], th, tx[2], tx[3], uc, DXP)
               - vc * d3(ty[0], ty[1], th, ty[2], ty[3], vc, DXP)
               - wc * (dzc(st(i, j, k - 1), th, st(i, j, k + 1), k, kb) + vz[VZ_DTH0 + ku]);
      tt += vdiff(st(i, j, k - 1), th, st(i, j, k + 1), k, c, kb, fc);
      tt += wk[WK_QR + id];                                  // promieniowanie (pe_rad)
      // brakujący transport ciepła przez niże i wyże (bilans zimy 50°N: dopływ ~80 zamiast ~100 W/m², troposfera o ~3 K za zimna,
      // zwrotniki ~2 K za ciepłe): dyfuzja południkowa samej średniej strefowej θ' (K = KZM, do ~8 km, zanika do 12 km) –
      // zaburzenia (fronty, niże, kontrast ląd–morze) bez zmian
      {
        let ro = ku * NYP;
        let zm0 = wk[WK_ZM + ro + u32(j)];
        let zmN = wk[WK_ZM + ro + u32(min(j + 1, i32(NYP) - 1))];
        let zmS = wk[WK_ZM + ro + u32(max(j - 1, 0))];
        tt += KZM * (1.0 - smoothstep(8000.0, 12000.0, vz[VZ_ZC + ku])) * (zmN - 2.0 * zm0 + zmS) / (DXP * DXP);
        // średnia strefowa przyciągana do klimatologii (pe.js; regulator PI: ZCN dób + część całkująca) – cały wiersz
        // o tyle samo, zaburzenia bez zmian
        if (ZCN > 0.0) { tt += zcW(ku) * (vz[VZ_ZCT + u32(j) * NZP + ku] - zm0) / (ZCN * 86400.0) + wk[WK_ZH + ro + u32(j)]; }
        if (P.wvOn > 0.5) { tt += wvF(j, ku, 0u, i, true); }
      }
      // strefa brzegowa przy ścianach N i S: atmosfera za ścianą (tropiki / Arktyka) – profil klimatyczny
      let north = j > i32(NYP / 2u);
      let bw = vz[VZ_BW + u32(j)] * select(XPS, XPN, north);
      // rdzeń arktyczny (losowany, pe.js): odchylenie temperatury w troposferze (do ~8 km, zanika do 11 km) i mnożnik wilgotności
      let ic = u32((i + i32(NXP)) % i32(NXP));
      let arc = select(0.0, vz[VZ_ARC + ic] * (1.0 - smoothstep(8000.0, 11000.0, vz[VZ_ZC + ku])) / vz[VZ_PI0 + ku], north);
      tt += bw * (vz[VZ_TEQ + u32(j) * NZP + ku] + arc - th);
      let q = sq(i, j, k);
      let qx = sten(3u, i, j, k, 1, 0, q);
      let qy = sten(3u, i, j, k, 0, 1, q);
      var tq = -uc * d3(qx[0], qx[1], q, qx[2], qx[3], uc, DXP)
               - vc * d3(qy[0], qy[1], q, qy[2], qy[3], vc, DXP)
               - wc * dzc(sq(i, j, k - 1), q, sq(i, j, k + 1), k, kb);
      tq += vdiff(sq(i, j, k - 1), q, sq(i, j, k + 1), k, c, kb, fc);
      tq += bw * (vz[VZ_QEQ + u32(j) * NZP + ku] * select(1.0, vz[VZ_ARQ + ic], north) - q);
      if (k == kb) {
        // wymiana z podłożem (morze / ląd): ciepło jawne i parowanie, formuły aerodynamiczne – w warstwie przy gruncie
        // (w górach: część nad gruntem fc·dz, wysokość i Exner przy gruncie na wysokości terenu)
        let spd = sqrt(uc * uc + vc * vc) + 2.0;
        // temperatura powierzchni: morze – SST z klimatu, ląd i lód – z bilansu energii (pe_rad); ląd ma małą
        // pojemność cieplną i idzie za powietrzem, więc pełna wymiana nie „zaciera” mas powietrza
        let ts = tSurf(c);
        let pis = vz[VZ_PI0 + ku] + G / (CP * vz[VZ_TH0 + ku]) * (vz[VZ_ZC + ku] - hc);   // Exner przy gruncie
        let ch = chExch(c, spd, vz[VZ_TH0 + ku] + th, ts, 0.5 * (vz[VZ_ZW + ku + 1u] - hc), pis);
        let ps = vz[VZ_P0 + ku];
        let ths = ts / pis - vz[VZ_TH0 + ku];                // θ podłoża jako θ' warstwy przy gruncie
        let dze = fc * vz[VZ_DZ + ku];
        tt += ch * spd * (ths - th) / dze;
        let qs = qsat(ts, ps);
        // parowanie: pełny współczynnik wymiany (ograniczenie przez glebę i roślinność – BETA); osobno od
        // ciepła jawnego (słaba wymiana z lądem dotyczyła tylko temperatury – inaczej ląd wysychał)
        tq += ch * spd * betaS(c, spd, ch) * max(qs - q, -0.2 * q) / dze;
      }
      sOut[2u * N3 + id] = sBase[2u * N3 + id] + P.dts * tt;
      sOut[3u * N3 + id] = max(sBase[3u * N3 + id] + P.dts * tq, 0.0);
      // woda chmurowa: przenoszona i mieszana jak para (parowanie i opad – w pe_column); w strefie brzegowej zanika
      let qcv = sqc(i, j, k);
      let cx = sten(4u, i, j, k, 1, 0, qcv);
      let cy = sten(4u, i, j, k, 0, 1, qcv);
      var tc = -uc * d3(cx[0], cx[1], qcv, cx[2], cx[3], uc, DXP)
               - vc * d3(cy[0], cy[1], qcv, cy[2], cy[3], vc, DXP)
               - wc * dzc(sqc(i, j, k - 1), qcv, sqc(i, j, k + 1), k, kb);
      tc += vdiff(sqc(i, j, k - 1), qcv, sqc(i, j, k + 1), k, c, kb, fc) - bw * qcv;
      sOut[4u * N3 + id] = max(sBase[4u * N3 + id] + P.dts * tc, 0.0);
    }
  }
}

// ---------------- rzut barotropowy ----------------
// Z górami masa słupa nad gruntem A zmienia się w poziomie: ∇·(A∇χ) = ∇·∫ρ0 u dz (strumienie tylko nad gruntem). Iteracja
// χ += Δ⁻¹((D − ∇·(A∇χ))/A) (Δ⁻¹ – DFT w x, Thomas w y; A – masa słupa nad gruntem oczka): nad płaskim terenem dokładne,
// przy górach reszta ~0.1 na iterację (stała masa M̄ zamiast A: ~0.36 w całym kanale – reszta przy ścianach kanału dawała
// fałszywe w do 5 cm/s); start od ciśnienia barotropowego poprzedniego etapu (zmienia się powoli – reszta na starcie mała);
// płaski kanał – jedna iteracja od zera, rozwiązanie dokładne.
// (a) dywergencja transportu ∫ρ0 u dz (ściany w części nad gruntem)
@compute @workgroup_size(64)
fn pe_div(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x;
  if (c >= N2) { return; }
  let i = i32(c % NXP);
  let j = i32(c / NXP);
  let hc = hgt(c);
  let he = max(hc, hgt(c2(i + 1, j)));
  let hw = max(hc, hgt(c2(i - 1, j)));
  let hn = max(hc, hgt(c2(i, j + 1)));
  let hs = max(hc, hgt(c2(i, j - 1)));
  var d = 0.0;
  for (var k = 0; k < i32(NZP); k++) {
    let ku = u32(k);
    let m = vz[VZ_RC + ku] * vz[VZ_DZ + ku];
    let ue = sOut[ix(i + 1, j, k)];
    let uw = sOut[ix(i, j, k)];
    let vn = select(sOut[N3 + ix(i, j + 1, k)], 0.0, j + 1 >= i32(NYP));
    let vs = select(sOut[N3 + ix(i, j, k)], 0.0, j == 0);
    d += m * ((fracZ(he, ku) * ue - fracZ(hw, ku) * uw) + (fracZ(hn, ku) * vn - fracZ(hs, ku) * vs)) / DXP;
  }
  wk[WK_D + c] = d * vz[VZ_AC + c];
  wk[WK_B + c] = d;
  wk[WK_CHIT + c] = select(0.0, wk[WK_PB + c] * P.dts, vz[VZ_MB + 1u] > 0.5);
}
// (b) DFT w x (wiersz j, liczba falowa m)
@compute @workgroup_size(64)
fn pe_dft(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x;
  if (c >= N2) { return; }
  let m = c % NXP;
  let row = c - m;
  var re = 0.0;
  var im = 0.0;
  var t = 0u;
  for (var i = 0u; i < NXP; i++) {
    let f = wk[WK_D + row + i];
    re += f * vz[VZ_COS + t];
    im -= f * vz[VZ_SIN + t];
    t += m;
    if (t >= NXP) { t -= NXP; }
  }
  wk[WK_HR + c] = re;
  wk[WK_HI + c] = im;
}
// (c) dla każdej liczby falowej: M·(∂²/∂y² − λ_m) χ = D, warunek Neumanna przy ścianach
@compute @workgroup_size(64)
fn pe_tri(@builtin(global_invocation_id) gid: vec3u) {
  let m = gid.x;
  if (m >= NXP) { return; }
  var M = 0.0;
  for (var k = 0u; k < NZP; k++) { M += vz[VZ_RC + k] * vz[VZ_DZ + k]; }
  M *= vz[VZ_MB];
  let h2 = DXP * DXP;
  if (m == 0u) {
    // tryb średni w x: całkowanie (strumień zerowy na ścianie), średnia w y = 0
    var g = 0.0;
    var x = 0.0;
    var s = 0.0;
    for (var j = 0u; j < NYP; j++) {
      wk[WK_HI + j * NXP] = x;
      s += x;
      g += DXP * wk[WK_HR + j * NXP] / M;
      x += DXP * g;
    }
    let mean = s / f32(NYP);
    for (var j = 0u; j < NYP; j++) { wk[WK_HR + j * NXP] = wk[WK_HI + j * NXP] - mean; wk[WK_HI + j * NXP] = 0.0; }
    return;
  }
  let lam = (2.0 - 2.0 * cos(PI2 * f32(m) / f32(NXP))) / h2;
  // Thomas: a χ[j−1] + b χ[j] + a χ[j+1] = r[j] (a = 1/h², b = −2/h² − λ; przy ścianach −1/h² − λ)
  var cp: array<f32, NYP>;
  var dr: array<f32, NYP>;
  var di: array<f32, NYP>;
  let a = 1.0 / h2;
  for (var j = 0u; j < NYP; j++) {
    var b = -2.0 / h2 - lam;
    if (j == 0u || j == NYP - 1u) { b = -1.0 / h2 - lam; }
    let rr = wk[WK_HR + j * NXP + m] / M;
    let ri = wk[WK_HI + j * NXP + m] / M;
    var den = b;
    var xr = rr;
    var xi = ri;
    if (j > 0u) { den = b - a * cp[j - 1u]; xr -= a * dr[j - 1u]; xi -= a * di[j - 1u]; }
    cp[j] = a / den;
    dr[j] = xr / den;
    di[j] = xi / den;
  }
  var yr = dr[NYP - 1u];
  var yi = di[NYP - 1u];
  wk[WK_HR + (NYP - 1u) * NXP + m] = yr;
  wk[WK_HI + (NYP - 1u) * NXP + m] = yi;
  for (var jj = i32(NYP) - 2; jj >= 0; jj--) {
    let j = u32(jj);
    yr = dr[j] - cp[j] * yr;
    yi = di[j] - cp[j] * yi;
    wk[WK_HR + j * NXP + m] = yr;
    wk[WK_HI + j * NXP + m] = yi;
  }
}
// (d) odwrotna DFT → χ
@compute @workgroup_size(64)
fn pe_idft(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x;
  if (c >= N2) { return; }
  let i = c % NXP;
  let row = c - i;
  var s = 0.0;
  var t = 0u;
  for (var m = 0u; m < NXP; m++) {
    s += wk[WK_HR + row + m] * vz[VZ_COS + t] - wk[WK_HI + row + m] * vz[VZ_SIN + t];
    t += i;
    if (t >= NXP) { t -= NXP; }
  }
  wk[WK_CHI + c] = s / f32(NXP);
}
// (d') suma iteracji; po ostatnim etapie ciśnienie na poziomie morza: część barotropowa χ/Δt + φ hydrostatyczne (od pokrywy)
// sprowadzone pół warstwy w dół do z = 0, minus jego średnia po kanale (pe_pmean) – w płaskim kanale dokładnie dawne χ/Δt
// przy całkowaniu φ od dołu, średnie ciśnienie 1013.25 hPa (bez odjęcia średniej ciśnienie było przesunięte o +20…70 hPa)
@compute @workgroup_size(64)
fn pe_acc(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x;
  if (c >= N2) { return; }
  wk[WK_CHIT + c] += wk[WK_CHI + c];
  wk[WK_PB + c] = wk[WK_CHIT + c] / P.dts;
  if (P.stage == 2u) {
    let i = i32(c % NXP);
    let j = i32(c / NXP);
    wk[WK_PS + c] = wk[WK_CHIT + c] / P.dts + dg[ix(i, j, 0)] - G * st(i, j, 0) / vz[VZ_TH0] * vz[VZ_ZC] - wk[WK_PM];
  }
}
// średnia po kanale części hydrostatycznej φ przy z = 0 (jedna grupa robocza, ostatni etap kroku)
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn pe_pmean(@builtin(local_invocation_id) lid: vec3u) {
  var s = 0.0;
  for (var c = lid.x; c < N2; c += 256u) {
    let i = i32(c % NXP);
    let j = i32(c / NXP);
    s += dg[ix(i, j, 0)] - G * st(i, j, 0) / vz[VZ_TH0] * vz[VZ_ZC];
  }
  red[lid.x] = s;
  workgroupBarrier();
  for (var w = 128u; w > 0u; w = w >> 1u) {
    if (lid.x < w) { red[lid.x] += red[lid.x + w]; }
    workgroupBarrier();
  }
  if (lid.x == 0u) { wk[WK_PM] = red[0] / f32(N2); }
}
// (d'') reszta równania ze zmienną masą słupa: D − ∇·(A∇χ) → prawa strona kolejnej iteracji
@compute @workgroup_size(64)
fn pe_res(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x;
  if (c >= N2) { return; }
  let i = i32(c % NXP);
  let j = i32(c / NXP);
  let x0 = wk[WK_CHIT + c];
  var l = vz[VZ_AU + c2(i + 1, j)] * (wk[WK_CHIT + c2(i + 1, j)] - x0) - vz[VZ_AU + c] * (x0 - wk[WK_CHIT + c2(i - 1, j)]);
  if (j + 1 < i32(NYP)) { l += vz[VZ_AV + c2(i, j + 1)] * (wk[WK_CHIT + c2(i, j + 1)] - x0); }
  if (j > 0) { l -= vz[VZ_AV + c] * (x0 - wk[WK_CHIT + c2(i, j - 1)]); }
  wk[WK_D + c] = (wk[WK_B + c] - l / (DXP * DXP)) * vz[VZ_AC + c];
}
// (e) poprawka prędkości: u −= ∂χ/∂x, v −= ∂χ/∂y na wszystkich poziomach nad gruntem (ściany w gruncie – zero)
@compute @workgroup_size(64)
fn pe_proj(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let id = gid.x + gid.y * nwg.x * 64u;
  if (id >= N3) { return; }
  let i = i32(id % NXP);
  let j = i32((id / NXP) % NYP);
  let zt = vz[VZ_ZW + id / N2 + 1u];
  sOut[id] = select(0.0, sOut[id] - (wk[WK_CHIT + c2(i, j)] - wk[WK_CHIT + c2(i - 1, j)]) / DXP, zt > hU(i, j));
  if (j > 0) { sOut[N3 + id] = select(0.0, sOut[N3 + id] - (wk[WK_CHIT + c2(i, j)] - wk[WK_CHIT + c2(i, j - 1)]) / DXP, zt > hV(i, j)); }
}

// nasycenie w warstwie k: nadmiar pary → woda chmurowa (τ = TCOND), niedosyt → parowanie wody chmurowej (od razu)
fn satAdj(th: ptr<function, array<f32, NZP>>, q: ptr<function, array<f32, NZP>>, qcl: ptr<function, array<f32, NZP>>, k: u32) {
  let pik = vz[VZ_PI0 + k];
  let t = (vz[VZ_TH0 + k] + (*th)[k]) * pik;
  let qs = qsatM(t, vz[VZ_P0 + k]);
  let den = 1.0 + LV * LV * qs / (CP * RV * t * t);
  var dq = 0.0;
  if ((*q)[k] > qs) { dq = ((*q)[k] - qs) / den * (1.0 - exp(-P.dt / TCOND)); }
  else if ((*qcl)[k] > 0.0) { dq = -min((*qcl)[k], (qs - (*q)[k]) / den); }
  (*q)[k] -= dq;
  (*qcl)[k] += dq;
  (*th)[k] += LV * dq / (CP * pik);
}

// ---------------- fizyka kolumny po kroku: kondensacja, przystosowanie konwekcyjne ----------------
@compute @workgroup_size(64)
fn pe_column(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x;
  if (c >= N2) { return; }
  var th: array<f32, NZP>;
  var q: array<f32, NZP>;
  var m: array<f32, NZP>;
  var qcl: array<f32, NZP>;
  // góry: kolumna od warstwy kb (masa części nad gruntem), oczka w gruncie poza fizyką (na końcu wypełnienie)
  let hc = hgt(c);
  let kb = kbot(hc);
  let fb = fracZ(hc, kb);
  for (var k = 0u; k < NZP; k++) {
    th[k] = sOut[2u * N3 + k * N2 + c];
    q[k] = sOut[3u * N3 + k * N2 + c];
    qcl[k] = sOut[4u * N3 + k * N2 + c];
    m[k] = vz[VZ_RC + k] * vz[VZ_DZ + k] * fracZ(hc, k);
  }
  // mieszanie warstwy granicznej (K-profil) niejawnie: θ', q w środku oczka, u na ścianie zachodniej, v na południowej
  {
    let i = i32(c % NXP);
    let j = i32(c / NXP);
    let cw = c2(i - 1, j);
    let cs = c2(i, j - 1);
    var kc: array<f32, NW>;
    var ku: array<f32, NW>;
    var kv: array<f32, NW>;
    // ściany u i v: dno nad wyższym z dwóch gruntów (bez mieszania z zerową prędkością w gruncie – tarcie liczy pe_stage)
    let hu = hU(i, j);
    let hv = hV(i, j);
    let kbu = kbot(hu);
    let kbv = kbot(hv);
    for (var k = 0u; k < NW; k++) {
      kc[k] = kpbl(c, k);
      ku[k] = select(0.5 * (kc[k] + kpbl(cw, k)), 0.0, k <= kbu);
      kv[k] = select(0.5 * (kc[k] + kpbl(cs, k)), 0.0, k <= kbv);
    }
    implDiff(&th, &kc, P.dt, kb, fb);
    implDiff(&q, &kc, P.dt, kb, fb);
    implDiff(&qcl, &kc, P.dt, kb, fb);
    var xu: array<f32, NZP>;
    var xv: array<f32, NZP>;
    for (var k = 0u; k < NZP; k++) { xu[k] = sOut[k * N2 + c]; xv[k] = sOut[N3 + k * N2 + c]; }
    implDiff(&xu, &ku, P.dt, kbu, fracZ(hu, kbu));
    for (var k = 0u; k < NZP; k++) { sOut[k * N2 + c] = xu[k]; }
    if (j > 0) {
      implDiff(&xv, &kv, P.dt, kbv, fracZ(hv, kbv));
      for (var k = 0u; k < NZP; k++) { sOut[N3 + k * N2 + c] = xv[k]; }
    }
  }
  // Kondensacja wielkoskalowa do wody chmurowej (wcześniej woda wypadała od razu – każde nasycenie oczka 75 km
  // dawało opad z wydajnością ~100%: zimą/jesienią ~2× za dużo opadu, mokre i chłodne powietrze przy gruncie)
  // i parowanie wody chmurowej w powietrzu nienasyconym (brzegi chmur, osiadanie). Opad z wody chmurowej – niżej
  // (autokonwersja Sundqvista i zbieranie przez opad z góry). prk – opad powstały na danym poziomie.
  var pr = 0.0;
  var prk: array<f32, NZP>;
  for (var k = kb; k < NZP; k++) { satAdj(&th, &q, &qcl, k); }
  // Konwekcja (Betts–Miller, uproszczona): cząstka z najniższej warstwy (~0–400 m) podnoszona sucho do
  // nasycenia, potem wilgotnoadiabatycznie (θe stałe). Gdy jest chwiejna i chmura ma ≥ ~1 km grubości,
  // temperatura w chmurze dąży do profilu cząstki, a wilgotność do 80% nasycenia (τ = 2 h); woda zabrana
  // z kolumny ponad to, co poszło na ogrzanie, spada jako opad konwekcyjny (bilans energii: poprawka
  // jednakowa na wszystkich poziomach chmury). Przelotne opady i burze w chwiejnych masach, pasma opadów
  // nad ciepłą wodą przy napływie zimnego powietrza (podłoże ogrzewa i nawilża najniższą warstwę).
  var prc = 0.0;
  {
    // (cząstka z warstwy przy gruncie kb)
    let pi0 = vz[VZ_PI0 + kb];
    let th0p = vz[VZ_TH0 + kb] + th[kb];
    let tp0 = th0p * pi0;
    let qp = q[kb];
    let the = th0p * exp(LV * qp / (CP * tp0));
    var tref: array<f32, NZP>;
    var klcl = NZP;
    var ktop = 0u;
    var cape = 0.0;
    for (var k = kb + 1u; k < NZP; k++) {
      let pik = vz[VZ_PI0 + k];
      let pk = vz[VZ_P0 + k];
      var t = th0p * pik;
      if (klcl < NZP || qp >= qsat(t, pk)) {
        if (klcl == NZP) { klcl = k; }
        // T z θ·exp(L q_s/(c_p T)) = θe (iteracja tłumiona)
        for (var it = 0; it < 10; it++) {
          let tn = pik * the / exp(LV * qsat(t, pk) / (CP * t));
          t = 0.5 * (t + tn);
        }
      }
      tref[k] = t;
      let te = (vz[VZ_TH0 + k] + th[k]) * pik;
      let qpar = select(qp, qsat(t, pk), k >= klcl);
      let b = (t * (1.0 + 0.61 * qpar) - te * (1.0 + 0.61 * q[k])) / te;
      if (k >= klcl && b > 0.0) { cape += G * b * vz[VZ_DZ + k]; ktop = k; }
      if (ktop > 0u && b < -0.01) { break; }
    }
    var bmAct = 0.0;
    var bmBlk = 0.0;
    if (klcl < NZP && ktop >= klcl && cape > BM_CAPE && vz[VZ_ZW + ktop + 1u] - vz[VZ_ZW + klcl] > 1000.0) {
      let al = min(P.dt / 10800.0, 1.0);
      var hsum = 0.0;
      var psum = 0.0;
      var msum = 0.0;
      var dT: array<f32, NZP>;
      var dQ: array<f32, NZP>;
      for (var k = klcl; k <= ktop; k++) {
        let pik = vz[VZ_PI0 + k];
        let te = (vz[VZ_TH0 + k] + th[k]) * pik;
        dT[k] = al * (tref[k] - 1.0 - te);
        dQ[k] = al * (0.8 * qsat(tref[k], vz[VZ_P0 + k]) - q[k]);
        hsum += m[k] * CP * dT[k];
        psum -= m[k] * dQ[k];
        msum += m[k];
      }
      let depth = vz[VZ_ZW + ktop + 1u] - vz[VZ_ZW + klcl];
      // Woda z warstwy podchmurowej (prąd wstępujący niesie powietrze spod podstawy): chmura głęboka bierze stamtąd parę, której
      // brakuje do ogrzania warstwy chmurowej i jej nawilżenia (ogrzanie = kondensacja), najwyżej 1/τ pary ponad 30% nasycenia
      // na krok. Wcześniej woda tylko z warstwy chmurowej – przy suchej środkowej troposferze (latem nad lądem RH 50–70% przy
      // odniesieniu ~90% względem nasycenia otoczenia) schemat się nie włączał (latem nad Europą zablokowany 5–15% czasu, pada
      // 2–5%). Efekt mały (lipiec, Polska, wysychająca gleba: opad 0.0 → 0.3 mm/d). (Dawne stałe suszenie ~1% pary spod każdej
      // chmury na krok obniżało latem punkt rosy i CAPE nad domeną.) ?bms=0 – bez
      var wex = 0.0;
      for (var k = kb; k < klcl; k++) {
        let tk = (vz[VZ_TH0 + k] + th[k]) * vz[VZ_PI0 + k];
        wex += m[k] * max(q[k] - 0.3 * qsat(tk, vz[VZ_P0 + k]), 0.0);
      }
      let sup = BMS * smoothstep(2500.0, 6000.0, depth) * clamp(hsum / LV - psum, 0.0, al * wex);
      let avail = psum + sup;
      if (avail > 0.0 && msum > 0.0) {
        // Wydajność opadowa (Betts 1986: konwekcja płytka nie pada): pełna dla chmur głębokich (~6 km), dla płytkich
        // tylko przy lodowym wierzchołku (pasma śniegu znad ciepłej wody: do 60%), ciepłe Cu/Sc – bez opadu. Woda,
        // która nie spada, zostaje w warstwie chmurowej jako para (detrainment, do 95% nasycenia); energia: ogrzanie
        // odpowiada tylko wodzie, która spadła. Wcześniej cały nadmiar nad 80% RH padał już z chmur ~1 km –
        // zimą nad morzem 6–8 mm/dobę (realnie Atlantyk 45–60°N ~3–4.5).
        let eff = max(smoothstep(2500.0, 6000.0, depth), 0.6 * smoothstep(258.0, 238.0, tref[ktop]));
        var rest = (1.0 - eff) * avail;
        var det: array<f32, NZP>;
        for (var kk = i32(ktop); kk >= i32(klcl); kk--) {
          let k = u32(kk);
          let pik = vz[VZ_PI0 + k];
          let tn = (vz[VZ_TH0 + k] + th[k]) * pik + dT[k];
          let cap = max(0.95 * qsat(tn, vz[VZ_P0 + k]) - (q[k] + dQ[k]), 0.0) * m[k];
          det[k] = min(rest, cap);
          rest -= det[k];
        }
        let fall = eff * avail + rest;
        let shift = (LV * fall - hsum) / (CP * msum);
        for (var k = klcl; k <= ktop; k++) {
          let pik = vz[VZ_PI0 + k];
          th[k] += (dT[k] + shift) / pik;
          q[k] = max(q[k] + dQ[k] + det[k] / m[k], 0.0);
        }
        if (sup > 0.0) {
          let fr = sup / wex;
          for (var k = kb; k < klcl; k++) {
            let tk = (vz[VZ_TH0 + k] + th[k]) * vz[VZ_PI0 + k];
            q[k] -= fr * max(q[k] - 0.3 * qsat(tk, vz[VZ_P0 + k]), 0.0);
          }
        }
        prc = fall;
        pr += fall;
        prk[klcl] += fall;
        bmAct = 1.0;
      } else { bmBlk = 1.0; }
    }
    wk[WK_BMD + c] = select(0.0, cape, klcl < NZP);
    wk[WK_BMD + N2 + c] = bmAct;
    wk[WK_BMD + 2u * N2 + c] = bmBlk;
  }
  // przystosowanie konwekcyjne: suche (θ rośnie z wysokością) i wilgotne (w warstwach nasyconych
  // θe nie maleje z wysokością) – mieszanie par warstw z zachowaniem energii i wody
  for (var it = 0; it < 3; it++) {
    for (var k = kb; k + 1u < NZP; k++) {
      let ta = vz[VZ_TH0 + k] + th[k];
      let tb = vz[VZ_TH0 + k + 1u] + th[k + 1u];
      let pia = vz[VZ_PI0 + k];
      let pib = vz[VZ_PI0 + k + 1u];
      let qsa = qsatM(ta * pia, vz[VZ_P0 + k]);
      let qsb = qsatM(tb * pib, vz[VZ_P0 + k + 1u]);
      let sat = q[k] > 0.95 * qsa;
      // θe ≈ θ (1 + L q / (cp T)); dla warstwy górnej – wartość przy nasyceniu
      let tea = ta + LV * q[k] / (CP * pia);
      let teb = tb + LV * qsb / (CP * pib);
      if (ta > tb + 0.01 || (sat && tea > teb + 0.5)) {
        // suche – pełne wymieszanie; wilgotne – częściowe (konwekcja rozwija się w ~godzinę,
        // inaczej na oczku 75 km powstają „burze punktów siatki”)
        let al = select(1.0, 0.05, ta <= tb + 0.01);
        let mt = m[k] + m[k + 1u];
        let tm = (m[k] * ta + m[k + 1u] * tb) / mt;
        let qm = (m[k] * q[k] + m[k + 1u] * q[k + 1u]) / mt;
        th[k] += al * (tm - ta);
        th[k + 1u] += al * (tm - tb);
        q[k] += al * (qm - q[k]);
        q[k + 1u] += al * (qm - q[k + 1u]);
      }
    }
  }
  // po wymieszaniu ponowna kondensacja (do wody chmurowej)
  for (var k = kb; k < NZP; k++) { satAdj(&th, &q, &qcl, k); }
  // opadanie kryształków lodu (~0.7 m/s): cirrus ma skończony czas życia – wcześniej cienka chmura lodowa (0.01 g/kg,
  // poniżej progu autokonwersji) wisiała bez końca, zimą przy tropopauzie zachmurzenie ~0.8 i OLR ~136 W/m²
  {
    var fall = 0.0;
    for (var kk = i32(NZP) - 1; kk >= i32(kb); kk--) {
      let k = u32(kk);
      qcl[k] += fall / m[k];
      let tk = (vz[VZ_TH0 + k] + th[k]) * vz[VZ_PI0 + k];
      fall = qcl[k] * smoothstep(258.0, 238.0, tk) * min(1.0, P.dt * 0.7 / vz[VZ_DZ + k]) * m[k];
      qcl[k] -= fall / m[k];
    }
    // lód opadający z najniższej warstwy – do opadu przy gruncie
    prk[kb] += fall;
  }
  // Opad z wody chmurowej (Sundqvist 1978/1989, jak w modelach klimatu): autokonwersja c0·q_c·(1 − exp(−(q_c/q_cr)²)),
  // c0 = 1e-4 1/s (~3 h), q_cr 0.3 g/kg w chmurach ciepłych → 0.1 g/kg w lodowych (Bergeron), przyspieszana przez opad
  // z góry (×(1 + √(P [mm/h]))); potem parowanie opadu w warstwach nienasyconych (do 25% niedosytu na krok)
  var flux = 0.0;
  var gen = 0.0;
  for (var k = 0u; k < NZP; k++) { gen += prk[k]; }
  for (var kk = i32(NZP) - 1; kk >= i32(kb); kk--) {
    let k = u32(kk);
    flux += prk[k];
    if (qcl[k] > 1e-7) {
      let tk = (vz[VZ_TH0 + k] + th[k]) * vz[VZ_PI0 + k];
      let ice = smoothstep(268.0, 253.0, tk);
      let qcr = mix(3e-4, 1e-4, ice);
      let rate = 1e-4 * (1.0 + 2.0 * ice) * (1.0 + sqrt(max(flux, 0.0) * 3600.0)) * (1.0 - exp(-(qcl[k] / qcr) * (qcl[k] / qcr)));
      let dp = qcl[k] * (1.0 - exp(-P.dt * rate));
      qcl[k] -= dp;
      flux += dp * m[k];
      gen += dp * m[k];
    }
    if (flux <= 0.0) { continue; }
    let pik = vz[VZ_PI0 + k];
    let t = (vz[VZ_TH0 + k] + th[k]) * pik;
    let qs = qsatM(t, vz[VZ_P0 + k]);
    if (q[k] < qs) {
      let ev = min(flux, 0.25 * (qs - q[k]) * m[k] * min(1.0, P.dt / 1800.0));
      q[k] += ev / m[k];
      th[k] -= LV * ev / m[k] / (CP * pik);
      flux -= ev;
    }
  }
  // udział konwekcji w opadzie przy gruncie (parowanie pod chmurą tak samo dla obu rodzajów)
  let fconv = select(0.0, clamp(prc / gen, 0.0, 1.0), gen > 0.0);
  pr = flux;
  // oczka w gruncie: θ' i para jak w warstwie przy gruncie (temperatura rośnie w dół ~6.5 K/km jak w profilu odniesienia –
  // „sprowadzenie do poziomu morza” dla domeny i map), bez wody chmurowej
  for (var k = 0u; k < NZP; k++) {
    let g = k < kb;
    sOut[2u * N3 + k * N2 + c] = select(th[k], th[kb], g);
    sOut[3u * N3 + k * N2 + c] = select(q[k], q[kb], g);
    sOut[4u * N3 + k * N2 + c] = select(qcl[k], 0.0, g);
  }
  wk[WK_PR + c] = pr / P.dt;
  wk[WK_PRC + c] = fconv * pr / P.dt;
}

// ---------------- hiperlepkość ∇⁴ (laplasjan, potem laplasjan laplasjanu) ----------------
// punkt pola f w gruncie (góry): ściana u / v zamknięta albo oczko θ, q pod terenem – bez wygładzania, a dla sąsiadów
// zerowy gradient (bez mieszania powietrza z wypełnieniem)
fn inGround(f: u32, i: i32, j: i32, k: i32) -> bool {
  let zt = vz[VZ_ZW + u32(k) + 1u];
  if (f == 0u) { return zt <= hU(i, j); }
  if (f == 1u) { return zt <= hV(i, j); }
  return zt <= hgt(c2(i, j));
}
fn lapAt(base: u32, f: u32, i: i32, j: i32, k: i32) -> f32 {
  // f: 0 u, 1 v, 2 θ, 3 q; przy ścianach – odbicie (dla v: v = 0 na ścianie)
  let o = base + f * N3;
  let c0 = sOut[o + ix(i, j, k)];
  if (inGround(f, i, j, k)) { return 0.0; }
  let e = select(sOut[o + ix(i + 1, j, k)], c0, inGround(f, i + 1, j, k));
  let w = select(sOut[o + ix(i - 1, j, k)], c0, inGround(f, i - 1, j, k));
  var n = select(sOut[o + ix(i, j + 1, k)], c0, inGround(f, i, j + 1, k));
  var s = select(sOut[o + ix(i, j - 1, k)], c0, inGround(f, i, j - 1, k));
  if (f == 1u) {
    if (j + 1 >= i32(NYP)) { n = 0.0; }
    if (j - 1 < 0) { s = 0.0; }
  } else {
    if (j + 1 >= i32(NYP)) { n = c0; }
    if (j - 1 < 0) { s = c0; }
  }
  return (e + w + n + s - 4.0 * c0) / (DXP * DXP);
}
@compute @workgroup_size(64)
fn pe_lap(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let id = gid.x + gid.y * nwg.x * 64u;
  if (id >= 5u * N3) { return; }
  let f = id / N3;
  let l = id % N3;
  let i = i32(l % NXP);
  let j = i32((l / NXP) % NYP);
  let k = i32(l / (NXP * NYP));
  wk[WK_LAP + id] = lapAt(0u, f, i, j, k);
}
@compute @workgroup_size(64)
fn pe_hyper(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let id = gid.x + gid.y * nwg.x * 64u;
  if (id >= 5u * N3) { return; }
  let f = id / N3;
  let l = id % N3;
  let i = i32(l % NXP);
  let j = i32((l / NXP) % NYP);
  let k = i32(l / (NXP * NYP));
  if (f == 1u && j == 0) { return; }
  if (inGround(f, i, j, k)) { return; }
  let o = WK_LAP + f * N3;
  let c0 = wk[o + ix(i, j, k)];
  var n = select(wk[o + ix(i, j + 1, k)], c0, inGround(f, i, j + 1, k));
  var s = select(wk[o + ix(i, j - 1, k)], c0, inGround(f, i, j - 1, k));
  if (j + 1 >= i32(NYP)) { n = select(c0, 0.0, f == 1u); }
  if (j - 1 < 0) { s = select(c0, 0.0, f == 1u); }
  let e = select(wk[o + ix(i + 1, j, k)], c0, inGround(f, i + 1, j, k));
  let w = select(wk[o + ix(i - 1, j, k)], c0, inGround(f, i - 1, j, k));
  let l2 = (e + w + n + s - 4.0 * c0) / (DXP * DXP);
  sOut[id] -= P.dt * P.nu4 * l2;
  if (f >= 3u) { sOut[id] = max(sOut[id], 0.0); }
}

// ---------------- próbkowanie (dla domeny zagnieżdżonej i diagnostyki) ----------------
// położenie (x, y) [m] względem środka kanału; f: 0 u, 1 v, 2 θ', 3 q; poziom k
fn smp(f: u32, x: f32, y: f32, k: u32) -> f32 {
  var X = x / DXP + f32(NXP) * 0.5 - 0.5;
  var Y = y / DXP + f32(NYP) * 0.5 - 0.5;
  if (f == 0u) { X += 0.5; }
  if (f == 1u) { Y += 0.5; }
  Y = clamp(Y, 0.0, f32(NYP) - 1.001);
  let xf = floor(X);
  let yf = floor(Y);
  let fx = X - xf;
  let fy = Y - yf;
  let i0 = i32(xf);
  let j0 = i32(yf);
  let o = f * N3;
  let a = mix(sOut[o + ix(i0, j0, i32(k))], sOut[o + ix(i0 + 1, j0, i32(k))], fx);
  let b = mix(sOut[o + ix(i0, j0 + 1, i32(k))], sOut[o + ix(i0 + 1, j0 + 1, i32(k))], fx);
  return mix(a, b, fy);
}
fn smp2(off: u32, x: f32, y: f32) -> f32 {
  let X = x / DXP + f32(NXP) * 0.5 - 0.5;
  let Y = clamp(y / DXP + f32(NYP) * 0.5 - 0.5, 0.0, f32(NYP) - 1.001);
  let xf = floor(X);
  let yf = floor(Y);
  let i0 = i32(xf);
  let j0 = i32(yf);
  let a = mix(wk[off + c2(i0, j0)], wk[off + c2(i0 + 1, j0)], X - xf);
  let b = mix(wk[off + c2(i0, j0 + 1)], wk[off + c2(i0 + 1, j0 + 1)], X - xf);
  return mix(a, b, Y - yf);
}
fn smpVz(off: u32, x: f32, y: f32) -> f32 {
  let X = x / DXP + f32(NXP) * 0.5 - 0.5;
  let Y = clamp(y / DXP + f32(NYP) * 0.5 - 0.5, 0.0, f32(NYP) - 1.001);
  let xf = floor(X);
  let yf = floor(Y);
  let i0 = i32(xf);
  let j0 = i32(yf);
  let a = mix(vz[off + c2(i0, j0)], vz[off + c2(i0 + 1, j0)], X - xf);
  let b = mix(vz[off + c2(i0, j0 + 1)], vz[off + c2(i0 + 1, j0 + 1)], X - xf);
  return mix(a, b, Y - yf);
}
fn wAt(x: f32, y: f32, kw: u32) -> f32 {
  let X = x / DXP + f32(NXP) * 0.5 - 0.5;
  let Y = clamp(y / DXP + f32(NYP) * 0.5 - 0.5, 0.0, f32(NYP) - 1.001);
  let xf = floor(X);
  let yf = floor(Y);
  let i0 = i32(xf);
  let j0 = i32(yf);
  let o = N3 + kw * N2;
  let a = mix(dg[o + c2(i0, j0)], dg[o + c2(i0 + 1, j0)], X - xf);
  let b = mix(dg[o + c2(i0, j0 + 1)], dg[o + c2(i0 + 1, j0 + 1)], X - xf);
  return mix(a, b, Y - yf);
}
// wartość na wysokości z [m] (liniowo między środkami warstw)
fn atZ(f: u32, x: f32, y: f32, z: f32) -> f32 {
  var k0 = 0u;
  for (var k = 0u; k + 1u < NZP; k++) { if (vz[VZ_ZC + k + 1u] < z) { k0 = k + 1u; } }
  let k1 = min(k0 + 1u, NZP - 1u);
  let za = vz[VZ_ZC + k0];
  let zb = vz[VZ_ZC + k1];
  let a = clamp((z - za) / max(zb - za, 1.0), 0.0, 1.0);
  return mix(smp(f, x, y, k0), smp(f, x, y, k1), a);
}
fn th0Z(z: f32) -> f32 {
  var k0 = 0u;
  for (var k = 0u; k + 1u < NZP; k++) { if (vz[VZ_ZC + k + 1u] < z) { k0 = k + 1u; } }
  let k1 = min(k0 + 1u, NZP - 1u);
  let a = clamp((z - vz[VZ_ZC + k0]) / max(vz[VZ_ZC + k1] - vz[VZ_ZC + k0], 1.0), 0.0, 1.0);
  return mix(vz[VZ_TH0 + k0], vz[VZ_TH0 + k1], a);
}
fn pi0Z(z: f32) -> f32 {
  var k0 = 0u;
  for (var k = 0u; k + 1u < NZP; k++) { if (vz[VZ_ZC + k + 1u] < z) { k0 = k + 1u; } }
  let k1 = min(k0 + 1u, NZP - 1u);
  let a = clamp((z - vz[VZ_ZC + k0]) / max(vz[VZ_ZC + k1] - vz[VZ_ZC + k0], 1.0), 0.0, 1.0);
  return mix(vz[VZ_PI0 + k0], vz[VZ_PI0 + k1], a);
}
fn tAtZ(x: f32, y: f32, z: f32) -> f32 { return (th0Z(z) + atZ(2u, x, y, z)) * pi0Z(z); }

// Parametry sondażu w punkcie (jak airAt w JS): [ts K, Γ K/m, z_tropo, z_inv, Δinv, RH dół, RH góra,
// u0, v0, du/dz, dv/dz, w, p_morza]; dodatkowo zwraca tDay, tAnom, q(1.5 km) przez wk (środek)
struct Air { p: array<f32, 25>, tDay: f32, tAnom: f32, ql: f32, pr: f32 }
// wilgotność względna na wysokości z względem nasycenia modelu (woda → lód między 0 a −40 °C, qsatM): 1 = chmura w modelu
fn rhM(x: f32, y: f32, z: f32) -> f32 {
  return clamp(atZ(3u, x, y, z) / qsatM(tAtZ(x, y, z), 100000.0 * pow(pi0Z(z), CP / 287.0)), 0.05, 1.0);
}
fn air(x: f32, y: f32) -> Air {
  var A: Air;
  // temperatura przy gruncie (średnia dobowa – krocząca, model ma cykl dobowy): ekstrapolacja z dwóch najniższych warstw
  let t0 = (vz[VZ_TH0] + smp2(WK_D24, x, y)) * vz[VZ_PI0];
  let t1 = (vz[VZ_TH0 + 1u] + smp2(WK_D24 + N2, x, y)) * vz[VZ_PI0 + 1u];
  let gl = clamp((t0 - t1) / (vz[VZ_ZC + 1u] - vz[VZ_ZC]), -0.01, 0.0098);
  let tday0 = t0 + gl * vz[VZ_ZC];
  // gradienty pionowe: dolny 1.5–3 km i górny 3–5.6 km (profil celu domeny przechodzi przez T modelu na 1.5, 3 i 5.6 km).
  // Wcześniej jeden gradient 1–5 km zakotwiczony na 3 km: zimą stała warstwa 1.5–3 km i stromy spadek 3–5.6 km pod zatoką
  // chłodu – cel o ~2 K za ciepły na 1.5 km i o 3–7 K na 5.6 km (zima, Polska, 10 dób: śr. −26.4 przy −29.2 °C modelu),
  // środkowa troposfera domeny stała: MUCAPE w napływie N–NW ~0, bez przelotnego śniegu
  let t15 = tAtZ(x, y, 1500.0);
  let t30 = tAtZ(x, y, 3000.0);
  let t56 = tAtZ(x, y, 5600.0);
  let gam = clamp((t15 - t30) / 1500.0, 0.001, 0.0095);
  let gamU = clamp((t30 - t56) / 2600.0, 0.0045, 0.0095);
  // Bieżąca zmiana masy powietrza: odchyłka warstwy 2 (~1.2 km, nad cyklem dobowym) od jej średniej dobowej dodana do średniej
  // dobowej przy gruncie. Sama średnia krocząca (τ 1 doba) rozkładała przejście frontu przy gruncie na ~dobę (front w domenie
  // przy gruncie 2–3× słabszy niż na 1.5 km, spadek T 2 m ~1 K/h). Ochłodzenie i wysuszenie w pełni; ocieplenie i nawilżenie
  // przy inwersji (zimna poduszka zimą) słabiej – ciepłe powietrze nad inwersją nie dociera od razu do gruntu.
  let inv0 = tAtZ(x, y, 3000.0) + gam * 3000.0 - (tday0 + 0.4 * P.halfDiur);
  let wWarm = 1.0 - 0.7 * smoothstep(1.0, 5.0, inv0);
  let dT2 = (smp(2u, x, y, 2u) - smp2(WK_D24 + 3u * N2, x, y)) * vz[VZ_PI0 + 2u];
  let tday = tday0 + select(wWarm, 1.0, dT2 < 0.0) * dT2;
  let tS = tday + 0.4 * P.halfDiur;
  // tropopauza: gładko z temperatury masy (wykrywanie z profilu na 12 poziomach dawało skoki między
  // kolumnami – ogromne różnice θ w stratosferze pól docelowych)
  let ztr = 11200.0 + 110.0 * (tday - 283.15);
  // wilgotność: warstwa graniczna (wilgotność właściwa ~1 km odniesiona do temperatury przy gruncie),
  // górna troposfera ~6.5 km
  // wilgotność przy gruncie z najniższej warstwy modelu (~200 m), nie z 1 km – para maleje z wysokością
  // (w tropikach Td przy gruncie wychodziło 14–17 °C zamiast 22–25 °C)
  // (wilgotność przy gruncie: średnia dobowa + bieżąca zmiana na ~1.2 km, jak temperatura)
  let ql0 = smp2(WK_D24 + 2u * N2, x, y);
  let dq2 = smp(3u, x, y, 2u) - smp2(WK_D24 + 4u * N2, x, y);
  let ql = max(ql0 + select(wWarm, 1.0, dq2 < 0.0) * dq2, 0.3 * ql0);
  // latem (wymieszana warstwa graniczna) ta sama wilgotność właściwa co na ~1 km; zimą (stała warstwa,
  // inwersje – wilgoć zostaje przy gruncie) wilgotność względna z ~1 km (dawniej zimą ~50% RH przy gruncie
  // zamiast ~85%: pogodne niebo, brak stratusów, mróz)
  // gdzie model pada (opad wielkoskalowy: niż, front), wilgotność docelowa może sięgnąć nasycenia – inaczej
  // domena nigdy nie dostawała nasyconego powietrza (limit 95–97%) i pod niżem nie było chmur ani opadu
  let wetp = smoothstep(0.0, 0.1 / 3600.0, smp2(WK_PR, x, y));
  let rhl = clamp(mix(ql / qsat(tAtZ(x, y, 200.0), 98000.0), ql / qsat(tS, 100000.0), P.summer), 0.12, 0.95 + 0.04 * wetp);   // ≤ 99% (przesycony cel – podwójny opad: kondensacja nadwyżki + napływ opadu)
  let t65 = tAtZ(x, y, 6500.0);
  let p65 = 100000.0 * pow(pi0Z(6500.0), CP / 287.0);
  let rhh = clamp(atZ(3u, x, y, 6500.0) / qsat(t65, p65), 0.05, 0.97 + 0.02 * smoothstep(0.0, 0.1 / 3600.0, smp2(WK_PR, x, y)));
  // wiatr wygładzony do skali oczka modelu (średnia z 5 punktów co 75 km) – próbkowanie gęściej niż
  // oczko dawało sztuczną zbieżność → wstrząs i rozległy opad w domenie
  var u1 = 0.0;
  var v1 = 0.0;
  var u6 = 0.0;
  var v6 = 0.0;
  var u3 = 0.0;
  var v3 = 0.0;
  // (nad wysokimi górami modelu – Alpy, Tybet – dolny poziom wiatru ≥ 600 m nad terenem: na 1.5 km byłby w gruncie)
  let zl = clamp(smpVz(VZ_HGT, x, y) + 600.0, 1500.0, 4000.0);
  for (var n = 0; n < 5; n++) {
    let ox = select(select(0.0, DXP, n == 1), -DXP, n == 2);
    let oy = select(select(0.0, DXP, n == 3), -DXP, n == 4);
    let wgt = select(0.125, 0.5, n == 0);
    u1 += wgt * atZ(0u, x + ox, y + oy, zl);
    v1 += wgt * atZ(1u, x + ox, y + oy, zl);
    u6 += wgt * atZ(0u, x + ox, y + oy, 6000.0);
    v6 += wgt * atZ(1u, x + ox, y + oy, 6000.0);
    u3 += wgt * atZ(0u, x + ox, y + oy, 3000.0);
    v3 += wgt * atZ(1u, x + ox, y + oy, 3000.0);
  }
  // ruch pionowy ~3 km
  var kw = 0u;
  for (var k = 0u; k < NW; k++) { if (vz[VZ_ZW + k] <= 3000.0) { kw = k; } }
  let w3 = wAt(x, y, kw);
  let psl = 1013.25 + vz[VZ_RC] * smp2(WK_PS, x, y) / 100.0;
  A.p[0] = tS;
  A.p[1] = gam;
  A.p[2] = clamp(ztr, 8500.0, 15000.0);
  // inwersja osiadania: wysokość stała, siła rośnie płynnie z osiadaniem (próg dawał schodki między
  // węzłami siatki parametrów – profil wilgotności skakał)
  A.p[3] = 1000.0 + 1000.0 * P.summer;
  // „inwersja” = różnica między swobodną atmosferą modelu (T na 3 km sprowadzona gradientem Γ do gruntu)
  // a temperaturą przy gruncie: dodatnia – prawdziwa inwersja/osiadanie (zimą, w wyżu), ujemna – warstwa
  // graniczna chłodzi się z wysokością szybciej niż Γ (latem po południu). Wcześniej profil liczony od
  // popołudniowej T przy gruncie + dodatkowa inwersja osiadania podnosiły całą troposferę o 3–5 K
  // ponad model (500 hPa −10 zamiast −13 °C) – za stateczna atmosfera, brak CAPE i burz.
  // (+ przesunięcie przejścia gradientów wokół 3 km – softplus o szerokości 400 m – żeby profil celu trafiał w T na 3 km)
  let tA = t30 + gam * 3000.0 + (gamU - gam) * 0.6931 * 400.0;
  A.p[4] = clamp(tA - tS, -8.0, 8.0);
  A.p[5] = rhl;
  // górna wilgotność dla domeny: pełna tylko przy wznoszeniu wielkoskalowym (fronty, opad); poza nim
  // ~0.7× (0.5× – zimą za mało chmur i mrozy −30 °C) – oczko 75 km uśrednia suche i wilgotne pasma, a prawie nasycona troposfera dawała
  // w domenie wszędzie grube chmury średnie i wysokie (ciepłe noce, słabe nagrzewanie za dnia)
  // „wilgotno” także tam, gdzie model pada (fronty z dala od niżu mają słabe wznoszenie na 3 km, ale opad)
  let wet = max(smoothstep(-0.005, 0.02, w3), smoothstep(0.0, 0.1 / 3600.0, smp2(WK_PR, x, y)));
  A.p[6] = rhh * mix(0.9, 1.0, wet);   // (było 0.7 – gdy PE był za wilgotny w górze; teraz suszyło domenę)
  // wiatr znad warstwy tarcia (1.5 km) ekstrapolowany w dół ścinaniem 1.5–6 km – „geostroficzny przy
  // gruncie”; tarcie i zbieżność w warstwie granicznej tworzy już domena (zbieżność od tarcia z modelu
  // przeniesiona na całą dolną troposferę dawała fałszywe wznoszenie i rozległy opad)
  let dux = (u6 - u1) / (6000.0 - zl);
  let dvy = (v6 - v1) / (6000.0 - zl);
  A.p[7] = u1 - dux * zl;
  A.p[8] = v1 - dvy * zl;
  A.p[9] = dux;
  A.p[10] = dvy;
  A.p[11] = w3;
  A.p[12] = psl;
  // opad modelu [mm/h] i udział konwekcji – napływ chmur i opadu przez brzegi domeny
  let prT = smp2(WK_PR, x, y);
  A.p[13] = 3600.0 * prT;
  A.p[14] = select(0.0, clamp(smp2(WK_PRC, x, y) / prT, 0.0, 1.0), prT > 1e-8);
  // drugi gradient: górna troposfera 5 km … min(9 km, tropopauza − 1 km) – w rzeczywistości ~7 K/km (500→300 hPa),
  // szybciej niż 1–5 km; jeden gradient do tropopauzy dawał za ciepłą górną troposferę celu (mniej CAPE, niższe burze)
  // Hodograf z krzywizną (superkomórki potrzebują skrętu wiatru z wysokością – SRH): (16, 17) wiatr geostroficzny
  // przy gruncie z gradientu ciśnienia modelu minus wiatr z ekstrapolacji liniowej 1.5 → 0 km (skręt w dolnych 1.5 km
  // z adwekcji ciepła/zimna, wiatr termiczny); (18, 19) wiatr na 3 km minus profil liniowy 1.5–6 km. Tarcie, skręt
  // przy gruncie i nocny prąd strumieniowy tworzy już warstwa graniczna domeny.
  {
    let Yf = clamp(y / DXP + f32(NYP) * 0.5 - 0.5, 0.0, f32(NYP) - 1.0);
    let fc = 1.4584e-4 * vz[VZ_SLAT + u32(round(Yf))];
    let fs = select(min(fc, -3e-5), max(fc, 3e-5), fc >= 0.0);
    let ugs = -(smp2(WK_PS, x, y + DXP) - smp2(WK_PS, x, y - DXP)) / (2.0 * DXP * fs);
    let vgs = (smp2(WK_PS, x + DXP, y) - smp2(WK_PS, x - DXP, y)) / (2.0 * DXP * fs);
    var d0 = vec2f(ugs, vgs) - vec2f(A.p[7], A.p[8]);
    d0 *= min(1.0, 15.0 / max(length(d0), 1e-3));
    A.p[16] = d0.x;
    A.p[17] = d0.y;
    var d3 = vec2f(u3, v3) - vec2f(u1 + (u6 - u1) / 3.0, v1 + (v6 - v1) / 3.0);
    d3 *= min(1.0, 15.0 / max(length(d3), 1e-3));
    A.p[18] = d3.x;
    A.p[19] = d3.y;
  }
  // profil wilgotności swobodnej troposfery dla domeny: 1.5 / 3 / 5 / 6.5 km (20 – 3 km, 21–23), względem nasycenia modelu
  // (woda → lód) – 1 = chmura w modelu; poza wznoszeniem i opadem × 0.9 jak górna wilgotność. Wcześniej domena dostawała tylko
  // grunt i 6.5 km (względem wody – zimą chmura lodowa na 6.5 km to ~70%) połączone prostą: nasycona warstwa frontu na 1.5–5 km
  // ginęła (Poznań, grudzień, 20 dób: domena 15 mm przy 58 mm modelu; gdy model padał 0.2 mm/h, RH celu nad warstwą graniczną 33–77%)
  let fw = mix(0.9, 1.0, wet);
  A.p[20] = fw * rhM(x, y, 3000.0);
  A.p[21] = fw * rhM(x, y, 1500.0);
  A.p[22] = fw * rhM(x, y, 5000.0);
  A.p[23] = fw * rhM(x, y, 6500.0);
  let z2 = clamp(A.p[2] - 1000.0, 6500.0, 9000.0);
  A.p[15] = clamp((t56 - tAtZ(x, y, z2)) / (z2 - 5600.0), 0.005, 0.0095);
  A.p[24] = gamU;
  A.tDay = tday - 273.15;
  let Y = clamp(y / DXP + f32(NYP) * 0.5 - 0.5, 0.0, f32(NYP) - 1.0);
  let j0 = u32(floor(Y));
  let tn = mix(vz[VZ_TN + j0], vz[VZ_TN + min(j0 + 1u, NYP - 1u)], Y - floor(Y));
  A.tAnom = tday - tn;
  A.ql = ql;
  A.pr = smp2(WK_PR, x, y);
  return A;
}

// siatka parametrów domeny zagnieżdżonej: każdy węzeł = suma ważona do 4 próbek (strefa wyrównania
// łączy przeciwległe brzegi); zapis wprost do bufora vg domeny
@compute @workgroup_size(64)
fn pe_params(@builtin(global_invocation_id) gid: vec3u) {
  let n = gid.x;
  if (n >= P.nodeCount) { return; }
  var acc: array<f32, 25>;
  for (var s = 0u; s < 4u; s++) {
    let o = VZ_NODES + (n * 4u + s) * 3u;
    let wgt = vz[o + 2u];
    if (wgt <= 0.0) { continue; }
    var A = air(P.cx + vz[o], P.cy + vz[o + 1u]);
    for (var p = 0u; p < 25u; p++) { acc[p] += wgt * A.p[p]; }
  }
  for (var p = 0u; p < 25u; p++) { nest[P.pgOff + p * P.nodeCount + n] = acc[p]; }
}

// wektor środka domeny (do interfejsu) i trajektoria wsteczna 3 doby (historia wiatru ~1.5 km)
@compute @workgroup_size(1)
fn pe_center() {
  var A = air(P.cx, P.cy);
  for (var p = 0u; p < 13u; p++) { wk[WK_CEN + p] = A.p[p]; }
  wk[WK_CEN + 13u] = A.tDay;
  wk[WK_CEN + 14u] = A.tAnom;
  wk[WK_CEN + 15u] = A.ql;
  wk[WK_CEN + 16u] = A.pr * 3600.0;
  wk[WK_CEN + 20u] = A.p[15];
  wk[WK_CEN + 21u] = smp2(WK_SM, P.cx, P.cy);   // woda w glebie (wiadro 0…1) – start gleby domeny
  wk[WK_CEN + 22u] = A.p[20];                     // wilgotność względna na 3 km (względem nasycenia woda → lód)
  wk[WK_CEN + 23u] = A.p[24];                     // gradient 3–5.6 km
  // trajektoria wsteczna: sloty co 3 h, od najnowszego
  var x = P.cx;
  var y = P.cy;
  var seaS = 0.0;
  var openS = 0.0;
  var nS = 0.0;
  var yMax = P.cy;
  var yMin = P.cy;
  for (var h = 0u; h < P.nhist; h++) {
    let slot = (P.hslot + 48u - h) % 24u;
    let o = WK_HIST + slot * 2u * N2;
    x -= smp2(o, x, y) * 3.0 * 3600.0;
    y -= smp2(o + N2, x, y) * 3.0 * 3600.0;
    let sea = smpVz(VZ_SEA, x, y);
    seaS += sea;
    // otwarta woda (bez lodu – jak landLike: temperatura morza ≥ 271.5 K) – masa morska; lód morski i ląd – kontynentalna
    openS += sea * step(271.5, smpVz(VZ_TS, x, y));
    yMax = max(yMax, y);
    yMin = min(yMin, y);
    nS += 1.0;
  }
  wk[WK_CEN + 17u] = select(0.5, seaS / nS, nS > 0.0);
  wk[WK_CEN + 18u] = y - P.cy;                 // > 0: powietrze przyszło z północy
  wk[WK_CEN + 19u] = x - P.cx;
  wk[WK_CEN + 24u] = select(0.5, openS / nS, nS > 0.0);
  wk[WK_CEN + 25u] = yMax - P.cy;              // najdalej na północ po drodze (masy arktyczne)
  wk[WK_CEN + 26u] = yMin - P.cy;              // najdalej na południe
  wk[WK_CEN + 27u] = smpVz(VZ_SEA, x, y) * step(271.5, smpVz(VZ_TS, x, y));   // początek nad otwartą wodą
}

// zapis wiatru ~1.5 km (warstwa 3) do historii, slot P.hslot
@compute @workgroup_size(64)
fn pe_hist(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x;
  if (c >= N2) { return; }
  let i = i32(c % NXP);
  let j = i32(c / NXP);
  let o = WK_HIST + P.hslot * 2u * N2;
  // (nad wysokimi górami – warstwa nad najniższą warstwą przy gruncie)
  let kh = i32(max(3u, min(kbot(hgt(c)) + 1u, NZP - 1u)));
  wk[o + c] = 0.5 * (sOut[ix(i, j, kh)] + sOut[ix(i + 1, j, kh)]);
  wk[o + N2 + c] = 0.5 * (sOut[N3 + ix(i, j, kh)] + select(sOut[N3 + ix(i, j + 1, kh)], 0.0, j + 1 >= i32(NYP)));
}

// pola 2D do mapy synoptycznej: ciśnienie [hPa], temperatura przy gruncie [°C], opad [mm/h],
// temperatura ~1.5 km [°C] (fronty) → wk od WK_LAP (bufor laplasjanu jest wtedy wolny)
@compute @workgroup_size(64)
fn pe_map(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x;
  if (c >= N2) { return; }
  let i = c % NXP;
  let j = c / NXP;
  let t0 = (vz[VZ_TH0] + wk[WK_D24 + c]) * vz[VZ_PI0];
  let t1 = (vz[VZ_TH0 + 1u] + wk[WK_D24 + N2 + c]) * vz[VZ_PI0 + 1u];
  let gl = clamp((t0 - t1) / (vz[VZ_ZC + 1u] - vz[VZ_ZC]), -0.01, 0.0098);
  wk[WK_LAP + c] = 1013.25 + vz[VZ_RC] * wk[WK_PS + c] / 100.0;
  wk[WK_LAP + N2 + c] = t0 + gl * vz[VZ_ZC] - 273.15;
  wk[WK_LAP + 2u * N2 + c] = wk[WK_PR + c] * 3600.0;
  let x = (f32(i) + 0.5 - f32(NXP) * 0.5) * DXP;
  let y = (f32(j) + 0.5 - f32(NYP) * 0.5) * DXP;
  wk[WK_LAP + 3u * N2 + c] = tAtZ(x, y, 1500.0) - 273.15;
  // poziomy: T ~700 hPa (3 km) i ~500 hPa (5.6 km), wiatr na 1.5 i 5.6 km, wysokość 500 hPa [dam]
  // (hipsometrycznie ze średniej temperatury warstwy do 5.6 km)
  let t3 = tAtZ(x, y, 3000.0);
  let t5 = tAtZ(x, y, 5600.0);
  wk[WK_LAP + 4u * N2 + c] = t3 - 273.15;
  wk[WK_LAP + 5u * N2 + c] = t5 - 273.15;
  wk[WK_LAP + 6u * N2 + c] = atZ(0u, x, y, 1500.0);
  wk[WK_LAP + 7u * N2 + c] = atZ(1u, x, y, 1500.0);
  wk[WK_LAP + 8u * N2 + c] = atZ(0u, x, y, 5600.0);
  wk[WK_LAP + 9u * N2 + c] = atZ(1u, x, y, 5600.0);
  let tm = 0.5 * (t3 + 0.5 * (tAtZ(x, y, 1500.0) + t5));   // ~temperatura środka warstwy (bez kontrastu ląd–morze)
  wk[WK_LAP + 10u * N2 + c] = 287.0 * tm / 9.81 * log(wk[WK_LAP + c] / 500.0) / 10.0;
  wk[WK_LAP + 11u * N2 + c] = wk[WK_PRC + c] * 3600.0;   // opad konwekcyjny [mm/h]
  // promieniowanie: OLR, pochłonięte krótkofalowe [W/m²], zachmurzenie, temperatura powierzchni [°C]
  wk[WK_LAP + 12u * N2 + c] = wk[WK_RD + c];
  wk[WK_LAP + 13u * N2 + c] = wk[WK_RD + N2 + c];
  wk[WK_LAP + 14u * N2 + c] = wk[WK_RD + 2u * N2 + c];
  wk[WK_LAP + 15u * N2 + c] = tSurf(c) - 273.15;
  for (var n = 0u; n < 4u; n++) { wk[WK_LAP + (16u + n) * N2 + c] = wk[WK_RD + (4u + n) * N2 + c]; }
  // woda w glebie (0…1), konwekcja Bettsa–Millera: CAPE cząstki, działa (pada), zablokowana (sucha warstwa chmurowa)
  wk[WK_LAP + 20u * N2 + c] = wk[WK_SM + c];
  for (var n = 0u; n < 3u; n++) { wk[WK_LAP + (21u + n) * N2 + c] = wk[WK_BMD + n * N2 + c]; }
}
