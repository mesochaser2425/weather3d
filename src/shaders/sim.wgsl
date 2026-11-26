// Rdzeń modelu: anelastyczne równania ruchu, adwekcja semi-lagrangeowska, wyporność z wilgocią,
// turbulencja podsiatkowa i K-profil, powierzchnia (promieniowanie, gleba, strumienie), mikrofizyka (deszcz dwumomentowy,
// lód z liczbą kryształków), konwekcja parametryzowana, oczka przycięte do terenu, rzut ciśnienia (FFT w poziomie + Thomas
// w pionie; z terenem: gradienty sprzężone z tym samym solverem jako prekondycjonerem).
//
// Kolejność w jednym kroku (CLAUDE.md, sekcja 4):
//   surface → route → front_phi → advect (state→tmp) → mass_sum / scale / apply → lbc_means → lbc_apply → turb_k → lap4
//   → diffuse (tmp→state; wyporność, Coriolis, tarcie) → micro → cumulus → org_update → cu_spread
//   → cg_init (r = D − Aφ) → prekondycjoner [fft_x → fft_y → tridiag → ifft_y → ifft_x] (z = M⁻¹ r) → cg_rz
//   → płasko: phi_add (φ += z)   z terenem: iteracje CG
//   → project (state w miejscu)
// Duża skala (model synoptyczny albo stała masa powietrza) wchodzi przez pola docelowe (bufor tgt):
//   advect dodaje zmianę pola docelowego wzdłuż trajektorii cząstki, lbc_apply przyciąga brzegi
//   (strefa relaksacji Daviesa) i swobodną atmosferę do pola docelowego.

const WG: u32 = 256u;

struct Params {
  dt: f32,
  time: f32,
  step: u32,
  noiseAmp: f32,     // amplituda szumu θ' w najniższej warstwie [K / krok]
  dampStart: f32,    // początek warstwy tłumiącej [m]
  dampTau: f32,      // skala czasowa tłumienia [s]
  ugeo: f32,         // wiatr geostroficzny [m/s]
  vgeo: f32,
  fcor: f32,         // parametr Coriolisa f = 2Ω sin φ
  sunX: f32,         // kierunek do słońca (x = wschód, y = północ, z = pion)
  sunY: f32,
  sunZ: f32,
  s0: f32,           // stała słoneczna [W/m²]
  sliceZ: f32,       // wysokość przekroju poziomego [m] (statystyki do skali kolorów)
  viewTop: f32,      // górna granica przekroju pionowego [m]
  sliceJ: u32,       // wiersz przekroju pionowego
  fieldH: u32,       // pole na przekroju poziomym / mapie
  fieldV: u32,       // pole na przekroju pionowym
  wls: f32,          // osiadanie wielkoskalowe w troposferze [m/s] (ujemne = w dół)
  ta0: f32,          // waga czasowa pól docelowych dla stanu wyjściowego (t), między terminami A i B
  ta1: f32,          // … dla stanu po kroku (t + Δt)
  tslot: u32,        // slot pól docelowych ze starszym terminem (A)
  bslot: u32,        // slot przebudowywany przez tgt_build
  initCool: f32,     // nocne wychłodzenie przy gruncie na starcie [K]
  nudge: f32,        // tempo przyciągania swobodnej atmosfery do pola docelowego [1/s]
  tsOff: f32,        // o ile cel przy gruncie jest cieplejszy od średniej dobowej (sondaż „popołudniowy”) [K]
  hmax: f32,         // najwyższy punkt terenu [m] (cień gór)
  hydro: f32,        // 1 – hydrologia (wsiąkanie, spływ, rzeki), 0 – sama gleba („wiadro”)
  lat0: f32,         // szerokość geograficzna środka mapy [°]
  decl: f32,         // deklinacja słońca [rad]
  hang: f32,         // kąt godzinny słońca w środku mapy [rad]
  tanom: f32,        // anomalia temperatury masy powietrza dużej skali [K] (suwak w zakładce Pogoda)
  ddecl: f32,        // zmiana deklinacji słońca [rad/dobę] (> 0: na półkuli N dzień się wydłuża) – fenologia
  rainF: f32,        // manipulacja atmosfery: mnożnik opadu (1 – bez zmian)
  sstD: f32,        // manipulacja atmosfery: zmiana anomalii temperatury morza w tym kroku [K] (woda domeny – płynnie, przez czas kick-in)
  _r2: f32,
}

// Szerokość geograficzna wiersza j [rad] (duże mapy: kilkanaście stopni różnicy N–S)
fn latAt(j: i32) -> f32 {
  return radians(P.lat0 + (f32(j) + 0.5 - f32(MG) - 0.5 * f32(NYD)) * DY / 111195.0);
}
// Kierunek do słońca w oczku (i, j): szerokość z wiersza, czas słoneczny z długości (na mapie Europy
// różnica ~2 h W–E i ~20° szerokości – wcześniej całe słońce liczone dla środka mapy)
fn sunAt(i: i32, j: i32) -> vec3f {
  let phi = latAt(j);
  let dlon = (f32(i) + 0.5 - f32(MG) - 0.5 * f32(NXD)) * DX / (111195.0 * max(cos(phi), 0.05));
  let h = P.hang + radians(dlon);
  let sd = sin(P.decl);
  let cd = cos(P.decl);
  return vec3f(-cd * sin(h), cos(phi) * sd - sin(phi) * cd * cos(h), sin(phi) * sd + cos(phi) * cd * cos(h));
}
// parametr Coriolisa w wierszu j (płaszczyzna β na dużych mapach)
fn fcorAt(j: i32) -> f32 { return 1.4584e-4 * sin(latAt(j)); }

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> vg: array<f32>;            // profile bazowe, cos/sin, teren
@group(0) @binding(2) var<storage, read_write> state: array<f32>;   // u, v, w, θ', q_v, q_c, q_r (stan n)
@group(0) @binding(3) var<storage, read_write> tmp: array<f32>;     // stan po adwekcji i wymuszeniach
@group(0) @binding(4) var<storage, read_write> work: array<f32>;    // φ | r | z | p | Ap | sumy | skalary | średnie
@group(0) @binding(5) var<storage, read_write> cx: array<vec2f>;    // [0,N): K lub widmo A, [N,2N): widmo B
@group(0) @binding(6) var<storage, read_write> stats: array<atomic<u32>>;
@group(0) @binding(7) var<storage, read_write> sfc: array<f32>;     // pola przy powierzchni (S_* · NXY + kolumna)
@group(0) @binding(8) var<storage, read_write> tgt: array<f32>;     // pola docelowe: 2 terminy × (θ', q_v, u, v, u_g, v_g, p)

fn ldb(b: u32, i: u32) -> f32 { return state[i]; }

fn lin_id(gid: vec3u, nwg: vec3u) -> u32 { return gid.x + gid.y * nwg.x * WG; }

fn hash(x: u32) -> u32 {
  var h = x * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  return (h >> 22u) ^ h;
}
fn rand11(x: u32) -> f32 { return f32(hash(x)) / 4294967295.0 * 2.0 - 1.0; }

// (Bez szumu wyzwalającego: losowe „termiki”, szum komórkowy i mezoskalowy wyzwalały konwekcję wszędzie, gdzie było
// CAPE – zbędny opad przy prawdziwych komórkach burzowych. Wyzwalanie wyłącznie przez wznoszenie, patrz pole LIFT.)

fn cidx(i: i32, j: i32, k: u32) -> u32 { return k * NXY + wrapi(j, NY) * NX + wrapi(i, NX); }
fn sf(s: u32, col: u32) -> u32 { return s * NXY + col; }
// suma opadu z kompensacją błędu zaokrągleń (Kahan): przy sumach rzędu tysięcy mm drobne przyrosty z jednego kroku
// (mżawka ~0.0005 mm) ginęłyby w liczbach 32-bitowych – długie przebiegi (miesiące, lata) i historie stacji
// (+ liczniki miesiąca do widoku „Miesiące”: opad i jego część śnieżna [mm] – sumy miesięczne są małe, bez Kahana)
fn addPacc(col: u32, inc: f32, snow: f32) {
  let y = inc - sfc[sf(S_PACCC, col)];
  let s0 = sfc[sf(S_PACC, col)];
  let t = s0 + y;
  sfc[sf(S_PACCC, col)] = (t - s0) - y;
  sfc[sf(S_PACC, col)] = t;
  sfc[sf(S_MPR, col)] += inc;
  sfc[sf(S_MSN, col)] += snow;
}

// --- Teren: kb = liczba podziemnych komórek w kolumnie ---
fn kbAt(i: i32, j: i32) -> u32 { return u32(vg[VG_KB + wrapi(j, NY) * NX + wrapi(i, NX)]); }
fn fluid(i: i32, j: i32, k: u32) -> bool { return k >= kbAt(i, j); }
fn openU(i: i32, j: i32, k: u32) -> bool { return k >= max(kbAt(i - 1, j), kbAt(i, j)); }
fn openV(i: i32, j: i32, k: u32) -> bool { return k >= max(kbAt(i, j - 1), kbAt(i, j)); }
// Wiatr w środku oczka z otwartych ścian (teren schodkowy: ściana przy wyższym sąsiedzie ma u = 0 – średnia z nią
// dawała przy stopniu połowę wiatru, a w „dołku” niższym od obu sąsiadów zero; ~5% oczek na terenie 4 km).
// Zwraca (wiatr, liczba otwartych ścian).
fn cellU(i: i32, j: i32, k: u32) -> vec2f {
  let oW = openU(i, j, k);
  let oE = openU(i + 1, j, k);
  let n = select(0.0, 1.0, oW) + select(0.0, 1.0, oE);
  return vec2f((select(0.0, state[U_OFF + cidx(i, j, k)], oW) + select(0.0, state[U_OFF + cidx(i + 1, j, k)], oE)) / max(n, 1.0), n);
}
fn cellV(i: i32, j: i32, k: u32) -> vec2f {
  let oS = openV(i, j, k);
  let oN = openV(i, j + 1, k);
  let n = select(0.0, 1.0, oS) + select(0.0, 1.0, oN);
  return vec2f((select(0.0, state[V_OFF + cidx(i, j, k)], oS) + select(0.0, state[V_OFF + cidx(i, j + 1, k)], oN)) / max(n, 1.0), n);
}
// wiatr przy gruncie (wymiana z podłożem, wiatr 10 m, stacje): w dołku zamkniętym z obu stron – z warstwy wyżej
fn sfcU(i: i32, j: i32, kb: u32) -> f32 {
  for (var k = kb; k < min(kb + 3u, NZ); k++) { let a = cellU(i, j, k); if (a.y > 0.0) { return a.x; } }
  return 0.0;
}
fn sfcV(i: i32, j: i32, kb: u32) -> f32 {
  for (var k = kb; k < min(kb + 3u, NZ); k++) { let a = cellV(i, j, k); if (a.y > 0.0) { return a.x; } }
  return 0.0;
}
fn openW(i: i32, j: i32, k: u32) -> bool { return k > kbAt(i, j) && k < NZ; }
// Oczka przycięte do terenu (shaved cells, Adcroft i in. 1997): najniższa komórka kb ma nad gruntem tylko część hf
// grubości (prawdziwa wysokość terenu), ściany między kolumnami są otwarte w części nad gruntem obu sąsiadów.
// Przepływ nad zboczem wznosi się łagodnie przez kolejne oczka zamiast uderzać w stopień (teren schodkowy dawał na
// każdym konturze terenu na granicy warstw nieruchomą linię wznoszenia i osiadania – termiki i chmury stały w miejscu)
fn hfAt(i: i32, j: i32) -> f32 { return vg[VG_HF + wrapi(j, NY) * NX + wrapi(i, NX)]; }
fn openFrac(i: i32, j: i32, k: u32) -> f32 { let kb = kbAt(i, j); return select(select(1.0, hfAt(i, j), k == kb), 0.0, k < kb); }
fn aU(i: i32, j: i32, k: u32) -> f32 { return min(openFrac(i - 1, j, k), openFrac(i, j, k)); }
fn aV(i: i32, j: i32, k: u32) -> f32 { return min(openFrac(i, j - 1, k), openFrac(i, j, k)); }
// masa powietrza w komórce k kolumny na jednostkę powierzchni [kg/m²]: komórka przy gruncie (kb) ma tylko część hf grubości. Bilanse wody i ciepła liczone z pełną grubością
// tworzyły wodę: schemat konwekcji zdejmował parę z warstwy podchmurowej proporcjonalnie do pełnej masy komórki kb, a opad liczył z całości (do ~2% opadu schematu w terenie z hf < 1)
fn mlay(k: u32, kb: u32, col: u32) -> f32 { return vg[VG_RC + k] * vg[VG_DZC + k] * select(1.0, vg[VG_HF + col], k == kb); }
// wysokość gruntu [m]: dół części komórki kb nad gruntem
fn zgC(col: u32) -> f32 { let kb = u32(vg[VG_KB + col]); return vg[VG_ZW + kb + 1u] - vg[VG_HF + col] * vg[VG_DZC + kb]; }
// Temperatura do rozdziału deszcz / śnieg przy gruncie: ~30 m nad prawdziwym gruntem, liniowo między poziomami siatki. Temperatura samej komórki kb jest
// na stałej wysokości środka warstwy, więc w górach była taka sama na całym tarasie o tym samym kb i skakała ~1.3 K na granicy warstw (200 m) – przy
// przedziale deszcz–śnieg 2 K zmieniało to udział śniegu o ~65% i pokrywa śnieżna wychodziła na mapie tarasowo (?phs=0 – dawne, A/B)
fn tPhase(col: u32, kb: u32, th0: f32, th1: f32) -> f32 {
  let t0 = (vg[VG_TC + kb] + th0) * vg[VG_EXC + kb];
  if (PHS < 0.5) { return t0; }
  let t1 = (vg[VG_TC + kb + 1u] + th1) * vg[VG_EXC + kb + 1u];
  return t0 + (t1 - t0) * clamp((zgC(col) + 30.0 - vg[VG_ZC + kb]) / (vg[VG_ZC + kb + 1u] - vg[VG_ZC + kb]), -1.0, 1.0);
}

// ======================= Powierzchnia =======================
// Promieniowanie: krótkofalowe ze słońca (masa optyczna, nachylenie stoku, przepuszczalność chmur),
// długofalowe z atmosfery (Brutsaert + chmury) i z gruntu. Wymiana gruntu z powietrzem: Louis (1979)
// z liczby Richardsona. Gleba: force-restore (Deardorff 1978) i "wiadro" wody.
const SIGMA: f32 = 5.67e-8;
const TAU1: f32 = 86400.0;
const TFW: f32 = 272.85;      // zamarzanie wody (słodka 0 °C, słonawa niżej – kompromis −0.3 °C)
const HMIX: f32 = 10.0;       // głębokość warstwy wymieszanej wody (jezioro, morze) [m]
// Gleba 3-warstwowa (0–10, 10–40, 40–100 cm), glina piaszczysta / gleba średnia (loam) wg Clappa i Hornbergera
// (1978): porowatość θs, wykładnik b, przewodność nasycona Ks [mm/s], potencjał nasycenia ψs [mm]; wilgotność
// względna s = θ/θs, punkt więdnięcia (ψ = −150 m) i polowa pojemność wodna (ψ = −3.3 m) z krzywej retencji
const SM_SAT: f32 = 0.45;
const SM_B: f32 = 5.3;
const SM_KS: f32 = 7.0e-3;
const SM_PSI: f32 = 480.0;
const SM_WILT: f32 = 0.34;
const SM_FC: f32 = 0.70;

// Wysokość terenu (gładka) w punkcie (x, y) [indeksy oczek], interpolacja dwuliniowa
fn hgtBil(x: f32, y: f32) -> f32 {
  let i0 = i32(floor(x));
  let j0 = i32(floor(y));
  let fx = x - f32(i0);
  let fy = y - f32(j0);
  let h00 = vg[VG_HGT + cidx(i0, j0, 0u)];
  let h10 = vg[VG_HGT + cidx(i0 + 1, j0, 0u)];
  let h01 = vg[VG_HGT + cidx(i0, j0 + 1, 0u)];
  let h11 = vg[VG_HGT + cidx(i0 + 1, j0 + 1, 0u)];
  return mix(mix(h00, h10, fx), mix(h01, h11, fx), fy);
}

// Cień rzucany przez góry: promień od kolumny w stronę słońca (krok 0.75 oczka) – 0 w pełnym cieniu,
// 1 w słońcu; brzeg cienia rozmyty na ±30 m wysokości promienia
fn sunShadow(i: i32, j: i32, sv: vec3f) -> f32 {
  let hz = length(sv.xy);
  if (P.hmax < 50.0 || hz < 1e-4) { return 1.0; }
  let tanE = sv.z / hz;
  let dx = sv.x / hz;
  let dy = sv.y / hz;
  let h0 = vg[VG_HGT + cidx(i, j, 0u)];
  var f = 1.0;
  for (var s = 1; s <= 96; s++) {
    let d = 0.75 * f32(s);
    let hr = h0 + d * DX * tanE;
    if (hr > P.hmax + 30.0) { break; }
    f = min(f, smoothstep(-30.0, 30.0, hr - hgtBil(f32(i) + dx * d, f32(j) + dy * d)));
    if (f <= 0.0) { break; }
  }
  return f;
}

// Parametry podłoża jednej klasy (biomu): albedo (z fenologią), opór szparkowy, odwrotność pojemności
// cieplnej warstwy powierzchniowej, log szorstkości, zieleń, zasłanianie śniegu przez drzewa
// Pojemność: wartości jak w ISBA (Noilhan i Mahfouf 1996: roślinność ~2·10⁻⁵, las 1·10⁻⁵ K m²/J), powierzchnia roślin, nie goła gleba. Wcześniej ~2× mniejsze: grunt miał amplitudę dobową ~10 K, nocą
// tylko 0.4 K pod powietrzem, ciepło z gleby równoważyło stratę promieniowania – noce za ciepłe (Kraków, 8 km, lipiec, ta sama pogoda: Tmin 14.35 → 12.16 °C, Tmax 23.28 → 23.41 °C, amplituda 8.9 → 11.3 K,
// w pomiarach 11.3 K; styczeń: amplituda 5.6 → 6.7 K, w pomiarach ~6.2 K). Zabudowa bez zmian (masa miasta).
// Opór szparkowy – całego łanu, nie liścia (uprawy FAO-56 ~70 s/m jako średnia dnia, w południe ~35–50; las 80–130). Wcześniej ~2× większy: parowanie latem 1.7–2.8 mm/d, rok 250–410 mm przy
// ~450–500 mm w bilansie wodnym Polski, RH latem 57% przy 73%, ciepło jawne ≈ utajone (Bowen ~1, typowo 0.4–0.7) – za gorąco, za sucho, podstawa chmur za wysoko, za dużo słońca.
struct VegP { alb: f32, rs: f32, ct: f32, lz0: f32, green: f32, mask: f32, urb: f32 }
// tdg – temperatura fenologiczna [°C] (pole TPHN: średnia z ~15 dób z pamięcią jesienną, patrz surface), w – woda w glebie,
// pd – jesienne skracanie dnia (1 – brak; maleje, gdy dzień krótszy niż ~11.5 h): drzewa liściaste tracą liście w październiku
// także w ciepłą jesień (fotoperiod), trawy słabiej
fn vegPar(veg: u32, w: f32, tdg: f32, pd: f32) -> VegP {
  var green = 1.0;
  var albG = 0.20;
  var albD = 0.22;
  var rsmin = 35.0;
  var ct = 2.4e-5;
  var z0 = 0.05;
  var masks = false;
  switch veg {
    case 0u: { green = smoothstep(3.0, 10.0, tdg) * mix(0.5, 1.0, pd); }                                  // pola, łąki
    case 1u: { albG = 0.15; albD = 0.17; rsmin = 80.0; ct = 1.4e-5; z0 = 0.9; masks = true; green = smoothstep(6.0, 12.0, tdg) * pd; }
    case 2u: { albG = 0.09; albD = 0.09; rsmin = 100.0; ct = 1.4e-5; z0 = 1.0; masks = true; green = 0.3 + 0.7 * smoothstep(-3.0, 2.0, tdg); }
    case 3u: { albG = 0.18; albD = 0.20; rsmin = 80.0; ct = 3.0e-5; z0 = 0.03; green = smoothstep(2.0, 8.0, tdg); }
    case 4u: { albG = 0.70; albD = 0.70; rsmin = 0.0; ct = 3.0e-5; z0 = 0.001; green = 0.0; }               // lodowiec
    case 5u: { albG = 0.13; albD = 0.13; rsmin = 50.0; ct = 1.2e-5; z0 = 2.0; masks = true; green = smoothstep(0.1, 0.35, w); }
    case 6u: { albG = 0.18; albD = 0.25; rsmin = 80.0; ct = 2.8e-5; z0 = 0.2; green = smoothstep(0.2, 0.5, w); }
    case 7u: { albG = 0.35; albD = 0.35; rsmin = 3000.0; ct = 4.4e-5; z0 = 0.01; green = 0.0; }             // pustynia
    case 8u: { albG = 0.20; albD = 0.25; rsmin = 100.0; ct = 3.0e-5; z0 = 0.03; green = smoothstep(0.2, 0.5, w) * smoothstep(3.0, 10.0, tdg); }
    case 9u: { albG = 0.15; albD = 0.15; rsmin = 280.0; ct = 0.9e-5; z0 = 0.6; green = 0.2; }              // zabudowa
    case 10u: { albG = 0.07; albD = 0.07; rsmin = 0.0; ct = 0.0; z0 = 0.0002; green = 0.0; }                // woda
    case 11u: { albG = 0.13; albD = 0.15; rsmin = 100.0; ct = 1.8e-5; z0 = 0.6; masks = true; green = 0.6 + 0.4 * smoothstep(0.15, 0.4, w); }
    default: {}
  }
  var rs = rsmin;
  // bez liści transpiracja słabnie (zostaje parowanie z gleby i resztek roślin)
  if (veg <= 8u || veg == 11u) { rs = rsmin / max(green, 0.1); }
  return VegP(mix(albD, albG, green), rs, ct, log(z0), green, select(0.0, 1.0, masks), select(0.0, 1.0, veg == 9u));
}

@compute @workgroup_size(64)
fn surface(@builtin(global_invocation_id) gid: vec3u) {
  let col = gid.x;
  if (col >= NXY) { return; }
  let i = i32(col % NX);
  let j = i32(col / NX);
  let kb = kbAt(i, j);
  let c = kb * NXY + col;
  let dt = P.dt;
  let rho = vg[VG_RC + kb];
  let pi1 = vg[VG_EXC + kb];
  let th1 = vg[VG_TC + kb] + state[T_OFF + c];
  let qv1 = max(state[QV_OFF + c], 0.0);
  let t1 = th1 * pi1;
  let z1 = 0.5 * vg[VG_HF + col] * vg[VG_DZC + kb];       // wysokość 1. poziomu nad gruntem (część komórki nad gruntem)
  let pis = pi1 + G / (CP * vg[VG_TC + kb]) * z1;          // Exner przy gruncie
  let ps = P0 * pow(pis, CP / RD);
  let u1 = sfcU(i, j, kb);
  let v1 = sfcV(i, j, kb);
  // Roślinność (biom z klimatu i wysokości, climate.js) z fenologią: zieleń zależy od temperatury fenologicznej
  // (strefa umiarkowana i chłodna) albo od wilgotności gleby (tropiki, step).
  // Parametry: albedo (zielone / uśpione), minimalny opór szparkowy, odwrotność pojemności cieplnej
  // warstwy powierzchniowej, szorstkość.
  let veg = u32(vg[VG_VEG + col] + 0.5);
  let w = sfc[sf(S_W, col)];
  // Fenologia: średnia krocząca T 2 m z ~15 dób (dwa stopnie wygładzania po 3.75 doby – odpowiedź jak średnia z 15 dni,
  // cykl dobowy znika) i temperatura fenologiczna z pamięcią: za ochłodzeniem idzie od razu (τ 5 dób – liście żółkną
  // i opadają w ~2–3 tygodnie), w górę tylko, gdy dzień się wydłuża (od ~10 h; wiosna) albo jest długi (≥ 13–15 h, lato).
  // Jesienią (dzień krótki i krótszy) ciepły epizod nie przywraca zieleni. Wcześniej zieleń szła za temperaturą
  // „głębszej gleby”, która dogania powierzchnię w ~1 dobę – po 2–3 ciepłych dniach jesienią pola i lasy odrastały.
  // W tropikach (|φ| < 15°, bez pór roku światła) bez blokady.
  let a15 = min(dt / (3.75 * 86400.0), 1.0);
  let tpa = sfc[sf(S_TPHA, col)] + a15 * (sfc[sf(S_T2, col)] - sfc[sf(S_TPHA, col)]);
  let tph = sfc[sf(S_TPH, col)] + a15 * (tpa - sfc[sf(S_TPH, col)]);
  var tdg = sfc[sf(S_TPHN, col)];
  let aph = min(dt / (5.0 * 86400.0), 1.0);
  let phi = latAt(j);
  let daylen = 7.6394373 * acos(clamp(-tan(phi) * tan(P.decl), -1.0, 1.0));   // długość dnia [h] (24/π · acos)
  let longer = P.ddecl * sign(phi) > 0.0;
  let seas = smoothstep(15.0, 30.0, abs(degrees(phi)));                          // pory roku światła (poza tropikami)
  // gdy dzień się wydłuża (wiosna), rozwój tylko naprzód: chłodny tydzień w maju go wstrzymuje, ale liście nie znikają
  if (tph < tdg) {
    tdg += aph * mix(1.0, select(1.0, 0.0, longer), seas) * (tph - tdg);
  } else {
    let fup = max(select(0.0, smoothstep(10.0, 12.0, daylen), longer), smoothstep(13.0, 15.0, daylen));
    tdg += aph * mix(1.0, fup, seas) * (tph - tdg);
  }
  // jesienny fotoperiod (dzień krótszy niż ~11.5 h i coraz krótszy): na 50°N liście opadają ~1–31 X
  let pd = mix(1.0, select(smoothstep(9.5, 11.5, daylen), 1.0, longer), seas);
  sfc[sf(S_TPHA, col)] = tpa;
  sfc[sf(S_TPH, col)] = tph;
  sfc[sf(S_TPHN, col)] = tdg;
  // Granice pokrycia rozmyte: parametry uśrednione z otoczenia 5 × 5 oczek (wagi Gaussa 1-4-6-4-1, jak
  // ułamki pokrycia w oczku) – na brzegu lasu T przy gruncie zmienia się płynnie, nie skokiem między oczkami.
  // Woda i lodowiec bez uśredniania (mają własny bilans); opór szparkowy uśredniany jako przewodność.
  var vp = vegPar(veg, w, tdg, pd);
  if (veg != 10u && veg != 4u) {
    var ws = 0.0;
    var aa = 0.0;
    var gc = 0.0;
    var cc2 = 0.0;
    var lz = 0.0;
    var gr = 0.0;
    var mk = 0.0;
    var ub = 0.0;
    let bw = array<f32, 5>(1.0, 4.0, 6.0, 4.0, 1.0);
    for (var dj = -2; dj <= 2; dj++) {
      for (var di = -2; di <= 2; di++) {
        let vn = u32(vg[VG_VEG + cidx(i + di, j + dj, 0u)] + 0.5);
        if (vn == 10u || vn == 4u) { continue; }
        let q = vegPar(vn, w, tdg, pd);
        let wt = bw[di + 2] * bw[dj + 2];
        ws += wt; aa += wt * q.alb; gc += wt / max(q.rs, 1.0); cc2 += wt * q.ct; lz += wt * q.lz0;
        gr += wt * q.green; mk += wt * q.mask; ub += wt * q.urb;
      }
    }
    vp = VegP(aa / ws, ws / gc, cc2 / ws, lz / ws, gr / ws, mk / ws, ub / ws);
  }
  let green = vp.green;
  let rsmin = vp.rs;
  var ct = vp.ct;
  let z0 = exp(vp.lz0);
  let water = veg == 10u;
  // lód na wodzie (jeziora, morze): grubość [m]; na lodzie może leżeć śnieg
  var ice = select(0.0, sfc[sf(S_ICE, col)], water);
  let frozen = ice > 0.0;
  var albedo = select(vp.alb, 0.45, frozen);
  sfc[sf(S_GRN, col)] = green;
  // pokrywa śnieżna (ekwiwalent wody [mm]); na wodzie się nie utrzymuje, lodowiec – zawsze
  var swe = select(sfc[sf(S_SWE, col)], 0.0, water && !frozen);
  if (veg == 4u) { swe = max(swe, 200.0); }
  // grubość pokrywy [m]: gęstość swe/snd w granicach 50–550 kg/m³ (bez zapisanej grubości – śnieg uleżały, ~250 kg/m³)
  var snd = select(sfc[sf(S_SND, col)], 0.0, water && !frozen);
  if (snd <= 0.0) { snd = swe / 250.0; }
  snd = clamp(snd, swe / 550.0, swe / 50.0);
  let fsn = min(swe / 10.0, 1.0);
  // albedo śniegu maleje z wiekiem pokrywy: świeży ~0.85, po tygodniach ~0.5 (zabrudzenie, przemiana)
  let asn = 0.50 + 0.35 * exp(-sfc[sf(S_SNAGE, col)] / 5.0);
  albedo = mix(albedo, asn, fsn * mix(1.0, 0.4, vp.mask));
  ct = select(mix(ct, 5.0e-5, fsn), 0.0, water);                    // śnieg: mała bezwładność cieplna
  if (frozen) { ct = mix(1.5e-5, 3.0e-5, fsn); }                   // lód: cienka warstwa powierzchniowa

  // woda i lód w kolumnie → grubość optyczna chmur. Równoważna woda chmurowa: lód (większe
  // kryształki) liczy się ~0.36×, opad ~0.2× (duże krople)
  // Przy okazji: promieniowanie zwrotne chmur z ich własnej temperatury (od dołu – każda warstwa
  // świeci z emisyjnością 1 − exp(−0.05·LWP) i zasłania wyższe) – zimny cirrus grzeje noc dużo słabiej
  // niż niski stratus; wcześniej każda chmura świeciła jak powietrze przy gruncie (ciepłe noce)
  // oraz woda w piętrach: niskie < 2 km, średnie 2–6 km, wysokie > 6 km nad gruntem
  // Chmury z jednego opisu (cloudAt w common.wgsl – ten sam w widoku 3D, na obrazie satelitarnym i przekroju):
  // „woda równoważna” warstwy (ekstynkcja / 150, w tym chmury podsiatkowe i konwekcji parametryzowanej),
  // zachmurzenie ogólne z nakładania warstw (maksymalno-losowe: sąsiednie warstwy chmur nakładają się,
  // rozdzielone – losowo), promieniowanie zwrotne chmur z ich temperatury (od dołu – każda warstwa świeci
  // z emisyjnością 1 − exp(−50·LWP) i zasłania wyższe) i woda w piętrach: niskie < 2 km, średnie 2–6 km,
  // wysokie > 6 km nad gruntem
  var lwp = 0.0;
  var trc = 1.0;
  var cl4 = 0.0;
  var tier = vec3f(0.0);
  var clr = 1.0;          // iloczyn (1 − max(f_k, f_k−1)) / (1 − f_k−1)
  var fprev = 0.0;
  // osobno chmury kłębiaste i warstwowe (mgła, stratus) – obraz satelitarny rysuje je warstwami
  var lwpc = 0.0;
  var lwpa = 0.0;         // chmury warstwowe lodowe poniżej −20 °C (kowadła, cirrusy) – na satelicie nad kłębami
  var clrC = 1.0;
  var fpC = 0.0;
  var clrS = 1.0;
  var fpS = 0.0;
  let culc = sfc[sf(S_CULS, col)];
  let cubc = sfc[sf(S_CUBS, col)];
  let cutc = sfc[sf(S_CUTS, col)];
  let hPrevC = sfc[sf(S_H, col)];
  let pblhC = sfc[sf(S_PBLH, col)];
  let muC = sfc[sf(S_MUCAPE, col)];
  let muelC = sfc[sf(S_MUEL, col)];
  for (var k = kb; k < NZ; k++) {
    let cc = k * NXY + col;
    let rk = vg[VG_RC + k];
    let tk = (vg[VG_TC + k] + state[T_OFF + cc]) * vg[VG_EXC + k];
    let qvk = max(state[QV_OFF + cc], 0.0);
    let pk = vg[VG_PRS + k];
    let zk = vg[VG_ZC + k];
    let zg = zk - zgC(col);
    let wk = 0.5 * (state[W_OFF + cc] + state[W_OFF + cc + NXY]);
    let cl = cloudAt(rk, state[QC_OFF + cc], state[QI_OFF + cc], state[QR_OFF + cc], qvk / qsat(tk, pk), qvk / qsat_ice(tk, pk),
                     tk, zk, convFlag(wk, hPrevC, zg, pblhC, muC, muelC), culc, cubc, cutc);
    let lk = cl.x * cl.y / 150.0 * vg[VG_DZC + k] * select(1.0, vg[VG_HF + col], k == kb);          // [kg/m²] (komórka przy gruncie: część nad gruntem)
    lwp += lk;
    let ek = 1.0 - exp(-50.0 * lk);
    cl4 += trc * ek * tk * tk * tk * tk;
    trc *= 1.0 - ek;
    tier += 1000.0 * lk * select(select(vec3f(0.0, 0.0, 1.0), vec3f(0.0, 1.0, 0.0), zg < 6000.0), vec3f(1.0, 0.0, 0.0), zg < 2000.0);
    let fk = select(0.0, cl.y, lk > 2e-6);
    clr *= (1.0 - max(fk, fprev)) / max(1.0 - fprev, 1e-3);
    fprev = fk;
    // udział chmur kłębiastych płynnie (jak w widoku 3D): przy rozlewaniu cumulusa w chmurę warstwową (albo odwrotnie) obraz
    // przechodzi z kłębów w jednolity pokład stopniowo, a nie przeskakuje przy progu
    let wcv = smoothstep(0.3, 0.7, cl.w);
    let fc = fk * wcv;
    let fs = fk * (1.0 - wcv);
    lwpc += lk * wcv;
    if (tk < 253.15) { lwpa += lk * (1.0 - wcv) * cl.z; }
    clrC *= (1.0 - max(fc, fpC)) / max(1.0 - fpC, 1e-3);
    fpC = fc;
    clrS *= (1.0 - max(fs, fpS)) / max(1.0 - fpS, 1e-3);
    fpS = fs;
  }
  let cover = clamp(1.0 - clr, 0.0, 1.0);
  // pola chmur do wyświetlania (mapa, satelita, piętra, stacje) wygładzone w czasie (τ 10 min): chmury na siatce
  // 1–5 km zapalają się i gasną skokowo w pojedynczych oczkach (migotanie); fizyka używa wartości chwilowych
  let adc = min(P.dt / 600.0, 1.0);
  sfc[sf(S_COVER, col)] += adc * (cover - sfc[sf(S_COVER, col)]);
  sfc[sf(S_LWPC, col)] += adc * (lwpc - sfc[sf(S_LWPC, col)]);
  sfc[sf(S_LWPA, col)] += adc * (lwpa - sfc[sf(S_LWPA, col)]);
  sfc[sf(S_COVC, col)] += adc * (clamp(1.0 - clrC, 0.0, 1.0) - sfc[sf(S_COVC, col)]);
  sfc[sf(S_COVS, col)] += adc * (clamp(1.0 - clrS, 0.0, 1.0) - sfc[sf(S_COVS, col)]);
  // Radiacyjne wychładzanie wierzchołków chmur: górna część chmury (widziana od góry, przepuszczalność
  // warstw wyżej) wypromieniowuje ~0.3·σT⁴ (≈ 90 W/m² przy −3 °C, ≈ 50 W/m² w cirrusie) – chłodzi się
  // ~1 K/h, miesza i odtwarza chmurę; bez tego zimowe stratusy i stratocumulusy szybko się rozpadały
  // Bilans netto: ε_chmury·σT⁴·(1 − 0.86·ε_nad) – promieniowanie zwrotne pary nad wierzchołkiem (ε_nad = 1 − exp(−0.4·√u),
  // u – para nad chmurą [kg/m²]; mgła/stratus pod wilgotnym powietrzem traci mniej niż wierzchołek w suchej, zimnej górze)
  // minus pochłanianie słońca w górnej części chmury (~8% padającego) – za dnia mgła się nagrzewa i rozpada zamiast
  // wychładzać powietrze cały dzień (wcześniej stałe 0.3·σT⁴ dniem i nocą)
  {
    var ta = 1.0;
    var uab = 0.0;
    let svc = sunAt(i, j);
    let swTop = select(0.0, P.s0 * svc.z * 0.85, svc.z > 0.0);
    for (var kk = i32(NZ) - 1; kk >= i32(kb); kk--) {
      let k = u32(kk);
      let cc = k * NXY + col;
      let lk = mlay(k, kb, col) * (state[QC_OFF + cc] + 0.36 * state[QI_OFF + cc]);
      if (lk < 1e-6) { uab += vg[VG_RC + k] * max(state[QV_OFF + cc], 0.0) * vg[VG_DZC + k]; continue; }
      let ek = 1.0 - exp(-50.0 * lk);
      let tk = (vg[VG_TC + k] + state[T_OFF + cc]) * vg[VG_EXC + k];
      let eab = 1.0 - exp(-0.4 * sqrt(uab));
      let fl = (SIGMA * tk * tk * tk * tk * (1.0 - 0.86 * eab) - 0.08 * swTop) * ta * ek;
      // Chmura przy samym gruncie (mgła, stratus; środek warstwy < 300 m nad gruntem, ?fsp=0 – bez): chłodzenie wierzchołka miesza prawdziwą mgłę przez całą jej grubość (~100–300 m) i ją pogłębia,
      // a w modelu nocna stała warstwa nie miesza – strumień ~50 W/m² szedł w jedną warstwę 67 m (~2.5 K/h) i kolejne ochłodzenie dawało więcej wody i silniejsze chłodzenie. Przebieg 4-letni: noce rekordów Tmin miesiąca
      // w 88% z mgłą (IMGW 26%), amplituda dobowa przy mgle bez opadu 10.5 K (7.2 K). Ten sam strumień rozłożony masą na warstwy do ~300 m nad gruntem
      let zf = zgC(col);
      if (FSP > 0.0 && vg[VG_ZC + k] - zf < 300.0) {
        var mf = 0.0;
        var kf = kb;
        for (var m = kb; m < NZ; m++) {
          if (vg[VG_ZC + m] - zf > 300.0) { break; }
          mf += vg[VG_RC + m] * vg[VG_DZC + m] * select(1.0, vg[VG_HF + col], m == kb);
          kf = m;
        }
        for (var m = kb; m <= kf; m++) { state[T_OFF + m * NXY + col] -= P.dt * fl / (mf * CP * vg[VG_EXC + m]); }
      } else {
        state[T_OFF + cc] -= P.dt * fl / (vg[VG_RC + k] * CP * vg[VG_DZC + k] * vg[VG_EXC + k]);
      }
      ta *= 1.0 - ek;
      if (ta < 0.02) { break; }
    }
  }
  sfc[sf(S_CLL, col)] += adc * (tier.x - sfc[sf(S_CLL, col)]);
  sfc[sf(S_CLM, col)] += adc * (tier.y - sfc[sf(S_CLM, col)]);
  sfc[sf(S_CLH, col)] += adc * (tier.z - sfc[sf(S_CLH, col)]);
  let cw = 1000.0 * lwp;                                   // [g/m²]
  // zachmurzenie częściowe: słońce przebija przez przerwy, chmura świeci tylko z części nieba
  let fcl = max(cover, 0.02);
  let cwi = cw / max(fcl, 0.02);                           // woda w samej chmurze
  let tcl = (1.0 - fcl) + fcl / (1.0 + 0.017 * cwi);       // τ ≈ 0.15·LWP, asymetria g = 0.85
  if (1.0 - trc > 1e-6) { cl4 *= fcl * (1.0 - exp(-0.05 * cwi)) / (1.0 - trc); }

  var sw = 0.0;
  var dni = 0.0;                                           // promieniowanie bezpośrednie (do usłonecznienia)
  let sv = sunAt(i, j);
  if (sv.z > 0.0) {
    let m = 1.0 / max(sv.z, 0.035);                        // masa optyczna atmosfery
    let direct = P.s0 * pow(0.7, pow(m, 0.678));           // promieniowanie bezpośrednie (Meinel)
    let nrm = normalize(vec3f(-vg[VG_SLX + col], -vg[VG_SLY + col], 1.0));
    let cosi = max(dot(nrm, sv), 0.0);                     // kąt padania na stok
    // bezpośrednie (z cieniem gór) + rozproszone
    let shd = sunShadow(i, j, sv);
    dni = direct * shd;
    sw = (direct * cosi * shd + 0.1 * direct * sv.z) * tcl;
  }
  let ea = qv1 * ps / (0.622 + qv1) * 0.01;                // ciśnienie pary [hPa]
  // emisyjność czystego nieba: Prata (1996), w = 46.5·e/T [cm wody] – latem jak Brutsaert, w mroźnym suchym
  // powietrzu ~10% większa (Brutsaert zaniżał tam promieniowanie zwrotne o ~20 W/m² – za zimne zimy)
  let wpr = 46.5 * max(ea, 0.01) / t1;
  let epsa = 1.0 - (1.0 + wpr) * exp(-sqrt(1.2 + 3.0 * wpr));
  // promieniowanie zwrotne nieba: świeci warstwa ~0–500 m nad gruntem, nie tylko najniższe oczko –
  // w mrozowisku nad zimną poduszką leży cieplejsza inwersja (inaczej zimne powietrze w dolinach
  // wychładzało się bez końca, do −40 °C)
  var tup = t1;
  for (var k = kb + 1u; k < NZ; k++) {
    if (vg[VG_ZC + k] - zgC(col) > 500.0) { break; }
    tup = max(tup, (vg[VG_TC + k] + state[T_OFF + k * NXY + col]) * vg[VG_EXC + k]);
  }
  // tylko część nadwyżki ciepła warstwy powyżej (30%) – Brutsaert z temperatury przy gruncie jest już
  // dopasowany do typowych profili; pełna średnia dawała latem za słabe nocne wychłodzenie (ciepła
  // warstwa resztkowa), a 0 – zbyt mroźne mrozowiska
  let tsky = t1 + 0.3 * max(tup - t1, 0.0);
  // niebo czyste z warstwy przyziemnej + chmury w „oknie” (1 − ε_czyste) z temperatury chmur
  let lwd = epsa * SIGMA * tsky * tsky * tsky * tsky + (1.0 - epsa) * SIGMA * cl4;
  var ts = sfc[sf(S_TS, col)];
  // + ciepło antropogeniczne zabudowy (ogrzewanie, ruch; ~30 W/m², Sailor 2011) – nocna wyspa ciepła miasta
  let rn = (1.0 - albedo) * sw + 0.95 * lwd - 0.95 * SIGMA * ts * ts * ts * ts + 30.0 * vp.urb;
  sfc[sf(S_LWN, col)] = 0.95 * (lwd - SIGMA * ts * ts * ts * ts);
  // Bilans długofalowy najniższej warstwy powietrza: emituje w górę i w dół, pochłania z gruntu
  // i z nieba (emisyjność zależna od zawartości pary). Nocą ochładza ją ~0.5–1 K/h.
  let wvp = rho * qv1 * vg[VG_HF + col] * vg[VG_DZC + kb];  // para w warstwie [kg/m²]
  let epsl = min(0.2, 0.06 + 0.1 * wvp);
  // powietrze zimniejsze od gruntu nie wychładza się dalej radiacyjnie (grunt świeci cieplej)
  var qrad = epsl * (2.0 * SIGMA * t1 * t1 * t1 * t1 - 0.95 * SIGMA * ts * ts * ts * ts - lwd);
  if (t1 < ts) { qrad = min(qrad, 0.0); }
  sfc[sf(S_QRAD, col)] = qrad;

  // wymiana turbulencyjna (Louis 1979)
  let qss = qsat(ts, ps);
  // opór szparkowy roślin (Jarvis): rośnie, gdy gleba wysycha i gdy brakuje światła (noc)
  let fw = clamp(w / 0.7, 0.02, 1.0);         // w – woda dostępna dla korzeni (0 więdnięcie … 1 polowa)
  let fr = max(sw / (sw + 200.0), 0.05);
  // deficyt wilgotności powietrza (Noah: F3 = 1/(1 + hs·(q_s − q)); hs 36 uprawy … 55 lasy, tu 55; ?vpd= hs, 0 – dawniej): w gorącym, suchym powietrzu szparki się przymykają. Bez tego w dni z T 850 hPa ≥ 14 °C
  // punkt rosy był o 1.3–2.7 K za wysoki przy dobrej temperaturze (sondaże Legionowo, Wrocław), a CAPE ≥ 2000 J/kg kilka razy za częste; dni chłodniejsze prawie bez zmian
  let fvd = 1.0 / (1.0 + VPD * max(qsat(t1, ps) - qv1, 0.0));
  var rs = rsmin / (fw * fr * fvd);
  // rosa (grunt chłodniejszy od punktu rosy powietrza) albo woda: bez oporu – płynne przejście
  // (przełącznik dawał skoki punktu rosy przy gruncie o zmierzchu i o świcie)
  rs *= 1.0 - smoothstep(0.0, 5e-4, qv1 - qss);
  if (water) { rs = 0.0; }
  rs *= 1.0 - fsn;                                         // śnieg paruje (sublimuje) bez oporu
  // w czasie deszczu liście i gleba są mokre – woda na powierzchni paruje bez oporu szparkowego (pod chmurą burzową,
  // w półmroku, opór rósł i parowanie prawie znikało: grunt pod ulewą zostawał ciepły i grzał zimny wypływ)
  // (drogi równoległe: mokra część liści – do 80% przy ulewie – paruje bez oporu szparkowego, sucha przez szparki;
  // sam spadek oporu był za słaby, bo w półmroku pod burzą opór szparkowy rośnie ~20×)
  let fwet = 0.8 * smoothstep(0.05, 2.0, max(sfc[sf(S_PR, col)], sfc[sf(S_PRCUS, col)]));
  let ths = ts / pis;
  let hPrev = sfc[sf(S_H, col)];
  let wst = pow(max(G / th1 * hPrev / (rho * CP) * 1000.0, 0.0), 1.0 / 3.0);   // porywy konwekcyjne w*
  let U = max(sqrt(u1 * u1 + v1 * v1 + wst * wst), 0.5);
  let lz = log(z1 / z0);
  let lzh = log(z1 / (0.1 * z0));
  let cn = 0.16 / (lz * lz);
  let cnh = 0.16 / (lz * lzh);
  let ran = 1.0 / (cnh * U);                               // opór aerodynamiczny bez poprawki na stabilność
  let thv1 = th1 * (1.0 + 0.61 * qv1);
  let thvs = ths * (1.0 + 0.61 * (qv1 + (qss - qv1) * ran / (ran + rs)));
  let rib = clamp(G * z1 * (thv1 - thvs) / (thv1 * U * U), -10.0, 10.0);
  var fm: f32;
  var fh: f32;
  if (rib < 0.0) {
    let cs = 75.0 * cn * sqrt(z1 / z0 * (-rib));
    fm = 1.0 - 10.0 * rib / (1.0 + cs);
    fh = 1.0 - 15.0 * rib / (1.0 + cs);
  } else {
    fm = 1.0 / (1.0 + 10.0 * rib / sqrt(1.0 + 5.0 * rib));
    // „długi ogon” dla ciepła (jak w modelach operacyjnych, np. ECMWF): w bardzo stałej warstwie nocą
    // wymiana z gruntem nie zanika – bez tego zimą przy śniegu „uciekające” wychłodzenie (−8…−10 K)
    fh = 1.0 / (1.0 + 10.0 * rib);
  }
  // Odwilż nad śniegiem przy wietrze (adwekcja ciepłego powietrza): wiatr miesza warstwę przy gruncie mechanicznie, więc wymiana ciepła z topniejącym śniegiem
  // nie gaśnie jak w ciszy (Louis przy Ri ~0.3 zostawiał ~20% – topnienie kilka mm/dobę), a przyziemna inwersja jest płytka. W ciszy bez zmian (śnieg chłodzi
  // powietrze, mrozowiska). Użytkownik: przy odwilży tereny ze śniegiem nie były cieplejsze niż 1–2 °C.
  let wThaw = fsn * smoothstep(TFRZ, TFRZ + 2.0, t1) * smoothstep(2.0, 7.0, sqrt(u1 * u1 + v1 * v1));
  fh = max(fh, 0.6 * wThaw);
  // minimalna wymiana przy bardzo stałej stratyfikacji (opór ≤ ~500 s/m), jak w modelach operacyjnych –
  // bez tego grunt nocą całkowicie odcina się od powietrza
  // we wnętrzu kopuły zimnego powietrza (wypływ burzy) stabilna warstwa przy gruncie tłumi wymianę z podłożem – nie ma termików,
  // nowe komórki nie startują w środku starej kopuły (tylko na jej brzegu); kopuła słabnie z czasem (szybciej w słońcu, org_update)
  let wkm = clamp(max(sfc[sf(S_ORG, col)], sfc[sf(S_ORGB, col)]) / WK_FULL, 0.0, 1.0);
  let chu = max(cnh * fh * U * (1.0 - 0.8 * wkm * wkm), 0.002);
  let hflx = rho * CP * chu * (ths - th1) * pis;
  let ra = 1.0 / chu;                                      // opór aerodynamiczny [s/m]
  let gsf = fwet / ra + (1.0 - fwet) / (ra + rs);         // przewodność dla pary: mokre liście ‖ szparki
  let le = rho * LV * (qss - qv1) * gsf;
  let qsf = qv1 + (qss - qv1) * ra * gsf;                  // efektywna wilgotność przy powierzchni (strumień = (q_sf − q_v1)/r_a)

  // gleba: force-restore
  let td = sfc[sf(S_TD, col)];
  if (water && frozen) {
    // pokrywa lodowa: powierzchnia lodu (lub śniegu na lodzie) z bilansu energii i przewodzenia przez
    // lód i śnieg od wody (temperatura zamarzania); lód przyrasta od spodu, gdy ciepło odpływa w górę
    // opór cieplny lodu i śniegu [m²K/W]; przewodność śniegu z gęstości (Yen 1981: 2.22·(ρ/1000)^1.88 – puch ~0.03,
    // śnieg uleżały ~0.2 W/m/K – świeży śnieg na lodzie mocno hamuje jego przyrost)
    let ksn = max(2.22 * pow(swe / max(snd, 1e-6) / 1000.0, 1.88), 0.03);
    let res = ice / 2.2 + snd / ksn;
    let gc = (TFW - ts) / max(res, 0.02);
    ts += dt * ct * (rn - hflx - le + gc);
    ice += dt * max(gc, 0.0) / (917.0 * 3.34e5);
    // topnienie od góry (najpierw śnieg – niżej), nadwyżka energii ponad 0 °C
    if (ts > TFRZ && swe <= 0.0) {
      ice -= (ts - TFRZ) / (ct * 917.0 * 3.34e5);
      ts = TFRZ;
    }
    if (ice <= 0.0) { ice = 0.0; ts = TFW + 0.2; }                  // przerębla – znów otwarta woda
  } else if (water) {
    // woda: warstwa wymieszana HMIX (bilans: słońce, długofalowe, ciepło jawne i utajone) z powolnym
    // powrotem do temperatury głębszej wody (τ = 30 dób); przy zamarzaniu i dalszym wychładzaniu – lód
    let net = rn - hflx - le;
    ts += dt * (net / (1000.0 * 4186.0 * HMIX) - (ts - td) / (30.0 * 86400.0)) + P.sstD;
    sfc[sf(S_TD, col)] = td + P.sstD;
    if (ts <= TFW && net < 0.0) { ice = 0.02; }
    ts = max(ts, TFW);
  } else {
    // ciepło niesione przez deszcz: krople mają temperaturę termometru zwilżonego najniższej warstwy powietrza – ulewa chłodzi
    // grunt (20 mm/h przy różnicy 8 K ≈ −190 W/m²); bez tego grunt pod burzą zostawał gorący (29 °C) i grzał zimny wypływ
    // strumieniem +107 W/m² – wypływy słabły w kilkanaście minut i nowe komórki rosły tuż za starymi
    let prr = max(sfc[sf(S_PR, col)] - sfc[sf(S_PSN, col)], 0.0) / 3600.0;
    let t1a = th1 * pis;
    let qs1 = qsat(t1a, vg[VG_PRS + kb]);
    let twb = t1a - LV / CP * max(qs1 - qv1, 0.0) / (1.0 + LV * LV * qs1 / (CP * RV * t1a * t1a));
    let grain = 4186.0 * prr * (twb - ts);
    ts += dt * (ct * (rn - hflx - le + grain) - 6.2831853 / TAU1 * (ts - td));
  }
  // powierzchnia (zwł. śnieg o małej pojemności cieplnej) nie wychładza się bez końca: najwyżej
  // ~8 K poniżej powietrza w pierwszej warstwie (silne inwersje przyziemne) i 30 K poniżej głębszej gleby
  // (12 K dawało pojedyncze zaśnieżone oczka o kilkanaście stopni zimniejsze od sąsiadów)
  ts = max(ts, max(th1 * pis - 8.0, td - 30.0));
  // topnienie śniegu: energia ponad 0 °C idzie na topnienie, grunt pod śniegiem nie ogrzewa się
  var melt = 0.0;
  if (swe > 0.0 && ts > TFRZ) {
    melt = min(swe, (ts - TFRZ) / (ct * LF));
    ts -= melt * ct * LF;
    snd *= (swe - melt) / swe;                             // przy stałej gęstości (mokry śnieg zagęszcza się niżej)
    swe -= melt;
  }
  // głębsza warstwa gleby: pod śniegiem izolowana (reaguje ~20× wolniej – nie wychładza się z powierzchnią)
  if (!water) { sfc[sf(S_TD, col)] = td + dt * (ts - td) / (TAU1 * (1.0 + 20.0 * fsn)); }
  sfc[sf(S_TS, col)] = ts;
  let pr = sfc[sf(S_PR, col)] / 3600.0;                   // opad z poprzedniego kroku [mm/s]
  let psn = sfc[sf(S_PSN, col)] / 3600.0;                 // w tym śnieg
  // wiek pokrywy śnieżnej [doby]: świeży opad (> 0.3 mm/h) odnawia biel śniegu
  sfc[sf(S_SNAGE, col)] = select(sfc[sf(S_SNAGE, col)] + dt / 86400.0, 0.0, psn * 3600.0 > 0.3);
  // świeży śnieg: gęstość z temperatury powietrza (Anderson 1976, jak w CLM): ≤ −15 °C ~50 kg/m³ (drobny, suchy – ~20 cm
  // z 10 mm wody), −5 °C ~105 (~10 cm), 0 °C ~150, odwilż ≤ 170 (mokre płatki, ~6 cm); wcześniej zawsze 300 kg/m³ (~3 cm)
  let rhoN = 50.0 + 1.7 * pow(clamp(sfc[sf(S_T2, col)] + 15.0, 0.0, 17.0), 1.5);
  let dsn = dt * psn * select(1.0, 0.0, water && !frozen);
  swe += dsn;
  snd += dsn / rhoN;
  sfc[sf(S_ICE, col)] = ice;
  var evs = 0.0;                                           // sublimacja ze śniegu
  if (swe > 0.0 && le > 0.0) { evs = min(swe, dt * le / LV * fsn); snd *= (swe - evs) / swe; swe -= evs; }
  // osiadanie: gęstość dąży do ρ_max (suchy 250 + 100 kg/m³ na metr pokrywy – nacisk wyższych warstw; mokry – odwilż, deszcz
  // na śnieg – 450) z τ 5 dób / 1.5 doby, jak w CLASS (Verseghy 1991): świeży puch traci połowę grubości w kilka dni
  if (swe > 0.0) {
    let wet = melt > 0.0 || (pr - psn) * 3600.0 > 0.1 || ts >= TFRZ - 0.05;
    let rmax = select(250.0 + 100.0 * min(snd, 1.0), 450.0, wet);
    let rho = swe / max(snd, 1e-6);
    snd = swe / max(rho, rmax - (rmax - rho) * exp(-dt / (select(5.0, 1.5, wet) * 86400.0)));
  }
  sfc[sf(S_SND, col)] = clamp(snd, swe / 550.0, swe / 50.0);
  sfc[sf(S_SWE, col)] = swe;
  // Woda w glebie (3 warstwy, prawo Darcy'ego): deszcz i roztopy wsiąkają do warstwy wierzchniej najwyżej
  // z szybkością Ks·(1 + 2·(1 − s₁)) (25–75 mm/h, sucha gleba szybciej) – nadmiar to spływ powierzchniowy (S_RUN [mm]);
  // między warstwami przepływ q = K·(Δψ/Δz + 1) z K(s) = Ks·s^(2b+3), ψ(s) = −ψs·s^(−b); spód – część SM_DRN swobodnego drenażu
  // (głębiej gleba nie kończy się na 1 m: warstwy słabiej przepuszczalne, wody gruntowe – jak współczynnik SLOPE w Noah). Pełny swobodny drenaż ustawiał
  // glebę zimą i wiosną na s ~0.64 (~29 %obj.), poniżej polowej pojemności 0.70 (K(s) = nadwyżka opadu ~1.3 mm/d): roczny odpływ i drenaż ~340 mm (realnie ~170), parowanie 386 mm (~480),
  // od czerwca brak zapasu, gleba 20–21 %obj. latem (czerwiec −56 mm); w bezchmurne doby Tx 28.8 °C przy suchej i 24.2 °C przy wilgotnej glebie. Przy 0.15 gleba zimą s ~0.73
  // (zasilanie wód podziemnych → odpływ gruntowy do rzek, gdy hydrologia włączona). Parowanie z gleby z warstwy
  // wierzchniej, transpiracja z warstw wg korzeni (las głębiej) i dostępnej wody. W (pole S_W) = woda dostępna
  // dla korzeni (0 – więdnięcie, 1 – polowa pojemność), używana przez opór szparkowy i fenologię.
  // Woda płynie po sieci D8 (jądro route); jeziora i morze ją pochłaniają.
  var srun = sfc[sf(S_RUN, col)];
  let dzs = vec3f(100.0, 300.0, 600.0);                   // grubość warstw [mm]
  let cws = SM_SAT * dzs;                                  // woda przy nasyceniu [mm]
  var wat = vec3f(sfc[sf(S_SM1, col)], sfc[sf(S_SM2, col)], sfc[sf(S_SM3, col)]) * cws;
  let root = mix(vec3f(0.35, 0.40, 0.25), vec3f(0.15, 0.35, 0.50), vp.mask);
  let newin = select(dt * (pr - psn) + melt, 0.0, water);     // (woda: opad przyjmuje jezioro / morze)
  let infil = min(newin, dt * SM_KS * (1.0 + 2.0 * (1.0 - clamp(wat.x / cws.x, 0.0, 1.0))));
  srun += newin - infil;
  wat.x += infil;
  let et = dt * le / LV - evs;                             // parowanie i transpiracja z gleby [mm]
  if (!water) {
    if (et < 0.0) {
      wat.x -= et;                                         // rosa
    } else {
      let av = clamp((wat / cws - SM_WILT) / (SM_FC - SM_WILT), vec3f(0.0), vec3f(1.0));
      let ra = root * av;
      let sra = ra.x + ra.y + ra.z;
      let tr = select(vec3f(1.0, 0.0, 0.0), ra / max(sra, 1e-6), sra > 1e-4);
      let fv = 0.2 + 0.7 * green;                          // udział transpiracji
      wat -= min(et * ((1.0 - fv) * vec3f(1.0, 0.0, 0.0) + fv * tr), max(wat - 0.05 * cws, vec3f(0.0)));
    }
    let s = clamp(wat / cws, vec3f(0.02), vec3f(1.0));
    let kk = SM_KS * pow(s, vec3f(2.0 * SM_B + 3.0));
    let psi = max(-SM_PSI * pow(s, vec3f(-SM_B)), vec3f(-1.0e6));
    let q12 = clamp(dt * 0.5 * (kk.x + kk.y) * ((psi.x - psi.y) / 200.0 + 1.0), -0.25 * wat.y, 0.25 * wat.x);
    let q23 = clamp(dt * 0.5 * (kk.y + kk.z) * ((psi.y - psi.z) / 450.0 + 1.0), -0.25 * wat.z, 0.25 * wat.y);
    let q3 = min(dt * SM_DRN * kk.z, 0.25 * wat.z);
    wat += vec3f(-q12, q12 - q23, q23 - q3);
    srun += P.hydro * q3;                                  // odpływ gruntowy do rzek
    // przesycenie warstwy – nadmiar w górę, z wierzchniej spływ
    if (wat.z > cws.z) { wat.y += wat.z - cws.z; wat.z = cws.z; }
    if (wat.y > cws.y) { wat.x += wat.y - cws.y; wat.y = cws.y; }
    if (wat.x > cws.x) { srun += wat.x - cws.x; wat.x = cws.x; }
    wat = max(wat, vec3f(0.0));
  }
  let sn = wat / cws;
  sfc[sf(S_SM1, col)] = sn.x;
  sfc[sf(S_SM2, col)] = sn.y;
  sfc[sf(S_SM3, col)] = sn.z;
  let avn = clamp((sn - SM_WILT) / (SM_FC - SM_WILT), vec3f(0.0), vec3f(1.0));
  if (water || i32(vg[VG_RCV + col]) == -2 || P.hydro < 0.5) { srun = 0.0; }    // jezioro, morze, brzeg siatki – ujście
  sfc[sf(S_W, col)] = select(dot(root, avn), 1.0, water);
  sfc[sf(S_RUN, col)] = srun;
  // odpływ do odbiornika: prędkość 0.3–3 m/s rośnie ze spadkiem; zapis jako przepływ [m³/s]
  let rc = i32(vg[VG_RCV + col]);
  var qo = 0.0;
  if (rc >= 0 && !water) {
    let ri = rc % i32(NX);
    let rj = rc / i32(NX);
    let ds = DX * length(vec2f(f32(min(abs(ri - i), i32(NX) - abs(ri - i))), f32(min(abs(rj - j), i32(NY) - abs(rj - j)))));
    let slope = max(vg[VG_HGT + col] - vg[VG_HGT + u32(rc)], 0.0) / ds;
    let vel = clamp(0.3 + 4.0 * sqrt(slope), 0.3, 3.0);
    qo = srun * min(1.0, vel * dt / ds) * 1e-3 * DX * DY / dt;
  }
  sfc[sf(S_QOUT, col)] = qo;
  sfc[sf(S_H, col)] = hflx;
  sfc[sf(S_LE, col)] = le;
  // opór nierozwiązanej rzeźby (jak szorstkość orograficzna / TOFD w modelach operacyjnych – Beljaars i in. 2004): szorstkość pędu z różnic wysokości sąsiednich oczek, tylko na siatkach
  // ≥ ~1–4 km (na gęstszych rzeźbę rozwiązuje siatka) i tylko dla pędu. Bez tego wiatr 10 m w górzystym terenie był za silny (przebieg 797 dób: Podhale 3.6 przy 1.3 m/s);
  // Kraków, 8 km, lipiec: 10 m w dzień 3.2 → 2.6, nocą 2.5 → 2.2 m/s, T i opad bez zmian
  var cdm = cn;
  if (DX > 1000.0) {
    let hx = zgC(u32(j) * NX + u32(wrapi(i + 1, NX))) - zgC(u32(j) * NX + u32(wrapi(i - 1, NX)));
    let hy = zgC(u32(wrapi(j + 1, NY)) * NX + u32(i)) - zgC(u32(wrapi(j - 1, NY)) * NX + u32(i));
    let zoro = min(0.02 * 0.5 * sqrt(hx * hx + hy * hy) * smoothstep(1000.0, 4000.0, DX), 0.5 * z1);
    let lzo = log(z1 / (z0 + zoro));
    cdm = 0.16 / (lzo * lzo);
  }
  sfc[sf(S_CDU, col)] = max(cdm * fm * U, 0.002);
  // wiatr na 10 m (profil logarytmiczny) i porywy: turbulencja (≈ 2.4·σ_u, σ_u ≈ 2u*) + zimne wypływy burz
  let vh = sqrt(u1 * u1 + v1 * v1);
  sfc[sf(S_UA, col)] = u1;                                 // wiatr 1. poziomu (kierunek na stacjach)
  sfc[sf(S_VA, col)] = v1;
  // usłonecznienie (WMO: promieniowanie bezpośrednie > 120 W/m²) od północy [h], część oczka bez chmur
  if (dni > 120.0) { sfc[sf(S_SUNH, col)] += dt / 3600.0 * select(1.0 - fcl, 1.0, cw < 1.0); }
  sfc[sf(S_SW, col)] = sw;
  sfc[sf(S_LWP, col)] += adc * (lwp - sfc[sf(S_LWP, col)]);   // wyświetlanie – wygładzone (jak wyżej)
  // Satelita IR (okno 10.8 µm): temperatura jasnościowa – promieniowanie gruntu i chmur widziane
  // z góry; każda warstwa chmury pochłania/emituje z emisyjnością 1 − exp(−0.13·LWP[g/m²])
  // Kanał pary wodnej (6.2 µm): para pochłania silnie (κ ≈ 6 m²/kg) – widać wilgotność górnej i środkowej
  // troposfery (ciemno = sucho, osiadanie; jasno = wilgotno, chmury wysokie). Radar: maksymalna
  // odbiciowość w kolumnie (CMAX): deszcz Z = 3.63e9·(ρq_r)^1.75, śnieg/krupa 2.2e8·(ρq_i)^1.75 [mm⁶/m³],
  // konwekcja parametryzowana Z = 200·R^1.6.
  var tr = 1.0;
  var e4 = 0.0;
  var trw = 1.0;
  var e4w = 0.0;
  var zmax = 0.0;
  var zcol = 0.0;
  for (var kk = i32(NZ) - 1; kk >= i32(kb); kk--) {
    let k = u32(kk);
    let cc = k * NXY + col;
    let rk = vg[VG_RC + k];
    let cwk = 1000.0 * rk * (state[QC_OFF + cc] + 0.2 * state[QR_OFF + cc]) * vg[VG_DZC + k];
    let iwk = 1000.0 * rk * state[QI_OFF + cc] * vg[VG_DZC + k];
    let tk = (vg[VG_TC + k] + state[T_OFF + cc]) * vg[VG_EXC + k];
    if (cwk + iwk > 1e-3) {
      let ek = 1.0 - exp(-0.13 * cwk - 0.07 * iwk);
      e4 += tr * ek * tk * tk * tk * tk;
      tr *= 1.0 - ek;
    }
    let ew = 1.0 - exp(-6.0 * rk * max(state[QV_OFF + cc], 0.0) * vg[VG_DZC + k] - 0.13 * cwk - 0.07 * iwk);
    e4w += trw * ew * tk * tk * tk * tk;
    trw *= 1.0 - ew;
    // odbiciowość: deszcz + opadający lód (bez drobnego lodu chmurowego < 0.05 g/kg – cirrusy i kowadła
    // są dla radaru prawie niewidoczne); radar „niskich wiązek” do 2 km nad gruntem – to, co spada na ziemię
    // deszcz z rozkładu kropel (Z = 720·ρ·N_r/λ⁶ [m⁶/m³] → mm⁶/m³), śnieg/krupa – wzór empiryczny
    let qrk = max(state[QR_OFF + cc], 0.0);
    let fck = clamp((TFRZ + 2.5 - tk) / 3.0, 0.0, 1.0);
    var zr = 0.0;
    if (qrk > 1e-9) {
      let nrk = nrBound(qrk, state[NR_OFF + cc], rk);
      zr = 720e18 * rk * nrk / pow(clamp(lamR(qrk, nrk), LAM_MIN, LAM_MAX), 6.0);
    }
    let zk = (1.0 - fck) * zr + fck * 3.63e9 * pow(rk * qrk, 1.75) + 2.2e8 * pow(rk * max(state[QI_OFF + cc] - 5e-5, 0.0), 1.75);
    zcol = max(zcol, zk);
    if (vg[VG_ZC + k] - zgC(col) < 2000.0) { zmax = max(zmax, zk); }
  }
  e4 += tr * ts * ts * ts * ts;
  sfc[sf(S_TB, col)] = sqrt(sqrt(e4)) - 273.15;
  sfc[sf(S_TBS, col)] += min(P.dt / 600.0, 1.0) * (sfc[sf(S_TB, col)] - sfc[sf(S_TBS, col)]);   // tylko do obrazu (jak inne pola wyświetlane, τ 10 min)
  e4w += trw * ts * ts * ts * ts;
  sfc[sf(S_TBWV, col)] = sqrt(sqrt(e4w)) - 273.15;
  // (opad schematu dochodzący do gruntu – to samo pole co na mapie opadu; wcześniej PRCUS z jednego oczka: szum i echo tam, gdzie opad wyparował)
  let zcu = 200.0 * pow(max(sfc[sf(S_PRCG, col)], 0.0), 1.6);
  sfc[sf(S_DBZ, col)] = 10.0 * log(max(max(zmax, zcu), 0.01)) / log(10.0);
  sfc[sf(S_DBZC, col)] = 10.0 * log(max(max(zcol, zcu), 0.01)) / log(10.0);   // cała kolumna (CMAX) – struktura burz

  // Wysokość warstwy granicznej i skala prędkości dla K-profilu (siatki mezoskalowe):
  // liczba Richardsona względem cząstki z powierzchni (z nadwyżką temperatury przy konwekcji)
  if (W_PBL > 0.0) {
    let ust = sqrt(cn * fm) * U;
    let hk = hflx / (rho * CP);
    let hold = max(sfc[sf(S_PBLH, col)], 50.0);
    let ws = pow(ust * ust * ust + 0.6 * max(G / th1 * hk * hold, 0.0), 1.0 / 3.0);
    let thvs = thv1 + select(0.0, min(6.8 * hk / max(ws, 0.1), 3.0), hk > 0.0);
    let zg = zgC(col);
    var zp = z1;
    var rp = 0.0;
    var hb = vg[VG_ZC + NZ - 6u] - zg;
    // poziom kondensacji cząstki z 1. poziomu (bez nadwyżki termicznej)
    var zlcl = 1e9;
    var dqp = qv1 - qsat(th1 * vg[VG_EXC + kb], vg[VG_PRS + kb]);
    for (var k = kb + 1u; k < NZ - 6u; k++) {
      let cc = k * NXY + col;
      let thv = (vg[VG_TC + k] + state[T_OFF + cc]) * (1.0 + 0.61 * state[QV_OFF + cc]);
      let uk = cellU(i, j, k).x;
      let vk = cellV(i, j, k).x;
      let za = vg[VG_ZC + k] - zg;
      if (zlcl > 1e8) {
        let dq = qv1 - qsat(th1 * vg[VG_EXC + k], vg[VG_PRS + k]);
        if (dq >= 0.0) { zlcl = zp + (za - zp) * clamp(-dqp / max(dq - dqp, 1e-9), 0.0, 1.0); }
        dqp = dq;
      }
      let rb = G * za * (thv - thvs) / (thvs * (uk * uk + vk * vk + 100.0 * ust * ust + 0.01));
      if (rb > 0.25) { hb = zp + (za - zp) * (0.25 - rp) / max(rb - rp, 1e-6); break; }
      zp = za;
      rp = rb;
    }
    // warstwa graniczna z cumulusami: K-profil miesza tylko warstwę podchmurową (do poziomu kondensacji), warstwę chmur
    // obsługuje konwekcja płytka (jak w schematach z oddzielną warstwą podchmurową – Tiedtke, EDMF). Wcześniej
    // cząstka z nadwyżką do 3 K przebijała się ~0.5 km ponad podstawę chmur i K-profil wynosił tam parę z gruntu:
    // latem przy 4 km warstwa 2–3.4 km miała RH 95–99% (cel 70%) – pokład chmur codziennie, a przy gruncie RH 36% (cel 66%).
    // Tylko tam, gdzie konwekcja płytka rzeczywiście przenosi parę (S_SHACT z poprzedniego kroku): w powietrzu bardzo chwiejnym
    // (wierzchołek cząstki > 3.5 km nad podstawą) schemat płytki się nie włącza – z ograniczeniem nic nie wynosiło pary z warstwy
    // przy gruncie (21 VI, 4 km: q +1…+3 g/kg ponad cel, Td 16–18 °C, CAPE o 14:00 średnio 800–1850 J/kg przez 2 tygodnie)
    if (hk > 0.0) { hb = mix(hb, min(hb, zlcl), clamp(sfc[sf(S_SHACT, col)], 0.0, 1.0)); }
    sfc[sf(S_PBLH, col)] = max(hb, z1);
    sfc[sf(S_WS, col)] = ws;
    // 1/L (Monin-Obuchow) przy stałej stratyfikacji – tłumienie K-profilu nocą
    sfc[sf(S_LINV, col)] = clamp(-0.4 * G * hk / (th1 * max(ust * ust * ust, 1e-4)), 0.0, 0.5);
  }

  // 2 m: profil Monina-Obuchowa między powierzchnią a 1. poziomem; z/L oszacowane z liczby
  // Richardsona. Przy stałej stratyfikacji (noc) większość spadku temperatury jest tuż przy gruncie.
  var zeta1: f32;
  if (rib < 0.0) { zeta1 = rib * lz * lz / lzh; }
  else { zeta1 = min(rib * lz * lz / lzh / max(1.0 - 5.0 * rib, 0.05), 20.0); }
  // za dnia stateczność do T2 ograniczona (z/L ≤ 0.3): zacieniony stok czy zaśnieżona polana w słońcu nie są
  // odcięte od otoczenia – mieszanie z sąsiedztwa (wiatry zboczowe, termiki obok); bez tego T2 szło za
  // temperaturą powierzchni (stoki N/S w styczniu: powietrze ±0.2 K, T2 ±3.8 K)
  // płynnie ze słońcem (próg sw > 20 W/m² dawał skok T2 – linię wschodu/zachodu słońca przesuwającą się po mapie)
  zeta1 = min(zeta1, mix(20.0, 0.3, smoothstep(0.0, 250.0, sw)));
  // (odwilż z wiatrem nad śniegiem: z/L ≤ ~1 – przy granicy 20 cały spadek temperatury między gruntem a ~30 m szedł poniżej 2 m: przy +8 °C na 30 m T2 ~1 °C)
  zeta1 = min(zeta1, mix(20.0, 1.0, wThaw));
  let linv = zeta1 / z1;
  // wiatr 10 m: profil log-liniowy przy stałej stratyfikacji (u/u* = [ln(z/z0) + 5·z/L]/κ, z/L ≤ 1 – jak ψ_m) – sam logarytm nie widział nocnego spadku wiatru przy gruncie;
  // za dnia bez poprawki (mieszana warstwa). Porywy jak dotąd: turbulencja (≈ 2.4·σ_u, σ_u ≈ 2u*) + zimne wypływy burz
  let z10 = max(10.0, 2.0 * z0);
  let lst = max(linv, 0.0);
  let u10 = vh * clamp((log(z10 / z0) + 5.0 * min(z10 * lst, 1.0)) / (lz + 5.0 * min(z1 * lst, 1.0)), 0.0, 1.5);
  sfc[sf(S_U10, col)] = u10;
  sfc[sf(S_GUST, col)] = u10 + 4.8 * sqrt(cn * fm) * max(vh, 0.5) + 3.0 * sqrt(max(sfc[sf(S_PRCUS, col)], 0.0));
  // szorstkość cieplna do T2 jak nad krótką trawą (stacja meteorologiczna, ≤ 5 mm): nad lasem T2 szło za temperaturą
  // koron drzew (skóry) – stok w słońcu i w cieniu różniły się T2 o 3–4 K przy powietrzu ±0.2 K
  let z0h = min(0.1 * z0, 0.005);
  let z2 = 2.0;
  let f2 = clamp((log(z2 / z0h) - psiH(z2 * linv) + psiH(z0h * linv)) /
                 (log(z1 / z0h) - psiH(zeta1) + psiH(z0h * linv)), 0.0, 1.0);
  let th2 = ths + (th1 - ths) * f2;
  let q2 = qsf + (qv1 - qsf) * f2;
  sfc[sf(S_T2, col)] = th2 * pis - 273.15;
  sfc[sf(S_T1, col)] = t1 - 273.15;                       // powietrze w 1. warstwie nad gruntem (diagnostyka)
  sfc[sf(S_TMAX, col)] = max(sfc[sf(S_TMAX, col)], th2 * pis - 273.15);     // od północy (JS zeruje o 0:00)
  sfc[sf(S_TMIN, col)] = min(sfc[sf(S_TMIN, col)], th2 * pis - 273.15);
  sfc[sf(S_MTS, col)] += (th2 * pis - 273.15) * P.dt;                        // widok „Miesiące”: Σ T 2 m·Δt
  // punkt rosy 2 m z bezwładnością ~15 min: o zmierzchu i o świcie opór aerodynamiczny zmienia się
  // ~10× w kilkanaście minut (przejście chwiejnie ↔ stale) i Td skakało o 3–4 K między krokami
  let tdn = min(dewpoint(q2, ps), th2 * pis) - 273.15;

  // Widzialność [km]: zmętnienie z wilgotności (RUC: 60·exp(−2.5·(RH−15)/80) km), mgła z wody chmurowej
  // przy gruncie (1. poziom + nadwyżka nasycenia na 2 m; Kunkel β = 144.7·LWC^0.88), deszcz i śnieg
  // (Stoelinga–Warner). Zjawiska: 1 szron (osadzanie na gruncie < 0 °C), 2 szadź (mgła przy T < 0 °C),
  // 3 marznący deszcz / gołoledź (ciekły opad na zamarznięty grunt), 4 mgła, 5 szczyty/zbocza w chmurach
  let t2k = th2 * pis;
  let q2s = qsat(t2k, ps);
  // woda na 2 m, nie średnia z warstwy ~67 m (?fgd=0 – dawniej): w chmurze przy gruncie woda rośnie z wysokością (połowa wzrostu adiabatycznego, ~1 g/kg na km), więc ten sam odczyt to często podstawa niskiego
  // stratusu kilkadziesiąt metrów nad gruntem, nie mgła. Dawniej próg ~0.015 g/kg w warstwie: mgła 138 dób/rok (IMGW 38), ≥ 6 h – 70 (11.5), 75% z opadem (47%), 46% przy wietrze ≥ 3 m/s (22%)
  let qc2 = max(state[QC_OFF + c] - FGD * 1.0e-6 * 0.5 * vg[VG_HF + col] * vg[VG_DZC + kb], 0.0);
  let lwc = 1000.0 * rho * (max(q2 - q2s, 0.0) + qc2);
  let rh2 = clamp(q2 / q2s, 0.0, 1.0);
  var beta = 3.912 / (60.0 * exp(-2.5 * max(100.0 * rh2 - 15.0, 0.0) / 80.0));
  beta += 144.7 * pow(lwc, 0.88) + 2.24 * pow(1000.0 * rho * max(state[QR_OFF + c], 0.0), 0.75)
        + 10.4 * pow(1000.0 * rho * max(state[QI_OFF + c], 0.0), 0.78);
  let vis = min(3.912 / beta, 50.0);
  sfc[sf(S_VIS, col)] = vis;
  // mgła (płytka, przy gruncie – radiacyjna, adwekcyjna) a „szczyty w chmurach”: chmura sięga też ~300 m nad grunt
  // (podstawa chmur poniżej szczytów, mgła orograficzna) – na mapie osobno, bo to nie jest mgła w dolinie
  var hill = false;
  if (vis < 1.0) {
    for (var k = kb + 1u; k < NZ; k++) {
      if (vg[VG_ZC + k] - zgC(col) > 300.0) {
        hill = state[QC_OFF + k * NXY + col] + state[QI_OFF + k * NXY + col] > 1e-5;
        break;
      }
    }
  }
  var ph = 0.0;
  if (vis < 1.0) { ph = select(4.0, 5.0, hill); }
  if (ts < TFRZ && le < -2.0 && !water) { ph = 1.0; }
  if (vis < 1.0 && t2k < TFRZ) { ph = 2.0; }     // szadź – także w chmurze na szczytach
  if (pr - psn > 0.05 / 3600.0 && ts < TFRZ && !water) { ph = 3.0; }
  sfc[sf(S_PHEN, col)] = ph;

  // Burze: wyładowania [1/km²/h] – rozwiązane: McCaul i in. (2009) F = 0.042·w·q_lód na poziomie −15 °C
  // (na 5 min); parametryzowane: z opadu konwekcyjnego i wysokości wierzchołka. Grad: maks. średnica [cm]
  // z prądu wstępującego (rozwiązanego albo 0.4·√(2·CAPE) przy aktywnej konwekcji), mniejsza przy wysokiej
  // izotermie 0 °C (topnienie w drodze do gruntu).
  var flash = 0.0;
  var wmx = 0.0;
  var zfrz = 0.0;
  var k15 = 0u;
  for (var k = kb; k < NZ; k++) {
    let cc = k * NXY + col;
    let tk = (vg[VG_TC + k] + state[T_OFF + cc]) * vg[VG_EXC + k];
    wmx = max(wmx, state[W_OFF + cc]);
    if (zfrz == 0.0 && tk < TFRZ) { zfrz = vg[VG_ZC + k] - zgC(col); }
    if (k15 == 0u && tk < 258.15) { k15 = k; }
  }
  if (k15 > 0u) {
    let cc = k15 * NXY + col;
    // lód = krupa (~20% opadu zamarzniętego na −15 °C; reszta to śnieg, słabo się elektryzujący) + lód chmurowy – u McCaula
    // strumień krupy; sam lód chmurowy po zmianie fizyki lodu (mało kryształków, duże przechodzą w opad) dawał ~300× mniej
    // wyładowań (scenariusz „Burze”: maks. 4.6 → 0.05; teraz ~20/km²/h w najsilniejszych rdzeniach)
    flash = 12.0 * 0.042 * max(0.5 * (state[W_OFF + cc] + state[W_OFF + cc + NXY]), 0.0) * 1000.0 * (max(state[QI_OFF + cc], 0.0) + 0.2 * max(state[QR_OFF + cc], 0.0));
  }
  let prcu = sfc[sf(S_PRCUS, col)];
  flash += 0.15 * prcu * smoothstep(7000.0, 12000.0, sfc[sf(S_CUTS, col)]);
  sfc[sf(S_FLASH, col)] = flash;
  let wh = max(wmx, select(0.0, 0.4 * sqrt(2.0 * sfc[sf(S_CAPE, col)]), prcu > 0.5));
  var dh = clamp((wh - 12.0) / 3.5, 0.0, 12.0) - max(zfrz - 3500.0, 0.0) / 1000.0;
  if (dh < 0.5 || (flash < 0.01 && prcu < 1.0)) { dh = 0.0; }
  sfc[sf(S_HAIL, col)] = dh;
  let tdo = sfc[sf(S_TD2, col)];
  sfc[sf(S_TD2, col)] = select(tdo + (tdn - tdo) * min(dt / 900.0, 1.0), tdn, abs(tdn - tdo) > 15.0);
}

// Funkcja stabilności dla ciepła: Paulson (chwiejnie), Businger-Dyer z łagodnym ogonem (stale)
fn psiH(zeta: f32) -> f32 {
  if (zeta < 0.0) {
    let x = pow(1.0 - 16.0 * zeta, 0.25);
    return 2.0 * log((1.0 + x * x) * 0.5);
  }
  if (zeta <= 1.0) { return -5.0 * zeta; }
  return -5.0 - 5.0 * log(zeta);
}

// ======================= Duża skala: pola docelowe i brzegi =======================
// Pola docelowe (θ', q_v, u, v w 3D oraz przy gruncie u_g, v_g i ciśnienie) w trzech terminach (sloty) co 30 min symulacji:
// poprzedni (P.tslot + 2) % 3, A = P.tslot, B = (P.tslot + 1) % 3; z modelu synoptycznego albo ze stałej masy powietrza.
// W czasie kwadratowa krzywa B-sklejana (ciągłe tempo zmian; przesunięcie o pół terminu wstecz). Wcześniej liniowo A → B:
// co 30 min skok tempa wymuszeń dużej skali i „impulsy” chmur na obrazie IR (front, 5 km: w 20.–29. minucie terminu 150–260
// oczek zmieniało TB o > 10 K w 5 min, w 5.–15. minucie 15–60). Budowane na GPU z siatki parametrów sondażu (co GS oczek).
fn tgW(a: f32) -> vec3f {
  let u = clamp(a, 0.0, 1.0);
  return vec3f(0.5 * (1.0 - u) * (1.0 - u), 0.5 + u - u * u, 0.5 * u * u);
}
fn tgMix(o: u32, a: f32) -> f32 {
  let w = tgW(a);
  return w.x * tgt[((P.tslot + 2u) % 3u) * TG_SLOT + o] + w.y * tgt[P.tslot * TG_SLOT + o] + w.z * tgt[((P.tslot + 1u) % 3u) * TG_SLOT + o];
}

// pole docelowe f (0 θ', 1 q_v, 2 u, 3 v) w punkcie l przy wadze czasowej a (0 – termin A, 1 – B)
fn tgAt(f: u32, l: u32, a: f32) -> f32 { return tgMix(f * N + l, a); }

// pola przy gruncie: 0 u_g, 1 v_g (wiatr geostroficzny przy gruncie), 2 ciśnienie na poziomie morza
fn tgSfc(f: u32, col: u32, a: f32) -> f32 { return tgMix(4u * N + f * NXY + col, a); }

// interpolacja dwuliniowa pola docelowego w poziomie, na poziomie k (X, Y w indeksach punktów pola)
fn tgBil(f: u32, X: f32, Y: f32, k: u32, a: f32) -> f32 {
  let xf = floor(X);
  let yf = floor(Y);
  let fx = X - xf;
  let fy = Y - yf;
  let i0 = wrapi(i32(xf), NX);
  let i1 = (i0 + 1u) % NX;
  let j0 = wrapi(i32(yf), NY);
  let j1 = (j0 + 1u) % NY;
  let b = k * NXY;
  let c00 = tgAt(f, b + j0 * NX + i0, a);
  let c10 = tgAt(f, b + j0 * NX + i1, a);
  let c01 = tgAt(f, b + j1 * NX + i0, a);
  let c11 = tgAt(f, b + j1 * NX + i1, a);
  return mix(mix(c00, c10, fx), mix(c01, c11, fx), fy);
}

// parametr p sondażu w punkcie (X, Y) [indeksy oczek; środek komórki i: X = i + 0.5]
fn parAt(p: u32, X: f32, Y: f32) -> f32 {
  let gx = X / f32(GS);
  let gy = Y / f32(GS);
  let xf = floor(gx);
  let yf = floor(gy);
  let fx = gx - xf;
  let fy = gy - yf;
  let i0 = wrapi(i32(xf), NGX);
  let i1 = (i0 + 1u) % NGX;
  let j0 = wrapi(i32(yf), NGY);
  let j1 = (j0 + 1u) % NGY;
  let b = VG_PGRID + p * NGX * NGY;
  return mix(mix(vg[b + j0 * NGX + i0], vg[b + j0 * NGX + i1], fx),
             mix(vg[b + j1 * NGX + i0], vg[b + j1 * NGX + i1], fx), fy);
}

struct Air { ts: f32, gam: f32, ztr: f32, zi: f32, di: f32, rhl: f32, rhh: f32, u0: f32, v0: f32, du: f32, dv: f32, g2: f32,
              d0u: f32, d0v: f32, d3u: f32, d3v: f32, rhm: f32, r15: f32, r50: f32, r65: f32, gu: f32 }

fn airAt(X: f32, Y: f32) -> Air {
  return Air(parAt(0u, X, Y), parAt(1u, X, Y), parAt(2u, X, Y), parAt(3u, X, Y), parAt(4u, X, Y),
             parAt(5u, X, Y), parAt(6u, X, Y), parAt(7u, X, Y), parAt(8u, X, Y), parAt(9u, X, Y), parAt(10u, X, Y),
             parAt(15u, X, Y), parAt(16u, X, Y), parAt(17u, X, Y), parAt(18u, X, Y), parAt(19u, X, Y), parAt(20u, X, Y),
             parAt(21u, X, Y), parAt(22u, X, Y), parAt(23u, X, Y), parAt(24u, X, Y));
}

// Korekta klimatu (metoda delta, main.js cc*): w węzłach co ≤ 600 km (CCNX × CCNY, bufor vg CCG) średnia różnica dane − model
// synoptyczny na 0 / 1.5 / 3 / 5.6 km n.p.m. i mnożnik wilgotności przy gruncie; dwuliniowo między węzłami (X, Y – położenie w
// oczkach siatki), liniowo z wysokością, powyżej 5.6 km stała do tropopauzy, nad nią zanika jak anomalia z suwaka. Model synoptyczny
// ma za zimną troposferę (Kraków: −5…−9 K na 850–500 hPa, −2…−6 K przy gruncie) i za stromy gradient grunt–850 hPa
fn ccBil(X: f32, Y: f32, k: u32) -> f32 {
  let fx = clamp(X / f32(NXV) * f32(CCNX) - 0.5, 0.0, f32(CCNX - 1u));
  let fy = clamp(Y / f32(NYV) * f32(CCNY) - 0.5, 0.0, f32(CCNY - 1u));
  let i0 = u32(fx);
  let j0 = u32(fy);
  let i1 = min(i0 + 1u, CCNX - 1u);
  let j1 = min(j0 + 1u, CCNY - 1u);
  let ax = fx - f32(i0);
  let ay = fy - f32(j0);
  let v00 = vg[VG_CCG + 8u * (j0 * CCNX + i0) + k];
  let v10 = vg[VG_CCG + 8u * (j0 * CCNX + i1) + k];
  let v01 = vg[VG_CCG + 8u * (j1 * CCNX + i0) + k];
  let v11 = vg[VG_CCG + 8u * (j1 * CCNX + i1) + k];
  return mix(mix(v00, v10, ax), mix(v01, v11, ax), ay);
}
// wysokość danych normy klimatu w węzłach korekty (tryb lekki, main.js ccUpload) – dwuliniowo jak ccBil
fn ccElev(X: f32, Y: f32) -> f32 {
  let fx = clamp(X / f32(NXV) * f32(CCNX) - 0.5, 0.0, f32(CCNX - 1u));
  let fy = clamp(Y / f32(NYV) * f32(CCNY) - 0.5, 0.0, f32(CCNY - 1u));
  let i0 = u32(fx);
  let j0 = u32(fy);
  let i1 = min(i0 + 1u, CCNX - 1u);
  let j1 = min(j0 + 1u, CCNY - 1u);
  let ax = fx - f32(i0);
  let ay = fy - f32(j0);
  return mix(mix(vg[VG_CCE + j0 * CCNX + i0], vg[VG_CCE + j0 * CCNX + i1], ax), mix(vg[VG_CCE + j1 * CCNX + i0], vg[VG_CCE + j1 * CCNX + i1], ax), ay);
}
fn climCorr(z: f32, ztr: f32, X: f32, Y: f32) -> f32 {
  let c0 = ccBil(X, Y, 0u);
  let c1 = ccBil(X, Y, 1u);
  let c2 = ccBil(X, Y, 2u);
  var c = ccBil(X, Y, 3u);
  if (z < 1500.0) { c = mix(c0, c1, max(z, 0.0) / 1500.0); }
  else if (z < 3000.0) { c = mix(c1, c2, (z - 1500.0) / 1500.0); }
  else if (z < 5600.0) { c = mix(c2, c, (z - 3000.0) / 2600.0); }
  return c * (1.0 - smoothstep(ztr, ztr + 2000.0, z));
}

// profil temperatury masy powietrza – ten sam wzór co makeSounding w grid.js
fn airT(a: Air, z: f32) -> f32 {
  let wt = 350.0;
  let x = (z - a.ztr) / wt;
  let soft = select(log(1.0 + exp(x)), x, x > 30.0);
  // gradienty: dolny (gam, do ~3 km), od ~3 km górny 3–5.6 km (gu) i od ~5.5 km górnej troposfery (g2) – z modelu synoptycznego,
  // przejścia gładkie (softplus 400 / 600 m); 0 – jak niższy (stała masa powietrza: jeden gradient)
  let gu = select(a.gam, a.gu, a.gu > 0.0);
  let g2 = select(gu, a.g2, a.g2 > 0.0);
  let w3 = 400.0;
  let x3 = (z - 3000.0) / w3;
  let soft3 = select(log(1.0 + exp(x3)), x3, x3 > 30.0);
  let w2 = 600.0;
  let x2 = (z - 5500.0) / w2;
  let soft2 = select(log(1.0 + exp(x2)), x2, x2 > 30.0);
  var t = a.ts - a.gam * z - (gu - a.gam) * w3 * soft3 - (g2 - gu) * w2 * soft2 + (g2 + 0.001) * wt * soft;
  if (a.zi > 0.0) {
    if (a.di >= 0.0) {
      let s = clamp((z - a.zi) / 500.0, 0.0, 1.0);
      t += a.di * s * s * (3.0 - 2.0 * s);
    } else {
      // ujemna „inwersja”: większy spadek temperatury w warstwie granicznej (do zi + 500 m)
      t += a.di * clamp(z / (a.zi + 500.0), 0.0, 1.0);
    }
  }
  return t;
}

fn airRH(a: Air, z: f32) -> f32 {
  if (z > a.ztr) { return 0.05; }
  // przejście wilgotności dolnej w górną: pod inwersją (tym wyraźniej, im silniejsza), bez niej 1.5–3.5 km
  let s = select(0.0, clamp(a.di, 0.0, 1.0), a.zi > 0.0);
  let z1 = mix(1500.0, a.zi, s);
  let z2 = mix(3500.0, a.zi + 500.0, s);
  // (tryb synoptyczny: poza latem warstwy prawie nasycone w modelu – z profilu w węzłach, airRHm, tgt_build)
  if (z < z1) { return a.rhl; }
  if (z < z2) { return a.rhl + (a.rhh - a.rhl) * (z - z1) / (z2 - z1); }
  return a.rhh;
}
// nasycenie jak w modelu synoptycznym (qsatM w pe.wgsl): nad wodą powyżej 0 °C, nad lodem poniżej −40 °C, liniowo pomiędzy
fn qsatMix(t: f32, p: f32) -> f32 { return mix(qsat_ice(t, p), qsat(t, p), clamp((t - 233.15) / 40.0, 0.0, 1.0)); }
// wilgotność swobodnej troposfery (względem qsatMix) z modelu synoptycznego: węzły 1.5 / 3 / 5 / 6.5 km n.p.m., wyżej stała do tropopauzy
fn airRHm(a: Air, z: f32) -> f32 {
  if (z > a.ztr) { return 0.05; }
  if (z < 3000.0) { return mix(a.r15, a.rhm, clamp((z - 1500.0) / 1500.0, 0.0, 1.0)); }
  if (z < 5000.0) { return mix(a.rhm, a.r50, (z - 3000.0) / 2000.0); }
  return mix(a.r50, a.r65, clamp((z - 5000.0) / 1500.0, 0.0, 1.0));
}

// wysokość dla ścinania wiatru: rośnie do tropopauzy, wyżej wiatr słabnie (zanik prądu strumieniowego)
fn windZ(z: f32, ztr: f32) -> f32 {
  return max(select(z, ztr - 0.5 * (z - ztr), z > ztr), 0.0);
}

// ======================= Fronty: wykrywanie w polu dużej skali i wyostrzenie =======================
// Model synoptyczny (oczko 75 km) daje strefy frontowe szerokości 100–200 km, a domena odtwarzała je wiernie: szeroka zmiana
// temperatury bez zbieżności i linii wznoszenia (temperatura domeny = pole dużej skali + własna odchyłka, wypór względem dużej
// skali; test frontdiag.js: szerokość strefy w domenie = w dużej skali, spadek T 2 m ≤ ~1 K/h). Teraz przy budowie terminu
// każda kolumna szuka wzdłuż gradientu temperatury (~1 km n.p.m.) osi frontu – największego gradientu w promieniu ±24 kroków –
// i ocenia jego rodzaj: chłodny / ciepły ze składowej wiatru w poprzek osi, ostrość frontu chłodnego z kontrastu i tempa
// napływu zimna. Co krok jądro front_phi zamienia gładką strefę na stopień o szerokości ~L (przemapowanie położenia w poprzek
// osi): Φ = pole ostre − gładkie, w dolnych ~3 km, powierzchnia frontowa nachylona (zimny klin). Φ wchodzi do temperatury
// i wilgotności domeny (zmiana wzdłuż drogi cząstki w advect, relaksacja na brzegach), ale wypór liczy się dalej względem
// gładkiego pola – dynamika czuje ostry front jak prąd gęstościowy: zbieżność i wąska linia wznoszenia na krawędzi (front ostry:
// linia konwekcyjna, porywy, nagły spadek temperatury), front łagodny – szeroki pas wznoszenia i opadu warstwowego.
const FR_J: i32 = 24;            // kroki przeszukiwania po każdej stronie kolumny
const FR_ZR: f32 = 1000.0;       // wysokość wykrywania [m n.p.m.]
const FR_H: f32 = 2000.0;        // grubość zimnego klina [m nad gruntem] (powyżej Φ zanika do FR_H + 1 km)

// temperatura dużej skali na wysokości FR_ZR w punkcie (X, Y) [oczka]; poza liczoną domeną wartość z jej brzegu (strefa
// wyrównania łączy przeciwległe brzegi – sztuczny gradient, który udawałby front)
fn frT(X0: f32, Y0: f32) -> f32 {
  var X = X0;
  var Y = Y0;
  if (NE > 0u) { X = clamp(X0, 0.5, f32(NXV) - 0.5); Y = clamp(Y0, 0.5, f32(NYV) - 0.5); }
  var a: Air;
  a.ts = parAt(0u, X, Y); a.gam = parAt(1u, X, Y); a.ztr = parAt(2u, X, Y); a.zi = parAt(3u, X, Y); a.di = parAt(4u, X, Y);
  a.g2 = parAt(15u, X, Y); a.gu = parAt(24u, X, Y);
  return airT(a, FR_ZR);
}

// kwadrat (pow(x, 2.0) dla ujemnego x jest w WGSL nieokreślony – na części kart NaN)
fn sqr2(x: f32) -> f32 { return x * x; }
// tanh bez przepełnienia dla dużych argumentów
fn tnh(x: f32) -> f32 { return tanh(clamp(x, -10.0, 10.0)); }

// ======================= Cyklony tropikalne: drobne jądro w polach docelowych =======================
// Model synoptyczny (oczko 75 km) ma wir cyklonu o promieniu maksymalnego wiatru ~100–150 km i „ogonie” do ~600 km, a domena odtwarzała go
// wiernie: szeroki wir bez oka i ściany oka, opad w kilku pasmach jak przy niżu, bez chmur CDO na IR, wiatr celu w górze z prostej 1.5–6 km
// przedłużonej do tropopauzy – 40–60 m/s nad środkiem (test: Cat 4, oczko 5 km, 800 km; użytkownik: huragany za rozległe, Cat 5 wygląda jak niż
// średnich szerokości). Jak wir sztuczny w modelach operacyjnych (HWRF, GFDL): model synoptyczny podaje ośrodki cyklonów (pe_tcdom: położenie,
// głębokość, otoczenie – lista VG_TCL), a w celu domeny do ~250 km od środka (płynnie do ~600 km) wir modelu zastępuje wiatr otoczenia + wir
// Hollanda (1980) o tej samej głębokości, z promieniem maksymalnego wiatru z intensywności i szerokości (Willoughby i in. 2006; ≥ 2.5 oczka),
// słabnący z wysokością (ciepły rdzeń), ściana oka nachylona na zewnątrz; ciśnienie z profilu Hollanda, ciepły rdzeń, suche oko, nasycona ściana
// oka i dwa pasma spiralne, tarcza cirrusów (CDO); bez wznoszenia dużej skali i warstw nasyconych modelu w jądrze. Zbieżność w warstwie
// granicznej, wznoszenie w ścianie oka i opad robi sama domena (tarcie). W niewidocznym marginesie jądro zanika – w strefie wyrównania sam model.
const TC_RO: f32 = 130000.0;    // promień części zewnętrznej profilu przy wielkości 1 [m]
const TC_FI: f32 = 0.65;        // część głębokości w jądrze (reszta – część zewnętrzna)
// promienie zastąpienia wiru modelu [m]: w całości do r1, płynnie do r2 – rosną z wielkością cyklonu sz
fn tcR12(sz: f32) -> vec2f {
  let r1 = max(250000.0, 1.6 * TC_RO * sz);
  return vec2f(r1, r1 + 350000.0);
}
// wielkość cyklonu ze śladu (losowa 0.6–1.8, pe_tcdom) albo stała z adresu (?tcsz=)
fn tcSize(v: f32) -> f32 { return select(select(1.0, v, v > 0.1), TCSZ, TCSZ > 0.0); }
struct TcPar { w: f32, c: vec2f, dp: f32, pe: f32, gp: vec2f, w1: vec2f, w6: vec2f, s: f32, f: f32, rm: f32, B: f32, ets: f32, egam: f32, eztr: f32, ezi: f32, edi: f32, eg2: f32, egu: f32,
                sz: f32, ro: f32, r1: f32, r2: f32 }
// ślad n z listy (VG_TCL, pe_tcdom): waga, środek względem środka liczonej domeny [m], głębokość [hPa], ciśnienie i gradient otoczenia, wiatr otoczenia
// 1.5 / 6 km, półkula; promień maksymalnego wiatru przy gruncie [m] i kształt B profilu Hollanda
fn tcPar(n: u32) -> TcPar {
  let o = VG_TCL + 24u * n;
  var t: TcPar;
  t.w = vg[o];
  if (t.w <= 0.0) { return t; }
  t.c = vec2f(vg[o + 1u], vg[o + 2u]);
  t.dp = max(vg[o + 3u], 0.0);
  t.pe = vg[o + 4u];
  t.gp = vec2f(vg[o + 5u], vg[o + 6u]);
  t.w1 = vec2f(vg[o + 7u], vg[o + 8u]);
  t.w6 = vec2f(vg[o + 9u], vg[o + 10u]);
  t.s = vg[o + 11u];
  // profil temperatury otoczenia (okrąg 450 km, pe_tcdom)
  t.ets = vg[o + 16u];
  t.egam = vg[o + 17u];
  t.eztr = vg[o + 18u];
  t.ezi = vg[o + 19u];
  t.edi = vg[o + 20u];
  t.eg2 = vg[o + 21u];
  t.egu = vg[o + 22u];
  let lat = vg[o + 12u];
  t.f = 1.4584e-4 * sin(radians(lat));
  // Profil: dwa profile Hollanda – jądro (część TC_FI głębokości; B rośnie z głębokością – silniejsze cyklony ostrzejsze; wiatr gradientowy w promieniu
  // maksymalnego wiatru ≈ √(TC_FI·B·Δp/(ρ·e))) i część zewnętrzna (reszta głębokości, promień TC_RO × wielkość, B 1.2). Sam profil jądra (dawniej) skupiał
  // spadek ciśnienia w ~100 km od środka – pole ciśnienia za mało rozłożone, huragany za małe i wszystkie jednakowe (użytkownik)
  t.sz = tcSize(vg[o + 23u]);
  t.B = clamp(TCB0 + 0.4 + 0.009 * t.dp, 1.6, 2.7);
  let vmx = sqrt(TC_FI * t.B * t.dp * 100.0 / (1.15 * 2.71828));
  t.rm = clamp(46400.0 * exp(-0.0155 * vmx + 0.0169 * lat) * sqrt(t.sz), max(2.5 * max(DX, DY), 12000.0), 100000.0);
  t.ro = max(TC_RO * t.sz, 2.5 * t.rm);
  let rr = tcR12(t.sz);
  t.r1 = rr.x;
  t.r2 = rr.y;
  return t;
}
// rozszerzenie promieni z wysokością: ściana oka nachylona na zewnątrz (~1.5× na 10 km)
fn tcKz(z: f32) -> f32 { return 1.0 + 0.5 * clamp((z - 1000.0) / 9000.0, 0.0, 1.0); }
// promień maksymalnego wiatru na wysokości z
fn tcRmZ(t: TcPar, z: f32) -> f32 { return t.rm * tcKz(z); }
// wiatr gradientowy [m/s] w odległości r: jądro i część zewnętrzna (dwa profile Hollanda 1980), promienie × kz (wysokość)
fn tcHol(t: TcPar, r: f32, kz: f32) -> f32 {
  let rr = max(r, 100.0);
  let xi = pow(kz * t.rm / rr, t.B);
  let xo = pow(kz * t.ro / rr, 1.2);
  let rf = 0.5 * r * abs(t.f);
  return sqrt(t.dp * 100.0 / 1.15 * (TC_FI * t.B * xi * exp(-xi) + (1.0 - TC_FI) * 1.2 * xo * exp(-xo)) + rf * rf) - rf;
}
// część głębokości niżu w odległości r (1 w środku, → 0 daleko): ten sam profil co wiatr
fn tcDef(t: TcPar, r: f32) -> f32 {
  let rr = max(r, 100.0);
  return TC_FI * (1.0 - exp(-pow(t.rm / rr, t.B))) + (1.0 - TC_FI) * (1.0 - exp(-pow(t.ro / rr, 1.2)));
}
// słabnięcie wiru z wysokością (ciepły rdzeń w górnej troposferze): ~0.7 na 10 km, do zera tuż nad tropopauzą
fn tcGz(z: f32, ztr: f32) -> f32 {
  return mix(1.0, 0.7, clamp((z - 1500.0) / 8500.0, 0.0, 1.0)) * (1.0 - smoothstep(10000.0, max(ztr, 12000.0) + 1000.0, z));
}
// wiatr otoczenia na wysokości z: 1.5 i 6 km z okręgu 375 km, liniowo (wyżej najwyżej 1.6 × ścinanie 1.5–6 km)
fn tcEnv(t: TcPar, z: f32, ztr: f32) -> vec2f {
  return t.w1 + (t.w6 - t.w1) * clamp((windZ(z, ztr) - 1500.0) / 4500.0, 0.0, 1.6);
}
// punkt (X, Y) [oczka liczonej domeny] względem środka cyklonu [m]
fn tcRel(t: TcPar, X: f32, Y: f32) -> vec2f {
  return vec2f((X - 0.5 * f32(NXV)) * DX, (Y - 0.5 * f32(NYV)) * DY) - t.c;
}
// waga zastąpienia wiru modelu: ślad × odległość × brzeg liczonej domeny (w niewidocznym marginesie zanika, w strefie wyrównania sam model)
fn tcWb(t: TcPar, rel: vec2f, X: f32, Y: f32) -> f32 {
  let e = min(min(X, f32(NXV) - X), min(Y, f32(NYV) - Y));
  return t.w * (1.0 - smoothstep(t.r1, t.r2, length(rel))) * smoothstep(0.0, max(f32(MG), 4.0), e);
}
// wiatr celu w cyklonie (otoczenie + wir) na wysokości z
fn tcWind(t: TcPar, rel: vec2f, z: f32, ztr: f32) -> vec2f {
  let r = max(length(rel), 1.0);
  let V = TCV * tcHol(t, r, tcKz(z)) * tcGz(z, ztr);
  return tcEnv(t, z, ztr) + t.s * V * vec2f(-rel.y, rel.x) / r;
}
// ciepły rdzeń [K]: ~0.12 K na hPa głębokości (Cat 5 ~11 K), maksimum na ~2/3 wysokości troposfery (~10–11 km), w oku – w ścianie oka już słaby (szerszy
// ogrzewał otoczenie ściany oka w górze i hamował jej konwekcję)
fn tcWarm(t: TcPar, r: f32, z: f32, ztr: f32) -> f32 {
  let u = clamp((z - 1000.0) / (max(ztr, 12000.0) - 1500.0), 0.0, 1.0);
  let rw = 0.9 * tcRmZ(t, z) + 5000.0;
  return 0.12 * t.dp * exp(-(r / rw) * (r / rw)) * sin(3.14159 * pow(u, 1.6));
}
// wilgotność celu w cyklonie: suche oko (osiadanie), nasycona ściana oka i dwa pasma spiralne, tarcza cirrusów (CDO) w górnej troposferze
fn tcMoist(tc: TcPar, rel: vec2f, z: f32, zagl: f32, t: f32, p: f32, ztr: f32, q0: f32, wb: f32) -> f32 {
  var q = q0;
  let r = length(rel);
  let x = r / tcRmZ(tc, z);
  let ins = smoothstep(5.0, 30.0, tc.dp);      // siła: od depresji do huraganu
  let qs = qsatMix(t, p);
  let top = 1.0 - smoothstep(ztr - 2500.0, ztr - 500.0, z);
  // oko: osiadanie, sucho nad ~1.5 km
  // (wyrazistość oka rośnie z siłą: burza tropikalna i Cat 1 – oko zachmurzone / poszarpane, RH ~85%; od Cat 3–4 czyste, RH 50%)
  let eyS = smoothstep(25.0, 65.0, tc.dp);
  let wEye = (1.0 - smoothstep(0.55, 0.9, x)) * smoothstep(1200.0, 2200.0, zagl) * ins;
  q = mix(q, min(q, mix(0.85, 0.5, eyS) * qs), wEye * wb);
  // ściana oka: pierścień ~1–1.6 promienia maksymalnego wiatru, od warstwy granicznej do górnej troposfery
  let wWall = exp(-((x - 1.25) / 0.4) * ((x - 1.25) / 0.4)) * smoothstep(200.0, 600.0, zagl) * top;
  // (pasma spiralne – tcBand, w każdym kroku w lbc_apply: obracają się i zmieniają w czasie)
  // otoczka pasm (od ściany oka do zasięgu pasm, 0.5–6 km): RH ≥ 85% – powietrze wchodzi w pasmo prawie nasycone. Bez tego przy RH otoczenia ~70% cząstka przelatywała
  // przez pasmo (~25 km przy 20–40 m/s, ~15 min) szybciej, niż dociąganie pary je nasycało – opad tylko w ~50 km od oka (użytkownik)
  let rbo = clamp(2.2 * tc.ro, 200000.0, 550000.0);
  let wEnv = smoothstep(1.3, 2.0, r / tc.rm) * (1.0 - smoothstep(0.7 * rbo, rbo, r)) * smoothstep(300.0, 800.0, zagl) * (1.0 - smoothstep(5000.0, 7000.0, z)) * ins;
  q = mix(q, max(q, 0.85 * qs), wEnv * wb);
  q = mix(q, max(q, qs), wWall * wb * mix(0.4, 1.0, ins));
  // tarcza cirrusów (CDO): przesycenie względem lodu w górnej troposferze w promieniu ~200–400 km (bez oka)
  let rc = clamp(1.2 * tc.ro + 60000.0, 180000.0, 450000.0);
  // + cirrusy wypływu: spiralne smugi do ~2 promieni tarczy, zwinięte antycyklonalnie (wypływ w górnej troposferze, jak na zdjęciach satelitarnych)
  let psc = atan2(rel.y, rel.x) - tc.s * 1.6 * log(max(r / rc, 1.0));
  let snc = sin(2.0 * psc) / 0.55;
  let wOut = exp(-snc * snc) * smoothstep(0.7 * rc, rc, r) * (1.0 - smoothstep(1.5 * rc, 2.1 * rc, r));
  let wCdo = max(1.0 - smoothstep(0.6 * rc, rc, r), 0.8 * wOut) * mix(1.0, smoothstep(0.9, 1.3, x), eyS) * (1.0 - smoothstep(250.0, 256.0, t)) * (1.0 - smoothstep(ztr - 1500.0, ztr + 500.0, z)) * ins;
  q = mix(q, max(q, 1.12 * qsat_ice(t, p)), wCdo * wb);
  return q;
}

// Pasma spiralne cyklonu (waga 0…1) w punkcie rel na wysokości z w chwili t [s]: dwa ramiona spirali logarytmicznej (na półkuli N zwinięte do środka przeciwnie
// do ruchu wskazówek zegara) od ~2 promieni maks. wiatru do ~2.2·R_o, obracające się cyklonalnie (pełny obrót ~12 h), porwane na odcinki, których ułożenie
// zmienia się co ~2 h (przejście kosinusowe). Wcześniej stała spirala w celu (co termin, nieruchoma względem oka): powietrze tylko przez nią przepływało,
// pasma opadu i chmur wyglądały statycznie (użytkownik)
fn tcBand(tc: TcPar, rel: vec2f, z: f32, zagl: f32, t: f32) -> f32 {
  let r = length(rel);
  let xs = r / tc.rm;
  let rb = clamp(2.2 * tc.ro, 200000.0, 550000.0);
  let win = smoothstep(1.8, 2.8, xs) * (1.0 - smoothstep(0.6 * rb, rb, r)) * smoothstep(300.0, 800.0, zagl) * (1.0 - smoothstep(6000.0, 8500.0, z));
  if (win <= 0.0) { return 0.0; }
  let lr = log(max(xs, 1.0));
  let psi = atan2(rel.y, rel.x) + tc.s * (2.6 * lr - 6.2832 * t / 43200.0);
  let sn = sin(psi) / 0.42;   // (szersze ramię – ~35 km na 150 km; przy 0.3 pasma dalej od oka za wąskie, użytkownik)
  let ia = f32(i32(floor(psi / 3.14159265 + 0.5)) & 1);
  let tN = t / 7200.0;
  let pN = u32(tN);
  let fN = fract(tN);
  let seg = cos(1.5708 * fN) * psNoise(3.0 * lr, 7.3 * ia + 0.37, pN) + sin(1.5708 * fN) * psNoise(3.0 * lr, 7.3 * ia + 0.37, pN + 1u);
  return exp(-sn * sn) * win * smoothstep(-0.35, 0.45, seg);
}
// waga drobnego jądra cyklonu w punkcie (X, Y) [oczka liczonej domeny] – poprawka dynamiki odchyłki wiatru w advect
fn tcCoreW(X: f32, Y: f32) -> f32 {
  if (TCJ <= 0.0) { return 0.0; }
  var w = 0.0;
  for (var n = 0u; n < 8u; n++) {
    let o = VG_TCL + 24u * n;
    if (vg[o] <= 0.0) { continue; }
    let rel = vec2f((X - 0.5 * f32(NXV)) * DX, (Y - 0.5 * f32(NYV)) * DY) - vec2f(vg[o + 1u], vg[o + 2u]);
    let rr = tcR12(tcSize(vg[o + 23u]));
    w = max(w, vg[o] * (1.0 - smoothstep(rr.x, rr.y, length(rel))));
  }
  let e = min(min(X, f32(NXV) - X), min(Y, f32(NYV) - Y));
  return w * smoothstep(0.0, max(f32(MG), 4.0), e);
}
// fronty a cyklony tropikalne: w otoczeniu cyklonu (do ~600 km, płynnie do ~850 km) bez wykrywania frontów – gradienty temperatury wokół ciepłego rdzenia
// i na brzegu jądra udawały fronty, a ich wyostrzenie (skok wiatru, temperatury i wilgotności) robiło fałszywe pasma opadu (użytkownik)
fn tcFrontKeep(X: f32, Y: f32) -> f32 {
  var k = 1.0;
  for (var n = 0u; n < 8u; n++) {
    let o = VG_TCL + 24u * n;
    if (vg[o] <= 0.0) { continue; }
    let rel = vec2f((X - 0.5 * f32(NXV)) * DX, (Y - 0.5 * f32(NYV)) * DY) - vec2f(vg[o + 1u], vg[o + 2u]);
    let r2 = tcR12(tcSize(vg[o + 23u])).y;
    k = min(k, 1.0 - vg[o] * (1.0 - smoothstep(r2, r2 + 250000.0, length(rel))));
  }
  return k;
}
// wiatr celu (u, v) [m/s] w punkcie (x, y) [oczka; ściany komórek w liczbach całkowitych] na poziomie k
fn tgUV(x: f32, y: f32, k: u32, a: f32) -> vec2f { return vec2f(tgBil(2u, x, y - 0.5, k, a), tgBil(3u, x - 0.5, y, k, a)); }

// Buduje pola docelowe jednego terminu (slot P.bslot) z siatki parametrów
@compute @workgroup_size(64)
fn tgt_build(@builtin(global_invocation_id) gid: vec3u) {
  let col = gid.x;
  if (col >= NXY) { return; }
  let X = f32(col % NX) + 0.5;
  let Y = f32(col / NX) + 0.5;
  let a = airAt(X, Y);
  let au = airAt(X - 0.5, Y);
  let av = airAt(X, Y - 0.5);
  let base = P.bslot * TG_SLOT;
  // manipulacja atmosfery „opad”: wilgotność dużej skali. Przy gruncie wykładnik RH → RH^e (RH 0 i 1 zostają na miejscu), wyżej mnożnik, nie ponad nasycenie
  let eRain = pow(max(P.rainF, 0.05), -0.4);
  let hRain = pow(max(P.rainF, 0.05), 0.15);
  // cyklony tropikalne w pobliżu kolumny (drobne jądro w celu); wbc – największa waga zastąpienia wiru modelu w środku kolumny
  var tcs: array<TcPar, 8>;
  var ntc = 0u;
  var wbc = 0.0;
  if (TCJ > 0.0) {
    for (var n = 0u; n < 8u; n++) {
      let tc = tcPar(n);
      if (tc.w <= 0.0 || length(tcRel(tc, X, Y)) > tc.r2 + 2.0 * max(DX, DY)) { continue; }
      tcs[ntc] = tc;
      ntc++;
      wbc = max(wbc, tcWb(tc, tcRel(tc, X, Y), X, Y));
    }
  }
  for (var k = 0u; k < NZ; k++) {
    let z = vg[VG_ZC + k];
    // anomalia z suwaka: cała troposfera cieplejsza / chłodniejsza o tyle samo, wilgotność względna bez zmian
    let ta = P.tanom * (1.0 - smoothstep(a.ztr, a.ztr + 2000.0, z)) + climCorr(z, a.ztr, X, Y);
    var t = airT(a, z) + ta;
    // cyklon: w jądrze profil otoczenia (bez szerokiego ciepłego rdzenia modelu synoptycznego) + wąski ciepły rdzeń w oku
    for (var m = 0u; m < ntc; m++) {
      let rel = tcRel(tcs[m], X, Y);
      let wb = tcWb(tcs[m], rel, X, Y);
      if (wb <= 0.0) { continue; }
      var ztE = a.ztr;
      if (tcs[m].ets > 200.0) {
        var ae = a;
        // (bez inwersji pasatowej: w jądrze cyklonu konwekcja ją niszczy – w celu warstwa stała 1–2.5 km zatrzymywała ścianę oka na ~4–5 km)
        ae.ts = tcs[m].ets; ae.gam = tcs[m].egam; ae.ztr = tcs[m].eztr; ae.zi = tcs[m].ezi; ae.di = min(tcs[m].edi, 0.0); ae.g2 = tcs[m].eg2; ae.gu = tcs[m].egu;
        ztE = ae.ztr;
        let tE = airT(ae, z) + P.tanom * (1.0 - smoothstep(ae.ztr, ae.ztr + 2000.0, z)) + climCorr(z, ae.ztr, X, Y);
        t = mix(t, tE, wb);
      }
      t += wb * tcWarm(tcs[m], length(rel), z, ztE);
    }
    let l = k * NXY + col;
    tgt[base + l] = t / vg[VG_EXC + k] - vg[VG_TC + k];
    // wilgotność docelowa: w warstwach cirrusowych (< −20 °C) najwyżej 95% nasycenia względem lodu (inaczej
    // wszędzie gruby cirrus); w cieplejszych – bez tego limitu (przy −8 °C oznaczał ≤ 87% RH względem wody,
    // więc zimą w warstwie granicznej nie mogły powstać przechłodzone stratusy – pogodne niebo i mróz)
    var qtw = airRH(a, z) * qsat(t, vg[VG_PRS + k]);
    // Tryb synoptyczny: warstwy prawie nasycone w modelu (RH względem nasycenia woda → lód 85–97% → płynnie; front, niż, chmury
    // warstwowe zimą) nad warstwą dolną (~1.5 km, przy inwersji niżej / wyżej) – w celu nasycone jak w modelu. Profil grunt → 6.5 km
    // (względem wody) gubił nasycone warstwy frontu: jesienią i zimą domena dostawała 10–40% opadu modelu (Poznań, 20 dób: listopad
    // 8 mm przy 73 mm, grudzień 15 przy 58). Poza nimi profil jak dotąd. Tylko poza latem (popołudniowa T przy gruncie ≤ ~14 °C – pełne, ≥ ~21 °C – wcale):
    // swobodna troposfera modelu jest latem za wilgotna i za często prawie nasycona – w lipcu (Kraków, 8 km, 20 dób) pełny profil
    // modelu dawał CAPE 371 → 524 J/kg i opad 100 → 264 mm, same warstwy nasycone 416 J/kg i 242 mm (jak dawniej sama wilgotność
    // na 3 km – burze w górach); latem opad frontów robi domena z unoszenia dużej skali jak dotąd
    var rhU = airRH(a, z);
    var wsat = 0.0;
    if (a.r15 > 0.0) {
      let zb = mix(1500.0, a.zi, select(0.0, clamp(a.di, 0.0, 1.0), a.zi > 0.0));
      let rm = airRHm(a, z);
      // (w tropikach – do ~20–28° – także w cieple tam, gdzie model synoptyczny pada ≥ ~0.5–2 mm/h: cyklon tropikalny i jego pasma; latowe
      // wyłączenie jest dla średnich szerokości, gdzie wilgotna swobodna troposfera modelu dawała za dużo CAPE – wokół cyklonu domena nie
      // dostawała nasyconego rdzenia i pasm opadu, użytkownik: „nie ma wirujących opadów”)
      let wTrop = (1.0 - smoothstep(0.34, 0.47, abs(sin(latAt(i32(col / NX)))))) * smoothstep(0.5, 2.0, parAt(13u, X, Y));
      // (w jądrze cyklonu bez warstw nasyconych modelu – tam wilgotność z drobnego jądra, tcMoist)
      wsat = smoothstep(zb - 300.0, zb + 300.0, z) * smoothstep(0.85, 0.97, rm) * max(max(1.0 - smoothstep(287.0, 294.0, a.ts), wTrop), CSI * (1.0 - smoothstep(248.15, 258.15, t))) * min(P.rainF, 1.0) * (1.0 - wbc);
      qtw = mix(qtw, max(qtw, rm * qsatMix(t, vg[VG_PRS + k])), wsat);
      rhU = mix(rhU, max(rhU, rm), wsat);
    }
    // latem w ciągu dnia warstwa graniczna jest wymieszana do ~1.5 km: wilgotność właściwa jak przy gruncie (stała RH
    // z wysokością dawała pod szczytem warstwy granicznej o 1–2 g/kg mniej niż przy gruncie – cel „suszył” termiki)
    {
      // (od wysokości nizinnej ≤ 700 m, nie od lokalnego gruntu: model synoptyczny nie ma gór, a warstwa „przyklejona” do terenu
      // dawała nad grzbietami Tatr na 2.3–3.4 km n.p.m. 5.8 g/kg przy 1.4–4 g/kg obok gór – stałe źródło pary i burz, 1300 mm
      // w 13 dób; wilgotną warstwę graniczną gór robi sama domena – parowanie, wiatr dolinny)
      let hg = min(vg[VG_HGT + col], 700.0);
      let qml = min(a.rhl * qsat(airT(a, hg) + P.tanom + climCorr(hg, a.ztr, X, Y), 101325.0 * exp(-hg / 8400.0)), 0.95 * qsat(t, vg[VG_PRS + k]));
      let fml = smoothstep(278.0, 290.0, a.ts) * (1.0 - smoothstep(1200.0, 2000.0, z - hg));
      qtw = max(qtw, mix(qtw, qml, fml));
    }
    // (gdzie duża skala pada – wilgotność ≥ 97% – bez limitu: chmury warstwowe frontu i niżu, także lodowe)
    // Swobodna troposfera (> 1.5 km nad gruntem) przy −5…−20 °C: najwyżej nasycenie względem lodu – inaczej
    // RH ~90% względem wody (≈ 106% względem lodu przy −15 °C) zamieniało przy pierwszych kryształkach całą warstwę
    // 3–6 km w pokład chmur lodowych (chłodne masy „zawalone” chmurami średnimi od rana); warstwa graniczna bez zmian
    let zagl = z - vg[VG_HGT + col];
    let lim = select(1.0, 0.95, t < 253.15) * qsat_ice(t, vg[VG_PRS + k]);
    // korekta wilgotności (main.js, ccUpdate): przy gruncie z normy punktu rosy jako wykładnik RH → RH^a, wyżej z wilgotności względnej na 850 i 700 hPa jako mnożnik
    // (~1.5 i 3 km n.p.m.), zanika do ~5 km; przejście grunt → swobodna atmosfera w dolnych 1.5 km nad gruntem. Przy gruncie mnożnik ×1.3–1.4 (lipiec) dodawał najwięcej pary tam, gdzie już
    // jest wilgotno – przed frontem i w dni burz (punkt rosy do ~24 °C, duże CAPE); wykładnik daje tę samą średnią, a RH 0 i 1 zostają na miejscu. W swobodnej atmosferze mnożnik zostaje:
    // wykładnik także tam obcinał opad o połowę, a zachmurzenie o 8–9 punktów (lipiec, 5 km, ta sama pogoda) – warstwy prawie nasycone modelu to jego chmury i opad frontów
    let fqn = select(1.0, ccBil(X, Y, 4u), ccBil(X, Y, 4u) > 0.0);
    let f85 = select(1.0, ccBil(X, Y, 5u), ccBil(X, Y, 5u) > 0.0);
    let f70 = select(1.0, ccBil(X, Y, 6u), ccBil(X, Y, 6u) > 0.0);
    let fqa = select(select(mix(f70, 1.0, smoothstep(3000.0, 5000.0, z)), mix(f85, f70, (z - 1500.0) / 1500.0), z < 3000.0), f85, z < 1500.0);
    // (płynnie zamiast progów: przy przejściu RH dużej skali przez 97% w nowym terminie cel stawał się nagle przesycony względem
    // lodu i całe płaty cirrusów zapalały się naraz – na IR „impulsy” co 30 min, front, 5 km: 150–260 oczek zmieniało TB o > 10 K)
    let wcold = max(1.0 - smoothstep(250.0, 256.0, t), (1.0 - smoothstep(265.0, 271.0, t)) * smoothstep(1300.0, 1700.0, zagl));
    let wlim = wcold * (1.0 - smoothstep(0.90, 0.99, rhU));
    // mnożnik korekty klimatu poza warstwami nasyconymi w modelu (mnożnik ~0.75–0.85 na 850–700 hPa zabierał nasycenie frontom)
    // i nie ponad nasycenie
    let qb = mix(qtw, min(qtw, lim), wlim);
    let qsm = qsatMix(t, vg[VG_PRS + k]);
    let qeN = select(qb, qsm * pow(max(qb / qsm, 1e-4), mix(fqn * eRain, 1.0, wsat)), qb < qsm);
    let qeA = min(mix(fqa * hRain, 1.0, wsat) * qb, max(qb, qsm));
    var qf = mix(qeN, qeA, smoothstep(0.0, 1500.0, zagl));
    for (var m = 0u; m < ntc; m++) {
      let rel = tcRel(tcs[m], X, Y);
      let wb = tcWb(tcs[m], rel, X, Y);
      if (wb > 0.0) { qf = tcMoist(tcs[m], rel, z, zagl, t, vg[VG_PRS + k], a.ztr, qf, wb); }
    }
    tgt[base + N + l] = qf;
    // hodograf: liniowy (u0 + ścinanie) + skręt w dolnych 1.5 km (wiatr geostroficzny przy gruncie) + krzywizna 1.5–6 km
    let f0 = max(1.0 - z / 1500.0, 0.0);
    let f3 = max(1.0 - abs(z - 3000.0) / select(1500.0, 3000.0, z > 3000.0), 0.0);
    var uu = au.u0 + au.du * windZ(z, au.ztr) + au.d0u * f0 + au.d3u * f3;
    var vv = av.v0 + av.dv * windZ(z, av.ztr) + av.d0v * f0 + av.d3v * f3;
    // cyklon: wir modelu synoptycznego → wiatr otoczenia + drobny wir (u i v w swoich punktach siatki C)
    for (var m = 0u; m < ntc; m++) {
      let ru = tcRel(tcs[m], X - 0.5, Y);
      let wu = tcWb(tcs[m], ru, X - 0.5, Y);
      if (wu > 0.0) { uu = mix(uu, tcWind(tcs[m], ru, z, a.ztr).x, wu); }
      let rv = tcRel(tcs[m], X, Y - 0.5);
      let wv = tcWb(tcs[m], rv, X, Y - 0.5);
      if (wv > 0.0) { vv = mix(vv, tcWind(tcs[m], rv, z, a.ztr).y, wv); }
    }
    tgt[base + 2u * N + l] = uu;
    tgt[base + 3u * N + l] = vv;
  }
  var ugs = a.u0 + a.d0u;
  var vgs = a.v0 + a.d0v;
  var pss = parAt(12u, X, Y);
  var wls = parAt(11u, X, Y);
  // cyklon: ciśnienie z profilu Hollanda na tle otoczenia (średnia i gradient z okręgu 375 km), bez wznoszenia dużej skali w jądrze (wznoszenie
  // w ścianie oka robi domena – szerokie wznoszenie modelu dawało tarczę opadu)
  for (var m = 0u; m < ntc; m++) {
    let rel = tcRel(tcs[m], X, Y);
    let wb = tcWb(tcs[m], rel, X, Y);
    if (wb <= 0.0) { continue; }
    let w0 = tcWind(tcs[m], rel, 0.0, a.ztr);
    ugs = mix(ugs, w0.x, wb);
    vgs = mix(vgs, w0.y, wb);
    // (unormowane tak, by na okręgu 375 km – tam model mierzy głębokość – było ciśnienie otoczenia)
    let d375 = tcDef(tcs[m], 375000.0);
    let pc = tcs[m].pe + dot(tcs[m].gp, rel) - tcs[m].dp * (tcDef(tcs[m], length(rel)) - d375) / max(1.0 - d375, 0.3);
    pss = mix(pss, pc, wb);
    wls = mix(wls, 0.0, wb);
  }
  tgt[base + 4u * N + col] = ugs;
  tgt[base + 4u * N + NXY + col] = vgs;
  tgt[base + 4u * N + 2u * NXY + col] = pss;
  tgt[base + 4u * N + 3u * NXY + col] = wls;     // ruch pionowy dużej skali ~3 km [m/s]
  // geometria frontu (pola 4…11 przy gruncie terminu): kierunek do zimnego powietrza (2), położenie osi względem kolumny wzdłuż
  // tego kierunku [m], połowa szerokości gładkiej strefy D [m], połowa szerokości ostrego stopnia L [m], nachylenie powierzchni
  // frontowej [m poziomo na m pionowo], waga 0…1, rodzaj (−1 ciepły, 0 stacjonarny, 1 chłodny łagodny … 2 chłodny ostry)
  var geo = array<f32, 11>(0.0, 0.0, 0.0, 1.0, 1.0, 100.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  if (NE == 0u || (col % NX < NXV && col / NX < NYV)) {
    let e = f32(GS);
    let gx = (frT(X + e, Y) - frT(X - e, Y)) / (2.0 * e * DX);
    let gy = (frT(X, Y + e) - frT(X, Y - e)) / (2.0 * e * DY);
    let gm = length(vec2f(gx, gy));
    if (gm > 3e-6) {
      let n = -vec2f(gx, gy) / gm;
      let ds = max(DX, 8000.0);
      var T: array<f32, 49>;
      for (var q = 0; q < 49; q++) {
        let s = f32(q - FR_J) * ds;
        T[q] = frT(X + n.x * s / DX, Y + n.y * s / DY);
      }
      // profil wygładzony w poprzek frontu (dwa razy filtr dwumianowy 1-4-6-4-1, σ ≈ 1.4 próbki ≥ 11 km): parametry są dwuliniowe między węzłami
      // co GS oczek – gradient był schodkowy, a oś frontu szła schodami wzdłuż węzłów (użytkownik: front kanciasty)
      for (var it = 0; it < 2; it++) {
        var Ts = T;
        for (var q = 2; q < 47; q++) { Ts[q] = (T[q - 2] + 4.0 * T[q - 1] + 6.0 * T[q] + 4.0 * T[q + 1] + T[q + 2]) / 16.0; }
        T = Ts;
      }
      // ciągłość w czasie: oś z poprzedniego terminu (slot zbudowany przed tym) rzutowana na ten kierunek – gradient blisko niej (~50 km) lekko
      // preferowany (× 0.6…1). Przy dwóch strefach gradientu o podobnej sile wykrywanie przerzucało oś między nimi co termin – front skakał (użytkownik);
      // wyraźnie silniejsza nowa strefa dalej wygrywa
      let pb = ((P.bslot + 2u) % 3u) * TG_SLOT + 4u * N + col;
      let nP = vec2f(tgt[pb + 4u * NXY], tgt[pb + 5u * NXY]);
      let cP = dot(nP, n) / max(length(nP), 1e-6);
      let sP = tgt[pb + 6u * NXY] * cP;
      let wP = smoothstep(0.05, 0.3, tgt[pb + 10u * NXY]) * smoothstep(0.7, 0.9, cP);
      // gradient wzdłuż n (dodatni w stronę zimna): G – do siły frontu, Ge – z preferencją osi z poprzedniego terminu – do położenia
      var G: array<f32, 49>;
      var Ge: array<f32, 49>;
      for (var q = 1; q < 48; q++) {
        G[q] = (T[q - 1] - T[q + 1]) / (2.0 * ds);
        Ge[q] = G[q] * mix(1.0, 0.6 + 0.4 * exp(-sqr2((f32(q - FR_J) * ds - sP) / 50000.0)), wP);
      }
      var gmax = 0.0;
      var gmE = 0.0;
      var qm = FR_J;
      for (var q = 2; q < 47; q++) {
        gmax = max(gmax, G[q]);
        if (Ge[q] > gmE) { gmE = Ge[q]; qm = q; }
      }
      // strefa, w której gradient przekracza połowę maksimum, i oś frontu w jej środku ciężkości (samo maksimum przeskakiwało między końcami
      // „płaskowyżów” pól liniowych między oczkami 75 km – schodki na linii frontu)
      var ql = qm;
      loop { if (ql <= 1 || Ge[ql] < 0.5 * gmE) { break; } ql -= 1; }
      var qr = qm;
      loop { if (qr >= 47 || Ge[qr] < 0.5 * gmE) { break; } qr += 1; }
      var sw = 0.0;
      var sx = 0.0;
      for (var q = ql; q <= qr; q++) {
        let wq = max(Ge[q] - 0.5 * gmE, 0.0);
        sw += wq;
        sx += wq * f32(q - FR_J);
      }
      let sAx = select(f32(qm - FR_J), sx / sw, sw > 0.0) * ds;
      let D0 = 0.5 * f32(qr - ql) * ds;
      let dT = T[max(2 * ql - qm, 0)] - T[min(2 * qr - qm, 48)];      // kontrast w poprzek strefy [K]
      // skupienie gradientu: 0 – równomierny na całym odcinku (strefa barokliniczna bez frontu), → 1 – front
      let fness = 1.0 - (T[0] - T[48]) / (48.0 * ds * gmax);
      // waga: gradient ≥ ~1–3 K/100 km skupiony w strefie i kontrast w poprzek ≥ ~1.5–3 K (letnie fronty modelu synoptycznego
      // mają ~1–2 K/100 km, jesienne i zimowe 3–5)
      let wf = smoothstep(1.0e-5, 3.0e-5, gmax) * smoothstep(0.25, 0.5, fness) * smoothstep(1.5, 3.0, dT) * tcFrontKeep(X, Y);
      // wiatr ~1 km po zimnej stronie osi (u0 + ścinanie + skręt w dolnych 1.5 km) w poprzek frontu
      var pc = vec2f(X, Y) + n * (sAx + 0.5 * D0) / DX;
      if (NE > 0u) { pc = clamp(pc, vec2f(0.5), vec2f(f32(NXV) - 0.5, f32(NYV) - 0.5)); }
      let u1 = parAt(7u, pc.x, pc.y) + 1000.0 * parAt(9u, pc.x, pc.y) + parAt(16u, pc.x, pc.y) / 3.0;
      let v1 = parAt(8u, pc.x, pc.y) + 1000.0 * parAt(10u, pc.x, pc.y) + parAt(17u, pc.x, pc.y) / 3.0;
      let un = u1 * n.x + v1 * n.y;        // < 0: zimne powietrze napiera (front chłodny), > 0: ciepłe nasuwa się (front ciepły)
      let cw = smoothstep(1.0, 4.0, -un);
      let ww = smoothstep(1.0, 4.0, un);
      // ostrość frontu chłodnego: duży kontrast i szybki napływ zimna; front ciepły i stacjonarny – łagodne
      let sh = cw * smoothstep(2.0, 6.0, dT) * smoothstep(2.0, 8.0, -un);
      // front stacjonarny: prawie bez wiatru w poprzek osi, wiatr wzdłuż niej
      let st = (1.0 - cw) * (1.0 - ww);
      // szerokość stopnia: chłodny ostry ≥ 6 km (wcześniej ≥ 3 km), łagodny 60 km, ciepły 80 km, stacjonarny 80 km
      let L = mix(mix(mix(60000.0, 80000.0, max(ww, st)), max(2.5 * DX, 6000.0), sh), 80000.0, st * (1.0 - sh));
      // wygięcie osi z przepływu: tam, gdzie powietrze ~1.5 km napiera w poprzek frontu mocniej niż średnio wzdłuż frontu (±120 km),
      // front wybrzusza się w łuk (chłodny – w stronę ciepłą, ciepły – w stronę zimną); słabiej – zostaje z tyłu. Przesunięcie ≈
      // różnica składowej × 2 h, najwyżej ±50 km i ±0.6 szerokości gładkiej strefy (oś była linią z modelu 75 km – prawie prosta)
      let tg = vec2f(-n.y, n.x);
      let pa = vec2f(X, Y) + n * sAx / DX;
      var umean = 0.0;
      var uhere = 0.0;
      for (var m = -3; m <= 3; m++) {
        var pq = pa + tg * f32(m) * 40000.0 / DX;
        if (NE > 0u) { pq = clamp(pq, vec2f(0.5), vec2f(f32(NXV) - 0.5, f32(NYV) - 0.5)); }
        let uq = (parAt(7u, pq.x, pq.y) + 1500.0 * parAt(9u, pq.x, pq.y)) * n.x + (parAt(8u, pq.x, pq.y) + 1500.0 * parAt(10u, pq.x, pq.y)) * n.y;
        umean += uq / 7.0;
        if (m == 0) { uhere = uq; }
      }
      let Dz = max(D0, 1.5 * L);
      let bend = clamp((uhere - umean) * 7200.0, -min(50000.0, 0.6 * Dz), min(50000.0, 0.6 * Dz));
      geo = array<f32, 11>(n.x, n.y, sAx + bend, Dz, L, mix(mix(mix(100.0, 200.0, max(ww, st)), 50.0, sh), 200.0, st * (1.0 - sh)), wf,
                           cw * (1.0 + sh) - ww - 2.0 * st, gmax * 1e5, fness, dT);
    }
  }
  for (var g = 0u; g < 11u; g++) { tgt[base + 4u * N + (4u + g) * NXY + col] = geo[g]; }
}

// geometria frontu w kolumnie w chwili o wadze a między terminami (front obecny tylko w jednym terminie – jego geometria)
struct FrGeo { n: vec2f, s: f32, D: f32, L: f32, tilt: f32, w: f32, typ: f32 }
fn frGeo(col: u32, a0: f32) -> FrGeo {
  // ta sama chwila co pola docelowe (krzywa B-sklejana = stan sprzed pół terminu): przed połową terminu między poprzednim a A,
  // potem między A a B
  let late = a0 >= 0.5;
  let a = select(a0 + 0.5, a0 - 0.5, late);
  let oA = select((P.tslot + 2u) % 3u, P.tslot, late) * TG_SLOT + 4u * N + col;
  let oB = select(P.tslot, (P.tslot + 1u) % 3u, late) * TG_SLOT + 4u * N + col;
  let wA = tgt[oA + 10u * NXY];
  let wB = tgt[oB + 10u * NXY];
  let b = select(select(a, 0.0, wB < 1e-3), 1.0, wA < 1e-3);
  let nv = mix(vec2f(tgt[oA + 4u * NXY], tgt[oA + 5u * NXY]), vec2f(tgt[oB + 4u * NXY], tgt[oB + 5u * NXY]), b);
  return FrGeo(nv / max(length(nv), 1e-6), mix(tgt[oA + 6u * NXY], tgt[oB + 6u * NXY], b), mix(tgt[oA + 7u * NXY], tgt[oB + 7u * NXY], b),
               mix(tgt[oA + 8u * NXY], tgt[oB + 8u * NXY], b), mix(tgt[oA + 9u * NXY], tgt[oB + 9u * NXY], b), mix(wA, wB, a),
               mix(tgt[oA + 11u * NXY], tgt[oB + 11u * NXY], b));
}

// Φ (f: 0 θ', 1 q_v, 2 u, 3 v – u i v w swoich punktach siatki C) w buforze parzystości par: punkt l (k < KFR) i dwuliniowo
// w poziomie (X, Y – indeksy punktów pola) na poziomie k
fn frPhi(par: u32, f: u32) -> u32 { return FPH_OFF + par * 4u * NF + f * NF; }
fn phAt(par: u32, f: u32, l: u32) -> f32 { return tgt[frPhi(par, f) + l]; }
fn phBil(par: u32, f: u32, X: f32, Y: f32, k: u32) -> f32 {
  let xf = floor(X);
  let yf = floor(Y);
  let fx = X - xf;
  let fy = Y - yf;
  let i0 = wrapi(i32(xf), NX);
  let i1 = (i0 + 1u) % NX;
  let j0 = wrapi(i32(yf), NY);
  let j1 = (j0 + 1u) % NY;
  let b = frPhi(par, f) + k * NXY;
  return mix(mix(tgt[b + j0 * NX + i0], tgt[b + j0 * NX + i1], fx), mix(tgt[b + j1 * NX + i0], tgt[b + j1 * NX + i1], fx), fy);
}

// Wyostrzenie frontów Φ w chwili t + Δt (waga P.ta1) → bufor parzystości (P.step + 1) & 1 (bufor P.step & 1 ma Φ(t)).
// Przy gruncie pole FRT – oś frontu na mapie (rodzaj × waga × bliskość osi).
@compute @workgroup_size(WG)
fn front_phi(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let id = lin_id(gid, nwg);
  if (id >= NF) { return; }
  let col = id % NXY;
  let k = id / NXY;
  let par = (P.step + 1u) & 1u;
  let g = frGeo(col, P.ta1);
  var ph = 0.0;
  var pq = 0.0;
  var pu = 0.0;
  var pv = 0.0;
  if (g.w > 1e-3) {
    let zagl = vg[VG_ZC + k] - zgC(col);
    if (zagl > -100.0 && zagl < FR_H + 1000.0) {
      // oś na tej wysokości: powierzchnia frontowa wznosi się w stronę zimnego powietrza (zimny klin)
      let sz = g.s + g.tilt * max(zagl, 0.0);
      if (abs(sz) < g.D) {
        // przemapowanie w poprzek osi x → s + D·tanh((x − s)/L)/tanh(D/L): na brzegach strefy bez zmian, przy osi stopień ~L
        let m = sz + g.D * tnh(-sz / g.L) / tnh(g.D / g.L);
        let Xm = f32(col % NX) + g.n.x * m / DX;
        let Ym = f32(col / NX) + g.n.y * m / DY;
        let fz = FRON * g.w * (1.0 - smoothstep(FR_H, FR_H + 1000.0, zagl));
        ph = fz * (tgBil(0u, Xm, Ym, k, P.ta1) - tgAt(0u, id, P.ta1));
        pq = fz * (tgBil(1u, Xm, Ym, k, P.ta1) - tgAt(1u, id, P.ta1));
        // wiatr: ten sam stopień w poprzek osi (skok wiatru na froncie – zbieżność na kilku km zamiast ~150 km; u i v w swoich
        // punktach siatki C – indeksy punktów pola przesunięte tak samo jak dla skalarów)
        // × FRW (?frw=1 – pełny skok): przy oczku 7.5 km ~8 m/s na ~40 km w dolnych 2 km to 30–40 cm/s – użytkownik: front zbyt mocno wymusza konwekcję (5–11 mm/h przy 2–3 mm/h w modelu, echo tylko do 4–5 km)
        pu = FRW * fz * (tgBil(2u, Xm, Ym, k, P.ta1) - tgAt(2u, id, P.ta1));
        pv = FRW * fz * (tgBil(3u, Xm, Ym, k, P.ta1) - tgAt(3u, id, P.ta1));
      }
    }
  }
  tgt[frPhi(par, 0u) + id] = ph;
  tgt[frPhi(par, 1u) + id] = pq;
  tgt[frPhi(par, 2u) + id] = pu;
  tgt[frPhi(par, 3u) + id] = pv;
  if (k == 0u) {
    let wd = max(1.5 * DX, min(0.3 * g.L, 12000.0));
    sfc[sf(S_FRT, col)] = g.w * exp(-(g.s / wd) * (g.s / wd)) * g.typ;
  }
}

// Stan początkowy z pola docelowego (termin A): wiatr, θ', para; poranna inwersja radiacyjna
// w dolnych 350 m nad lokalnym gruntem (wilgotność względna rośnie w zimnej warstwie, najwyżej
// do 97% – bez mgły na starcie), drobny szum w dolnym 1 km
@compute @workgroup_size(64)
fn init_state(@builtin(global_invocation_id) gid: vec3u) {
  let col = gid.x;
  if (col >= NXY) { return; }
  let h = vg[VG_HGT + col];
  for (var k = 0u; k < NZ; k++) {
    let l = k * NXY + col;
    let z = vg[VG_ZC + k];
    let pk = vg[VG_EXC + k];
    let zagl = z - h;
    var dT = 0.0;
    if (zagl >= 0.0 && zagl < 350.0) {
      let x = 1.0 - zagl / 350.0;
      dT = P.initCool * x * x;
    }
    // + wyostrzenie frontów w chwili startu (front_phi uruchomione przed init_state, bufor (P.step + 1) & 1)
    var phT = 0.0;
    var phQ = 0.0;
    if (k < KFR) { phT = phAt((P.step + 1u) & 1u, 0u, l); phQ = phAt((P.step + 1u) & 1u, 1u, l); }
    let thT = tgAt(0u, l, 0.0) + phT;
    var th = thT - dT / pk;
    if (z < 1000.0) { th += 0.1 * rand11(l * 7u + 12345u); }
    state[T_OFF + l] = th;
    let tK = (vg[VG_TC + k] + thT) * pk;
    let qT = min(max(tgAt(1u, l, 0.0) + phQ, 0.0), qsat(tK, vg[VG_PRS + k]));     // start bez przesycenia
    state[QV_OFF + l] = select(qT, min(qT, 0.97 * qsat(tK - dT, vg[VG_PRS + k])), dT > 0.0);
    state[QC_OFF + l] = 0.0;
    state[QI_OFF + l] = 0.0;
    state[QR_OFF + l] = 0.0;
    state[NR_OFF + l] = 0.0;
    var phU = 0.0;
    var phV = 0.0;
    if (k < KFR) { phU = phAt((P.step + 1u) & 1u, 2u, l); phV = phAt((P.step + 1u) & 1u, 3u, l); }
    state[U_OFF + l] = tgAt(2u, l, 0.0) + phU;
    state[V_OFF + l] = tgAt(3u, l, 0.0) + phV;
    state[W_OFF + l] = 0.0;
  }
  state[W_OFF + NZ * NXY + col] = 0.0;
}

// gładkie pole losowe (średnio 0, odchylenie ~1): wartości w węzłach siatki co 1 (x, y w jednostkach węzłów) z hasza okresu,
// między węzłami interpolacja dwuliniowa z wygładzeniem
fn psNoise(x: f32, y: f32, per: u32) -> f32 {
  let x0 = floor(x);
  let y0 = floor(y);
  let fx = x - x0;
  let fy = y - y0;
  let sx = fx * fx * (3.0 - 2.0 * fx);
  let sy = fy * fy * (3.0 - 2.0 * fy);
  let i0 = u32(i32(x0) + 4096);
  let j0 = u32(i32(y0) + 4096);
  let kp = per * 2654435761u;
  let n00 = rand11((i0 * 73856093u) ^ (j0 * 19349663u) ^ kp);
  let n10 = rand11(((i0 + 1u) * 73856093u) ^ (j0 * 19349663u) ^ kp);
  let n01 = rand11((i0 * 73856093u) ^ ((j0 + 1u) * 19349663u) ^ kp);
  let n11 = rand11(((i0 + 1u) * 73856093u) ^ ((j0 + 1u) * 19349663u) ^ kp);
  return 1.73 * mix(mix(n00, n10, sx), mix(n01, n11, sx), sy);
}
// Pole losowe płynące z wiatrem (um, vm [m/s]; X, Y w oczkach, lc – skala w oczkach, tau [s], sd – ziarno): dwa pokolenia
// przesunięte o tau, przejście kosinusowe (stała wariancja, odchylenie std. ~0.74), każde pokolenie jedzie z wiatrem przez całe swoje życie
fn flowNoise(X: f32, Y: f32, lc: f32, tau: f32, sd: u32, um: f32, vm: f32) -> f32 {
  let per = u32(P.time / tau);
  let ft = fract(P.time / tau);
  let ag = ft * tau;
  let a = psNoise((X - um * ag / DX) / lc, (Y - vm * ag / DY) / lc, per + sd);
  let b = psNoise((X - um * (ag - tau) / DX) / lc, (Y - vm * (ag - tau) / DY) / lc, per + 1u + sd);
  return cos(1.5708 * ft) * a + sin(1.5708 * ft) * b;
}

fn lbcOff(f: u32) -> u32 {
  switch f {
    case 0u: { return T_OFF; }
    case 1u: { return QV_OFF; }
    case 2u: { return U_OFF; }
    default: { return V_OFF; }
  }
}

// Średnia odchyłka od pola docelowego we wnętrzu domeny na kolejnych poziomach nad gruntem
// (θ', q_v, u, v) – to, co warstwa graniczna zrobiła z masą powietrza (cykl dobowy, tarcie,
// parowanie). Powietrze wpływające przez brzeg dostaje tę samą odchyłkę, inaczej każdy napływ
// przynosiłby "popołudniowy" sondaż bez nocnej inwersji.
@compute @workgroup_size(WG)
fn lbc_means(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) li: u32) {
  // grupy 0 … 4·MEB−1: poziomy nad gruntem (θ', q_v, u, v); dalej 2·NZ: stałe poziomy (θ', q_v)
  let pbl = wid.x < 4u * MEB;
  let g = select(wid.x - 4u * MEB, wid.x, pbl);
  let f = select(g / NZ, g / MEB, pbl);
  let m = select(g % NZ, g % MEB, pbl);
  let off = lbcOff(f);
  var s = 0.0;
  var c = 0.0;
  var sh = 0.0;
  for (var col = li; col < NXY; col += WG) {
    if (vg[VG_ZONE + col] > 0.0) { continue; }
    if (wid.x == 0u) { sh += sfc[sf(S_H, col)]; }
    let kb = kbAt(i32(col % NX), i32(col / NX));
    let k = select(m, kb + m, pbl);
    if (k >= NZ || k < kb) { continue; }
    let l = k * NXY + col;
    s += tmp[off + l] - tgAt(f, l, P.ta1);
    if (k < KFR) { s -= phAt((P.step + 1u) & 1u, f, l); }     // wyostrzenie frontów to część celu, nie odchyłka
    c += 1.0;
  }
  let a = wg_sum(li, s);
  let b = wg_sum(li, c);
  // (grupa 0: θ' na najniższym poziomie nad gruntem – każda kolumna liczona dokładnie raz)
  if (wid.x == 0u) {
    let hs = wg_sum(li, sh);
    if (li == 0u) { work[W_HM] += min(P.dt / 86400.0, 1.0) * (hs / max(b, 1.0) - work[W_HM]); }
  }
  if (li == 0u) {
    if (pbl) {
      let e = a / max(b, 1.0);
      work[W_EB + f * MEB + m] = e;
      // θ: średnia dobowa odchyłki (średnia wykładnicza, τ = 1 doba) – do wykrywania dryfu
      if (f < 2u) { let o = W_EBM + f * MEB + m; work[o] = work[o] + min(P.dt / 86400.0, 1.0) * (e - work[o]); }
    }
    else { work[W_EA + f * NZ + m] = a / max(b, 1.0); }
  }
}

// Brzegi i swobodna atmosfera: relaksacja Daviesa w strefie przy krawędzi (do pola docelowego
// + odchyłki warstwy granicznej), pełne zastąpienie w strefie wyrównania, chmury i opad wygaszane
// na brzegach; powyżej ~3 km nad gruntem powolne przyciąganie do pola docelowego (P.nudge).
@compute @workgroup_size(64)
fn lbc_apply(@builtin(global_invocation_id) gid: vec3u) {
  let col = gid.x;
  if (col >= NXY) { return; }
  let i = i32(col % NX);
  let j = i32(col / NX);
  let kb = kbAt(i, j);
  let wc = vg[VG_ZONE + col];
  let wu = max(wc, vg[VG_ZONE + cidx(i - 1, j, 0u)]);
  let wv = max(wc, vg[VG_ZONE + cidx(i, j - 1, 0u)]);
  let h = zgC(col);
  // Ciśnienie na mapie: z dużej skali + zaburzenie od samej domeny (?psd=0 – tylko duża skala). Hydrostatycznie z odchyłki wyporu słupa od celu
  // (θ', para, kondensat), bez średniej odchyłki domeny na każdym poziomie (dryf całej domeny nie przesuwa ciśnienia): ciepły rdzeń cyklonu
  // tropikalnego – głęboki niż, zimne wypływy burz – mezowyże, nocne mrozowiska – słabe wyże. Wcześniej mapa pokazywała tylko ciśnienie modelu
  // synoptycznego (oczko 75 km): huragan rozwinięty w domenie nie miał na niej niżu
  var pdv = 0.0;
  if (PSD > 0.0) {
    for (var k = NZ - 1u; k >= kb && k < NZ; k--) {
      let l = k * NXY + col;
      var b = (tmp[T_OFF + l] - tgAt(0u, l, P.ta1) - work[W_EA + k]) / vg[VG_TC + k] + 0.61 * (tmp[QV_OFF + l] - tgAt(1u, l, P.ta1) - work[W_EA + NZ + k])
            - max(tmp[QC_OFF + l], 0.0) - max(tmp[QI_OFF + l], 0.0) - max(tmp[QR_OFF + l], 0.0);
      if (k < KFR) { b -= phAt((P.step + 1u) & 1u, 0u, l) / vg[VG_TC + k] + 0.61 * phAt((P.step + 1u) & 1u, 1u, l); }
      pdv -= PSD * vg[VG_RC + k] * G * b * vg[VG_DZC + k] * select(1.0, vg[VG_HF + col], k == kb);
      if (k == 0u) { break; }
    }
  }
  // (w jądrze cyklonu tropikalnego bez zaburzenia od domeny: ciepły rdzeń ściany oka domeny dawał skoki ±20–30 hPa – siłę pokazuje cel, jak kategoria)
  sfc[sf(S_PSL, col)] = tgSfc(2u, col, P.ta1) + 0.01 * pdv * (1.0 - tcCoreW(f32(i) + 0.5, f32(j) + 0.5));
  // Stochastyczne zaburzenia warstwy granicznej w szarej strefie (PSP, „physically based stochastic perturbations”, Kober i Craig
  // 2016; podobnie UKV i ICON-D2): na siatkach ~1–3 km wiry warstwy granicznej są w schemacie (K-profil), a przepływ siatki jest
  // gładki i deterministyczny – przy stałym napływie i stałym wyzwalaczu (góry) komórki rodziły się co 30–60 min w tym samym
  // miejscu i płynęły z wiatrem sznurem jednakowych komórek (Tatry, lipiec, 2 km). Zaburzenia θ i q w konwekcyjnej warstwie
  // granicznej (za dnia, H > 10 W/m², do ~0.8 jej wysokości) o skalach konwekcyjnych 2·θ* = 2·H/(ρ·c_p·w*) i 2·q* = 2·E/(ρ·w*)
  // (~0.2 K, ~0.1 g/kg), pole losowe gładkie w skali max(5·dx, 8 km), nowe co 10 min (czas obrotu wiru ~h/w*), przejście
  // kosinusowe (stała wariancja); ?psp=0 – wyłączone
  var psT = 0.0;
  var psQ = 0.0;
  var psH = 0.0;
  let wps = PSP * smoothstep(800.0, 1500.0, DX) * (1.0 - smoothstep(2500.0, 4000.0, DX));
  if (wps > 0.0 && wc < 1.0) {
    let hs = sfc[sf(S_H, col)];
    psH = sfc[sf(S_PBLH, col)];
    if (hs > 10.0 && psH > 200.0) {
      let rb = vg[VG_RC + kb];
      let wst = pow(G / 300.0 * hs / (rb * CP) * psH, 1.0 / 3.0);
      let lc = max(5.0, 8000.0 / DX);
      let per = u32(P.time / 600.0);
      let ft = fract(P.time / 600.0);
      let eta = cos(1.5708 * ft) * psNoise(f32(i) / lc, f32(j) / lc, per) + sin(1.5708 * ft) * psNoise(f32(i) / lc, f32(j) / lc, per + 1u);
      psT = wps * 2.0 * hs / (rb * CP * wst) * eta * P.dt / 600.0;
      psQ = wps * 2.0 * max(sfc[sf(S_LE, col)], 0.0) / (rb * LV * wst) * eta * P.dt / 600.0;
    }
  }
  // Chmury i opad napływające przez brzeg: tam, gdzie model synoptyczny pada, powietrze wpływa z opadem
  // (strumień F = natężenie modelu: q_r = F/(ρ·v_opadania), deszcz ~5 m/s, śnieg ~1.2 m/s) i z chmurą
  // w warstwie prawie nasyconej celu (woda chmurowa, lód poniżej −5 °C – zasiewa niższe chmury). Wcześniej
  // brzeg zerował chmury i opad: na mapie 50 km napływ musiał wszystko wytworzyć od nowa w ~1–2 h
  // (domena dostawała ~25% opadu modelu). Opad konwekcyjny wpływa w komórkach (szum ~10 km, 20 min).
  var fpr = 0.0;
  var ztopP = 0.0;
  var etaL = 0.0;
  var etaH = 0.0;
  var wLs = 0.0;
  var fLs = 0.0;
  // Ciepło z gruntu liczone podwójnie (?hff=0 – bez; tylko tryb synoptyczny, RCOOL = 0): temperatura celu ma już w sobie ogrzewanie od gruntu modelu synoptycznego zrównoważone jego
  // chłodzeniem radiacyjnym, a domena dokłada do tego swój pełny strumień, bez chłodzenia. Średni po domenie i dobie strumień (lipiec ~+55, styczeń ~−15 W/m²) to dla odchyłki od celu czyste
  // źródło, regulator proporcjonalny niżej (τ 6 h) zostawiał z niego resztę Q·τ – stąd sezonowy wzór błędu (lato +, zima −). Część HFF średniego strumienia zdejmowana wprost z warstwy
  // granicznej, równomiernie w czasie i w poziomie: cykl dobowy i różnice między oczkami bez zmian
  var hff = 0.0;
  if (HFF > 0.0 && wc < 1.0 && vg[VG_RCOOL + kb] == 0.0) {
    var mpb = 0.0;
    for (var k = kb; k < min(kb + MEB, NZ); k++) { mpb += mlay(k, kb, col) * (1.0 - smoothstep(f32(MEB) - 5.0, f32(MEB), f32(k - kb))); }
    hff = HFF * P.dt * work[W_HM] / (CP * max(mpb, 1.0));
  }
  if (wc > 0.0) {
    let X = f32(i) + 0.5;
    let Y = f32(j) + 0.5;
    // Domena sama tworzy opad z wilgoci i wznoszenia dużej skali (pasma, komórki w swojej skali) – napływ gotowego opadu
    // konwekcyjnego modelu synoptycznego (jednolita strefa 75 km) tylko w małych domenach, gdzie powietrze przelatuje w 1–2 h
    // i opad nie zdąży powstać: pełny ≤ 50 km, zanika do 150 km (krótszy bok widocznej domeny). Opad warstwowy (front, niż)
    // poza latem wpływa w każdej domenie: śnieg z chmury warstwowej powstaje w 2–4 h (100–200 km drogi) – bez napływu domena
    // 320 km zaczynała padać 3–6 h po modelu synoptycznym i dawała w zdarzeniu ~20–35% jego opadu (Poznań, grudzień); latem
    // (popołudniowa T przy gruncie ≥ ~21 °C) opad robi konwekcja domeny, a napływ tylko go zwiększał (lipiec: +10%).
    // × mnożnik opadu z korekty klimatu (jak pełne unoszenie pary w lsTend)
    let lDom = f32(min(NXD, NYD)) * DX;
    let wsm = clamp((150000.0 - lDom) / 100000.0, 0.0, 1.0);
    let wst = (1.0 - clamp(parAt(14u, X, Y), 0.0, 1.0)) * (1.0 - smoothstep(287.0, 294.0, parAt(0u, X, Y)));
    let fpc = ccBil(X, Y, 7u);
    fpr = max(parAt(13u, X, Y), 0.0) / 3600.0 * mix(wst, 1.0, wsm) * select(1.0, fpc, fpc > 0.0) * P.rainF;
    if (fpr > 3e-6) {
      for (var k = kb; k < NZ; k++) {
        let z = vg[VG_ZC + k];
        if (z > 10000.0) { break; }
        let l = k * NXY + col;
        let tT = (vg[VG_TC + k] + tgAt(0u, l, P.ta1)) * vg[VG_EXC + k];
        if (tgAt(1u, l, P.ta1) >= 0.93 * qsatMix(tT, vg[VG_PRS + k])) { ztopP = z; }
      }
      if (ztopP == 0.0) { ztopP = h + 3000.0; }
    } else { fpr = 0.0; }
    // Napływ z wariancją wilgotności i wilgocią wznoszenia (?bcq=0 – wyłączone; duże domeny, płynnie 150–400 km).
    // Powietrze wchodziło przez brzeg gładkie: wszędzie ta sama średnia wilgotność dużej skali, bez plam nasyconych i bez chmur. W stratus
    // i Sc samo przechodzi bardzo wolno (w domenie nie ma chłodzenia radiacyjnego czystego powietrza, a wierzchołek chmury chłodzi się dopiero,
    // gdy chmura już jest), a pełne unoszenie pary (lsTend) musi najpierw nasycić powietrze, co przy kilku cm/s trwa wiele godzin. Stąd w przebiegu
    // 4-letnim (Polska, 720 km, dni z jednym sektorem wiatru) zachmurzenie o 7–11 punktów i opad o 0.3–1.4 mm/d większe po stronie dalekiej
    // od brzegu napływu niż po bliskiej, także po odjęciu różnic położenia – i opady modelu widoczne w domenie z opóźnieniem.
    // Średnia wilgotność zostaje: plamy (~60 km, płyną z wiatrem ~1.5 km) dodają tylko wariancję. Tam, gdzie duża skala się wznosi, powietrze wchodzi tak,
    // jakby wznosiło się już wcześniej: wilgotne (RH 75–95%) dociągane do nasycenia, z tymi samymi mnożnikami co pełne unoszenie
    if (BCQ > 0.0) {
      let ua = parAt(7u, X, Y) + 1500.0 * parAt(9u, X, Y);
      let va = parAt(8u, X, Y) + 1500.0 * parAt(10u, X, Y);
      let lcq = max(8.0, 60000.0 / DX);
      etaL = flowNoise(X, Y, lcq, 5400.0, 3001u, ua, va);
      etaH = flowNoise(X, Y, lcq, 5400.0, 5003u, ua, va);
      wLs = tgSfc(3u, col, P.ta1);
      fLs = BCQ * (1.0 - 0.7 * clamp(parAt(14u, X, Y), 0.0, 1.0)) * (1.0 - smoothstep(800000.0, 2500000.0, lDom)) * select(1.0, fpc, fpc > 0.0) * P.rainF;
    }
  }
  // pasma spiralne najbliższego cyklonu (tcBand): w każdym kroku – para dociągana do lekkiego przesycenia (τ 30 min), kondensacja i ciepło robią konwekcję pasm
  var bTc: TcPar;
  var bRel = vec2f(1e9);
  var bW = 0.0;
  if (TCJ > 0.0) {
    for (var n = 0u; n < 8u; n++) {
      let tc = tcPar(n);
      if (tc.w <= 0.0) { continue; }
      let rel = tcRel(tc, f32(i) + 0.5, f32(j) + 0.5);
      if (length(rel) < length(bRel)) { bRel = rel; bTc = tc; bW = tcWb(tc, rel, f32(i) + 0.5, f32(j) + 0.5) * smoothstep(5.0, 30.0, tc.dp); }
    }
  }
  for (var k = kb; k < NZ; k++) {
    let l = k * NXY + col;
    let m = k - kb;
    let zagl = vg[VG_ZC + k] - h;
    // Napływ turbulentny (metoda zaburzeń w komórkach, Muñoz-Esparza i in. 2014 – jak w WRF-LES): na siatkach LES (≤ 0.5 km,
    // zanika do 1 km) w pasie marginesu przy brzegach (≤ 12 oczek) w dolnych ~1.5 km losowe zaburzenia θ w blokach 8 × 8 oczek
    // × 4 warstwy, odnawiane co czas przelotu przez blok, amplituda z liczby Eckerta U²/(0.2·c_p) (0.25–1 K). Bez tego powietrze
    // wpływało gładkie i w domenie 25 km nie zdążyło stać się turbulentne (Tatry 250 m, 14:00, CAPE ~230: std w w czasie
    // 0.03–0.16 m/s w zachodnich 40% domeny przy ~1 m/s w rzeczywistej warstwie konwekcyjnej) – przepływ nad górami był
    // „laminarny”, wznoszenia i komórki stały w miejscu, opad chwilowy w nieruchomych pasmach wzdłuż wiatru
    let wles = CPM * (1.0 - smoothstep(500.0, 1000.0, DX));
    if (wles > 0.0 && wc <= 0.0 && zagl < 1500.0 && MG > 0u) {
      let pw = i32(min(MG, 12u));
      if (i < pw || i >= i32(NXV) - pw || j < pw || j >= i32(NYV) - pw) {
        let U = max(length(vec2f(tgAt(2u, l, P.ta1), tgAt(3u, l, P.ta1))), 2.0);
        let tp = 8.0 * DX / U;
        let amp = wles * clamp(U * U / (0.2 * CP), 0.25, 1.0) * (1.0 - smoothstep(1000.0, 1500.0, zagl));
        let per = u32(P.time / tp);
        let key = (u32(i / 8) * 73856093u) ^ (u32(j / 8) * 19349663u) ^ ((m / 4u) * 83492791u) ^ (per * 2654435761u);
        tmp[T_OFF + l] += amp * rand11(key) * P.dt / tp;
      }
    }
    if (psT != 0.0 || psQ != 0.0) {
      let fz = 1.0 - smoothstep(0.6 * psH, 0.9 * psH, zagl);
      tmp[T_OFF + l] += fz * psT;
      tmp[QV_OFF + l] = max(tmp[QV_OFF + l] + fz * psQ, 0.0);
    }
    let rn = min(P.dt * P.nudge * smoothstep(2000.0, 4000.0, zagl), 1.0);
    // jądro cyklonu tropikalnego: odchyłka wiatru przyciągana do celu (τ 1 h) – siłę cyklonu trzyma model synoptyczny (kategoria, potem warunki); bez tego
    // domena rozkręcała wir ponad cel o 15–25 m/s (Cat 1: U10 ~60 m/s przy ~45 m/s w celu). θ' tylko słabo (τ 12 h): przy τ 2 h ciepło kondensacji
    // znikało, zanim prąd wstępujący doszedł do górnej troposfery – ściana oka bez opadu, chmury do ~6 km. Ciśnienie na mapie w jądrze z celu (PSL)
    let rtc = TCN * tcCoreW(f32(i) + 0.5, f32(j) + 0.5) * P.dt / 3600.0;
    let pb = 1.0 - smoothstep(f32(MEB) - 5.0, f32(MEB), f32(m));
    // wyostrzenie frontów (część celu θ' – do limitu nasycenia pary)
    var phT = 0.0;
    if (k < KFR) { phT = phAt((P.step + 1u) & 1u, 0u, l); }
    // dryf ciepła warstwy granicznej względem dużej skali usuwany powoli w całej domenie (τ = 2 doby),
    // bez zmiany struktury poziomej i cyklu dobowego
    // próg liczony od średniej dobowej dużej skali (+0.5 K): cel przy gruncie to profil popołudniowy,
    // więc próg +1 K od celu pozwalał domenie stać ~3.5 K ponad średnią (ciepłe noce, upał)
    let thr = 0.5 - P.tsOff * (1.0 - f32(m) / f32(MEB));
    // i symetrycznie dryf zimna (zimą przy śniegu i pogodnym niebie domena wychładzała się bez końca:
    // −13 °C średnio przy średniej dobowej dużej skali +1 °C); inwersje do −2.5 K są dozwolone
    // tolerancja zależna od wysokości: szeroka przy gruncie (inwersje nocne, cykl dobowy), wąska od ~1 km nad gruntem –
    // tam domena odpływała o −2 K (parowanie cumulusów na szczycie warstwy granicznej bez osiadania, które je równoważy);
    // zimna warstwa 1–2.5 km pogłębiała mieszanie: wilgoć uciekała z dołu (Td −4 K), popołudnie chłodniejsze
    // (przy gruncie dawniej −1.5 K poniżej progu: zimą nad śniegiem domena stała ~2.8 K pod celem – 40 dób stycznia,
    // 352 km: tolerancja 0.25 K + τ 6 h + stała RH → domena −6.9 → −5.4 °C, T2 nizin −6.8 → −5.2, chmury 64 → 67%)
    let hw = smoothstep(500.0, 1300.0, zagl);
    let thrC = mix(thr - 0.25, -0.3, hw);
    let thrW = mix(thr, 0.3, hw);
    let mE = min(m, MEB - 1u);        // (powyżej warstwy granicznej wartości nieużywane – bez czytania poza tablicą)
    let dexc = max(work[W_EBM + mE] - thrW, 0.0) + min(work[W_EBM + mE] - thrC, 0.0);
    // para: nadmiar ponad +0.5 g/kg (było +1 – latem domena stała 1–2 g/kg ponad celem: Td 16–20 °C, CAPE > 1000 J/kg),
    // niedobór poniżej −0.4 g/kg (wyżej −0.3). Progi dobrane latem – w zimnym powietrzu proporcjonalnie do nasycenia celu (sq):
    // zimą −0.3…−0.5 g/kg na 1–2.5 km to 10–20% RH – domena stała tyle poniżej celu (niedobór wracał też przez brzeg), unoszenie
    // dużej skali (tylko w powietrzu wilgotnym) się nie włączało i fronty jesienią i zimą prawie nie padały
    let tTq = (vg[VG_TC + k] + tgAt(0u, l, P.ta1) + phT) * vg[VG_EXC + k];
    let sq = clamp(qsat(tTq, vg[VG_PRS + k]) / 0.008, 0.2, 1.0);
    let qexc = max(work[W_EBM + MEB + mE] - 0.0005 * sq, 0.0) + min(work[W_EBM + MEB + mE] + mix(0.0004, 0.0003, hw) * sq, 0.0);
    if (m < MEB && wc < 1.0) {
      // nadmiar ciepła i zimna usuwany z τ = 6 h (zimą przy śniegu i pogodnym niebie dobrze wymieszana warstwa przy gruncie traciła ~3 K/dobę – po 3 dobach −9 K względem dużej skali;
      // przy τ = 2 doby w upale domena odjeżdżała ~2 K ponad dużą skalę i po kilkunastu dobach dawała noce ~29 °C i dni ~40 °C).
      // Domena nie ma radiacyjnego chłodzenia powietrza (jest w modelu synoptycznym), a ciepło z gruntu dostaje w całości (lipiec ~+55 W/m², ~4 K/dobę w warstwie 1 km), więc regulator
      // proporcjonalny zostawia resztę Q·τ: przy τ = 12 h latem dolna warstwa stała +1.5…+2.2 K ponad dobowy cel
      let dth = -P.dt / 86400.0 * pb * 4.0 * dexc;
      tmp[T_OFF + l] += dth - hff * pb / vg[VG_EXC + k];
      // ogrzewanie przy stałej wilgotności względnej (dq = q·L/(R_v·T²)·dT): sam wzrost temperatury suszył powietrze
      // i zabierał zimowe chmury warstwowe (węższa tolerancja bez tego: +1.3 K, ale chmury 64 → 52%, opad 35 → 28 mm)
      if (dth > 0.0) {
        let tk = (vg[VG_TC + k] + tmp[T_OFF + l]) * vg[VG_EXC + k];
        tmp[QV_OFF + l] += max(tmp[QV_OFF + l], 0.0) * LV / (461.5 * tk * tk) * dth * vg[VG_EXC + k];
      }
      // para symetrycznie (τ = 12 h): wcześniej tylko nadmiar – warstwa graniczna mogła wyschnąć bez granic
      // (Kraków, lipiec: 2–4 g/kg przy 8–10 w modelu, Td −4 °C)
      tmp[QV_OFF + l] = max(tmp[QV_OFF + l] - P.dt / 86400.0 * pb * 2.0 * qexc, 0.0);
    }
    // nad warstwą graniczną: średni dryf domeny względem dużej skali (θ', q_v na stałych poziomach) usuwany
    // z τ = 1 doba – struktura mezoskalowa zostaje; bez tego warstwa 0.5–2.5 km zimą odpływała o −4…−5 K
    // (ochładzanie radiacyjne + powrót odchyłki przez brzegi) i wysychała o połowę
    if (wc < 1.0) {
      let fa = P.dt / 86400.0 * (1.0 - select(0.0, pb, m < MEB));
      tmp[T_OFF + l] -= fa * work[W_EA + k];
      tmp[QV_OFF + l] = max(tmp[QV_OFF + l] - fa * work[W_EA + NZ + k], 0.0);
    }
    var qcB = 0.0;
    for (var f = 0u; f < 4u; f++) {
      if (f == 2u && !openU(i, j, k)) { continue; }
      if (f == 3u && !openV(i, j, k)) { continue; }
      let off = lbcOff(f);
      let w = select(select(wc, wu, f == 2u), wv, f == 3u);
      var tg = tgAt(f, l, P.ta1);
      if (k < KFR) { tg += phAt((P.step + 1u) & 1u, f, l); }
      var tgw = tg;                 // cel relaksacji na brzegu (para: z wariancją i wilgocią wznoszenia)
      if (f == 1u) {
        // przy brzegach i w przyciąganiu najwyżej nasycenie (przesycony cel działa tylko przez
        // zmiany wzdłuż trajektorii – opad wielkoskalowy; tu odnawiałby chmurę w nieskończoność)
        let tT = (vg[VG_TC + k] + tgAt(0u, l, P.ta1) + phT) * vg[VG_EXC + k];
        let qsW = qsat(tT, vg[VG_PRS + k]);
        tg = min(max(tg, 0.0), qsW);
        tgw = tg;
        if (BCQ > 0.0 && wc > 0.0) {
          let qsM = qsatMix(tT, vg[VG_PRS + k]);
          let aq = min(fLs * smoothstep(0.75, 0.95, tg / qsM) * smoothstep(0.005, 0.03, wLs * vg[VG_WLS + k]), 1.0);
          // odchylenie std. wilgotności w plamach ~7% w warstwie granicznej, ~18% wyżej (pole losowe ma std. ~0.74)
          let qb = mix(tg, max(tg, qsM), aq) * (1.0 + BCQ * mix(0.1, 0.24, smoothstep(500.0, 2500.0, zagl)) * mix(etaL, etaH, smoothstep(1500.0, 4000.0, zagl)));
          tgw = min(qb, qsW);
          qcB = min(max(qb - qsW, 0.0), 3e-4);   // nadwyżka ponad nasycenie – woda chmurowa (lód tworzy dalej mikrofizyka, bez zasiewania)
        }
      }
      var x = tmp[off + l];
      if (w > 0.0) {
        // odchyłka od dużej skali z wnętrza domeny: w warstwie granicznej po poziomach nad gruntem,
        // wyżej (θ', q_v) po stałych poziomach
        var e = 0.0;
        if (m < MEB) {
          e = pb * work[W_EB + f * MEB + m];
          // θ: nadwyżka średniej dobowej ponad +1 K to dryf (np. upał narastający z dnia na dzień przy
          // wysychającej glebie) – napływ przez brzeg go nie powtarza
          if (f == 0u) { e -= pb * dexc; }
          if (f == 1u) {
            e -= pb * qexc;
            // niedobór wilgoci z wnętrza wraca przez brzeg najwyżej do −0.5 g/kg (cykl dobowy) – napływ niesie wilgoć dużej
            // skali (wcześniej pełna odchyłka: wysuszona warstwa graniczna wracała przez brzeg i nie odnawiała się)
            e = max(e, -0.0005 * pb * sq);
          }
        }
        // swobodna atmosfera (ciepło chmur, wysuszenie przez opad) tylko w dużych domenach – w małej
        // napływające powietrze nie przeszło jeszcze przez nasze góry i chmury
        if (f < 2u) { e += W_REC * (1.0 - select(0.0, pb, m < MEB)) * work[W_EA + f * NZ + k]; }
        // para wodna: powyżej ~1 km nad gruntem odchyłka z wnętrza może tylko osuszać napływ
        // (inaczej wilgoć z chmury orograficznej wracała przez brzeg – pasy chmur od brzegu domeny)
        if (f == 1u) { e = mix(e, min(e, 0.0), smoothstep(500.0, 1500.0, zagl)); }
        // θ: napływające powietrze najwyżej 8 K chłodniejsze / cieplejsze od masy powietrza (inaczej
        // przy słabym wietrze cała domena wychładza się bez końca – recykling kopiuje wychłodzenie)
        if (f == 0u) { e = clamp(e, -8.0, 8.0); }
        x += w * (tgw + e - x);
      }
      x += rn * (tg - x);
      if (f != 1u && rtc > 0.0) { x += min(rtc * select(1.0, 1.0 / 12.0, f == 0u), 1.0) * (tg - x); }
      // (para w górnej troposferze jądra – τ 1 h: tarcza cirrusów i suche oko z celu trwają; przesycenie celu względem lodu działało tylko przez zmiany
      // celu wzdłuż drogi cząstki – cirrus wypadał, a płytka ściana oka go nie odnawiała: wierzchołki CDO ~−35 °C, za mało chmur wysokich – użytkownik)
      if (f == 1u && rtc > 0.0 && zagl > 7000.0) { x += min(rtc / max(TCN, 1e-3) * smoothstep(7000.0, 9000.0, zagl), 1.0) * (tg - x); }
      if (f == 1u) { x = max(x, 0.0); }
      tmp[off + l] = x;
    }
    if (bW > 0.0) {
      let wbd = bW * tcBand(bTc, bRel, vg[VG_ZC + k], zagl, P.time);
      if (wbd > 0.0) {
        let tkb = (vg[VG_TC + k] + tmp[T_OFF + l]) * vg[VG_EXC + k];
        tmp[QV_OFF + l] += max(1.02 * qsatMix(tkb, vg[VG_PRS + k]) - tmp[QV_OFF + l], 0.0) * min(P.dt / 600.0, 1.0) * wbd;   // (τ 10 min – przelot przez pasmo ~15 min)
      }
    }
    if (wc > 0.0) {
      var qrT = 0.0;
      let qcT = qcB;
      let qiT = 0.0;
      let z = vg[VG_ZC + k];
      if (fpr > 0.0 && z <= ztopP) {
        let tT = (vg[VG_TC + k] + tgAt(0u, l, P.ta1)) * vg[VG_EXC + k];
        let cold = clamp((TFRZ + 1.0 - tT) / 2.0, 0.0, 1.0);
        qrT = fpr / (vg[VG_RC + k] * mix(5.0, 1.2, cold));
        // (bez zasiewania wodą chmurową i lodem: lód w prawie nasyconej warstwie uruchamiał w domenie proces
        // Bergerona i podwajał opad – Tatry, 10 dób grudnia: doliny 1.35× → 1.05× opadu dużej skali, szczyty 3.4× → 2.9×)
      }
      tmp[QC_OFF + l] += wc * (qcT - tmp[QC_OFF + l]);
      tmp[QI_OFF + l] += wc * (qiT - tmp[QI_OFF + l]);
      tmp[QR_OFF + l] += wc * (qrT - tmp[QR_OFF + l]);
      tmp[NR_OFF + l] += wc * (nMarshallPalmer(qrT, vg[VG_RC + k]) - tmp[NR_OFF + l]);
      tmp[W_OFF + l] *= 1.0 - wc;
    }
  }
}

// ======================= Adwekcja =======================

// Prędkość cząstki w indeksach na sekundę, w punkcie p = (X, Y, S)
fn vel(p: vec3f) -> vec3f {
  let u = trilin(0u, U_OFF, NZ, p.x, p.y - 0.5, p.z - 0.5);
  let v = trilin(0u, V_OFF, NZ, p.x - 0.5, p.y, p.z - 0.5);
  let w = trilin(0u, W_OFF, NZ + 1u, p.x - 0.5, p.y - 0.5, p.z);
  return vec3f(u / DX, v / DY, w / dzdS(p.z));
}

// Monotoniczna interpolacja trójsześcienna (Catmull-Rom, obcięta do zakresu 8 najbliższych punktów).
fn cr_w(t: f32) -> vec4f {
  let t2 = t * t;
  let t3 = t2 * t;
  return vec4f(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);
}

fn tricubic(off: u32, nk: u32, X: f32, Y: f32, K: f32) -> f32 {
  let xf = floor(X);
  let yf = floor(Y);
  let kc = clamp(K, 0.0, f32(nk - 1u));
  let kf = min(floor(kc), f32(nk - 2u));
  let wx = cr_w(X - xf);
  let wy = cr_w(Y - yf);
  let wz = cr_w(kc - kf);
  let i0 = i32(xf);
  let j0 = i32(yf);
  let k0 = i32(kf);
  let ix = vec4u(wrapi(i0 - 1, NX), wrapi(i0, NX), wrapi(i0 + 1, NX), wrapi(i0 + 2, NX));
  var lo = 1e30;
  var hi = -1e30;
  var acc = 0.0;
  for (var c = 0; c < 4; c++) {
    let kk = u32(clamp(k0 - 1 + c, 0, i32(nk) - 1));
    var accy = 0.0;
    for (var b = 0; b < 4; b++) {
      let row = off + kk * NXY + wrapi(j0 - 1 + b, NY) * NX;
      let x0 = state[row + ix.x];
      let x1 = state[row + ix.y];
      let x2 = state[row + ix.z];
      let x3 = state[row + ix.w];
      accy += wy[b] * (wx.x * x0 + wx.y * x1 + wx.z * x2 + wx.w * x3);
      if ((b == 1 || b == 2) && (c == 1 || c == 2)) {
        lo = min(lo, min(x1, x2));
        hi = max(hi, max(x1, x2));
      }
    }
    acc += wz[c] * accy;
  }
  return clamp(acc, lo, hi);
}

fn damping(z: f32) -> f32 {
  if (z <= P.dampStart) { return 0.0; }
  let s = sin(1.5707963 * (z - P.dampStart) / (HTOP - P.dampStart));
  return s * s / P.dampTau;
}

// θ0 na dowolnej wysokości: interpolacja liniowa w S po węzłach na przemian w (TW) i w środkach (TC)
fn th0node(m: u32) -> f32 {
  if ((m & 1u) == 0u) { return vg[VG_TW + m / 2u]; }
  return vg[VG_TC + (m - 1u) / 2u];
}
fn th0At(z: f32) -> f32 {
  let s2 = 2.0 * clamp(S_of_z(z), 0.0, f32(NZ));
  let m = min(u32(s2), 2u * NZ - 1u);
  return mix(th0node(m), th0node(m + 1u), s2 - f32(m));
}

// Ruch pionowy wielkoskalowy (osiadanie w wyżu; suwak przy stałej masie powietrza):
// −w_ls ∂φ/∂z, różnica "pod prąd" (z góry przy osiadaniu, z dołu przy wznoszeniu)
// przeniesienie pionowe z prędkością w (pod wiatr): dev – tylko odchyłka θ od pola docelowego,
// inaczej pełne θ = θ0 + θ' (ogrzewanie / ochładzanie adiabatyczne)
fn lsOne(off: u32, l: u32, k: u32, theta: bool, wl: f32, dev: bool) -> f32 {
  if (wl == 0.0) { return 0.0; }
  let up = wl > 0.0;
  if ((!up && k + 1u >= NZ) || (up && k == 0u)) { return 0.0; }
  let ka = select(k + 1u, k, up);
  let kc = select(k, k - 1u, up);
  let la = select(l + NXY, l, up);
  let lc = select(l, l - NXY, up);
  var d = state[off + la] - state[off + lc];
  if (dev) { d -= tgAt(select(1u, 0u, theta), la, P.ta0) - tgAt(select(1u, 0u, theta), lc, P.ta0); }
  else if (theta) { d += vg[VG_TC + ka] - vg[VG_TC + kc]; }
  return -P.dt * wl * vg[VG_WLS + k] * d / (vg[VG_ZC + ka] - vg[VG_ZC + kc]);
}
fn lsTend(off: u32, l: u32, k: u32, theta: bool) -> f32 {
  // osiadanie z suwaka (stała masa powietrza): pełne ogrzewanie adiabatyczne, równoważy ochładzanie
  // radiacyjne. Ruch pionowy z modelu synoptycznego (fronty, wyże): θ i para tylko jako odchyłka od pola
  // docelowego – temperatura i wilgotność dużej skali mają już w sobie skutki wznoszenia / osiadania
  // (pełne liczenie dawało upał 47 °C w wyżu i sztuczne nasycanie powietrza z ulewami)
  // Wyjątek: wznoszenie dużej skali w powietrzu już wilgotnym (RH 75–95% → płynnie): pełne unoszenie pary
  // i pełne ochłodzenie adiabatyczne – to dopływ wilgoci, który domena sama przerabia na chmury i opad
  // (front, niż). Przy samej odchyłce w ustalonym niżu nic nie dostarczało nowej pary: domena wypadała
  // swoją wilgoć i wysychała (duża skala 2 mm/h, domena 0.05 mm/h; zimą niże bez chmur)
  // „Wilgotne” = woda (para + chmura) względem nasycenia woda → lód: w chmurze lodowej para spada do nasycenia względem lodu
  // (−20 °C: 82% względem wody), więc liczone względem wody unoszenie gasło właśnie tam, gdzie zimą pada śnieg
  let wl = tgSfc(3u, l % NXY, P.ta0);
  var fm = 0.0;
  if (wl > 0.0) {
    let t = (vg[VG_TC + k] + state[T_OFF + l]) * vg[VG_EXC + k];
    fm = smoothstep(0.75, 0.95, max(state[QV_OFF + l] + state[QC_OFF + l] + state[QI_OFF + l], 0.0) / qsatMix(t, vg[VG_PRS + k]));
  }
  // w dużych domenach (≳ 1000 km, oczka ≥ ~10 km) domena sama liczy fronty i niże – pełne unoszenie pary z modelu synoptycznego
  // liczyłoby wznoszenie podwójnie (domena 4000 × 2400 km, 25 km, lipiec: opad 3.4–5.0 mm/d przy 2.5–2.9 w modelu synoptycznym,
  // maksima 110–150 mm w 3 doby; bez tego 1.7–2.5 mm/d); pełne do ~800 km, prawie zero od ~2500 km
  // Zmniejszone tylko dla części konwekcyjnej opadu dużej skali (parametr 14): konwekcję domena liczy sama, więc pełne unoszenie
  // liczyłoby ją podwójnie (wcześniej 30% dla wszystkiego – Tatry, 16 dób lipca: 72 → 56 mm przy 54 mm modelu synoptycznego).
  // Opad warstwowy (front, niż) – pełne unoszenie: to on pada też w dolinach; przy 30% domena robiła opad prawie tylko na grzbietach
  // (doliny ~0.3× opadu dużej skali, rok w Tatrach: Zakopane 42% normy, Nowy Targ 49%)
  let cidx2 = l % NXY;
  let csh = clamp(parAt(14u, f32(cidx2 % NX) + 0.5, f32(cidx2 / NX) + 0.5), 0.0, 1.0);
  fm *= (1.0 - 0.7 * csh) * (1.0 - smoothstep(800000.0, 2500000.0, f32(min(NXD, NYD)) * DX));
  // korekta opadu z klimatu (main.js ccUpdate: norma / średni opad modelu synoptycznego, 0.3–1) – model pada 2–3× za dużo
  // (Poznań: listopad 0.30, grudzień 0.48; Kraków, lipiec 0.41)
  let fpc = ccBil(f32(cidx2 % NX) + 0.5, f32(cidx2 / NX) + 0.5, 7u);
  // pełne unoszenie tylko w części, której domena nie wznosi sama (?lwd=0 – dawniej pełne zawsze): ciepło kondensacji napędza w domenie własne wznoszenie, które samo ściąga parę z otoczenia,
  // a pełne unoszenie dokładało do niego jeszcze całe wznoszenie modelu – przy stojącym niżu sumy dobowe ponad miarę. Zapis użytkownika (lipiec, 7.5 km, doby niżu z modelem 10.7 / 11.9 / 5 mm):
  // domena 37.1 → 30.4 mm przy 27.5 mm modelu, oczka ≥ 50 mm 1361 → 418, ≥ 100 mm 162 → 53, maks. 189 → 160 mm
  if (LWD > 0.0 && wl > 0.0) { fm *= clamp(1.0 - 0.5 * (state[W_OFF + l] + state[W_OFF + l + NXY]) / max(wl * vg[VG_WLS + k], 0.005), 0.0, 1.0); }
  fm *= select(1.0, fpc, fpc > 0.0) * P.rainF;   // × mnożnik z manipulacji atmosfery (powyżej 1: więcej pary i ochłodzenia niż ze wznoszenia dużej skali)
  // w strefie wyostrzonego frontu wznoszenie robi sama domena (skok wiatru Φ skupia zbieżność całego pasa modelu synoptycznego na wąskiej linii), więc pełne unoszenie liczyłoby je
  // podwójnie: największe opady przy przejściu frontów. W cieple (przy gruncie ≥ ~14–21 °C, jak warstwy nasycone w celu) na każdym froncie; w chłodzie tylko na ostrych frontach chłodnych (mały stopień L – ?fdb=0: dawniej tylko
  // w cieple), bo łagodne fronty zimą padają głównie z tego unoszenia. Użytkownik: front, pasmo 5–11 mm/h przy 2–3 mm/h w modelu, echo tylko do 4–5 km
  if (fm > 1e-3) {
    let gf = frGeo(cidx2, P.ta0);
    if (gf.w > 1e-3) {
      let warm = smoothstep(287.0, 294.0, parAt(0u, f32(cidx2 % NX) + 0.5, f32(cidx2 / NX) + 0.5));
      let Ls = max(2.5 * DX, 6000.0);   // połowa szerokości stopnia najostrzejszego frontu (jak w tgt_build)
      let sharp = FDB * (1.0 - smoothstep(Ls, max(0.5 * (Ls + 60000.0), Ls + 1000.0), gf.L));
      fm *= 1.0 - 0.8 * FRW * max(warm, sharp) * gf.w * (1.0 - smoothstep(0.7 * gf.D, gf.D, abs(gf.s)));   // (słabszy skok wiatru zastępuje mniejszą część unoszenia)
    }
  }
  // gdzie cel jest już prawie nasycony (warstwy nasycone modelu – front, niż; tgt_build), wilgoć wznoszenia dużej skali wchodzi do domeny przez zmianę celu wzdłuż drogi
  // cząstki i pełne unoszenie dokładałoby ją drugi raz (?sfm=0 – dawniej). Polska, 900 km, 7.5 km, 20 dób października: domena 35 mm przy 34 mm modelu i 25 mm po mnożniku
  // opadu; bez pełnego unoszenia 24, bez warstw nasyconych 23, z wygaszaniem 27 mm. Przebieg roczny użytkownika: opad 149% normy, II–V i VIII–XI 148–227%, lato w normie
  if (SFM > 0.0 && fm > 1e-3) {
    let tTs = (vg[VG_TC + k] + tgAt(0u, l, P.ta0)) * vg[VG_EXC + k];
    fm *= 1.0 - SFM * smoothstep(0.88, 0.97, tgAt(1u, l, P.ta0) / qsatMix(tTs, vg[VG_PRS + k]));
  }
  return lsOne(off, l, k, theta, P.wls, false) + (1.0 - fm) * lsOne(off, l, k, theta, wl, true) + fm * lsOne(off, l, k, theta, wl, false);
}

@compute @workgroup_size(WG)
fn advect(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let id = lin_id(gid, nwg);
  if (id >= STATE_LEN) { return; }
  var kind: u32;     // 0 u, 1 v, 2 w, 3 θ', 4 q_v, 5 q_c, 6 q_i, 7 q_r, 8 N_r
  var l: u32;
  if (id < V_OFF) { kind = 0u; l = id; }
  else if (id < W_OFF) { kind = 1u; l = id - V_OFF; }
  else if (id < T_OFF) { kind = 2u; l = id - W_OFF; }
  else { kind = 3u + (id - T_OFF) / N; l = (id - T_OFF) % N; }
  let i = l % NX;
  let j = (l / NX) % NY;
  let k = l / NXY;
  let ii = i32(i);
  let jj = i32(j);
  let fi = f32(i);
  let fj = f32(j);
  let fk = f32(k);

  var p0: vec3f;
  var sh: vec3f;
  var off: u32;
  var nk = NZ;
  switch kind {
    case 0u: {
      if (!openU(ii, jj, k)) { tmp[id] = 0.0; return; }
      p0 = vec3f(fi, fj + 0.5, fk + 0.5); sh = vec3f(0.0, 0.5, 0.5); off = U_OFF;
    }
    case 1u: {
      if (!openV(ii, jj, k)) { tmp[id] = 0.0; return; }
      p0 = vec3f(fi + 0.5, fj, fk + 0.5); sh = vec3f(0.5, 0.0, 0.5); off = V_OFF;
    }
    case 2u: {
      if (!openW(ii, jj, k)) { tmp[id] = 0.0; return; }
      p0 = vec3f(fi + 0.5, fj + 0.5, fk); sh = vec3f(0.5, 0.5, 0.0); off = W_OFF; nk = NZ + 1u;
    }
    default: {
      if (!fluid(ii, jj, k)) {
        tmp[id] = state[id];
        if (kind == 4u) { work[W_R + l] = 0.0; }
        return;
      }
      p0 = vec3f(fi + 0.5, fj + 0.5, fk + 0.5); sh = vec3f(0.5, 0.5, 0.5); off = T_OFF + (kind - 3u) * N;
    }
  }

  // Punkt odejścia trajektorii (metoda punktu środkowego)
  let dt = P.dt;
  var pm = p0 - 0.5 * dt * vel(p0);
  pm.z = clamp(pm.z, 0.0, f32(NZ));
  var pd = p0 - dt * vel(pm);
  pd.z = clamp(pd.z, 0.0, f32(NZ));
  // Skalary: wysokość startu z prędkości pionowej cząstki w punkcie odejścia, ta sama dla θ' i θ0 –
  // całkowite θ = θ0 + θ' jest wtedy przenoszone dokładnie, a sprzężenie z wypornością pozostaje
  // stabilne (forward-backward) także przy silnym wietrze
  var wd = 0.0;
  if (kind >= 3u) {
    wd = trilin(0u, W_OFF, NZ + 1u, pd.x - 0.5, pd.y - 0.5, pd.z);
    pd.z = clamp(S_of_z(vg[VG_ZC + k] - dt * wd), 0.0, f32(NZ));
  }
  let q = pd - sh;
  // wszystkie pola trójsześciennie (monotonicznie); nadwyżkę masy na ostrych brzegach chmur usuwa
  // globalna korekta masy (mass_apply). Trójliniowa interpolacja q_c, q_r rozmywała chmury w każdym
  // kroku – woda z rdzeni prądów wstępujących „przeciekała” do suchego otoczenia i parowała (sztuczne
  // wciąganie), deszcz prawie nie powstawał
  var val = tricubic(off, nk, q.x, q.y, q.z);

  // Duża skala: zmiana pola docelowego wzdłuż poziomej drogi cząstki (pole w punkcie przybycia
  // w chwili t+Δt minus pole w punkcie odejścia w chwili t, na tej samej wysokości). Cząstka
  // niesie więc tylko swoją odchyłkę od dużej skali (konwekcja, warstwa graniczna), a masy powietrza
  // przesuwają się tak, jak w modelu synoptycznym – także w małej domenie, gdzie gradient dużej
  // skali jest niewidoczny (wtedy to po prostu lokalna zmiana w czasie).
  var fls = 0.0;
  if (kind != 2u && kind <= 4u) {
    let ft = select(select(select(1u, 0u, kind == 3u), 3u, kind == 1u), 2u, kind == 0u);
    // Wiatr w jądrze cyklonu: zmiana celu wzdłuż drogi samego wiatru celu (punkt środkowy), nie całej cząstki. Wzdłuż całej drogi odchyłka
    // (napływ w warstwie granicznej) przesuwała cząstkę przez gradient wiru celu i dostawała jego wiatr „za darmo”, a do tego Coriolisa i krzywiznę
    // od własnego ruchu – brak członu −(u′·∇)u_celu: poza promieniem maksymalnego wiatru rozkręcanie ~2× za szybkie (test: Cat 4, cel ~50 m/s,
    // domena 83–99 m/s, 905 hPa). Wzdłuż drogi celu odchyłka dostaje dokładnie zmianę momentu pędu (cel w równowadze wiatru gradientowego)
    var qx = q.x;
    var qy = q.y;
    if (kind <= 1u) {
      let wtc = tcCoreW(p0.x, p0.y);
      if (wtc > 0.0) {
        let u0 = tgUV(p0.x, p0.y, k, P.ta0);
        let pmid = p0.xy - 0.5 * dt * vec2f(u0.x / DX, u0.y / DY);
        let um = tgUV(pmid.x, pmid.y, k, P.ta0);
        let qt = p0.xy - dt * vec2f(um.x / DX, um.y / DY) - sh.xy;
        qx = mix(q.x, qt.x, wtc);
        qy = mix(q.y, qt.y, wtc);
      }
    }
    fls = tgAt(ft, l, P.ta1) - tgBil(ft, qx, qy, k, P.ta0);
    // wyostrzenie frontów: Φ(t + Δt) w punkcie przybycia − Φ(t) w punkcie odejścia (front przesuwa się z dużą skalą)
    if (k < KFR) {
      let fp = select(select(kind - 3u, 3u, kind == 1u), 2u, kind == 0u);
      fls += phAt((P.step + 1u) & 1u, fp, l) - phBil(P.step & 1u, fp, q.x, q.y, k);
    }
  }

  // Uwaga: człony źródłowe (Coriolis, ochładzanie przy wznoszeniu) biorą wartości z punktu
  // odejścia tej samej cząstki – inaczej przy silnym wietrze rosną fale grawitacyjne.
  let col = j * NX + i;
  let kb = kbAt(ii, jj);
  if (kind == 0u) {
    // Coriolis dla u: f (v − v_g); v dostaje Coriolisa w `diffuse` już z nowym u (forward-backward)
    let vd = trilin(0u, V_OFF, NZ, pd.x - 0.5, pd.y, pd.z - 0.5);
    // Coriolis względem wiatru geostroficznego dużej skali na tej wysokości (profil z modelu
    // synoptycznego, ze ścinaniem wiatru termicznego), w punkcie odejścia
    val += dt * fcorAt(jj) * (vd - tgBil(3u, pd.x - 0.5, pd.y, k, P.ta0)) + fls;
  } else if (kind == 1u) {
    val += fls;
  } else if (kind == 2u) {
    // (wyporność dodawana w `diffuse`, z już zaktualizowanym θ' – forward-backward)
    val /= 1.0 + dt * damping(vg[VG_ZW + k]);
  } else if (kind == 3u) {
    // zmiana θ' przy przemieszczeniu pionowym: θ0(z − w·Δt) − θ0(z), w cząstki w punkcie odejścia;
    // różnica dokładna (nie gradient), bo profil bazowy bywa zakrzywiony (nocna inwersja przy gruncie)
    val += th0At(vg[VG_ZC + k] - dt * wd) - vg[VG_TC + k];
    val += dt * vg[VG_RCOOL + k];
    val += lsTend(T_OFF, l, k, true) + fls;
    if (k == kb) {
      // pierwsza komórka nad gruntem: strumień ciepła jawnego z powierzchni
      val += dt * (sfc[sf(S_H, col)] - sfc[sf(S_QRAD, col)]) / (vg[VG_RC + k] * CP * vg[VG_HF + col] * vg[VG_DZC + k] * vg[VG_EXC + k]);
      val += P.noiseAmp * rand11(l + P.step * NXY);
    }
    // warstwa tłumiąca: wygasza odchyłkę od pola docelowego (fale grawitacyjne), nie samo θ'
    let thT = tgAt(0u, l, P.ta1);
    val = thT + (val - thT) / (1.0 + dt * damping(vg[VG_ZC + k]));
  } else if (kind == 4u) {
    // (parowanie z powierzchni dodawane w `diffuse` jako strumień na dolnym brzegu)
    // wymuszenia dużej skali q_v dochodzą po korekcie masy (mass_apply) – korekta ma poprawiać
    // tylko błąd adwekcji, nie znosić osiadania czy napływu suchszego powietrza
    work[W_R + l] = fls + lsTend(QV_OFF, l, k, false);
    val = max(val, 0.0);
  } else if (kind == 8u) {
    val = max(val, 0.0);           // liczba kropel opadu
  }
  tmp[id] = val;
}

// ======================= Turbulencja podsiatkowa: Smagorinsky 3D =======================
// Poprawka na stabilność tylko tłumi mieszanie w warstwach stałych; w chwiejnych nie wzmacnia go,
// żeby transport ciepła przejmowała rozwiązana konwekcja.
const CS: f32 = 0.21;
const PR: f32 = 0.333;
const KMAX: f32 = 3000.0;

fn ucen(i: i32, j: i32, k: u32) -> f32 { return 0.5 * (tmp[U_OFF + cidx(i, j, k)] + tmp[U_OFF + cidx(i + 1, j, k)]); }
fn vcen(i: i32, j: i32, k: u32) -> f32 { return 0.5 * (tmp[V_OFF + cidx(i, j, k)] + tmp[V_OFF + cidx(i, j + 1, k)]); }
fn wcen(i: i32, j: i32, k: u32) -> f32 { return 0.5 * (tmp[W_OFF + cidx(i, j, k)] + tmp[W_OFF + cidx(i, j, k + 1u)]); }

// Współczynniki K (Km, Kh) w środkach komórek → cx[0,N) (wolne w tej fazie kroku)
@compute @workgroup_size(WG)
fn turb_k(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let id = lin_id(gid, nwg);
  if (id >= N) { return; }
  let i = i32(id % NX);
  let j = i32((id / NX) % NY);
  let k = id / NXY;
  let km = select(k - 1u, 0u, k == 0u);
  let kp = min(k + 1u, NZ - 1u);
  let dzv = vg[VG_ZC + kp] - vg[VG_ZC + km];
  let dzc = vg[VG_DZC + k];

  let dudx = (tmp[U_OFF + cidx(i + 1, j, k)] - tmp[U_OFF + id]) / DX;
  let dvdy = (tmp[V_OFF + cidx(i, j + 1, k)] - tmp[V_OFF + id]) / DY;
  let dwdz = (tmp[W_OFF + id + NXY] - tmp[W_OFF + id]) / dzc;
  let dudy = (ucen(i, j + 1, k) - ucen(i, j - 1, k)) / (2.0 * DY);
  let dudz = (ucen(i, j, kp) - ucen(i, j, km)) / dzv;
  let dvdx = (vcen(i + 1, j, k) - vcen(i - 1, j, k)) / (2.0 * DX);
  let dvdz = (vcen(i, j, kp) - vcen(i, j, km)) / dzv;
  let dwdx = (wcen(i + 1, j, k) - wcen(i - 1, j, k)) / (2.0 * DX);
  let dwdy = (wcen(i, j + 1, k) - wcen(i, j - 1, k)) / (2.0 * DY);
  let s2 = 2.0 * (dudx * dudx + dvdy * dvdy + dwdz * dwdz)
         + (dudy + dvdx) * (dudy + dvdx) + (dudz + dwdx) * (dudz + dwdx) + (dvdz + dwdy) * (dvdz + dwdy);

  let thp = vg[VG_TC + kp] + tmp[T_OFF + cidx(i, j, kp)];
  let thm = vg[VG_TC + km] + tmp[T_OFF + cidx(i, j, km)];
  var n2 = G / vg[VG_TC + k] * (thp - thm) / dzv;
  if (DX > 300.0 && tmp[QC_OFF + id] + tmp[QI_OFF + id] > 1e-5) {
    // w chmurze stateczność wilgotna (θe ≈ θ + L q_v/(c_p π), Durran i Klemp 1982) zamiast suchej (siatki
    // ≥ ~0.5 km; na LES cumulus to kilka oczek i silniejsze mieszanie rozmywało go) –
    // sucha stateczność wnętrza chmury (dodatnia) wyłączała tam mieszanie: prądy wstępujące szerokości
    // jednego oczka, wąskie „słupy” opadu
    let ep = LV / (CP * vg[VG_EXC + kp]) * tmp[QV_OFF + cidx(i, j, kp)];
    let em = LV / (CP * vg[VG_EXC + km]) * tmp[QV_OFF + cidx(i, j, km)];
    n2 = mix(n2, G / vg[VG_TC + k] * (thp + ep - thm - em) / dzv, smoothstep(300.0, 700.0, DX));
  }

  // Skala długości: na siatkach LES izotropowa Δ = (dx·dy·dz)^(1/3); na grubszych siatkach poziomo
  // Cs·dx z deformacji poziomej (Smagorinsky 2D), pionowo Cs·dz – pionowe mieszanie w warstwie
  // granicznej przejmuje wtedy schemat K-profilu.
  // „Szara strefa” konwekcji (oczko 0.5–1.5 km): poziomo już od ~0.9 km pełne Cs·dx (jak w modelu UKV
  // Met Office, λ ≈ 0.2 dx) – przy izotropowej Δ ≈ 0.7 dx komórki kurczyły się do 1–2 oczek
  // („wysypka” małych, krótkotrwałych komórek bez łączenia się)
  let delta = pow(DX * DY * dzc, 1.0 / 3.0);
  let fs = sqrt(max(s2 - max(n2, 0.0) / PR, 0.0));
  let sh2 = (dudx - dvdy) * (dudx - dvdy) + (dudy + dvdx) * (dudy + dvdx);
  let lh = CS * mix(delta, sqrt(DX * DY), max(W_PBL, smoothstep(300.0, 900.0, DX)));
  let lv = CS * mix(delta, dzc, W_PBL);
  let kmh = lh * lh * mix(fs, sqrt(sh2), W_PBL);
  var kmv = min(lv * lv * fs, KMAX);
  // na siatkach mezoskalowych w warstwie stałej ciepło miesza się jak pęd (Pr ≈ 1): Pr = 1/3 jest z warstwy chwiejnej; przy nocnym ścinaniu Smagorinsky dawał Kh = 3·Km ~10 m²/s
  // i profil T od gruntu do ~400 m był prawie izotermiczny (lipiec, Polska środkowa, 3:00: 32 m 17.2 °C, 408 m 17.0 °C; po zmianie inwersja 16.3 → 17.1 °C, Tmin −0.3 K)
  var khv = min(kmv / mix(PR, 1.0, W_PBL * smoothstep(0.0, 2e-5, n2)), KMAX);
  if (W_PBL > 0.0) {
    // schemat warstwy granicznej (K-profil, jak YSU bez członu przeciwgradientowego)
    let col = id % NXY;
    let hb = sfc[sf(S_PBLH, col)];
    let za = vg[VG_ZC + k] - zgC(col);
    if (za > 0.0 && za < hb) {
      let x = 1.0 - za / hb;
      // nocą (warstwa stała) w_s = u*/φm, φm = 1 + 5 z/L (jak YSU) – bez tego K-profil mieszał ciepło
      // z inwersji do gruntu jak w dzień i na siatkach ≥ 2 km noce były o kilka stopni za ciepłe
      let phim = 1.0 + 5.0 * za * sfc[sf(S_LINV, col)];
      let kpbl = W_PBL * 0.4 * sfc[sf(S_WS, col)] * za * x * x / phim;
      kmv = max(kmv, min(kpbl, KMAX));
      khv = max(khv, min(kpbl, KMAX));
    }
  }
  cx[id] = vec2f(kmv, khv);                 // pionowe (Km, Kh)
  cx[N + id] = vec2f(kmh, kmh / PR);        // poziome (Km, Kh)
}

// wiatr docelowy u uśredniony do punktu v (jak uAtV)
fn tgUAtV(i: i32, j: i32, k: u32) -> f32 {
  return 0.25 * (tgAt(2u, cidx(i, j - 1, k), P.ta1) + tgAt(2u, cidx(i + 1, j - 1, k), P.ta1)
               + tgAt(2u, cidx(i, j, k), P.ta1) + tgAt(2u, cidx(i + 1, j, k), P.ta1));
}

fn uAtV(i: i32, j: i32, k: u32) -> f32 {
  return 0.25 * (tmp[U_OFF + cidx(i, j - 1, k)] + tmp[U_OFF + cidx(i + 1, j - 1, k)]
               + tmp[U_OFF + cidx(i, j, k)] + tmp[U_OFF + cidx(i + 1, j, k)]);
}

// dywergencja pozioma w komórce (z tmp, po adwekcji)
const DDAMP: f32 = 0.02;
fn hdiv(i: i32, j: i32, k: u32) -> f32 {
  return (tmp[U_OFF + cidx(i + 1, j, k)] - tmp[U_OFF + cidx(i, j, k)]) / DX
       + (tmp[V_OFF + cidx(i, j + 1, k)] - tmp[V_OFF + cidx(i, j, k)]) / DY;
}

// K w komórce: h – dla skalarów (Kh) zamiast pędu (Km); hz – poziome zamiast pionowego
fn kcell(i: i32, j: i32, k: u32, h: bool, hz: bool) -> f32 {
  let c = cx[cidx(i, j, k) + select(0u, N, hz)];
  return select(c.x, c.y, h);
}

fn openF(f: u32, i: i32, j: i32, k: u32) -> bool {
  switch f {
    case 0u: { return openU(i, j, k); }
    case 1u: { return openV(i, j, k); }
    case 2u: { return openW(i, j, k); }
    default: { return fluid(i, j, k); }
  }
}

// najniższy poziom, od którego punkt pola f w kolumnie (i, j) jest otwarty (teren schodkowy) – nie zależy od k,
// więc w dyfuzji liczony raz na kolumnę zamiast sprawdzania terenu dla każdego poziomu i sąsiada
fn openThr(f: u32, i: i32, j: i32) -> u32 {
  switch f {
    case 0u: { return max(kbAt(i - 1, j), kbAt(i, j)); }
    case 1u: { return max(kbAt(i, j - 1), kbAt(i, j)); }
    case 2u: { return kbAt(i, j) + 1u; }
    default: { return kbAt(i, j); }
  }
}

// Wartość sąsiada do laplasjanu; za ścianą terenu – wartość własna (zerowy strumień)
fn nbv(f: u32, off: u32, i: i32, j: i32, k: u32, c: f32) -> f32 {
  if (openF(f, i, j, k)) { return tmp[off + cidx(i, j, k)]; }
  return c;
}

// laplasjan poziomy skalara (q_v) w oczku, za ścianą terenu zerowy strumień (hiperdyfuzja wilgoci)
fn lapQ(off: u32, i: i32, j: i32, k: u32) -> f32 {
  let c = tmp[off + cidx(i, j, k)];
  return nbv(3u, off, i + 1, j, k, c) + nbv(3u, off, i - 1, j, k, c) + nbv(3u, off, i, j + 1, k, c)
       + nbv(3u, off, i, j - 1, k, c) - 4.0 * c;
}

// K w punkcie pola f (u, v: średnia z dwóch komórek; w: z komórek nad i pod; skalary: komórka)
fn kpoint(f: u32, i: i32, j: i32, k: u32, hz: bool) -> f32 {
  switch f {
    case 0u: { return 0.5 * (kcell(i, j, k, false, hz) + kcell(i - 1, j, k, false, hz)); }
    case 1u: { return 0.5 * (kcell(i, j, k, false, hz) + kcell(i, j - 1, k, false, hz)); }
    case 2u: { return 0.5 * (kcell(i, j, max(k, 1u) - 1u, false, hz) + kcell(i, j, min(k, NZ - 1u), false, hz)); }
    default: { return kcell(i, j, k, true, hz); }
  }
}

// Laplasjan poziomy (w jednostkach oczka) pól u, v, w, θ' do hiperdyfuzji → work[W_R + f·N] (W_R…W_AP są wolne
// między korektą masy a solverem ciśnienia); za ścianą terenu zerowy strumień
@compute @workgroup_size(WG)
fn lap4(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let id = lin_id(gid, nwg);
  if (id >= 4u * N || DX <= 400.0) { return; }
  let f = id / N;
  let l = id % N;
  let i = i32(l % NX);
  let j = i32((l / NX) % NY);
  let k = l / NXY;
  let off = select(select(select(T_OFF, W_OFF, f == 2u), V_OFF, f == 1u), U_OFF, f == 0u);
  let c = tmp[off + l];
  work[W_R + id] = nbv(f, off, i + 1, j, k, c) + nbv(f, off, i - 1, j, k, c) + nbv(f, off, i, j + 1, k, c)
                 + nbv(f, off, i, j - 1, k, c) - 4.0 * c;
}

// Dyfuzja: poziomo jawnie, pionowo niejawnie (algorytm Thomasa w kolumnie). tmp → state.
// Jeden wątek = jedna kolumna jednego pola (u, v, w, θ', q_v, q_c, q_i, q_r, N_r). Tu też: wyporność,
// Coriolis dla v, tarcie o powierzchnię.
@compute @workgroup_size(64)
fn diffuse(@builtin(global_invocation_id) gid: vec3u) {
  let id = gid.x;
  if (id >= 9u * NXY) { return; }
  let f = id / NXY;
  let col = id % NXY;
  let i = i32(col % NX);
  let j = i32(col / NX);
  let dt = P.dt;
  var off: u32;
  var nl = NZ;
  var di = 0;
  var dj = 0;
  var kbf: u32;   // pierwszy poziom nad gruntem
  switch f {
    case 0u: { off = U_OFF; di = -1; kbf = max(kbAt(i - 1, j), kbAt(i, j)); }
    case 1u: { off = V_OFF; dj = -1; kbf = max(kbAt(i, j - 1), kbAt(i, j)); }
    case 2u: { off = W_OFF; nl = NZ + 1u; kbf = kbAt(i, j) + 1u; }
    default: { off = T_OFF + (f - 3u) * N; kbf = kbAt(i, j); }
  }
  let heat = f >= 3u;
  let khmax = 0.2 * min(DX, DY) * min(DX, DY) / dt;   // stabilność jawnej dyfuzji poziomej

  var kp: array<f32, NZ + 1u>;
  var rhs: array<f32, NZ + 1u>;
  let thE = openThr(f, i + 1, j);
  let thW = openThr(f, i - 1, j);
  let thN = openThr(f, i, j + 1);
  let thS = openThr(f, i, j - 1);
  for (var k = 0u; k < nl; k++) {
    if (k < kbf || (f == 2u && k == NZ)) { kp[k] = 0.0; rhs[k] = 0.0; continue; }
    kp[k] = kpoint(f, i, j, k, false);
    let kk = kpoint(f, i, j, k, true);
    let c = tmp[off + k * NXY + col];
    // poziomo: strumienie przez ściany z K uśrednionym na ścianie (postać zachowawcza)
    let ke = min(0.5 * (kk + kpoint(f, i + 1, j, k, true)), khmax);
    let kw = min(0.5 * (kk + kpoint(f, i - 1, j, k, true)), khmax);
    let kn = min(0.5 * (kk + kpoint(f, i, j + 1, k, true)), khmax);
    let ks = min(0.5 * (kk + kpoint(f, i, j - 1, k, true)), khmax);
    let cE = select(c, tmp[off + cidx(i + 1, j, k)], k >= thE);
    let cW = select(c, tmp[off + cidx(i - 1, j, k)], k >= thW);
    let cN = select(c, tmp[off + cidx(i, j + 1, k)], k >= thN);
    let cS = select(c, tmp[off + cidx(i, j - 1, k)], k >= thS);
    let lap = (ke * (cE - c) + kw * (cW - c)) / (DX * DX) + (kn * (cN - c) + ks * (cS - c)) / (DY * DY);
    rhs[k] = c + dt * lap;
    // hiperdyfuzja ∇⁴ (u, v, w, θ'): tłumi tylko najkrótsze fale (2 oczka, τ ≈ 5 min; 4 oczka ~16× słabiej,
    // jak filtr 6. rzędu w WRF) – usuwa wąskie, regularne paski wznoszeń wzdłuż wiatru („undulatusy”) i
    // komórki konwekcyjne w skali jednego oczka; na siatkach LES wyłączona
    // (laplasjan policzony wcześniej w jądrze lap4 – tu tylko drugi laplasjan, 5 odczytów zamiast 13 sąsiadów)
    if (f <= 3u && DX > 400.0 && k < NZ) {
      let lb = W_R + f * N;
      let lC = work[lb + k * NXY + col];
      var d4 = 0.0;
      if (k >= thE) { d4 += work[lb + cidx(i + 1, j, k)] - lC; }
      if (k >= thW) { d4 += work[lb + cidx(i - 1, j, k)] - lC; }
      if (k >= thN) { d4 += work[lb + cidx(i, j + 1, k)] - lC; }
      if (k >= thS) { d4 += work[lb + cidx(i, j - 1, k)] - lC; }
      rhs[k] -= smoothstep(400.0, 900.0, DX) * dt / (16.0 * 300.0) * d4;   // ∇⁴ · DX⁴
    }
    // ta sama hiperdyfuzja dla q_v (zachowawcza): w szarej strefie (1–5 km) konwekcja zapada się do 1–2 oczek
    // i wilgoć (a z nią chmury i opad) tworzyła szum „piksel po pikselu” – migotanie i kraty na satelicie
    if (f == 4u && DX > 400.0 && k < NZ) {
      let lC = lapQ(off, i, j, k);
      var d4 = 0.0;
      if (k >= thE) { d4 += lapQ(off, i + 1, j, k) - lC; }
      if (k >= thW) { d4 += lapQ(off, i - 1, j, k) - lC; }
      if (k >= thN) { d4 += lapQ(off, i, j + 1, k) - lC; }
      if (k >= thS) { d4 += lapQ(off, i, j - 1, k) - lC; }
      rhs[k] -= smoothstep(400.0, 900.0, DX) * dt / (16.0 * 300.0) * d4;
    }
    // tłumienie dywergencji (grube siatki, W_CU): tłumi tylko zbieżno-rozbieżną część przepływu w małej
    // skali (2–6 oczek), nie wiry ani przepływ geostroficzny – zapobiega samonapędzającym się krążeniom
    // kondensacyjnym (CISK, „burze punktów siatki” z ulewami po kilkaset mm); jak w WRF/MPAS
    if (f < 2u && W_CU > 0.0) {
      let nud = DDAMP * W_CU * DX * DY / dt;
      if (f == 0u) { rhs[k] += dt * nud * (hdiv(i, j, k) - hdiv(i - 1, j, k)) / DX; }
      else { rhs[k] += dt * nud * (hdiv(i, j, k) - hdiv(i, j - 1, k)) / DY; }
    }
    if (f == 1u) {
      // Coriolis dla v: −f (u − u_g), u już po kroku (z `advect`)
      rhs[k] -= dt * fcorAt(j) * (uAtV(i, j, k) - tgUAtV(i, j, k));
    }
    if (f == 2u) {
      // Wyporność względem stanu dużej skali (pola docelowego): b = g [(θ' − θ'_d)/θ0 + 0.61 (q_v − q_v,d)
      // − q_c − q_r] na poziomie w. Duża skala jest w równowadze hydrostatycznej i geostroficznej
      // z wiatrem docelowym (model synoptyczny), więc jej gradient temperatury nie może drugi raz
      // napędzać przepływu przez ciśnienie z solvera (przy sztywnym wieku dawało to fałszywy wiatr
      // przy gruncie rzędu połowy wiatru termicznego).
      let a = (k - 1u) * NXY + col;
      let b = k * NXY + col;
      let thw = 0.5 * (tmp[T_OFF + a] - tgAt(0u, a, P.ta1) + tmp[T_OFF + b] - tgAt(0u, b, P.ta1));
      let qvw = 0.5 * (tmp[QV_OFF + a] - tgAt(1u, a, P.ta1) + tmp[QV_OFF + b] - tgAt(1u, b, P.ta1));
      let qlw = 0.5 * (tmp[QC_OFF + a] + tmp[QC_OFF + b] + tmp[QI_OFF + a] + tmp[QI_OFF + b]
                     + tmp[QR_OFF + a] + tmp[QR_OFF + b]);
      rhs[k] += dt * G * (thw / vg[VG_TW + k] + 0.61 * qvw - qlw);
    }
  }

  // Tarcie o powierzchnię: τ = ρ C_D |V| V, C_D·|V| z kroku `surface` (Louis), liczone niejawnie
  var drag = 0.0;
  if (f < 2u) {
    let cdu = 0.5 * (sfc[sf(S_CDU, col)] + sfc[sf(S_CDU, wrapi(j + dj, NY) * NX + wrapi(i + di, NX))]);
    drag = dt * cdu / (vg[VG_DZC + kbf] * select(aV(i, j, kbf), aU(i, j, kbf), f == 0u));
  }

  // Cienka komórka przy gruncie (hf < 1, ?tlk=0 – bez) łączona mieszaniem z warstwą wyżej, τ ~15 min / (1 − hf) (jak łączenie cienkich komórek przy oczkach przyciętych). Strumienie z gruntu idą w jej małą masę (hf·dz), a nocą
  // mieszanie w górę prawie nie działa, więc oczka, których teren wypada tuż pod ścianą warstwy (~120, ~210, ~300 m), były co noc najzimniejsze: przebieg 4-letni, stacje o hf < 0.7 (25 z 50) mają 42 z 48 rekordów Tmin miesiąca, ciche noce −1.3…−1.8 K
  // wobec −0.1…−0.6 K pozostałych; na mapie Tmin „zawsze w tych samych miejscach”
  var kLnk = 0.0;
  if (TLK > 0.0 && f != 2u && kbf + 1u < NZ) {
    let hk0 = select(select(vg[VG_HF + col], aV(i, j, kbf), f == 1u), aU(i, j, kbf), f == 0u);
    kLnk = TLK * clamp(1.0 - hk0, 0.0, 1.0) * vg[VG_DZW + kbf + 1u] * vg[VG_DZW + kbf + 1u] / 900.0;
  }
  var cp: array<f32, NZ + 1u>;
  var dp: array<f32, NZ + 1u>;
  for (var k = 0u; k < nl; k++) {
    var a = 0.0;
    var c = 0.0;
    var b = 1.0;
    if (k >= kbf && !(f == 2u && k == NZ)) {
      // strumienie ważone gęstością: ∂/∂z(ρ K ∂φ/∂z) / ρ – zachowuje masę przy zmiennej gęstości
      if (f == 2u) {
        // strumienie w środkach komórek k−1 i k; w = 0 na gruncie i u góry (warunek Dirichleta)
        let rw = vg[VG_RW + k];
        a = -dt * kcell(i, j, k - 1u, false, false) * vg[VG_RC + k - 1u] / (vg[VG_DZC + k - 1u] * vg[VG_DZW + k] * rw);
        c = -dt * kcell(i, j, k, false, false) * vg[VG_RC + k] / (vg[VG_DZC + k] * vg[VG_DZW + k] * rw);
      } else {
        // strumienie na poziomach w; zerowy strumień na gruncie i u góry
        let rc = vg[VG_RC + k];
        if (k > kbf) { a = -dt * (0.5 * (kp[k - 1u] + kp[k]) + select(0.0, kLnk, k == kbf + 1u)) * vg[VG_RW + k] / (vg[VG_DZW + k] * vg[VG_DZC + k] * rc); }
        // (komórka przy gruncie: masa części nad gruntem – hf·dz dla skalarów, część otwarta ściany dla u, v)
        let hk = select(1.0, select(select(vg[VG_HF + col], aV(i, j, k), f == 1u), aU(i, j, k), f == 0u), k == kbf);
        if (k < NZ - 1u) { c = -dt * (0.5 * (kp[k] + kp[k + 1u]) + select(0.0, kLnk, k == kbf)) * vg[VG_RW + k + 1u] / (vg[VG_DZW + k + 1u] * hk * vg[VG_DZC + k] * rc); }
      }
      b = 1.0 - a - c;
      if (k == kbf && f < 2u) { b += drag; }
      if (k == kbf && f == 4u) {
        // parowanie z powierzchni: strumień na dolnym brzegu pierwszej komórki nad gruntem
        rhs[k] += dt * sfc[sf(S_LE, col)] / (vg[VG_RC + k] * LV * vg[VG_HF + col] * vg[VG_DZC + k]);
      }
      if (f == 3u) {
        // mieszanie działa na pełne θ = θ0 + θ', więc dochodzi człon od gradientu θ0
        if (k < NZ - 1u) { rhs[k] -= c * (vg[VG_TC + k + 1u] - vg[VG_TC + k]); }
        if (k > kbf) { rhs[k] += a * (vg[VG_TC + k] - vg[VG_TC + k - 1u]); }
      }
    }
    var den = b;
    var r = rhs[k];
    if (k > 0u) {
      den = b - a * cp[k - 1u];
      r -= a * dp[k - 1u];
    }
    cp[k] = c / den;
    dp[k] = r / den;
  }
  var x = dp[nl - 1u];
  state[off + (nl - 1u) * NXY + col] = x;
  for (var kk = i32(nl) - 2; kk >= 0; kk--) {
    let k = u32(kk);
    x = dp[k] - cp[k] * x;
    state[off + k * NXY + col] = select(x, max(x, 0.0), f >= 4u);
  }
  if (f >= 3u) {
    // skalary pod gruntem = wartość z pierwszej komórki nad gruntem (dla interpolacji przy zboczach)
    // (θ', q_v: kopiujemy odchyłkę od pola docelowego, bo wypór liczy się względem niego –
    // inaczej przy zboczach powstaje fałszywy wypór)
    let tb = state[off + kbf * NXY + col];
    let tf = f - 3u;
    let dv = select(0.0, tb - tgAt(min(tf, 1u), kbf * NXY + col, P.ta1), f <= 4u);
    for (var k = 0u; k < kbf; k++) {
      state[off + k * NXY + col] = select(tb, dv + tgAt(min(tf, 1u), k * NXY + col, P.ta1), f <= 4u);
    }
  }
}

// ======================= Mikrofizyka: ciepły deszcz (Kessler) + uproszczona faza lodowa =======================
// Pola: q_c – woda chmurowa (może być przechłodzona do −38 °C), q_i – lód chmurowy, q_r – opad
// (deszcz albo śnieg zależnie od temperatury warstwy).
// Procesy: autokonwersja i akrecja (Kessler), zamarzanie kropel i proces Bergerona, zamarzanie
// homogeniczne poniżej −38 °C, depozycja/sublimacja lodu (z nukleacją przy przesyceniu względem
// lodu – cirrusy), agregacja lodu w śnieg (Lin 1983), zbieranie lodu przez śnieg, parowanie deszczu
// i sublimacja śniegu (Klemp–Wilhelmson), topnienie przy przejściu śniegu przez 0 °C, opadanie
// deszczu, śniegu i kryształków lodu.
const LF: f32 = 3.34e5;
const LS: f32 = 2.834e6;
const RV: f32 = 461.5;
const TFRZ: f32 = 273.15;

// ---- Opad dwumomentowy (Morrison i in. 2009, WRF mp=10; samozderzenia: Seifert i Beheng 2001) ----
// Prognozowane: masa opadu q_r i liczba cząstek N_r [1/kg]. Krople deszczu: rozkład wykładniczy N(D) = N0·e^(−λD),
// λ = (π·ρ_w·N_r/q_r)^⅓ (średnia średnica 20 µm … 2.8 mm), prędkość v = a·D^b (a = 842, b = 0.8, poprawka gęstości).
// Od rozkładu zależą: prędkość opadania masy i liczby (sortowanie kropel), parowanie (wentylacja: drobne krople pod
// chmurą parują szybko i silnie chłodzą – zimne wypływy), odbiciowość radaru (Z = 720·ρ·N_r/λ⁶).
// Śnieg i krupa: liczba z rozkładu Gunna–Marshalla (po stopnieniu – mało, ale dużych kropel).
const PI: f32 = 3.14159265;
const RHOW: f32 = 1000.0;
const AR_R: f32 = 841.99667;
const BR_R: f32 = 0.8;
const RHOSU: f32 = 1.0838;          // 85000 / (287.15 · 273.15) – gęstość odniesienia prędkości opadania
const M_AUT: f32 = 6.545e-11;       // masa nowej kropli z autokonwersji (promień 25 µm) [kg]
const LAM_MIN: f32 = 357.14;        // 1 / 2.8 mm
const LAM_MAX: f32 = 50000.0;       // 1 / 20 µm
fn lamR(qr: f32, nr: f32) -> f32 { return pow(PI * RHOW * max(nr, 1e-12) / max(qr, 1e-12), 1.0 / 3.0); }
// liczba kropel z rozkładu Marshalla–Palmera (N0 = 8·10⁶ m⁻⁴) – opad bez historii (napływ przez brzeg)
fn nMarshallPalmer(q: f32, rho: f32) -> f32 {
  if (q <= 1e-9) { return 0.0; }
  let lam = pow(PI * RHOW * 8e6 / (rho * q), 0.25);
  return 8e6 / lam / rho;
}
// śnieg (ρ 100 kg/m³, N0 5·10⁶) i krupa (ρ 400, N0 4·10⁶) – liczba cząstek [1/kg]
fn nSnowDiag(q: f32, rho: f32, rime: f32) -> f32 {
  let n0 = mix(5e6, 4e6, rime);
  let lam = pow(PI * mix(100.0, 400.0, rime) * n0 / max(rho * q, 1e-12), 0.25);
  return n0 / lam / rho;
}
// liczba kropel w granicach rozkładu (średnia średnica 20 µm … 2.8 mm); bez opadu – zero
fn nrBound(qr: f32, nr: f32, rho: f32) -> f32 {
  if (qr <= 1e-9) { return 0.0; }
  if (nr <= 0.0) { return nMarshallPalmer(qr, rho); }
  let c = PI * RHOW / qr;
  return clamp(nr, LAM_MIN * LAM_MIN * LAM_MIN / c, LAM_MAX * LAM_MAX * LAM_MAX / c);
}
// punkty pierścienia otoczenia (2–3 oczka od komórki) do wciągania w chmurę
fn entOff(r: i32) -> vec2i {
  switch r {
    case 0: { return vec2i(3, 0); }
    case 1: { return vec2i(-3, 0); }
    case 2: { return vec2i(0, 3); }
    case 3: { return vec2i(0, -3); }
    case 4: { return vec2i(2, 2); }
    case 5: { return vec2i(-2, 2); }
    case 6: { return vec2i(2, -2); }
    default: { return vec2i(-2, -2); }
  }
}
// tempo parowania deszczu [1/s] (Morrison i in. 2009: dyfuzja pary + wentylacja); parowanie = tempo·(q_s − q_v)/Γ
fn rainEvapRate(qr: f32, nr: f32, t: f32, pres: f32, rho: f32) -> f32 {
  let lam = clamp(lamR(qr, nr), LAM_MIN, LAM_MAX);
  let dv = 8.794e-5 * pow(t, 1.81) / pres;
  let mu = 1.496e-6 * pow(t, 1.5) / (t + 120.0);
  let arn = AR_R * pow(RHOSU / rho, 0.54);
  let vent = 0.78 / (lam * lam) + 0.308 * sqrt(arn * rho / mu) * pow(mu / (rho * dv), 1.0 / 3.0) * 1.827 / pow(lam, 2.9);
  return 2.0 * PI * nr * lam * rho * dv * vent;
}

@compute @workgroup_size(64)
fn micro(@builtin(global_invocation_id) gid: vec3u) {
  let col = gid.x;
  if (col >= NXY) { return; }
  let kb = kbAt(i32(col % NX), i32(col / NX));
  let dt = P.dt;
  // liczba kropel chmurowych (autokonwersja): powietrze morskie ~100 cm⁻³, kontynentalne ~250 cm⁻³ – udział wody
  // w otoczeniu 5 × 5 oczek (płynnie przy brzegu, bez skoku opadu na linii brzegowej)
  var fwat = 0.0;
  for (var dj = -2; dj <= 2; dj++) {
    for (var di = -2; di <= 2; di++) {
      fwat += select(0.0, 1.0, u32(vg[VG_VEG + cidx(i32(col % NX) + di, i32(col / NX) + dj, 0u)] + 0.5) == 10u);
    }
  }
  let ncAut = pow(mix(250.0, 100.0, fwat / 25.0), -1.79);
  var qrc: array<f32, NZ>;
  var qic: array<f32, NZ>;
  var thc: array<f32, NZ>;
  var cold: array<f32, NZ>;
  var rime: array<f32, NZ>;
  var vt: array<f32, NZ>;
  var nrc: array<f32, NZ>;
  var vn: array<f32, NZ>;
  var evr = 0.0;                     // parowanie opadu w dolnych 2 km [kg/m²] – źródło kopuł (org_update)
  // wciąganie zależne od ścinania (siatki 0.5–4 km, gdzie prądy wstępujące są za szerokie i same go nie robią): w chmurze,
  // gdzie powietrze się wznosi, θ', para i kondensat zbliżają się do średniej z otoczenia (pierścień 2–3 oczka) w tempie
  // r = c·ΔV/R – ΔV: różnica wiatru otoczenia między poziomem a ~1 km nad gruntem (prąd niesie pęd z podstawy chmury,
  // otoczenie przewiewa przez chmurę i wciąga suche powietrze), R: promień prądu (pół oczka, ≥ 500 m). Słaby prąd w szybkim
  // przepływie jest rozcieńczony, zanim urośnie (Weisman–Klemp: przy BRN < ~10 słabe burze są rozrywane; Peters i in. – ECAPE),
  // silny przechodzi przez warstwę, zanim się wymiesza. Na siatkach LES (≤ 300 m) turbulencję liczy sama siatka.
  let ci = i32(col % NX);
  let cj = i32(col / NX);
  let wEnt = smoothstep(300.0, 1000.0, DX);
  var k1 = kb;
  for (var k = kb; k < NZ; k++) { if (vg[VG_ZC + k] - zgC(col) > 1000.0) { break; } k1 = k; }
  var u1 = 0.0;
  var v1 = 0.0;
  for (var r = 0; r < 8; r++) {
    let o = entOff(r);
    u1 += ucen(ci + o.x, cj + o.y, k1);
    v1 += vcen(ci + o.x, cj + o.y, k1);
  }
  u1 *= 0.125;
  v1 *= 0.125;
  for (var k = kb; k < NZ; k++) {
    let c = k * NXY + col;
    var thp = state[T_OFF + c];
    var qv = max(state[QV_OFF + c], 0.0);
    var qc = max(state[QC_OFF + c], 0.0);
    var qi = max(state[QI_OFF + c], 0.0);
    var qr = max(state[QR_OFF + c], 0.0);
    var nr = max(state[NR_OFF + c], 0.0);
    let rho = vg[VG_RC + k];
    let pk = vg[VG_EXC + k];
    let pres = vg[VG_PRS + k];
    let th0 = vg[VG_TC + k];
    var t = (th0 + thp) * pk;

    let wup = 0.5 * (tmp[W_OFF + c] + tmp[W_OFF + c + NXY]);
    if (wEnt > 0.0 && k > k1 && qc + qi > 1e-5 && wup > 0.2) {
      var te = 0.0;
      var qe = 0.0;
      var ce = 0.0;
      var ie = 0.0;
      var ue = 0.0;
      var ve = 0.0;
      for (var r = 0; r < 8; r++) {
        let o = entOff(r);
        let cn = cidx(ci + o.x, cj + o.y, k);
        te += tmp[T_OFF + cn];
        qe += max(tmp[QV_OFF + cn], 0.0);
        ce += max(tmp[QC_OFF + cn], 0.0);
        ie += max(tmp[QI_OFF + cn], 0.0);
        ue += ucen(ci + o.x, cj + o.y, k);
        ve += vcen(ci + o.x, cj + o.y, k);
      }
      let dvs = length(vec2f(ue * 0.125 - u1, ve * 0.125 - v1));
      // + wciąganie w prąd wstępujący na grubych siatkach (W_CU, ≥ 2–5 km): ε·w, ε = 0.1/km – bez niego przy słabym ścinaniu prąd szerokości kilku oczek prawie się nie rozcieńczał:
      // ulewy 50–60 mm/h stojące godzinami i kropki opadu przy dużym CAPE
      let fe = 1.0 - exp(-dt * (wEnt * 0.3 * dvs / max(0.5 * DX, 500.0) + W_CU * 1.0e-4 * wup));
      thp += fe * (te * 0.125 - thp);
      qv += fe * (qe * 0.125 - qv);
      qc += fe * (ce * 0.125 - qc);
      qi += fe * (ie * 0.125 - qi);
      t = (th0 + thp) * pk;
    }

    // topnienie lodu chmurowego nad 0 °C, zamarzanie homogeniczne wody poniżej −38 °C
    if (t > TFRZ && qi > 0.0) { qc += qi; thp -= LF / (CP * pk) * qi; qi = 0.0; }
    if (t < 235.15 && qc > 0.0) { qi += qc; thp += LF / (CP * pk) * qc; qc = 0.0; }
    t = (th0 + thp) * pk;

    // Lód w chmurze mieszanej: liczba kryształków z jąder lodu zależnych od temperatury (Cooper 1986:
    // 0.005·e^{0.304·(T0 − T)} na litr – przy −10 °C ~0.1/l, −20 °C ~2/l, −25 °C ~10/l) albo z ilości lodu
    // już obecnego (kryształki ≤ 3e-8 kg – konwekcja, lód napływający z góry). Kryształki rosną przez dyfuzję pary
    // (jądro depozycji niżej, tempo ∝ N·pojemność), woda paruje i odnawia parę (proces Bergerona przez nasycenie).
    // Wcześniej tempo ∝ masie lodu: każdy ślad lodu rósł wykładniczo i przechłodzony stratus przy −8…−12 °C
    // zamieniał się w lód i wypadał w ~1 h – zimą chmury tylko z opadem, pogodne noce nad śniegiem (−6…−8 K).
    let nin = min(5.0 * exp(0.304 * (TFRZ - t)) / rho, 1e6);   // jądra lodu [1/kg]
    // zamarzanie kropel na jądrach (immersyjne): w chmurze wodnej poniżej −2 °C co najmniej N_in kryształków po 1e-12 kg
    if (t < TFRZ - 2.0 && qc > 1e-6) {
      let fz = min(max(nin * 1e-12 - qi, 0.0), qc);
      qc -= fz;
      qi += fz;
      thp += LF / (CP * pk) * fz;
    }

    // autokonwersja wody → deszcz (Khairoutdinov–Kogan, niżej) i akrecja (Kessler, postać niejawna)
    // akrecja: śnieg (zimna warstwa) zbiera krople chmurowe ~2× słabiej niż deszcz
    // grube siatki (≥ 2 km): woda chmurowa wolniej przechodzi w opad – oczko to wiele chmur w różnych
    // stadiach, część kondensatu odparowuje, zanim spadnie (mniejsza wydajność opadowa „na siatce”)
    // Autokonwersja wg Khairoutdinova i Koguta (2000): 1350·q_c^2.47·N_c^−1.79 [1/s] – zależna od liczby kropel
    // (ląd ~250 cm⁻³, morze ~100 cm⁻³). Kessler (próg 1 g/kg, 1e-3/s) dawał ulewy 10+ mm/h z płytkich chmur
    // orograficznych bez lodu (wierzchołek ~2 km, −6 °C) i za dużo opadu ogólnie; w powietrzu kontynentalnym
    // ciepły deszcz zaczyna się późno i słabo – duży opad daje głęboka chmura z lodem (Bergeron, śnieg → deszcz)
    let effg = 1.0 - 0.5 * W_CU;
    // Zbieranie kropel (i kryształków) przez opad zależy od strumienia (masa × prędkość opadania), nie od samej masy:
    // śnieg spada 4–5× wolniej niż deszcz, więc przy tym samym natężeniu ma w powietrzu 4–5× więcej masy – wzór
    // Kesslera (∝ q_r^0.875) dawał mu ~2× większe zbieranie niż deszczowi i śnieżyce padały mocniej niż taki sam deszcz.
    // Teraz dla opadu zamarzniętego współczynnik × (v_śnieg / v_deszcz)^0.875 (śnieg ~1 m/s, krupa ~2.5 m/s).
    let rhoA = vg[VG_RC + k];
    let fcold = clamp((TFRZ + 2.5 - t) / 3.0, 0.0, 1.0);
    let vrA = 36.34 * pow(max(0.001 * rhoA * qr, 1e-15), 0.1364);
    let vsA = (0.9 + 1.5 * clamp(qc / 5e-4, 0.0, 1.0)) * pow(max(1000.0 * rhoA * qr, 1e-6), 0.1);
    let fflux = pow(clamp(vsA / max(vrA, 0.1), 0.05, 1.0), 0.875);
    let kacc = 2.2 * mix(1.0, fflux, fcold) * effg;
    let aut = effg * 1350.0 * pow(qc, 2.47) * ncAut;
    let qrprod = qc - (qc - dt * aut) / (1.0 + dt * kacc * pow(max(qr, 1e-12), 0.875));
    qc -= qrprod;
    qr += qrprod;
    // liczba kropel: autokonwersja tworzy krople o promieniu ~25 µm (KK2000); akrecja liczby nie zmienia
    nr += min(dt * aut, qrprod) / M_AUT;
    t = (th0 + thp) * pk;
    // agregacja lodu w śnieg (Lin i in. 1983) i zbieranie lodu przez opad
    if (qi > 0.0) {
      // + duże kryształki to już śnieg: średnia masa ponad ~2e-9 kg (~200 µm) przechodzi w opad (τ 10 min) – przy małej
      // liczbie kryształków (jądra lodu przy −10…−20 °C) q_i nie dochodzi do progu Lina 0.1 g/kg, a duże kryształki
      // zostawały „chmurą” i sublimowały (zima: opad 50 → 18 mm / 40 dób)
      let niA = max(nin, qi / 3e-8);
      let agg = min(qi, dt * 1e-3 * exp(0.025 * (t - TFRZ)) * max(qi - 1e-4, 0.0)
                       + max(qi - niA * 2e-9, 0.0) * (1.0 - exp(-dt / 600.0)));
      let col_i = (qi - agg) * (1.0 - 1.0 / (1.0 + dt * 1.1 * fflux * pow(max(qr, 1e-12), 0.875)));
      qi -= agg + col_i;
      qr += agg + col_i;
    }

    // nasycenie względem wody: kondensacja / parowanie chmury z ciepłem (poniżej −38 °C tylko lód)
    let qvs = qsat(t, pres);
    var prod = (qv - qvs) / (1.0 + qvs * 4098.17 * LV / CP / ((t - 35.86) * (t - 35.86)));
    if (t < 235.15) { prod = min(prod, 0.0); }
    let dqc = max(prod, -qc);
    thp += LV / (CP * pk) * dqc;
    qv -= dqc;
    qc += dqc;
    t = (th0 + thp) * pk;

    // depozycja i sublimacja lodu (nierównowagowo, τ ≈ 10 min); nowe kryształki tylko przy
    // przesyceniu względem lodu (RHi > 120% poniżej −20 °C, > 145% poniżej −38 °C)
    if (t < TFRZ) {
      let qsi = qsat_ice(t, pres);
      let ex = qv - qsi;
      let den = 1.0 + qsi * LS * LS / (CP * RV * t * t);
      if (ex > 0.0) {
        let rhi = qv / qsi;
        // nukleacja w czystym powietrzu przy dużym przesyceniu względem lodu (cirrusy) i depozycyjna na jądrach lodu od −8 °C
        // przy przesyceniu > 8% (jak w schemacie Morrisona) – warstwy przesycone względem lodu (fronty, niże zimą) dają chmurę
        // lodową i śnieg także bez nasycenia względem wody
        if ((t < 235.15 && rhi > 1.45) || (t < 253.15 && rhi > 1.2) || (t < 265.15 && rhi > 1.08)) { qi = max(qi, nin * 1e-12); }
        // wzrost przez dyfuzję pary: 1/τ = 4π·D·C·N·ρ·f_w – C pojemność cząstki (kula), f_w wentylacja.
        //  • kryształki chmury: N z jąder lodu albo z ilości lodu (≤ 3e-8 kg na kryształek), 500 kg/m³, f_w 1.5 – stratus
        //    przy −10 °C: τ rzędu doby (woda chmurowa trwa); −20 °C: ~2 h; −25 °C i niżej, konwekcja (dużo lodu): minuty;
        //  • płatki śniegu (opad zamarznięty, liczba z rozkładu): 100 kg/m³, f_w 2 – śnieg padający z wyższych warstw przez
        //    przechłodzoną chmurę rośnie kosztem jej wody w kilka minut (zasiewacz–karmiciel: opad z chmur frontowych);
        //    stratus bez śniegu nad sobą trwa
        var ri = 0.0;
        if (qi > 1e-14) {
          let ni = max(nin, qi / 3e-8);
          let cap = 0.5 * pow(6.0 * qi / ni / (3.14159 * 500.0), 1.0 / 3.0);
          ri = clamp(4.0 * 3.14159 * 2.2e-5 * cap * ni * rho * 1.5, 2.5e-6, 1.0 / 60.0);
        }
        var rsn = 0.0;
        let fcs = clamp((TFRZ + 2.5 - t) / 3.0, 0.0, 1.0);
        if (qr > 1e-9 && fcs > 0.0 && nr > 0.0) {
          let caps = 0.5 * pow(6.0 * qr / nr / (3.14159 * 100.0), 1.0 / 3.0);
          // (×0.5: przy pełnym tempie własny śnieg stratusu zjadał jego wodę – zima, 40 dób: zachmurzenie 39%; bez tej drogi
          // opad 18 mm przy normie ~48; ×0.5 – 35 mm, chmury 64% (dawniej 50 mm, 54%))
          rsn = min(4.0 * 3.14159 * 2.2e-5 * caps * nr * fcs * rho * 2.0 * 0.5, 1.0 / 60.0);
        }
        let rt = ri + rsn;
        if (rt > 0.0) {
          let dep = ex / den * (1.0 - exp(-dt * rt));
          let ds = dep * rsn / rt;
          qv -= dep;
          qi += dep - ds;
          qr += ds;
          thp += LS / (CP * pk) * dep;
        }
      } else if (qi > 0.0) {
        let sub = min(qi, -ex / den * (1.0 - exp(-dt / 600.0)));
        qi -= sub;
        qv += sub;
        thp -= LS / (CP * pk) * sub;
      }
    }
    t = (th0 + thp) * pk;

    // udział śniegu / krupy w opadzie (płynnie w warstwie −0.5…+2.5 °C)
    let fc = clamp((TFRZ + 2.5 - t) / 3.0, 0.0, 1.0);
    // samozderzenia kropel (liczba maleje) i rozpad dużych (średnica > 300 µm – liczba rośnie): Seifert–Beheng, Morrison
    nr = nrBound(qr, nr, rho);
    if (qr > 1e-8 && nr > 0.0) {
      let dm = 1.0 / lamR(qr, nr);
      let ec = select(2.0 - exp(2300.0 * (dm - 300e-6)), 1.0, dm < 300e-6);
      nr *= exp(-dt * 5.78 * ec * qr * rho * (1.0 - fc));
      nr = nrBound(qr, nr, rho);
    }
    // parowanie deszczu (Morrison: dyfuzja pary z wentylacją, zależnie od rozkładu kropel) – relaksacja do nasycenia
    let qsw = qsat(t, pres);
    if (qr > 1e-9 && qv < qsw && fc < 1.0) {
      let abr = 1.0 + LV * LV * qsw / (RV * CP * t * t);
      let ep = (1.0 - fc) * rainEvapRate(qr, nr, t, pres, rho);
      let ern = min((qsw - qv) / abr * (1.0 - exp(-dt * ep)), (1.0 - fc) * qr);
      nr -= nr * ern / qr;
      if (vg[VG_ZC + k] - zgC(col) < 2000.0) { evr += ern * mlay(k, kb, col); }
      thp -= LV / (CP * pk) * ern;
      qv += ern;
      qr -= ern;
      t = (th0 + thp) * pk;
    }
    // sublimacja śniegu / krupy (Klemp i Wilhelmson 1978, względem lodu)
    if (qr > 1e-9 && fc > 0.0) {
      let qsx = qsat_ice(t, pres);
      let rq = max(0.001 * rho * qr, 1e-15);
      let ev = dt * ((1.6 + 124.9 * pow(rq, 0.2046)) * pow(rq, 0.525)) / (2.55e8 / (pres * qsx) + 5.4e5)
             * (max(qsx - qv, 0.0) / (0.001 * rho * qsx));
      let ers = min(min(fc * ev, 0.5 * max(qsx - qv, 0.0)), fc * qr);
      nr -= nr * ers / qr;
      thp -= LS / (CP * pk) * ers;
      qv += ers;
      qr -= ers;
    }
    // śnieg i krupa: liczba cząstek dąży do rozkładu Gunna–Marshalla (τ 5 min)
    if (qr > 1e-9 && fc > 0.0) {
      nr += (1.0 - exp(-dt / 300.0)) * fc * (nSnowDiag(qr, rho, clamp(qc / 5e-4, 0.0, 1.0)) - nr);
    }
    nr = nrBound(qr, nr, rho);

    state[QV_OFF + c] = max(qv, 0.0);
    state[QC_OFF + c] = max(qc, 0.0);
    thc[k] = thp;
    qrc[k] = max(qr, 0.0);
    nrc[k] = nr;
    qic[k] = max(qi, 0.0);
    // udział śniegu w opadzie: płynnie w warstwie −0.5…+2.5 °C (mokry śnieg / deszcz ze śniegiem) –
    // przełącznik 0/1 dawał przy froncie w temperaturze ~0 °C plamki opadu wielkości oczka
    cold[k] = clamp((TFRZ + 2.5 - (th0 + thp) * pk) / 3.0, 0.0, 1.0);
    rime[k] = clamp(qc / 5e-4, 0.0, 1.0);        // opad zbierający przechłodzoną wodę = krupa
  }

  // opadanie deszczu (do ~10 m/s) i śniegu (~1 m/s), "pod prąd" z podkrokami; przy przejściu
  // opadu przez 0 °C ciepło topnienia (śnieg → deszcz chłodzi warstwę) lub zamarzania
  let rho0 = vg[VG_RC];
  var cmax = 0.0;
  for (var k = kb; k < NZ; k++) {
    let rho = vg[VG_RC + k];
    let rq = max(0.001 * rho * qrc[k], 1e-15);
    let vr = 36.34 * pow(rq, 0.1364) * sqrt(rho0 / rho);
    // śnieg ~1 m/s, oszroniony śnieg / krupa do ~2.5 m/s (wolniej opadający śnieg wiatr przenosi
    // nad grzbiet – mniej opadu na nawietrznych stokach, więcej za grzbietem)
    // + w rdzeniach burz (dużo oszronionego opadu, > 1–4 g/kg) krupa i grad spadają 3–8 m/s – wcześniej
    // kondensat burzy zostawał w górze i szedł w kowadło zamiast spaść jako ulewa
    let vs = (0.9 + 1.5 * rime[k] + 6.0 * rime[k] * smoothstep(1.0, 4.0, 1000.0 * qrc[k])) * pow(max(1000.0 * rho * qrc[k], 1e-6), 0.1) * sqrt(rho0 / rho);
    // deszcz: prędkość ważona masą (dla masy) i liczbą (dla liczby kropel) z rozkładu – duże krople wyprzedzają małe
    var vqr = vr;
    var vnr = vr;
    if (qrc[k] > 1e-9 && nrc[k] > 0.0) {
      let lam = clamp(lamR(qrc[k], nrc[k]), LAM_MIN, LAM_MAX);
      let arn = AR_R * pow(RHOSU / rho, 0.54);
      let lb = pow(lam, BR_R);
      vqr = min(arn * 17.837 / (6.0 * lb), 9.1);     // Γ(4 + b) / 6
      vnr = min(arn * 0.9314 / lb, 9.1);             // Γ(1 + b)
    }
    vt[k] = select(0.0, mix(vqr, vs, cold[k]), qrc[k] > 1e-9);
    vn[k] = select(0.0, mix(vnr, vs, cold[k]), qrc[k] > 1e-9);
    cmax = max(cmax, vt[k] * dt / vg[VG_DZC + k]);
  }
  // liczba podkroków z twardym limitem i osłoną przed NaN: u32(NaN) albo u32(+∞) daje w WebGPU 4 294 967 295, a pętla po podkrokach
  // (× warstwy) zawieszała wtedy kartę – Windows resetował sterownik (DXGI_ERROR_DEVICE_HUNG, zgłoszenie z Radeona RX 7900 GRE).
  // Normalnie 1–30 podkroków (prędkość ≤ 9.1 m/s, krok ≤ 90 s, warstwa ≥ ~25 m)
  let nsub = clamp(u32(ceil(select(0.0, cmax, cmax == cmax) / 0.8)), 1u, 64u);
  let dts = dt / f32(nsub);
  var acc = 0.0;
  for (var s = 0u; s < nsub; s++) {
    var fin = 0.0;
    var finN = 0.0;
    var coldAbove = 0.0;
    for (var kk = i32(NZ) - 1; kk >= i32(kb); kk--) {
      let k = u32(kk);
      let rho = vg[VG_RC + k];
      let fout = rho * qrc[k] * vt[k];
      let foutN = rho * nrc[k] * vn[k];
      let m = rho * vg[VG_DZC + k];
      qrc[k] = max(qrc[k] + dts * (fin - fout) / m, 0.0);
      nrc[k] = max(nrc[k] + dts * (finN - foutN) / m, 0.0);
      finN = foutN;
      if (fin > 0.0 && coldAbove != cold[k]) {
        // śnieg topnieje w cieplejszej warstwie (chłodzenie) albo deszcz zamarza w zimniejszej – ciepło
        // proporcjonalne do zmiany udziału śniegu
        thc[k] += (cold[k] - coldAbove) * LF * fin * dts / (m * CP * vg[VG_EXC + k]);
      }
      fin = fout;
      coldAbove = cold[k];
    }
    acc += fin * dts;
  }
  // opadanie kryształków lodu chmurowego (VFI × √(ρ0/ρ): domyślnie ~0.15 m/s przy gruncie, ~0.25 m/s na 10 km – jak drobne kryształki cirrusów; ?vfi=0.4 – dawniej:
  // ~0.65 m/s na 10 km, warstwa 1 km wypadała w ~25 min i chmur wysokich było kilka razy mniej niż w modelu synoptycznym – użytkownik: przy niżach i frontach za mało)
  var acci = 0.0;
  var cmi = 0.0;
  for (var k = kb; k < NZ; k++) { cmi = max(cmi, VFI * sqrt(rho0 / vg[VG_RC + k]) * dt / vg[VG_DZC + k]); }
  let nsi = clamp(u32(ceil(select(0.0, cmi, cmi == cmi) / 0.8)), 1u, 64u);   // (limit jak wyżej)
  let dti = dt / f32(nsi);
  for (var s = 0u; s < nsi; s++) {
    var fin = 0.0;
    for (var kk = i32(NZ) - 1; kk >= i32(kb); kk--) {
      let k = u32(kk);
      let rho = vg[VG_RC + k];
      let fout = rho * qic[k] * VFI * sqrt(rho0 / rho);
      qic[k] = max(qic[k] + dti * (fin - fout) / (rho * vg[VG_DZC + k]), 0.0);
      fin = fout;
    }
    acci += fin * dti;
  }
  for (var k = kb; k < NZ; k++) {
    let c = k * NXY + col;
    state[T_OFF + c] = thc[k];
    state[QR_OFF + c] = qrc[k];
    state[NR_OFF + c] = nrBound(qrc[k], nrc[k], vg[VG_RC + k]);
    state[QI_OFF + c] = qic[k];
  }
  // Prąd zstępujący pod burzą rozwiązywaną (siatki ~1–4 km, gdzie siatka oddaje go tylko częściowo; wymiana zachowawcza jak
  // w schemacie Emanuela): pod deszczem część dolnych ~500 m zastępuje powietrze z poziomu minimum θe (1–4 km nad gruntem),
  // sprowadzone wzdłuż wilgotnej adiabaty (nasycone parowaniem deszczu) – zimne i ubogie w energię; wypchnięte powietrze z dołu
  // trafia na ten poziom (masa), woda do nasycenia z deszczu w kolumnie. Tempo rośnie z natężeniem (pełne od 20 mm/h, τ 20 min).
  // Bez tego po burzy zostawało powietrze ledwie ~1 K chłodniejsze i CAPE odbudowywało się w 2–3 h („brak dziury po burzy”).
  let rrs = acc / dt * 3600.0;
  // (od ~0.5 km oczka, pełny od 0.75 km: przy 1 km prąd zstępujący z siatki to opadające powietrze samej burzy – pod rdzeniem
  // 97 mm/h ciepłe o 1–3 K i wilgotne, przy gruncie tylko ~0.5 K chłodniej niż otoczenie)
  let wDD = smoothstep(250.0, 750.0, DX) * (1.0 - smoothstep(4000.0, 8000.0, DX));
  if (wDD > 0.0 && rrs > 1.0) {
    let zg = zgC(col);
    var kmn = kb;
    var temn = 1e9;
    var qmn = 0.0;
    for (var k = kb; k < NZ; k++) {
      let za = vg[VG_ZC + k] - zg;
      if (za < 1000.0) { continue; }
      if (za > 4000.0) { break; }
      // źródło: powietrze środkowej troposfery z otoczenia burzy (pierścień 2–3 oczka), wciągane w strefę opadu – nie wnętrze
      // chmury w tej kolumnie (tam θe jak w prądzie wstępującym: burze 1 km – θe kolumny ~332 K, otoczenia ~318 K na 3 km)
      var th = 0.0;
      var qq = 0.0;
      for (var r = 0; r < 8; r++) {
        let o = entOff(r);
        let cn = cidx(ci + o.x, cj + o.y, k);
        th += tmp[T_OFF + cn];
        qq += max(tmp[QV_OFF + cn], 0.0);
      }
      th = vg[VG_TC + k] + 0.125 * th;
      qq *= 0.125;
      let te = th * exp(LV * qq / (CP * th * vg[VG_EXC + k]));
      if (te < temn) { temn = te; kmn = k; qmn = qq; }
    }
    if (kmn > kb && temn < 1e8) {
      // τ 10 min przy ≥ 20 mm/h (było 20 min – burza przechodzi nad oczkiem w 10–15 min i kopuła ledwie powstawała)
      let f = wDD * min(rrs / 20.0, 1.0) * dt / 600.0;
      // deszcz dostępny pod poziomem źródła [kg/m²]
      var rain = 0.0;
      for (var k = kb; k < kmn; k++) { rain += mlay(k, kb, col) * state[QR_OFF + k * NXY + col]; }
      var mbl = 0.0;
      var thb = 0.0;
      var qb = 0.0;
      var need = 0.0;
      var tdd: array<f32, 8>;
      var qdd: array<f32, 8>;
      var nb = 0u;
      for (var k = kb; k < NZ; k++) {
        if (vg[VG_ZC + k] - zg > 500.0 || nb >= 8u) { break; }
        let c = k * NXY + col;
        let pk = vg[VG_EXC + k];
        let pr = vg[VG_PRS + k];
        // temperatura na wilgotnej adiabacie θe = θe_min przy ciśnieniu poziomu (Newton)
        var tt = (vg[VG_TC + k] + state[T_OFF + c]) * pk;
        for (var it = 0; it < 6; it++) {
          let qs = qsat(tt, pr);
          let fe = tt / pk * exp(LV * qs / (CP * tt)) - temn;
          let qs2 = qsat(tt + 0.1, pr);
          let d = ((tt + 0.1) / pk * exp(LV * qs2 / (CP * (tt + 0.1))) - (fe + temn)) / 0.1;
          tt -= fe / max(d, 1e-3);
        }
        tdd[nb] = tt;
        qdd[nb] = qsat(tt, pr);
        let m = mlay(k, kb, col);
        mbl += m;
        thb += m * state[T_OFF + c];
        qb += m * max(state[QV_OFF + c], 0.0);
        need += m * max(qdd[nb] - qmn, 0.0);
        nb++;
      }
      // ograniczenie: woda do nasycenia prądu tylko z dostępnego deszczu
      let fr = min(f, 0.5 * rain / max(need, 1e-9));
      if (fr > 0.0 && mbl > 0.0) {
        var i = 0u;
        for (var k = kb; k < kb + nb; k++) {
          let c = k * NXY + col;
          let pk = vg[VG_EXC + k];
          let thdd = tdd[i] / pk - vg[VG_TC + k];
          if (thdd < state[T_OFF + c]) {
            state[T_OFF + c] += fr * (thdd - state[T_OFF + c]);
            state[QV_OFF + c] += fr * (qdd[i] - max(state[QV_OFF + c], 0.0));
          }
          i++;
        }
        // powietrze wypchnięte z dołu na poziom źródła (masa i energia)
        let cm = kmn * NXY + col;
        let mm = vg[VG_RC + kmn] * vg[VG_DZC + kmn];
        let a = min(fr * mbl / mm, 0.5);
        state[T_OFF + cm] += a * (thb / mbl - state[T_OFF + cm]);
        state[QV_OFF + cm] += a * (qb / mbl - max(state[QV_OFF + cm], 0.0));
        // woda zużyta na nasycenie prądu – z deszczu pod poziomem źródła (proporcjonalnie), liczba kropel w tej samej proporcji
        let used = fr * need;
        let sc = max(1.0 - used / max(rain, 1e-9), 0.0);
        for (var k = kb; k < kmn; k++) {
          let c = k * NXY + col;
          state[QR_OFF + c] *= sc;
          state[NR_OFF + c] *= sc;
        }
      }
    }
  }
  // opad przy gruncie: śnieg, gdy w najniższej warstwie poniżej ~1 °C
  let tb = tPhase(col, kb, thc[kb], thc[kb + 1u]);
  let fsnow = clamp((TFRZ + 1.0 - tb) / 2.0, 0.0, 1.0);
  let tot = PR_SCALE * (acc + acci);
  sfc[sf(S_PR, col)] = tot / dt * 3600.0;                // [mm/h]
  sfc[sf(S_PSN, col)] = PR_SCALE * (fsnow * acc + acci) / dt * 3600.0;
  addPacc(col, tot, PR_SCALE * (fsnow * acc + acci));   // [mm]
  sfc[sf(S_EVR, col)] = evr;
  // skalary pod gruntem = wartości z pierwszej komórki nad gruntem
  for (var k = 0u; k < kb; k++) {
    let c = k * NXY + col;
    let b = kb * NXY + col;
    state[T_OFF + c] = state[T_OFF + b] - tgAt(0u, b, P.ta1) + tgAt(0u, c, P.ta1);
    state[QV_OFF + c] = max(state[QV_OFF + b] - tgAt(1u, b, P.ta1) + tgAt(1u, c, P.ta1), 0.0);
    state[QC_OFF + c] = state[QC_OFF + b];
    state[QI_OFF + c] = state[QI_OFF + b];
    state[QR_OFF + c] = state[QR_OFF + b];
    state[NR_OFF + c] = state[NR_OFF + b];
  }
}

// ======================= Korekta masy wilgoci =======================
// Adwekcja semi-lagrangeowska nie zachowuje masy dokładnie. Po adwekcji skalujemy q_v, q_c, q_r tak,
// żeby całkowita masa każdego składnika w domenie była taka sama jak przed adwekcją
// (globalna korekta masy, jak w modelach operacyjnych).
var<workgroup> red6: array<array<f32, 256>, 8>;

@compute @workgroup_size(WG)
fn mass_sum(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32,
            @builtin(workgroup_id) wid: vec3u) {
  let id = gid.x;
  for (var q = 0u; q < 8u; q++) { red6[q][li] = 0.0; }
  if (id < N) {
    let k = id / NXY;
    let kbm = kbAt(i32(id % NX), i32((id / NX) % NY));
    if (k >= kbm) {
      let m = mlay(k, kbm, id % NXY);
      for (var q = 0u; q < 4u; q++) {
        red6[q][li] = m * state[QV_OFF + q * N + id];
        red6[q + 4u][li] = m * tmp[QV_OFF + q * N + id];
      }
    }
  }
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { for (var q = 0u; q < 8u; q++) { red6[q][li] += red6[q][li + s]; } }
    workgroupBarrier();
  }
  if (li == 0u) { for (var q = 0u; q < 8u; q++) { work[W_MPART + q * NPART + wid.x] = red6[q][0]; } }
}

@compute @workgroup_size(WG)
fn mass_scale(@builtin(local_invocation_index) li: u32) {
  for (var q = 0u; q < 4u; q++) {
    var a = 0.0;
    var b = 0.0;
    for (var p = li; p < NPART; p += WG) {
      a += work[W_MPART + q * NPART + p];
      b += work[W_MPART + (q + 4u) * NPART + p];
    }
    let sa = wg_sum(li, a);
    let sb = wg_sum(li, b);
    if (li == 0u) { work[W_MSC + q] = select(1.0, sa / sb, sb > 1e-12 && sa > 1e-12); }
  }
}

@compute @workgroup_size(WG)
fn mass_apply(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let id = lin_id(gid, nwg);
  if (id >= 4u * N) { return; }
  let q = id / N;
  var v = tmp[QV_OFF + id] * work[W_MSC + q];
  if (q == 0u) { v = max(v + work[W_R + id], 0.0); }
  tmp[QV_OFF + id] = v;
}

// ======================= Konwekcja parametryzowana =======================
// Schemat strumienia masy w duchu Kain–Fritsch / Tiedtke (uproszczony, jedna kolumna), zależny od skali:
//  • cząstka z warstwy wymieszanej (dolne 500 m); wyzwalanie z zaburzeniem temperatury od wznoszenia na
//    siatce (zbieżność, fronty: ΔT = 4.64·w^(1/3), jak w KF) i od strumienia ciepła z gruntu (termiki);
//  • wciąganie otoczenia do chmury (ε = 0.1/km, mieszanie energii statycznej wilgotnej) – mniejsza,
//    realistyczna energia cząstki;
//  • głęboka (W_CU, siatki ≥ 2 km; wierzchołek > ~3 km nad podstawą): warstwa chmurowa ogrzewa się w stronę
//    profilu cząstki (domknięcie CAPE, τ = 40 min), woda z warstwy zasilającej; wydajność opadowa 30–90%
//    zależna od wilgotności środkowej troposfery – reszta detrainuje (para w górnej części chmury
//    i kondensat w kowadle); prądy zstępujące: odparowanie opadu w warstwie podchmurowej (zimne
//    wypływy); opad rozkładany na otoczenie (cu_spread);
//  • płytka (W_SH, siatki ≥ ~0.5 km; cumulusy do ~3 km, tylko przy grzaniu od gruntu): bez opadu –
//    przenosi parę z warstwy przy gruncie do warstwy chmurowej (τ = 1 h); ogranicza parność przy gruncie.
const TAU_CU: f32 = 1200.0;
const TAU_SH: f32 = 3600.0;
// ---- Wyzwalanie i domknięcie konwekcji głębokiej (Grandpeix–Lafore 2010, Rio i in. 2009, Kain–Fritsch) ----
// energia unoszenia ALE [J/kg] z termików warstwy granicznej i frontów podmuchowych kopuł; konwekcja rusza, gdy ALE > |CIN|;
// moc unoszenia ALP [W/m²] daje strumień masy u podstawy M_b = ALP/(2·w_b² + |CIN|)
const KSTAR: f32 = 0.33;            // C* = k*·√(2·WAPE) – prędkość rozlewania kopuły
const WK_FULL: f32 = 25.0;          // WAPE [J/kg], przy którym kopuła pokrywa całe oczko
const WK_H: f32 = 1200.0;           // głębokość kopuły [m]
const WB2: f32 = 2.0;               // 2·w_b² (w_b = 1 m/s – prędkość u podstawy chmury)
// ---- Losowanie chmur (Plant–Craig 2008) i skalowanie z udziałem prądu wstępującego (Arakawa–Wu 2011, Grell–Freitas 2014) ----
const M_CLD: f32 = 2e7;             // średni strumień masy jednej chmury u podstawy [kg/s]
const T_LIFE: f32 = 2700.0;         // czas życia chmury [s]
const W_UP: f32 = 3.0;              // prędkość prądu wstępującego u podstawy do udziału σ_u = M/(ρ·w_u)
fn rand01(x: u32) -> f32 { return (f32(hash(x) >> 8u) + 0.5) / 16777216.0; }
const ENTR: f32 = 1.0e-4;
// skala odczytu opadu przy gruncie (natężenie, sumy, śnieg); 1.0 – pełny bilans wody (0.8 gubiło 20% opadu)
const PR_SCALE: f32 = 1.0;

// Parametry burzowe kolumny: ścinanie 0–6 km (wektor) i 0–1 km, SRH 0–3 i 0–1 km względem ruchu prawej
// superkomórki wg Bunkersa (średni wiatr 0–6 km + 7.5 m/s prostopadle w prawo od ścinania)
// (wiatr z bufora tmp – pole po rzucie ciśnienia z poprzedniego kroku, jak w1 w schemacie konwekcji)
fn stormParams(i: i32, j: i32, col: u32, kb: u32) {
  let zg = zgC(col);
  var u0 = 0.0; var v0 = 0.0; var u1 = 0.0; var v1 = 0.0; var u6 = 0.0; var v6 = 0.0;
  var um = 0.0; var vm = 0.0; var hm = 0.0;
  var cwu = 0.0; var cwv = 0.0; var cwh = 0.0;
  var cmu = 0.0; var cmv = 0.0; var cmw = 0.0;
  let culM = sfc[sf(S_CULS, col)];
  let cubM = sfc[sf(S_CUBS, col)];
  let cutM = sfc[sf(S_CUTS, col)];
  var got1 = false; var got6 = false;
  for (var k = kb; k < NZ; k++) {
    let za = vg[VG_ZC + k] - zg;
    let uc = 0.5 * (tmp[U_OFF + cidx(i, j, k)] + tmp[U_OFF + cidx(i + 1, j, k)]);
    let vc = 0.5 * (tmp[V_OFF + cidx(i, j, k)] + tmp[V_OFF + cidx(i, j + 1, k)]);
    if (k == kb) { u0 = uc; v0 = vc; }
    if (!got1 && za >= 1000.0) { u1 = uc; v1 = vc; got1 = true; }
    if (za <= 6000.0) { um += uc * vg[VG_DZC + k]; vm += vc * vg[VG_DZC + k]; hm += vg[VG_DZC + k]; }
    if (za >= 800.0 && za <= 2000.0) { cwu += uc * vg[VG_DZC + k]; cwv += vc * vg[VG_DZC + k]; cwh += vg[VG_DZC + k]; }
    // piętro średnie (jak w CLM): wiatr ważony wodą chmur w warstwie – liczoną wprost i chmury schematu rozłożonej między podstawą a wierzchołkiem [kg/m²]
    if (za >= 2000.0 && za <= 6000.0) {
      let c = k * NXY + col;
      var wq = vg[VG_RC + k] * vg[VG_DZC + k] * (max(state[QC_OFF + c], 0.0) + max(state[QI_OFF + c], 0.0));
      if (cutM > cubM + 300.0 && vg[VG_ZC + k] > cubM && vg[VG_ZC + k] < cutM) { wq += 1e-3 * culM * vg[VG_DZC + k] / (cutM - cubM); }
      cmu += wq * uc;
      cmv += wq * vc;
      cmw += wq;
    }
    if (!got6 && za >= 6000.0) { u6 = uc; v6 = vc; got6 = true; break; }
  }
  if (!got6 || hm <= 0.0) { return; }
  let su = u6 - u0;
  let sv = v6 - v0;
  let sm = max(length(vec2f(su, sv)), 0.1);
  let cu = um / hm + 7.5 * sv / sm;
  let cv = vm / hm - 7.5 * su / sm;
  var h3 = 0.0;
  var h1 = 0.0;
  var pu = u0 - cu;
  var pv = v0 - cv;
  for (var k = kb + 1u; k < NZ; k++) {
    let za = vg[VG_ZC + k] - zg;
    if (za > 3000.0) { break; }
    let qu = 0.5 * (tmp[U_OFF + cidx(i, j, k)] + tmp[U_OFF + cidx(i + 1, j, k)]) - cu;
    let qv = 0.5 * (tmp[V_OFF + cidx(i, j, k)] + tmp[V_OFF + cidx(i, j + 1, k)]) - cv;
    let d = qu * pv - pu * qv;
    h3 += d;
    if (za <= 1000.0) { h1 += d; }
    pu = qu;
    pv = qv;
  }
  sfc[sf(S_SHU, col)] = su;
  sfc[sf(S_SHV, col)] = sv;
  sfc[sf(S_SHR01, col)] = length(vec2f(u1 - u0, v1 - v0));
  sfc[sf(S_SRH03, col)] = h3;
  sfc[sf(S_SRH01, col)] = h1;
  sfc[sf(S_MWU, col)] = um / hm;                 // średni wiatr 0–6 km (ruch burz)
  // wiatr warstwy cumulusów (0.8–2 km nad gruntem, wygładzony w czasie ~10 min) – pojedyncze cumulusy w 3D i na satelicie płyną
  // z nim w każdym miejscu (wcześniej jeden wektor z profilu dużej skali dla całej mapy)
  if (cwh > 0.0) {
    let ac = min(P.dt / 600.0, 1.0);
    sfc[sf(S_CWU, col)] += ac * (cwu / cwh - sfc[sf(S_CWU, col)]);
    sfc[sf(S_CWV, col)] += ac * (cwv / cwh - sfc[sf(S_CWV, col)]);
  }
  sfc[sf(S_MWV, col)] = vm / hm;
  // wiatr na wysokości chmur piętra średniego (wygładzony ~10 min); bez takich chmur w kolumnie – średni 0–6 km. Wcześniej wzór tych chmur płynął ze średnim wiatrem 0–6 km, a nie z wiatrem swojej warstwy
  let acM = min(P.dt / 600.0, 1.0);
  sfc[sf(S_CMU, col)] += acM * (select(um / hm, cmu / max(cmw, 1e-12), cmw > 1e-5) - sfc[sf(S_CMU, col)]);
  sfc[sf(S_CMV, col)] += acM * (select(vm / hm, cmv / max(cmw, 1e-12), cmw > 1e-5) - sfc[sf(S_CMV, col)]);
}

// ---------- Konwekcja podniesiona i zimowa (wzór ECMWF: konwekcja środkowego piętra – Tiedtke 1989; domknięcie CAPE – Bechtold
// i in. 2008, 2014) ----------
// Dla chwiejności, której nie widzi cząstka z dolnych 500 m schematu głębokiego: podniesionej nad zimną, stałą warstwą przy gruncie
// (zima, noc, adwekcja ciepła nad frontem) albo słabej w chłodnej masie z lodowymi wierzchołkami (przelotny śnieg i krupa – zimą
// wystarcza kilkadziesiąt J/kg, chmury 1–3 km, prawie bez termików od gruntu). Cząstka z poziomu największej energii statycznej
// wilgotnej w dolnych 3 km, z wciąganiem; rusza przy wznoszeniu warstwy źródłowej (siatka albo LIFT) i jej wilgotności ≥ ~80%
// (jak IFS); domknięcie – usuwanie CAPE w ~1 h, × (1 − σ)² (σ – udział burzy o promieniu 1.2 km w oczku: na siatkach ≤ 2 km
// konwekcję liczy siatka). Zima, Polska, 4 km: MUCAPE ≥ 20 J/kg w 8% oczko·terminów, CAPE cząstki z dolnych 500 m w 0% z nich –
// schemat głęboki ani razu.
// Parowanie opadu schematu pod podstawą chmury (Kessler 1969, postać jak w IFS – Tiedtke 1993; opad na części σ = 5% oczka):
// E = σ·α₁·(RHc − RH)·q_s·(√(p/p_s)·F/(σ·α₃))^α₄; zwraca opad dochodzący do gruntu [kg/m²], para i ochłodzenie zostają w warstwach.
// Bez tego słaby opad konwekcji płytkiej i podniesionej spadał na grunt w całości, także spod podstawy na 2–2.5 km przez suchą warstwę
// graniczną (w rzeczywistości virga: przy 0.3 mm/h, RH 60%, 2 km paruje ~75%) – duże gładkie pola opadu 0.1–0.6 mm/h pod rzadkimi cumulusami
fn cuVirga(col: u32, kb: u32, kl: u32, pr0: f32) -> f32 {
  var fl = pr0 / P.dt;                                // strumień opadu [kg/m²/s]
  if (fl <= 0.0) { return 0.0; }
  let ps = vg[VG_PRS + kb];
  for (var kk = kl; kk > kb; kk--) {
    let k = kk - 1u;
    let c = k * NXY + col;
    let pk = vg[VG_PRS + k];
    let te = (vg[VG_TC + k] + state[T_OFF + c]) * vg[VG_EXC + k];
    let qs = qsat(te, pk);
    let def = max(0.9 * qs - max(state[QV_OFF + c], 0.0), 0.0);
    if (def <= 0.0) { continue; }
    let m = mlay(k, kb, col);
    let e = 0.05 * 5.44e-4 * def * pow(sqrt(pk / ps) * fl / (0.05 * 5.09e-3), 0.5777);
    let df = min(min(e * m, fl), 0.5 * def * m / P.dt);
    state[QV_OFF + c] += df * P.dt / m;
    state[T_OFF + c] -= LV * df * P.dt / (CP * m * vg[VG_EXC + k]);
    fl -= df;
    if (fl <= 0.0) { return 0.0; }
  }
  return fl * P.dt;
}
const TAU_MID: f32 = 3600.0;
fn cuMid(col: u32, kb: u32, zg: f32, ks: u32, capes: f32) -> bool {
  var hmx = -1.0;
  var ke = kb;
  for (var k = kb; k < NZ; k++) {
    if (vg[VG_ZC + k] - zg > 3000.0) { break; }
    let c = k * NXY + col;
    let h = CP * (vg[VG_TC + k] + state[T_OFF + c]) * vg[VG_EXC + k] + G * vg[VG_ZC + k] + LV * max(state[QV_OFF + c], 0.0);
    if (h > hmx) { hmx = h; ke = k; }
  }
  let ce = ke * NXY + col;
  var tp = (vg[VG_TC + ke] + state[T_OFF + ce]) * vg[VG_EXC + ke];
  var qp = max(state[QV_OFF + ce], 0.0);
  let rhe = qp / qsat(tp, vg[VG_PRS + ke]);
  // wznoszenie warstwy źródłowej: na siatce (pole po rzucie ciśnienia) albo mezoskalowe / dużej skali (LIFT – całka ~3 h)
  let we = 0.5 * (tmp[W_OFF + ce] + tmp[W_OFF + ce + NXY]);
  let lift = max(smoothstep(0.0, 0.05, we), smoothstep(0.0, 150.0, sfc[sf(S_LIFT, col)]));
  if (rhe < 0.75 || lift <= 0.0) { return false; }
  var tpe: array<f32, NZ>;
  var sat = false;
  var kl = NZ;
  var kt = 0u;
  var cape = 0.0;
  var cin = 0.0;
  var lfc = false;
  for (var k = ke + 1u; k < NZ; k++) {
    let dz = vg[VG_ZC + k] - vg[VG_ZC + k - 1u];
    let p = vg[VG_PRS + k];
    let c = k * NXY + col;
    let te = (vg[VG_TC + k] + state[T_OFF + c]) * vg[VG_EXC + k];
    let qe = max(state[QV_OFF + c], 0.0);
    if (!sat) {
      tp -= G / CP * dz;
      if (qp >= qsat(tp, p)) { sat = true; kl = k; }
    } else {
      for (var s = 0; s < 2; s++) {
        let qs = qsat(tp, p);
        tp -= 0.5 * dz * G * (1.0 + LV * qs / (RD * tp)) / (CP + LV * LV * qs * 0.622 / (RD * tp * tp));
      }
      let hm = CP * tp + LV * qsat(tp, p) + ENTR * dz * (CP * te + LV * qe - CP * tp - LV * qsat(tp, p));
      for (var s = 0; s < 2; s++) {
        let qs = qsat(tp, p);
        tp -= (CP * tp + LV * qs - hm) / (CP + LV * qs * 4098.17 / ((tp - 35.86) * (tp - 35.86)));
      }
      qp = qsat(tp, p);
    }
    tpe[k] = tp;
    let b = (tp * (1.0 + 0.61 * qp) - te * (1.0 + 0.61 * qe)) / te;
    if (sat && b > 0.0) { cape += G * b * dz; kt = k; lfc = true; }
    else if (!lfc && b < 0.0) { cin += G * b * dz; }
    if (lfc && b < -0.01) { break; }
    if (tp < 190.0) { break; }
  }
  if (!lfc || kt <= kl || kl >= NZ) { return false; }
  let zb = vg[VG_ZC + kl];
  let depth = vg[VG_ZC + kt] - zb;
  let ttop = (vg[VG_TC + kt] + state[T_OFF + kt * NXY + col]) * vg[VG_EXC + kt];
  let tbas = (vg[VG_TC + kl] + state[T_OFF + kl * NXY + col]) * vg[VG_EXC + kl];
  // lodowy wierzchołek (< −15…−25 °C): niższe progi – kryształki lodu dają opad już ze słabej, płytkiej chmury
  let icy = 1.0 - smoothstep(248.15, 258.15, ttop);
  // tylko tam, gdzie nie działa schemat z cząstką z dolnych 500 m: chwiejność podniesiona (źródło nad warstwą zasilającą albo ta
  // cząstka stała) albo chłodna masa (podstawa < ~+3 °C) z lodowym wierzchołkiem
  let cold = icy * (1.0 - smoothstep(274.15, 280.15, tbas));
  if (!(ke > ks || capes < 10.0) && cold <= 0.0) { return false; }
  let act = smoothstep(mix(50.0, 15.0, icy), mix(300.0, 80.0, icy), cape) * smoothstep(mix(2000.0, 1000.0, icy), mix(4000.0, 2000.0, icy), depth)
          * smoothstep(0.75, 0.9, rhe) * lift * smoothstep(-40.0, -10.0, cin);
  let sig = clamp(PI * 1200.0 * 1200.0 / (DX * DY), 0.0, 1.0);
  let fr = min(act * (1.0 - sig) * (1.0 - sig) * P.dt / TAU_MID, 0.5);
  if (fr <= 1e-6) { return false; }
  // ogrzewanie w chmurze w stronę profilu cząstki; woda z warstwy źródłowej (od warstwy pod źródłem do podstawy chmury)
  var heat = 0.0;
  for (var k = kl; k <= kt; k++) {
    let te = (vg[VG_TC + k] + state[T_OFF + k * NXY + col]) * vg[VG_EXC + k];
    heat += vg[VG_RC + k] * vg[VG_DZC + k] * CP * fr * max(tpe[k] - te, 0.0);
  }
  let k0 = max(ke, kb + 1u) - 1u;
  var sq = 0.0;
  for (var k = k0; k < kl; k++) { sq += mlay(k, kb, col) * max(state[QV_OFF + k * NXY + col], 0.0); }
  if (sq <= 0.0 || heat <= 0.0) { return false; }
  let pw = min(heat / LV, 0.2 * sq);
  let sc = pw * LV / heat;
  var rs = 0.0;
  for (var k = kl; k <= kt; k++) {
    let c = k * NXY + col;
    let te = (vg[VG_TC + k] + state[T_OFF + c]) * vg[VG_EXC + k];
    state[T_OFF + c] += sc * fr * max(tpe[k] - te, 0.0) / vg[VG_EXC + k];
    rs += min(state[QV_OFF + c] / qsat(te, vg[VG_PRS + k]), 1.0);
  }
  let dry = pw / sq;
  for (var k = k0; k < kl; k++) {
    let c = k * NXY + col;
    state[QV_OFF + c] = max(state[QV_OFF + c] * (1.0 - dry), 0.0);
  }
  // wydajność opadowa z wilgotności w chmurze (jak schemat głęboki); lodowy wierzchołek – co najmniej 70%
  let eff = max(clamp(0.45 + 0.5 * rs / f32(kt - kl + 1u), 0.45, 0.95), 0.7 * icy);
  let prc = eff * pw;
  // reszta wody: para w górnej połowie chmury (z ochłodzeniem), kondensat u wierzchołka (lód poniżej −20 °C)
  let det = pw - prc;
  let km = (kl + kt) / 2u;
  var mu = 0.0;
  for (var k = km; k <= kt; k++) { mu += vg[VG_RC + k] * vg[VG_DZC + k]; }
  for (var k = km; k <= kt; k++) {
    let c = k * NXY + col;
    let dq = 0.6 * det / mu;
    state[QV_OFF + c] += dq;
    state[T_OFF + c] -= LV * dq / (CP * vg[VG_EXC + k]);
  }
  let ka = max(kt, kl + 1u) - 1u;
  var ma = 0.0;
  for (var k = ka; k <= kt; k++) { ma += vg[VG_RC + k] * vg[VG_DZC + k]; }
  for (var k = ka; k <= kt; k++) {
    let c = k * NXY + col;
    let te = (vg[VG_TC + k] + state[T_OFF + c]) * vg[VG_EXC + k];
    if (te < 253.15) { state[QI_OFF + c] += 0.4 * det / ma; } else { state[QC_OFF + c] += 0.4 * det / ma; }
  }
  sfc[sf(S_PRK, col)] = 2.0;
  sfc[sf(S_PRCU, col)] = cuVirga(col, kb, kl, prc) / P.dt * 3600.0;
  // widoczne chmury (wieże w części oczka – 3D, satelita, zachmurzenie)
  sfc[sf(S_CUTOP, col)] = zb + depth;
  sfc[sf(S_CUBASE, col)] = zb;
  sfc[sf(S_CUL, col)] = clamp(act, 0.0, 1.0) * min(0.04 * depth, 300.0);
  return true;
}

@compute @workgroup_size(64)
fn cumulus(@builtin(global_invocation_id) gid: vec3u) {
  let col = gid.x;
  if (col >= NXY) { return; }
  let i = i32(col % NX);
  let j = i32(col / NX);
  let kb = kbAt(i, j);
  let zg = zgC(col);
  sfc[sf(S_CUTOP, col)] = 0.0;
  sfc[sf(S_CAPE, col)] = 0.0;
  stormParams(i, j, col, kb);
  sfc[sf(S_CUBASE, col)] = 0.0;
  sfc[sf(S_PRCU, col)] = 0.0;
  sfc[sf(S_PRK, col)] = 0.0;
  sfc[sf(S_CUL, col)] = 0.0;
  sfc[sf(S_WKSRC, col)] = 0.0;
  sfc[sf(S_SHACT, col)] = 0.0;

  // warstwa zasilająca: dolne ~500 m nad gruntem (średnia ważona masą)
  var mth = 0.0;
  var mq = 0.0;
  var mm = 0.0;
  var ks = kb;
  for (var k = kb; k < NZ; k++) {
    if (k > kb && vg[VG_ZC + k] - zg > 500.0) { break; }
    let c = k * NXY + col;
    let m = mlay(k, kb, col);
    mth += m * (vg[VG_TC + k] + state[T_OFF + c]);
    mq += m * max(state[QV_OFF + c], 0.0);
    mm += m;
    ks = k;
  }
  // zaburzenie wyzwalające: wznoszenie na siatce ~1 km nad gruntem i grzanie od gruntu. Wiatr pionowy z bufora tmp
  // (po adwekcji – pole z poprzedniego kroku po rzucie ciśnienia): w `state` jest tu jeszcze przed rzutem, z wyporem
  // bez kompensacji ciśnieniem (średnio −0.5 m/s, lokalnie ±4 m/s) – dawał przypadkowe „wznoszenia” i wyzwalanie wszędzie
  var w1 = 0.0;
  for (var k = kb + 1u; k < NZ; k++) {
    if (vg[VG_ZW + k] - zg >= 1000.0) { w1 = tmp[W_OFF + k * NXY + col]; break; }
  }
  sfc[sf(S_W1, col)] = w1;                       // do pola wymuszenia (LIFT, org_update)
  let hs = sfc[sf(S_H, col)];
  // Kain–Fritsch: zaburzenie temperatury cząstki z wznoszenia na siatce, przeskalowanego do oczka 25 km (w·Δx/25 km) –
  // na drobnych siatkach to samo w oznacza mniejsze wymuszenie (konwekcję robi tam sama siatka); termiki – przez ALE_bl niżej
  let wkf = w1 * min(DX / 25000.0, 1.0);
  let dtrig = min(4.64 * pow(max(wkf - 0.02, 0.0), 1.0 / 3.0), 3.0);

  // cząstka: połowa zaburzenia wchodzi w jej temperaturę (profil ogrzewania), cała – w sprawdzenie CIN
  var tp = mth / mm * vg[VG_EXC + ks] + 0.5 * dtrig;
  var qp = mq / mm;
  var pert = 0.5 * dtrig;
  var tpar: array<f32, NZ>;
  var sat = false;
  var klcl = NZ;
  var kel = 0u;
  var ktop = 0u;
  var cape = 0.0;
  var cin = 0.0;
  var lfc = false;
  // CAPE standardowe (mapa, sonda, grad): ta sama cząstka z warstwy 0–500 m bez wciągania i bez zaburzenia,
  // suma dodatniej wyporności nad poziomem kondensacji – jak w sondażach (MLCAPE); wersja z wciąganiem tylko w schemacie
  var tps = mth / mm * vg[VG_EXC + ks];
  let qps = mq / mm;
  var sats = false;
  var capes = 0.0;
  // (cząstka rozpręża się do ciśnienia otoczenia: między tymi samymi poziomami ciśnienia jej droga to dz·T_cząstki/T_otoczenia. Bez tego CAPE mapy ~15% za duże wobec adiabaty w układzie ciśnienia, sekcja 13)
  var tep = (vg[VG_TC + ks] + state[T_OFF + ks * NXY + col]) * vg[VG_EXC + ks];
  for (var k = ks + 1u; k < NZ; k++) {
    let dz = vg[VG_ZC + k] - vg[VG_ZC + k - 1u];
    let dzp = dz * tps / tep;
    let p = vg[VG_PRS + k];
    if (!sats) {
      tps -= G / CP * dzp;
      if (qps >= qsat(tps, p)) { sats = true; }
    } else {
      for (var s = 0; s < 2; s++) {
        let qs = qsat(tps, p);
        tps -= 0.5 * dzp * G * (1.0 + LV * qs / (RD * tps)) / (CP + LV * LV * qs * 0.622 / (RD * tps * tps));
      }
    }
    if (tps < 190.0) { break; }
    let c = k * NXY + col;
    let te = (vg[VG_TC + k] + state[T_OFF + c]) * vg[VG_EXC + k];
    let qe = max(state[QV_OFF + c], 0.0);
    let b = (tps * (1.0 + 0.61 * select(qps, qsat(tps, p), sats)) - te * (1.0 + 0.61 * qe)) / te;
    if (sats && b > 0.0) { capes += G * b * dz; }
    tep = te;
  }
  for (var k = ks + 1u; k < NZ; k++) {
    let dz = vg[VG_ZC + k] - vg[VG_ZC + k - 1u];
    let p = vg[VG_PRS + k];
    let c = k * NXY + col;
    let te = (vg[VG_TC + k] + state[T_OFF + c]) * vg[VG_EXC + k];
    let qe = max(state[QV_OFF + c], 0.0);
    if (!sat) {
      tp -= G / CP * dz;
      if (qp >= qsat(tp, p)) { sat = true; klcl = k; }
    } else {
      for (var s = 0; s < 2; s++) {
        let qs = qsat(tp, p);
        tp -= 0.5 * dz * G * (1.0 + LV * qs / (RD * tp)) / (CP + LV * LV * qs * 0.622 / (RD * tp * tp));
      }
      // wciąganie otoczenia: mieszanie energii statycznej wilgotnej, cząstka pozostaje nasycona
      let hm = CP * tp + LV * qsat(tp, p) + ENTR * dz * (CP * te + LV * qe - CP * tp - LV * qsat(tp, p));
      for (var s = 0; s < 2; s++) {
        let qs = qsat(tp, p);
        tp -= (CP * tp + LV * qs - hm) / (CP + LV * qs * 4098.17 / ((tp - 35.86) * (tp - 35.86)));
      }
      qp = qsat(tp, p);
      pert *= exp(-dz / 1500.0);
    }
    tpar[k] = tp;
    let b = (tp * (1.0 + 0.61 * qp) - te * (1.0 + 0.61 * qe)) / te;
    if (sat && b > 0.0) { cape += G * b * dz; kel = k; lfc = true; }
    else if (!lfc) {
      let bt = ((tp + pert) * (1.0 + 0.61 * qp) - te * (1.0 + 0.61 * qe)) / te;
      if (bt < 0.0) { cin += G * bt * dz; }
    }
    // wierzchołek chmury płytkiej: pierwszy poziom nad podstawą, gdzie cząstka jest > 1 K chłodniejsza
    if (sat && ktop == 0u && tp + pert < te - 1.0) { ktop = k; }
    if (lfc && b < -0.01) { break; }
    if (tp < 190.0) { break; }
  }
  sfc[sf(S_CAPE, col)] = capes;
  // MUCAPE: cząstka najbardziej chwiejna (największa energia statyczna wilgotna) z dolnych 3 km, bez
  // wciągania – nocą i nad zimną warstwą przy gruncie burze rosną z wyższej, wilgotnej warstwy (CAPE
  // z gruntu bliskie zera, a konwekcja „podniesiona” działa)
  {
    var hmx = -1.0;
    var km = kb;
    for (var k = kb; k < NZ; k++) {
      if (vg[VG_ZC + k] - zg > 3000.0) { break; }
      let c = k * NXY + col;
      let h = CP * (vg[VG_TC + k] + state[T_OFF + c]) * vg[VG_EXC + k] + G * vg[VG_ZC + k] + LV * max(state[QV_OFF + c], 0.0);
      if (h > hmx) { hmx = h; km = k; }
    }
    var tq = (vg[VG_TC + km] + state[T_OFF + km * NXY + col]) * vg[VG_EXC + km];
    let qm = max(state[QV_OFF + km * NXY + col], 0.0);
    var qq = qm;
    var st = false;
    var mu = 0.0;
    var muTop = 0.0;
    var tem = tq;
    for (var k = km + 1u; k < NZ; k++) {
      let dz = vg[VG_ZC + k] - vg[VG_ZC + k - 1u];
      let dzp = dz * tq / tem;
      let p = vg[VG_PRS + k];
      if (!st) {
        tq -= G / CP * dzp;
        if (qq >= qsat(tq, p)) { st = true; }
      } else {
        for (var s = 0; s < 2; s++) {
          let qs = qsat(tq, p);
          tq -= 0.5 * dzp * G * (1.0 + LV * qs / (RD * tq)) / (CP + LV * LV * qs * 0.622 / (RD * tq * tq));
        }
        qq = qsat(tq, p);
      }
      let c = k * NXY + col;
      let te = (vg[VG_TC + k] + state[T_OFF + c]) * vg[VG_EXC + k];
      let b = (tq * (1.0 + 0.61 * qq) - te * (1.0 + 0.61 * max(state[QV_OFF + c], 0.0))) / te;
      if (st && b > 0.0) { mu += G * b * dz; muTop = vg[VG_ZC + k] - zg; }
      tem = te;
      if (tq < 190.0) { break; }
    }
    sfc[sf(S_MUCAPE, col)] = max(mu, capes);
    sfc[sf(S_MUEL, col)] = muTop;   // wierzchołek dodatniej wyporności cząstki MU nad gruntem (rodzaj chmur – convFlag)
  }
  if (klcl >= NZ) { sfc[sf(S_CUM, col)] *= exp(-5.0 * P.dt / T_LIFE); _ = cuMid(col, kb, zg, ks, capes); return; }
  let zb = vg[VG_ZC + klcl];

  // ---------- Wyzwalanie i domknięcie (Grandpeix–Lafore 2010; Rio i in. 2009; Kain–Fritsch; Plant–Craig 2008) ----------
  // Termiki warstwy granicznej: w* = (g/θ·H/(ρc_p)·z_i)^⅓, ALE_bl = ½·(1.8·w*)², ALP_bl = 0.1·ρ·w*³
  let rhob = vg[VG_RC + ks];
  let zi = max(sfc[sf(S_PBLH, col)], 300.0);
  let wst = pow(G / 300.0 * max(hs, 0.0) / (rhob * CP) * zi, 1.0 / 3.0);
  let aleBL = 0.5 * (1.8 * wst) * (1.8 * wst);
  // (moc termików do domknięcia w szarej strefie (≤ 5 km, zanika do 15 km): 0.015·ρ·w*³ – przy 0.1 w dni z CAPE schemat losował
  // chmury w ~⅓ oczek naraz: „wysypka” kropek opadu i niebo zakryte wieżami; domena 352 km / 4 km, lipiec; grube siatki – 0.1)
  let wGrey = 1.0 - smoothstep(5000.0, 15000.0, DX);
  let alpBL = mix(0.1, 0.015, wGrey) * rhob * wst * wst * wst;
  // Kopuła (zimny wypływ) w oczku: WAPE (pole org_update), udział σ_w; front podmuchowy podnosi powietrze przed kopułą:
  // ALE_wk = k*²·WAPE (silniej po stronie ścinania 0–6 km – teoria RKW: linie przesuwają się w stronę ścinania),
  // ALP_wk = ½·ρ·k*·C*³·h_w·L_g, L_g – długość frontu na jednostkę powierzchni (zero we wnętrzu kopuły)
  let wap = max(sfc[sf(select(S_ORG, S_ORGB, (P.step & 1u) == 1u), col)], 0.0);
  // (na dużych oczkach kopuła zajmuje najwyżej połowę oczka – GL: σ_w ~ 0.4–0.6 w oczku modelu klimatu)
  let sigw = clamp(wap / WK_FULL, 0.0, mix(1.0, 0.5, smoothstep(8000.0, 20000.0, DX)));
  let wwk = select(0.0, max(wap, WK_FULL), wap > 0.5);
  let cst = KSTAR * sqrt(2.0 * wwk);
  // kierunek frontu (na zewnątrz kopuły) względem ścinania
  let wE = sfc[sf(select(S_ORG, S_ORGB, (P.step & 1u) == 1u), cidx(i + 1, j, 0u))];
  let wW = sfc[sf(select(S_ORG, S_ORGB, (P.step & 1u) == 1u), cidx(i - 1, j, 0u))];
  let wN = sfc[sf(select(S_ORG, S_ORGB, (P.step & 1u) == 1u), cidx(i, j + 1, 0u))];
  let wS = sfc[sf(select(S_ORG, S_ORGB, (P.step & 1u) == 1u), cidx(i, j - 1, 0u))];
  let gw = vec2f(wE - wW, wN - wS);
  let shv = vec2f(sfc[sf(S_SHU, col)], sfc[sf(S_SHV, col)]);
  let s06c = length(shv);
  let fdir = select(1.0, 1.0 + 0.6 * dot(-gw / max(length(gw), 1e-6), shv / max(s06c, 0.1)) * smoothstep(5.0, 15.0, s06c), length(gw) > 0.5);
  let edge = sigw * (1.0 - sigw);
  let aleWK = KSTAR * KSTAR * wwk * fdir * smoothstep(0.0, 0.05, edge);
  let lg = 2.0 * sqrt(PI * edge) / DX;
  // (w szarej strefie bez ALP frontów podmuchowych: kopuły burz liczonych na siatce i ich fronty są tam w polu wiatru i temperatury,
  // nowe komórki na ich brzegu tworzy siatka; schemat dokładał wokół każdej burzy dziesiątki słabych chmur – „kropki” opadu)
  let alpWK = 0.5 * rhob * KSTAR * cst * cst * cst * WK_H * lg * fdir * (1.0 - wGrey);
  // wyzwolenie: max(ALE) > |CIN| (cząstka z zaburzeniem KF); albo – KF – wymuszone wznoszenie na siatce znosi CIN całkiem
  let acin = max(-cin, 0.0);
  let ale = max(aleBL, aleWK);
  let trigA = smoothstep(0.7, 1.3, ale / max(acin, 0.5));
  let trigK = smoothstep(0.0, 0.05, wkf - 0.02) * smoothstep(-5.0, -1.0, cin);
  // domknięcie: M_b = ALP/(2·w_b² + |CIN|); przy wymuszeniu dużej skali – strumień masy rzędu wznoszenia na siatce
  let mbA = trigA * (alpBL + alpWK) / (WB2 + acin);
  let mbK = trigK * 1.5 * rhob * max(wkf, 0.0);
  let mbMean = max(mbA, mbK);
  let trigBL = trigA * smoothstep(0.5, 1.0, aleBL / max(aleWK, 0.01));
  let trigWk = trigA * (1.0 - smoothstep(0.5, 1.0, aleBL / max(aleWK, 0.01)));
  // tryb organizacji (superkomórka: silniejszy prąd wstępujący) – ścinanie i SRH przy słabym wymuszeniu
  let wQc = smoothstep(10.0, 18.0, s06c) * smoothstep(5.0, 20.0, aleWK);
  let wSc = smoothstep(14.0, 22.0, s06c) * smoothstep(80.0, 200.0, sfc[sf(S_SRH03, col)]) * (1.0 - wQc);

  // ---------- konwekcja głęboka ----------
  // Chmury w oczku (Plant–Craig): średnia liczba ⟨N⟩ = M_b·A/⟨m⟩; nowe chmury losowo (strumień masy z rozkładu wykładniczego),
  // każda żyje ~45 min – na małych oczkach „albo jedna silna komórka, albo nic”, na dużych suma zbiega do średniej (M_b·A).
  // Pole CUM = łączny strumień masy chmur w oczku [kg/s].
  let area = DX * DY;
  let depth0 = select(0.0, vg[VG_ZC + kel] - zb, lfc && kel > klcl);
  let act = smoothstep(50.0, 300.0, cape) * smoothstep(2000.0, 4000.0, depth0) * (1.0 - sigw);
  // organizacja mezoskalowa: narodziny chmur tylko tam, gdzie powietrze się wznosi (LIFT – całka z ~3 h wznoszenia
  // mezoskalowego: linie zbieżności, stoki nawietrzne, wznoszenie dużej skali) i na frontach podmuchowych; bez wymuszenia
  // żadnych (losowanie po całej mapie dawało kropki opadu wszędzie, przy dużym CAPE także przy 5% i progu LIFT ~0; przy 15% ~250 przelotnych opadów naraz na 352 km)
  // (szara strefa ≤ 5 km; na grubych siatkach oczko to cały zespół chmur – bez skupiania, czynnik 1)
  // Czynnik frontów podmuchowych (×1.5 i pominięcie skupisk narodzin) w szarej strefie (pełne ≤ 10 km, zanika do 15 km) tylko dla kopuł ze schematu (ORGS, źródło WKSRC; ?wks=0 – dawniej dla wszystkich).
  // Kopuła z parowania opadu siatki (EVR) ma front w polu wiatru i temperatury i nowe komórki robi na nim sama siatka – schemat dokładał wokół takich burz kropki. Wyzwolenie, strumień masy i sama kopuła bez zmian
  let wapS = max(sfc[sf(select(S_ORGS, S_ORGSB, (P.step & 1u) == 1u), col)], 0.0);
  let trigWkB = trigWk * mix(1.0, clamp(wapS / max(wap, 0.5), 0.0, 1.0), WKS * (1.0 - smoothstep(10000.0, 15000.0, DX)));
  let gL0 = mix(1.0, mix(1.5 * smoothstep(50.0, 300.0, sfc[sf(S_LIFT, col)]), 1.5, trigWkB), wGrey);
  // Skupiska narodzin (?clu=0 – wyłączone; siatki ≤ ~15 km, pełne ≤ 5 km): chmury losowane niezależnie w każdym oczku dawały przy dużym CAPE równomierną
  // wysypkę jednakowych kropek – przy 7.5 km ~7% oczek na godzinę także bez wymuszenia (czynnik 1 − wGrey), a przy słabym wznoszeniu dużej skali
  // (LIFT 50–300 m) w oczkach ≤ 5 km też po całym obszarze. Prawdziwa konwekcja rodzi się w grupach na granicach mezoskalowych, których siatka nie widzi
  // (podobnie stochastyczny automat komórkowy, Bengtsson i in. 2013). Tu: gładkie pole ~80 km, 2 h, płynące z wiatrem ~3 km; ta sama średnia liczba narodzin
  // (średnia smoothstep ~0.25), ale tylko na ~¼ obszaru. Silne wymuszenie (LIFT ≥ 300–800 m) i fronty podmuchowe bez zmian – linie rodzą się, gdzie je wymusza przepływ
  var gC = 1.0;
  if (CLU > 0.0 && wGrey > 0.0 && act > 0.0) {
    let xc = f32(i) + 0.5;
    let yc = f32(j) + 0.5;
    let ua = parAt(7u, xc, yc) + 3000.0 * parAt(9u, xc, yc);
    let va = parAt(8u, xc, yc) + 3000.0 * parAt(10u, xc, yc);
    let pat = smoothstep(0.2, 0.9, flowNoise(xc, yc, max(8.0, 80000.0 / DX), 7200.0, 7001u, ua, va)) / 0.25;
    gC = mix(1.0, mix(pat, 1.0, smoothstep(300.0, 800.0, sfc[sf(S_LIFT, col)])), wGrey);
  }
  let gL = select(mix(gL0 * gC, gL0, trigWkB), gL0, gC == 1.0);
  let nMean = act * mbMean * gL * area / M_CLD;
  let pB = nMean * P.dt / T_LIFE;
  var cum = sfc[sf(S_CUM, col)] * exp(-P.dt / T_LIFE * (1.0 + 4.0 * (1.0 - act)));
  // Bez losowania (?lot=1 – dawne losowanie): zawsze średnia i bez zerowania słabych chmur niżej (średni strumień w oczku jest zwykle poniżej progu 5% typowej chmury). Przy losowaniu każda kropka opadu na oczkach 5–8 km
  // to jedna wylosowana chmura (użytkownik: bez narodzin kropki znikają; ze średnią kropek nie ma, komórki i CAPE podobne)
  if (pB >= 0.25 || LOT < 0.5) {
    cum += act * mbMean * gL * area * P.dt / T_LIFE;             // wiele chmur: średnia
  } else if (rand01((col * 2654435761u) ^ (P.step * 40503u)) < pB) {
    cum -= M_CLD * log(rand01(col * 97u + P.step * 2246822519u + 7u));   // nowa chmura
  }
  // wygasła chmura znika (szara strefa): poniżej 5% typowej chmury burzowej – wcześniej strumień malał wykładniczo przez
  // ~10 czasów życia (do 1e3 kg/s, ~7 h) i resztki „konwekcji” stały w 18% oczek z pełną wieżą do poziomu równowagi i opadem
  // ~0.05 mm/h (mediana) – kropki na radarze i las wież w 3D (352 km / 4 km, lipiec)
  if (LOT > 0.5 && cum < 0.05 * M_CLD * wGrey) { cum = 0.0; }
  sfc[sf(S_CUM, col)] = cum;
  // siła chmury w oczku względem typowej chmury burzowej (szara strefa; na grubych siatkach oczko to zespół chmur – 1)
  let msr = mix(1.0, cum / M_CLD, wGrey);
  // siatki od ~3 km (pełne od 6 km; ?ccl=10000 – dawniej od 10 km, pełne od 20 km). Przy 7.5 km schemat bez tego prawie nie działał: 1% opadu w najbardziej zalanych oczkach, burze „na oczku” stojące w miejscu
  // (zapis użytkownika, 14 dób: w dniach samej konwekcji oczka ≥ 50 mm 325 → 106, maks. 108 → 79 mm, CAPE dobowe 313 → 154 J/kg): oprócz ALP – domknięcie CAPE (Arakawa–Schubert / KF, jak w zespole domknięć
  // Grell–Freitas): CAPE usuwane w ~20 min (τ KF) wszędzie, gdzie cząstka z zaburzeniem KF ma CIN < ~20–60 J/kg. Tam siatka zdążyłaby
  // sama zrobić burzę „na oczku” (domena 4000 km, 25 km, samo ALP: maksima 250–340 mm w 3 doby, schemat 5–9% opadu)
  // Para z warstwy przy gruncie nad podstawę chmury przy bardzo dużym CAPE (?cuq=0 – bez): ogrzewanie w stronę cząstki z wciąganiem (niżej) prawie nie działa, gdy wyżej jest sucho –
  // cząstka z wciąganiem jest wtedy prawie tak zimna jak otoczenie. Pekin, lipiec, 15:00: Td2 26–27 °C, 18–19 g/kg przy gruncie, 0.6–3.5 g/kg na 3 km, CAPE 4900–5700 J/kg w ~200 oczkach przy CIN ≈ 0,
  // z wciąganiem 1300–1800. Tu nadwyżka CAPE ponad CUL przeliczona na parę (~600 J/kg na g/kg) odchodzi z τ 1 h do warstwy 0–3 km nad podstawą (bez przemiany fazy) – tak, jak wynosiłyby ją termiki i chmury
  if (CUQ > 0.0 && CUL > 0.0 && klcl > kb) {
    let tq = smoothstep(CUL, CUL + 1500.0, capes) * smoothstep(-60.0, -20.0, cin) * (1.0 - sigw);
    if (tq > 0.0) {
      let dq = CUQ * tq * min(max(capes - CUL, 0.0) / 6.0e5, 4.0e-3) * P.dt / 3600.0;
      var mb = 0.0;
      var wsum = 0.0;
      for (var k = kb; k < klcl; k++) {
        let c = k * NXY + col;
        let m = vg[VG_RC + k] * vg[VG_DZC + k] * select(1.0, vg[VG_HF + col], k == kb);
        let d = min(dq, 0.5 * max(state[QV_OFF + c], 0.0));
        state[QV_OFF + c] -= d;
        wsum += d * m;
        mb += m;
      }
      let zb0 = vg[VG_ZC + klcl];
      var mu = 0.0;
      for (var k = klcl; k < NZ; k++) { if (vg[VG_ZC + k] - zb0 > 3000.0) { break; } mu += vg[VG_RC + k] * vg[VG_DZC + k]; }
      for (var k = klcl; k < NZ; k++) { if (vg[VG_ZC + k] - zb0 > 3000.0) { break; } state[QV_OFF + k * NXY + col] += wsum / max(mu, 1.0); }
    }
  }
  let trigC = smoothstep(CCL, 2.0 * CCL, DX) * smoothstep(-60.0, -20.0, cin) * act;
  // Ograniczenie bardzo dużego CAPE (?cul=0 – bez; od CUL, pełne ~1500 J/kg wyżej; CAPE standardowe bez wciągania): strumień masy schematu zależy od termików, nie od CAPE, więc przy dużym CAPE usuwa go tyle samo co przy małym,
  // a chmura losowana jest tylko w części oczek. Użytkownik: CAPE często > 4500 J/kg także latem w napływie chłodniejszej masy, nadmierne opady dobowe (przebieg 4-letni: doby ≥ 50 mm 1.6× za często, ≥ 10 mm 0.7×). Tam, gdzie CIN jest mały,
  // profil dochodzi do cząstki z wciąganiem z τ ~2 h, para z warstwy podchmurowej. Bez opadu z tej drogi przy msr < 0.3 (siatki ≤ ~8 km; woda zostaje jako para i chmura u wierzchołka) – to mieszanie, nie nowa burza
  let trigH = select(0.0, smoothstep(CUL, CUL + 1500.0, capes) * smoothstep(-60.0, -20.0, cin) * (1.0 - sigw), CUL > 0.0);
  if (lfc && kel > klcl && (cum > 1e3 || trigC > 0.0 || trigH > 0.0)) {
    let depth = depth0;
    // udział prądu wstępującego w oczku σ_u = M/(ρ·w_u); tendencje schematu × (1 − σ_u)² (Arakawa–Wu; Grell–Freitas) –
    // przy oczkach 1–2 km jedna chmura wypełnia oczko i konwekcję liczy sama siatka, przy ≥ 10–25 km schemat w pełni
    let mAct = cum / area;
    // (co najmniej udział jednego prądu wstępującego burzy o promieniu ~1.2 km – Grell–Freitas: przy oczku 2 km schemat gaśnie
    // całkiem; wcześniej małe wylosowane chmury liczyły się w schemacie i dawały mżawkę w kropki)
    let sigu = clamp(max(mAct / (rhob * W_UP), PI * 1200.0 * 1200.0 / area), 0.0, 1.0);
    let scl = (1.0 - sigu) * (1.0 - sigu) * (1.0 - sigw);
    // tempo przystosowania z fizyki: ogrzewanie przez osiadanie wyrównawcze M/ρ·∂θ/∂z, przeliczone na zbliżanie profilu
    // do cząstki: fr = Δt·M·Γ_θ/(ρ̄·B̄), B̄ – średnia nadwyżka temperatury cząstki w chmurze
    var sb = 0.0;
    var smass = 0.0;
    for (var k = klcl; k <= kel; k++) {
      let te = (vg[VG_TC + k] + state[T_OFF + k * NXY + col]) * vg[VG_EXC + k];
      let m = vg[VG_RC + k] * vg[VG_DZC + k];
      sb += m * max(tpar[k] - te, 0.0);
      smass += m;
    }
    let gth = max((vg[VG_TC + kel] + state[T_OFF + kel * NXY + col] - vg[VG_TC + klcl] - state[T_OFF + klcl * NXY + col]) / depth, 2e-3);
    let bbar = max(sb / max(smass, 1.0), 0.3);
    let rhom = smass / depth;
    let fr = min(max(max(scl * P.dt * mAct * gth / (rhom * bbar) * (1.0 + 0.5 * wSc), trigC * (1.0 - sigu) * P.dt / CCT), trigH * (1.0 - sigu) * P.dt / 7200.0), 0.5);
    if (fr > 0.0) {
      var heat = 0.0;
      for (var k = klcl; k <= kel; k++) {
        let te = (vg[VG_TC + k] + state[T_OFF + k * NXY + col]) * vg[VG_EXC + k];
        heat += vg[VG_RC + k] * vg[VG_DZC + k] * CP * fr * max(tpar[k] - te, 0.0);
      }
      var sq = 0.0;
      var sm = 0.0;
      for (var k = kb; k < klcl; k++) {
        let m = mlay(k, kb, col);
        sq += m * max(state[QV_OFF + k * NXY + col], 0.0);
        sm += m;
      }
      if (sq > 0.0 && heat > 0.0) {
        let pw = min(heat / LV, 0.2 * sq);          // skondensowana woda [kg/m²]
        let sc = pw * LV / heat;
        for (var k = klcl; k <= kel; k++) {
          let c = k * NXY + col;
          let te = (vg[VG_TC + k] + state[T_OFF + c]) * vg[VG_EXC + k];
          state[T_OFF + c] += sc * fr * max(tpar[k] - te, 0.0) / vg[VG_EXC + k];
        }
        let dry = pw / sq;
        for (var k = kb; k < klcl; k++) {
          let c = k * NXY + col;
          state[QV_OFF + c] = max(state[QV_OFF + c] * (1.0 - dry), 0.0);
        }
        // wydajność opadowa z wilgotności środkowej troposfery (1–5 km nad podstawą)
        var rs = 0.0;
        var rn = 0.0;
        for (var k = klcl; k <= kel; k++) {
          let dzb = vg[VG_ZC + k] - zb;
          if (dzb < 1000.0 || dzb > 5000.0) { continue; }
          let c = k * NXY + col;
          let te = (vg[VG_TC + k] + state[T_OFF + c]) * vg[VG_EXC + k];
          rs += min(state[QV_OFF + c] / qsat(te, vg[VG_PRS + k]), 1.0);
          rn += 1.0;
        }
        // wydajność opadowa 45–95% (głęboka konwekcja w wilgotnym otoczeniu: 70–90%)
        // słaba chmura (mały strumień masy – rozcieńczona, płytsza) nie pada: opad od ~30% siły typowej chmury burzowej,
        // pełny od 80% (chmura średniej siły pada ~1 h); jej woda zostaje w atmosferze (para i chmura u wierzchołka)
        // Przy ciepłej podstawie (≥ ~+2…+6 °C) na oczkach ≤ 10 km (zanika do 15 km) opad dopiero od 80%, pełny od 150% siły typowej chmury (?rnt=0 – dawniej). Użytkownik: mnóstwo kropek opadu ~1 mm/h bez chmury
        // i bez nasycenia w sondażu – 74% losowań miało opad, a każda chmura słabnąc przechodziła przez słaby zakres ~45 min. Chmura dalej grzeje i osusza dół (zużywa CAPE); woda, która nie spadnie, zostaje jako para.
        // Zimna podstawa (przelotny śnieg, chłodne masy) i grube siatki (oczko to zespół chmur, siła 1) bez zmian
        let tbD = (vg[VG_TC + klcl] + state[T_OFF + klcl * NXY + col]) * vg[VG_EXC + klcl];
        let wRn = RNT * smoothstep(275.15, 279.15, tbD) * (1.0 - smoothstep(10000.0, 15000.0, DX));
        let sRain0 = mix(smoothstep(0.3, 0.8, msr), smoothstep(0.8, 1.5, cum / M_CLD), wRn);
        // tam, gdzie usuwanie CAPE działa na mniejszych oczkach, opad z niego zależy od usuwanego CAPE, a nie od siły pojedynczej chmury; słaba konwekcja tylko miesza (woda zostaje jako para) – inaczej pola słabego opadu
        let sRain = select(sRain0, max(sRain0, trigC * smoothstep(CCR, CCR + 500.0, capes)), CCL < 10000.0);
        let eff = clamp(0.45 + 0.5 * select(0.7, rs / rn, rn > 0.0), 0.45, 0.95) * sRain;
        var prc = eff * pw;
        // detrainment: 60% jako para w górnej połowie chmury (z ochłodzeniem – parowanie), 40% jako
        // kondensat u wierzchołka (kowadło: lód w zimnej warstwie)
        let det = pw - prc;
        // Kowadło tylko z chmury, która pada, i na jej prawdziwym wierzchołku (?anv=0 – dawniej: u każdej chmury 40% wody jako kondensat na poziomie równowagi). Słaba chmura nie pada, a jej widoczny wierzchołek jest
        // na ~30% głębokości – mimo to dostarczała lód poniżej −20 °C, który rysuje się na całe oczko od 0.02 g/kg (użytkownik: pseudokowadła w miejscach kropek bez burzy; ok. ⅓ lodu i ¼–½ kropek)
        // (ta sama waga co opad: chmura, która nie pada, oddaje wodę jako parę – inaczej po podniesieniu progu kowadeł byłoby ~4× więcej)
        let sAnv = select(1.0, sRain, ANV > 0.0);
        let depthA = select(depth, max(depth * mix(0.3, 1.0, sAnv), min(depth, 1500.0)), ANV > 0.0);
        var keA = kel;
        for (var k = klcl; k <= kel; k++) { if (vg[VG_ZC + k] - zb >= depthA) { keA = k; break; } }
        let kmid = (klcl + keA) / 2u;
        var mu = 0.0;
        for (var k = kmid; k <= keA; k++) { mu += vg[VG_RC + k] * vg[VG_DZC + k]; }
        for (var k = kmid; k <= keA; k++) {
          let c = k * NXY + col;
          let dq = (1.0 - 0.4 * sAnv) * det / mu;
          state[QV_OFF + c] += dq;
          state[T_OFF + c] -= LV * dq / (CP * vg[VG_EXC + k]);
        }
        let ka = max(keA, klcl + 1u) - 1u;
        var ma = 0.0;
        for (var k = ka; k <= keA; k++) { ma += vg[VG_RC + k] * vg[VG_DZC + k]; }
        for (var k = ka; k <= keA; k++) {
          let c = k * NXY + col;
          let te = (vg[VG_TC + k] + state[T_OFF + c]) * vg[VG_EXC + k];
          if (te < 253.15) { state[QI_OFF + c] += 0.4 * sAnv * det / ma; } else { state[QC_OFF + c] += 0.4 * sAnv * det / ma; }
        }
        // prądy zstępujące: odparowanie części opadu w warstwie podchmurowej (zimny wypływ)
        var def = 0.0;
        for (var k = kb; k < klcl; k++) {
          let c = k * NXY + col;
          let te = (vg[VG_TC + k] + state[T_OFF + c]) * vg[VG_EXC + k];
          def += mlay(k, kb, col) * max(qsat(te, vg[VG_PRS + k]) - state[QV_OFF + c], 0.0);
        }
        let ev = min(0.25 * prc, 0.5 * def);
        // źródło kopuły (WAPE) z parowania w prądzie zstępującym: g·L·E/(ρ·c_p·θ) [J/kg]
        sfc[sf(S_WKSRC, col)] = G * LV * max(ev, 0.0) / (rhob * CP * 300.0);
        if (def > 0.0 && ev > 0.0) {
          for (var k = kb; k < klcl; k++) {
            let c = k * NXY + col;
            let te = (vg[VG_TC + k] + state[T_OFF + c]) * vg[VG_EXC + k];
            let m = mlay(k, kb, col);
            let d = m * max(qsat(te, vg[VG_PRS + k]) - state[QV_OFF + c], 0.0) / def;   // udział warstwy
            state[QV_OFF + c] += ev * d / m;
            state[T_OFF + c] -= LV * ev * d / (m * CP * vg[VG_EXC + k]);
          }
          prc -= ev;
        }
        sfc[sf(S_PRK, col)] = 1.0;
        sfc[sf(S_PRCU, col)] = prc / P.dt * 3600.0;     // [mm/h] (wcześniej mm na krok – radar, grad, błyskawice ~60× za słabe)
        // widoczny wierzchołek: słaba chmura (rozcieńczona przez wciąganie) kończy się ~1.5–2 km nad podstawą (Cu mediocris,
        // congestus), do poziomu równowagi sięga tylko silna (od ~80% typowej chmury burzowej)
        let depthV = max(depth * mix(0.3, 1.0, smoothstep(0.3, 0.8, msr)), min(depth, 1500.0));
        sfc[sf(S_CUTOP, col)] = zb + depthV;
        sfc[sf(S_CUBASE, col)] = zb;
        // woda chmurowa wież (część oczka, ~0.5 g/m³ w chmurze) – widoczne chmury, cień i zachmurzenie
        sfc[sf(S_CUL, col)] = clamp(max(scl * mAct / 0.03, trigC), 0.0, 1.0) * min(0.04 * depthV, 300.0);
        return;
      }
    }
  }

  // konwekcja podniesiona i zimowa (wzór ECMWF) – gdy schemat głęboki nie działa
  if (cuMid(col, kb, zg, ks, capes)) { return; }

  // ---------- konwekcja płytka (cumulusy przy grzaniu od gruntu) ----------
  let kt = select(ktop, kel, ktop == 0u && lfc);
  // termiki muszą sięgać poziomu kondensacji: wierzchołek warstwy granicznej (z przestrzeleniem ~20% + 100 m) na wysokości
  // podstawy chmur. Wcześniej wystarczało grzanie od gruntu i CIN > −40 J/kg – cumulusy (i nawilżanie warstwy nad nimi)
  // powstawały każdego słonecznego dnia, także przy suchej warstwie granicznej pod inwersją (brak dni bezchmurnych latem)
  let pblh = sfc[sf(S_PBLH, col)];
  let reachCu = select(1.0, 1.0 - smoothstep(-100.0, 0.2 * pblh + 100.0, zb - zg - pblh), W_PBL > 0.0);
  if (W_SH > 0.0 && kt > klcl && hs > 10.0 && cin > -40.0 && reachCu > 0.0) {
    let dsh = vg[VG_ZC + kt] - zb;
    if (dsh > 150.0 && dsh < 3500.0) {
      // cumulusy płytkie widoczne (pokrycie rośnie z grzaniem od gruntu): woda chmurowa ułamka oczka
      let fcu = W_SH * clamp(hs / 150.0, 0.0, 1.0) * reachCu;
      sfc[sf(S_CUL, col)] = fcu * min(0.03 * dsh, 60.0);
      // konwekcja płytka przenosi parę z warstwy podchmurowej – K-profil może się zatrzymać na podstawie chmur (surface)
      sfc[sf(S_SHACT, col)] = W_SH * clamp(hs / 100.0, 0.0, 1.0) * reachCu;
      if (fcu > 0.3 && dsh > 500.0) {
        sfc[sf(S_CUTOP, col)] = vg[VG_ZC + kt];
        sfc[sf(S_CUBASE, col)] = zb;
      }
      var qs0 = 0.0;
      var ms = 0.0;
      for (var k = kb; k < klcl; k++) {
        let m = mlay(k, kb, col);
        qs0 += m * max(state[QV_OFF + k * NXY + col], 0.0);
        ms += m;
      }
      var qc0 = 0.0;
      var mc = 0.0;
      for (var k = klcl; k <= kt; k++) {
        let m = vg[VG_RC + k] * vg[VG_DZC + k];
        qc0 += m * max(state[QV_OFF + k * NXY + col], 0.0);
        mc += m;
      }
      let dqm = qs0 / ms - qc0 / mc;
      if (ms > 0.0 && mc > 0.0 && dqm > 0.0) {
        // przeniesienie pary (masa wody zachowana): część różnicy wilgotności właściwej na krok
        let tr = W_SH * clamp(hs / 100.0, 0.0, 1.0) * reachCu * P.dt / TAU_SH * dqm * ms * mc / (ms + mc);
        // warstwa chmurowa nawilżana najwyżej do RH 85% (otoczenie cumulusów jest nienasycone) – inaczej
        // para dochodziła do nasycenia i na ~2 km powstawał całodzienny pokład Sc (zachmurzenie 90%)
        var added = 0.0;
        for (var k = klcl; k <= kt; k++) {
          let c = k * NXY + col;
          let te = (vg[VG_TC + k] + state[T_OFF + c]) * vg[VG_EXC + k];
          let room = max(0.85 * qsat(te, vg[VG_PRS + k]) - state[QV_OFF + c], 0.0);
          let dq = min(tr / mc, room);
          state[QV_OFF + c] += dq;
          added += dq * vg[VG_RC + k] * vg[VG_DZC + k];
        }
        // opad z płytkiej konwekcji (chmury grubsze niż ~1.2 km): pasma śniegu znad ciepłej wody przy napływie
        // zimnego powietrza (efekt jeziora/morza), przelotne opady z Cu congestus; lodowe wierzchołki (< −10 °C)
        // wydajniej. Woda z warstwy podchmurowej, ciepło skraplania w warstwie chmurowej.
        // Chmury z ciepłym wierzchołkiem (bez lodu) dają opad dopiero od ~2.5 km grubości – wcześniej cumulusy
        // 1.2–2.5 km nad lądem latem mżyły w tysiącach oczek (jasnoniebieska „wysypka” na radarze)
        let ttop = (vg[VG_TC + kt] + state[T_OFF + kt * NXY + col]) * vg[VG_EXC + kt];
        // opad pełny tylko przy wymuszeniu wznoszenia albo na wypływach burz (bez szumu)
        let pcell = mix(0.4, 1.0, max(trigK, trigWk));
        // na siatkach < ~5 km cumulusy congestus i ich przelotne opady liczy sama siatka (opad z parametryzacji dawał tam codzienną
        // „wysypkę” kropek słabego deszczu z cumulusów – Niemcy, 2 km, lipiec: 93% opadu dnia i ~35% oczko·h z mżawką)
        // Chmury z lodowym wierzchołkiem w chłodnej masie (podstawa < ~+2 °C – przelotny śnieg i krupa w napływie zimna, pasma
        // znad Bałtyku) padają na każdej siatce od ~1 km: kłęby mają 2–5 km średnicy i wierzchołki 2–3 km – siatka 1–4 km ich nie
        // rozwiązuje (zima, Polska: schemat ani razu, MUCAPE ~0, opad konwekcyjny 0% przy ERA5 ~10–20%)
        let tbase = (vg[VG_TC + klcl] + state[T_OFF + klcl * NXY + col]) * vg[VG_EXC + klcl];
        // (płynnie z temperaturą wierzchołka i grubością chmury: próg −10 °C i koniec schematu na 3.5 km dawały na mapie opadu ostre granice,
        // a w poziomie pasma i pierścienie wzdłuż izolinii grubości chmury)
        // udział wody w 5 × 5 oczkach (jak przy liczbie kropel w mikrofizyce) – powietrze morskie; chmura cieńsza niż 1.2 km i tak nie pada
        var fw = 0.0;
        if ((SHL < 1.0 || GLI > 0.0) && dsh > 1200.0) {
          for (var dj = -2; dj <= 2; dj++) { for (var di = -2; di <= 2; di++) { fw += select(0.0, 1.0, u32(vg[VG_VEG + cidx(i + di, j + dj, 0u)] + 0.5) == 10u); } }
          fw = fw / 25.0;
        }
        // Wierzchołek lodowy (wydajny opad przez lód): nad morzem i w chłodnej masie −5…−15 °C; nad lądem przy ciepłej podstawie (≥ ~+8 °C) próg o GLI chłodniej
        // (?gli= [K], domyślnie 10 → −15…−25 °C; 0 – dawniej wszędzie −5…−15 °C). Chmury kontynentalne (~250 kropel/cm³, małe krople – bez wtórnego lodu
        // Hallett–Mossop) zostają przechłodzone do ~−20 °C i niżej (Rosenfeld i Woodley 2000), morskie zamarzają przy ~−10 °C. Czerwiec, Polska, 7.5 km: słaby opad
        // 0.05–1 mm/h w dzień na 22% domeny, w 58% z cumulusów płytkich z wierzchołkiem ~−10 °C (podstawa ~+8 °C, grubość ~2.7 km); bez tej drogi 7% (użytkownik:
        // gładkie pola słabego deszczu; przebieg 4-letni: latem 36 dni z opadem 0.1–1 mm przy 12 w IMGW)
        let gSh = GLI * (1.0 - fw) * smoothstep(275.15, 281.15, tbase);
        let fIce = 1.0 - smoothstep(258.15 - gSh, 268.15 - gSh, ttop);
        let wCold = fIce * (1.0 - smoothstep(271.15, 279.15, tbase)) * smoothstep(700.0, 1200.0, DX);
        // Ciepły opad (bez lodu) nad lądem × SHL (?shl= , 1 – dawniej; nad morzem bez zmian): powietrze kontynentalne ma ~250 kropel/cm³ i chmury 2.5–3.5 km
        // z ciepłym wierzchołkiem prawie nie padają
        var warmF = 1.0;
        if (SHL < 1.0 && fIce < 1.0 && dsh > 2500.0) { warmF = mix(SHL, 1.0, fw); }
        let prs0 = max(smoothstep(3000.0, 8000.0, DX), wCold) * pcell * 0.6 * tr * mix(0.5 * smoothstep(2500.0, 3500.0, dsh) * warmF, smoothstep(1200.0, 2500.0, dsh), fIce) * (1.0 - smoothstep(3000.0, 3500.0, dsh));
        // Cumulus przy CAPE ponad SHC [J/kg] (?shc=, 0 – dawniej) i ciepłej podstawie (≥ ~+2…+6 °C) nie pada – przy takim CAPE opad daje tylko schemat głęboki (Cb), przelotny śnieg i krupa z zimną podstawą
        // bez zmian. Czynnik smoothstep(3–8 km) oczka sprawiał, że problem rósł z oczkiem, czyli na dużych domenach (użytkownik: gładkie pola słabego opadu spod cumulusów). Woda, która by spadła, idzie do warstwy
        // chmurowej jako para: samo wyłączenie zostawiłoby ją przy gruncie i podniosło CAPE (1 mm/d ≈ 0.8 g/kg/d w 1.2 km, 1 g/kg ≈ 600 J/kg)
        let noRn = select(0.0, smoothstep(0.5 * SHC, 1.5 * SHC + 1.0, capes) * smoothstep(275.15, 279.15, tbase), SHC > 0.0);
        let prs = prs0 * (1.0 - noRn);
        var add2 = 0.0;
        if (prs0 * noRn > 0.0) {
          for (var k = klcl; k <= kt; k++) {
            let c = k * NXY + col;
            let te = (vg[VG_TC + k] + state[T_OFF + c]) * vg[VG_EXC + k];
            let dq = min(prs0 * noRn / mc, max(0.85 * qsat(te, vg[VG_PRS + k]) - state[QV_OFF + c], 0.0));
            state[QV_OFF + c] += dq;
            add2 += dq * vg[VG_RC + k] * vg[VG_DZC + k];
          }
        }
        for (var k = kb; k < klcl; k++) {
          let c = k * NXY + col;
          state[QV_OFF + c] = max(state[QV_OFF + c] - (added + add2 + prs) / ms, 0.0);
        }
        if (prs > 0.0) {
          for (var k = klcl; k <= kt; k++) {
            state[T_OFF + k * NXY + col] += LV * prs / (CP * mc * vg[VG_EXC + k]);
          }
          sfc[sf(S_PRK, col)] = 3.0;
          sfc[sf(S_PRCU, col)] = cuVirga(col, kb, klcl, prs) / P.dt * 3600.0;
          // padający cumulus congestus – widoczny (3D, satelita) jak gęsta chmura, nie rzadka mgiełka
          sfc[sf(S_CUL, col)] = max(sfc[sf(S_CUL, col)], 120.0 * smoothstep(0.0, 0.5, prs / P.dt * 3600.0));
          sfc[sf(S_CUTOP, col)] = vg[VG_ZC + kt];
          sfc[sf(S_CUBASE, col)] = zb;
        }
      }
    }
  }
}

// Spływ: woda powierzchniowa oczka − odpływ + dopływy od sąsiadów, których odbiornikiem jest to oczko
@compute @workgroup_size(64)
fn route(@builtin(global_invocation_id) gid: vec3u) {
  let col = gid.x;
  if (col >= NXY || P.hydro < 0.5) { return; }
  let i = i32(col % NX);
  let j = i32(col / NX);
  let k2 = P.dt * 1000.0 / (DX * DY);                      // m³/s → mm w oczku na krok
  var s = sfc[sf(S_RUN, col)] - sfc[sf(S_QOUT, col)] * k2;
  for (var dj = -1; dj <= 1; dj++) {
    for (var di = -1; di <= 1; di++) {
      if (di == 0 && dj == 0) { continue; }
      let n = cidx(i + di, j + dj, 0u);
      if (i32(vg[VG_RCV + n]) == i32(col)) { s += sfc[sf(S_QOUT, n)] * k2; }
    }
  }
  if (u32(vg[VG_VEG + col] + 0.5) == 10u) { s = 0.0; }
  sfc[sf(S_RUN, col)] = max(s, 0.0);
}

// Kopuły zimnego powietrza (wypływy burz) wg Grandpeix–Lafore (2010), w wersji rozlewającej się po siatce:
// pole ORG = WAPE kopuły [J/kg] (energia potencjalna zimnego powietrza, średnia w oczku). Źródło: parowanie opadu pod chmurą
// (prądy zstępujące schematu + opad z siatki tam, gdzie siatka nie rozdziela kopuł) – g·L·E/(ρ·c_p·θ), ~74 J/kg na mm.
// Rozlewa się jak prąd gęstościowy: dyfuzja nieliniowa K = C*·Δx, C* = k*·√(2·WAPE) (skończona prędkość frontu, jak
// w równaniu ośrodka porowatego), płynie z wiatrem przy gruncie, zanika (grzanie od podłoża, mieszanie u góry) z τ ≈ 2.5 h.
// Schemat cumulus czyta z niej udział kopuły w oczku (wnętrze blokuje) i energię frontu podmuchowego (ALE, ALP).
// Dwa bufory na zmianę (parzystość kroku).
@compute @workgroup_size(64)
fn org_update(@builtin(global_invocation_id) gid: vec3u) {
  let col = gid.x;
  if (col >= NXY) { return; }
  let i = i32(col % NX);
  let j = i32(col / NX);
  let odd = (P.step & 1u) == 1u;
  let rd = select(S_ORG, S_ORGB, odd);
  let wr = select(S_ORGB, S_ORG, odd);
  let rdS = select(S_ORGS, S_ORGSB, odd);
  let wrS = select(S_ORGSB, S_ORGS, odd);
  if (vg[VG_ZONE + col] > 0.0) { sfc[sf(wr, col)] = 0.0; sfc[sf(wrS, col)] = 0.0; return; }
  let kb = kbAt(i, j);
  // Pole wymuszenia wznoszenia: wznoszenie dużej skali (model synoptyczny, ~3 km) + wznoszenie ~1 km nad gruntem w domenie
  // uśrednione na ~20 km (termiki i pojedyncze prądy znoszą się, zostają linie zbieżności i fronty); LIFT – całka z ~3 h [m]
  let rb = clamp(i32(round(10000.0 / DX)), 1, 12);
  let stp = max(1, (rb + 3) / 4);
  var wsum = 0.0;
  var wn = 0.0;
  // oczka z opadem pomijane: wznoszenie wywołane przez same burze (ciepło kondensacji) nie jest wymuszeniem – inaczej
  // burza podtrzymywała własne LIFT i nowe komórki odpalały ciągle na tej samej linii
  for (var dj = -rb; dj <= rb; dj += stp) {
    for (var di = -rb; di <= rb; di += stp) {
      let cn = cidx(i + di, j + dj, 0u);
      let g = 1.0 - smoothstep(0.3, 2.0, sfc[sf(S_PR, cn)] + sfc[sf(S_PRCUS, cn)]);
      wsum += g * sfc[sf(S_W1, cn)];
      wn += g;
    }
  }
  let wmes = select(0.0, wsum / max(wn, 1e-3), wn > 0.5) + tgSfc(3u, col, P.ta1);
  sfc[sf(S_WMES, col)] = wmes;
  let lf = sfc[sf(S_LIFT, col)];
  sfc[sf(S_LIFT, col)] = clamp(lf + P.dt * (wmes - lf / 10800.0), -1000.0, 3000.0);
  // Tryb organizacji burz (ze ścinania 0–6 km, SRH 0–3 km i wymuszenia mezoskalowego LIFT):
  //  • linie (QLCS, bow echo): silne ścinanie + silne wznoszenie – zimne wypływy łączą komórki w linię prostopadłą
  //    do ścinania, która przesuwa się z wiatrem i dodatkowo „po stronie ścinania” (front podmuchowy wyzwala nowe komórki);
  //  • superkomórki: silne ścinanie prędkości i kierunku (SRH) przy słabym wznoszeniu – pojedyncze, zwarte, długo żyjące
  //    komórki poruszające się w prawo od średniego wiatru (Bunkers, 7.5 m/s);
  //  • pozostałe – pojedyncze / wielokomórkowe, z średnim wiatrem 0–6 km.
  let shu = sfc[sf(S_SHU, col)];
  let shv = sfc[sf(S_SHV, col)];
  let s06 = length(vec2f(shu, shv));
  let sn = vec2f(shu, shv) / max(s06, 0.1);
  let c = sfc[sf(rd, col)];
  let wQm = smoothstep(10.0, 18.0, s06) * smoothstep(10.0, 40.0, c);
  let wSm = smoothstep(14.0, 22.0, s06) * smoothstep(80.0, 200.0, sfc[sf(S_SRH03, col)]) * (1.0 - wQm);
  // kopuła płynie z wiatrem przy gruncie (~300 m; pole po rzucie ciśnienia z poprzedniego kroku)
  var kl = kb;
  for (var k = kb; k < NZ; k++) { if (vg[VG_ZC + k] - zgC(col) > 300.0) { break; } kl = k; }
  let ub = 0.5 * (tmp[U_OFF + cidx(i, j, kl)] + tmp[U_OFF + cidx(i + 1, j, kl)]);
  let vb = 0.5 * (tmp[V_OFF + cidx(i, j, kl)] + tmp[V_OFF + cidx(i, j + 1, kl)]);
  let x = f32(i) - ub * P.dt / DX;
  let y = f32(j) - vb * P.dt / DY;
  let i0 = i32(floor(x));
  let j0 = i32(floor(y));
  let fx = x - f32(i0);
  let fy = y - f32(j0);
  let adv = mix(mix(sfc[sf(rd, cidx(i0, j0, 0u))], sfc[sf(rd, cidx(i0 + 1, j0, 0u))], fx),
                mix(sfc[sf(rd, cidx(i0, j0 + 1, 0u))], sfc[sf(rd, cidx(i0 + 1, j0 + 1, 0u))], fx), fy);
  // ta sama adwekcja dla części kopuły ze schematu
  let advS = mix(mix(sfc[sf(rdS, cidx(i0, j0, 0u))], sfc[sf(rdS, cidx(i0 + 1, j0, 0u))], fx),
                 mix(sfc[sf(rdS, cidx(i0, j0 + 1, 0u))], sfc[sf(rdS, cidx(i0 + 1, j0 + 1, 0u))], fx), fy);
  // opad i chmury konwekcji parametryzowanej wygładzone w czasie (τ 15–20 min) – komórki narastają i zanikają
  // płynnie zamiast migotać krok po kroku (bilans wody: opad przy gruncie tylko opóźniony). Chmury dodatkowo
  // uśrednione z otoczenia 3 × 3 (bez „klocków” i pikseli), a podstawa i wierzchołek zostają, gdy chmura zanika
  // (wcześniej zerowane w każdym kroku bez konwekcji – chmura znikała w jednym kroku). Wartości chwilowe
  // (PRCU, CUL, CUBASE, CUTOP) pisze tylko schemat cumulus; wszyscy czytają wygładzone (PRCUS, CULS, CUBS, CUTS).
  let ap = min(P.dt / 900.0, 1.0);
  let prs = sfc[sf(S_PRCUS, col)] + ap * (sfc[sf(S_PRCU, col)] - sfc[sf(S_PRCUS, col)]);
  sfc[sf(S_PRCUS, col)] = prs;
  var cS = 0.0;
  var wS = 0.0;
  var bS = 0.0;
  var tS = 0.0;
  var wT = 0.0;
  for (var dj = -1; dj <= 1; dj++) {
    for (var di = -1; di <= 1; di++) {
      let cn = cidx(i + di, j + dj, 0u);
      let wg = exp(-f32(di * di + dj * dj) / 1.5);
      let cu = sfc[sf(S_CUL, cn)];
      cS += wg * cu;
      wS += wg;
      let ct = sfc[sf(S_CUTOP, cn)];
      let wt = select(0.0, wg * max(cu, 1e-3), ct > 0.0);
      bS += wt * sfc[sf(S_CUBASE, cn)];
      tS += wt * ct;
      wT += wt;
    }
  }
  let cOld = sfc[sf(S_CULS, col)];
  // narasta z τ 20 min, zanika z τ 60 min – wieczorne cumulusy gasną stopniowo (rozpływają się ~1 h po ustaniu grzania),
  // zamiast znikać razem z ostatnim ciepłem z gruntu
  let cls = cOld + min(P.dt / select(1200.0, 3600.0, cS / wS < cOld), 1.0) * (cS / wS - cOld);
  sfc[sf(S_CULS, col)] = cls;
  if (wT > 0.0) {
    // nowa chmura – od razu wysokość z konwekcji; istniejąca – płynnie (~5 min)
    let ah = select(min(P.dt / 300.0, 1.0), 1.0, sfc[sf(S_CUTS, col)] <= 0.0 || cOld < 0.5);
    sfc[sf(S_CUBS, col)] += ah * (bS / wT - sfc[sf(S_CUBS, col)]);
    if (ANV > 0.0) {
      // wierzchołek nowej chmury startuje ~1.5 km nad podstawą i rośnie z τ ~20 min (wcześniej pełna wieża do poziomu równowagi w jednym kroku – użytkownik: w miejscu kropki od razu pełnoprawny Cb); opada jak dotąd (~5 min)
      let tsT = tS / wT;
      if (sfc[sf(S_CUTS, col)] <= 0.0) { sfc[sf(S_CUTS, col)] = bS / wT + min(1500.0, tsT - bS / wT); }
      else { sfc[sf(S_CUTS, col)] += select(min(P.dt / 300.0, 1.0), min(P.dt / 1200.0, 1.0), tsT > sfc[sf(S_CUTS, col)]) * (tsT - sfc[sf(S_CUTS, col)]); }
    } else {
      sfc[sf(S_CUTS, col)] += ah * (tS / wT - sfc[sf(S_CUTS, col)]);
    }
  }
  // rozlewanie kopuły jak prąd gęstościowy: strumienie przez ściany z K = C*·Δx (C* ze średniej WAPE po obu stronach)
  let kmax = 0.24 * DX * DX / P.dt;
  var fl = 0.0;
  var flS = 0.0;
  let csw = sfc[sf(rdS, col)];
  for (var nb = 0; nb < 4; nb++) {
    let di = select(select(select(0, 0, nb == 3), -1, nb == 1), 1, nb == 0);
    let dj = select(select(0, 1, nb == 2), -1, nb == 3);
    let cn = sfc[sf(rd, cidx(i + di, j + dj, 0u))];
    let kf = min(KSTAR * sqrt(2.0 * max(0.5 * (c + cn), 0.0)) * DX, kmax);
    fl += kf * (cn - c);
    flS += kf * (sfc[sf(rdS, cidx(i + di, j + dj, 0u))] - csw);
  }
  var o = adv + P.dt * fl / (DX * DX);
  // źródło: parowanie w prądach zstępujących schematu + parowanie opadu z siatki pod chmurą (tam, gdzie siatka kopuł nie
  // rozdziela – oczka ≥ ~2 km; na drobnych siatkach kopuły są w polu temperatury modelu)
  // (opad z siatki na oczkach < ~10 km – tam to rozwiązywane burze, a na drobnych siatkach kopuła jest maską wnętrza wypływu
  // dla termików; na dużych oczkach to opad warstwowy frontów, a kopuły tworzą tylko prądy zstępujące schematu – inaczej kopuła
  // z deszczu frontowego blokowała schemat w całym pasie opadu i konwekcję przejmowała siatka)
  o += sfc[sf(S_WKSRC, col)] + (1.0 - smoothstep(8000.0, 15000.0, DX)) * G * LV * sfc[sf(S_EVR, col)] / (1.15 * CP * 300.0);
  // zanik: grzanie od podłoża i mieszanie u góry (τ 2.5 h), w słońcu szybciej (~45 min przy 800 W/m² – czyste niebo nad kopułą)
  let odec = exp(-P.dt * (1.0 / 9000.0 + max(sfc[sf(S_SW, col)], 0.0) / (800.0 * 2700.0)));
  o *= odec;
  sfc[sf(wr, col)] = clamp(o, 0.0, 300.0);
  // część kopuły ze schematu: ten sam transport i zanik, źródło tylko WKSRC – bierze ją czynnik narodzin chmur w cumulus (gL0)
  sfc[sf(wrS, col)] = clamp(min((advS + P.dt * flS / (DX * DX) + sfc[sf(S_WKSRC, col)]) * odec, o), 0.0, 300.0);
  // tryb do podglądu (mapa „Organizacja burz”): 0 brak, 1 pojedyncze/wielokomórkowe, 2 linie, 3 superkomórki
  sfc[sf(S_SMODE, col)] = select(0.0, 1.0 + wQm + 2.0 * wSm, o > 2.0 || sfc[sf(S_CUM, col)] > 1e6);
}

// Opad z konwekcji parametryzowanej rozłożony na otoczenie 5 × 5 oczek (rozkład Gaussa, σ ≈ 1.2 oczka):
// schemat opisuje chmury rozrzucone w obszarze, a nie jedną kolumnę (inaczej opad w „kwadracikach”)
@compute @workgroup_size(64)
fn cu_spread(@builtin(global_invocation_id) gid: vec3u) {
  let col = gid.x;
  if (col >= NXY) { return; }
  let i = i32(col % NX);
  let j = i32(col / NX);
  var s = 0.0;
  var wsum = 0.0;
  for (var dj = -1; dj <= 1; dj++) {
    for (var di = -1; di <= 1; di++) {
      // tylko kolumny poza strefą brzegową (tam powietrze jest stale odnawiane – nie może „przeciekać”)
      // 3 × 3 oczka (46% w oczku burzy, reszta na sąsiadów) – szersze (5 × 5) rozmazywało ulewy w mżawkę
      let cn = cidx(i + di, j + dj, 0u);
      if (vg[VG_ZONE + cn] > 0.0 && vg[VG_ZONE + col] == 0.0) { continue; }
      let w = exp(-f32(di * di + dj * dj) / 0.7);
      s += w * sfc[sf(S_PRCUS, cn)];
      wsum += w;
    }
  }
  var prc = PR_SCALE * s / wsum;                          // [mm/h]
  sfc[sf(S_PRCG, col)] = 0.0;
  if (prc <= 0.0) { return; }
  let kb = kbAt(i, j);
  // Słaby opad schematu (średnia z oczka poniżej ~RMN mm/h, ?rmn=0 – dawniej; siatki ≤ 10 km, zanika do 20 km) paruje w warstwie pod podstawą chmury, jeśli powietrze tam nie jest
  // prawie nasycone (do RH 95%): para i ochłodzenie zostają w warstwach, do gruntu dochodzi reszta. Taki opad to w rzeczywistości pojedyncze przelotne opady na kilku procentach
  // oczka (virga, ślad), a na mapie dawał gładkie pola i cienkie łuki 0.05–0.3 mm/h: każda droga schematu ma opad w wąskim zakresie grubości chmury albo progu wyzwolenia,
  // a wierzchołek chmury to poziom siatki – pasmo o szerokości 1–2 oczek wzdłuż izolinii, migoczące, gdy wierzchołek przeskakuje o poziom (użytkownik: „ringi”, opad
  // pojawia się na chwilę i znika, w sondażu sucho pod chmurą; przebieg roczny: 129 dni z opadem 0.1–1 mm przy 64 w IMGW)
  if (RMN > 0.0 && DX < 20000.0) {
    let fEv = (1.0 - smoothstep(0.5 * RMN, 1.5 * RMN + 1e-6, prc)) * (1.0 - smoothstep(10000.0, 20000.0, DX));
    if (fEv > 0.0) {
      let zcb = max(sfc[sf(S_CUBS, col)], zgC(col) + 500.0);
      var def = 0.0;
      var kc = kb;
      for (var k = kb; k < NZ; k++) {
        if (k > kb && vg[VG_ZC + k] >= zcb) { break; }
        let c = k * NXY + col;
        let te = (vg[VG_TC + k] + state[T_OFF + c]) * vg[VG_EXC + k];
        def += vg[VG_RC + k] * vg[VG_DZC + k] * select(1.0, vg[VG_HF + col], k == kb) * max(0.95 * qsat(te, vg[VG_PRS + k]) - max(state[QV_OFF + c], 0.0), 0.0);
        kc = k;
      }
      let ev = min(fEv * prc * P.dt / 3600.0, 0.5 * def);           // [kg/m²]
      if (ev > 0.0) {
        for (var k = kb; k <= kc; k++) {
          let c = k * NXY + col;
          let te = (vg[VG_TC + k] + state[T_OFF + c]) * vg[VG_EXC + k];
          let dq = ev * max(0.95 * qsat(te, vg[VG_PRS + k]) - max(state[QV_OFF + c], 0.0), 0.0) / def;   // udział warstwy [kg/kg]
          state[QV_OFF + c] += dq;
          state[T_OFF + c] -= LV * dq / (CP * vg[VG_EXC + k]);
        }
        prc = max(prc - ev * 3600.0 / P.dt, 0.0);
      }
    }
  }
  sfc[sf(S_PRCG, col)] = prc;
  if (prc <= 0.0) { return; }
  let tbk = tPhase(col, kb, state[T_OFF + kb * NXY + col], state[T_OFF + (kb + 1u) * NXY + col]);
  let fsn = clamp((TFRZ + 1.0 - tbk) / 2.0, 0.0, 1.0);
  sfc[sf(S_PR, col)] += prc;
  sfc[sf(S_PSN, col)] += fsn * prc;
  addPacc(col, prc * P.dt / 3600.0, fsn * prc * P.dt / 3600.0);
}

// analizy: o każdej północy (także po niepełnej dobie) ekstrema miesiąca – T maks. i T min. absolutna, największy opad dobowy
@compute @workgroup_size(64)
fn mon_abs(@builtin(global_invocation_id) gid: vec3u) {
  let col = gid.x;
  if (col >= NXY) { return; }
  sfc[sf(S_MXA, col)] = max(sfc[sf(S_MXA, col)], sfc[sf(S_TMAX, col)] + 1000.0);
  sfc[sf(S_MNA, col)] = max(sfc[sf(S_MNA, col)], 1000.0 - sfc[sf(S_TMIN, col)]);
  sfc[sf(S_MPD, col)] = max(sfc[sf(S_MPD, col)], sfc[sf(S_PACC, col)] - sfc[sf(S_PD0, col)]);
  sfc[sf(S_PD0, col)] = sfc[sf(S_PACC, col)];
}

// widok „Miesiące”: o północy po pełnej dobie dobowe T maks. i T min. dodane do sum miesiąca (main.js monMidnight)
@compute @workgroup_size(64)
fn mon_day(@builtin(global_invocation_id) gid: vec3u) {
  let col = gid.x;
  if (col >= NXY) { return; }
  sfc[sf(S_MTX, col)] += sfc[sf(S_TMAX, col)];
  sfc[sf(S_MTN, col)] += sfc[sf(S_TMIN, col)];
  sfc[sf(S_MHOT, col)] += select(0.0, 1.0, sfc[sf(S_TMAX, col)] >= 30.0);
  sfc[sf(S_MTRO, col)] += select(0.0, 1.0, sfc[sf(S_TMIN, col)] >= 20.0);
}

// ======================= Rzut ciśnienia =======================
// Równanie: ∇·(ρ0 ∇φ) = ∇·(ρ0 u*),  potem u = u* − ∇φ  (φ = Δt·p'/ρ0).
// A – operator z maskami terenu, M – ten sam operator bez terenu (rozwiązywany dokładnie przez DFT).

var<workgroup> red: array<f32, 256>;

fn wg_sum(li: u32, v: f32) -> f32 {
  red[li] = v;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { red[li] += red[li + s]; }
    workgroupBarrier();
  }
  let r = red[0];
  workgroupBarrier();
  return r;
}

// A·x w komórce (i,j,k) dla wektora zaczynającego się w work[base]
fn applyA(base: u32, i: i32, j: i32, k: u32) -> f32 {
  let c = cidx(i, j, k);
  let x0 = work[base + c];
  let ch = vg[VG_RC + k] / (DX * DX);
  let cy = vg[VG_RC + k] / (DY * DY);
  var s = 0.0;
  // ściany ważone częścią otwartą (oczka przycięte do terenu) – macierz zostaje symetryczna
  if (openU(i + 1, j, k)) { s += ch * aU(i + 1, j, k) * (work[base + cidx(i + 1, j, k)] - x0); }
  if (openU(i, j, k)) { s += ch * aU(i, j, k) * (work[base + cidx(i - 1, j, k)] - x0); }
  if (openV(i, j + 1, k)) { s += cy * aV(i, j + 1, k) * (work[base + cidx(i, j + 1, k)] - x0); }
  if (openV(i, j, k)) { s += cy * aV(i, j, k) * (work[base + cidx(i, j - 1, k)] - x0); }
  if (k + 1u < NZ) { s += vg[VG_TCU + k] * (work[base + c + NXY] - x0); }
  if (openW(i, j, k)) { s += vg[VG_TA + k] * (work[base + c - NXY] - x0); }
  return s;
}

// r = ∇·(ρ0 u*) − A φ  (φ z poprzedniego kroku jako punkt startowy)
@compute @workgroup_size(WG)
fn cg_init(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let id = lin_id(gid, nwg);
  if (id >= N) { return; }
  let i = i32(id % NX);
  let j = i32((id / NX) % NY);
  let k = id / NXY;
  if (!fluid(i, j, k)) { work[W_R + id] = 0.0; return; }
  // strumienie przez ściany: część otwarta × wiatr (oczka przycięte do terenu)
  let du = (aU(i + 1, j, k) * state[U_OFF + cidx(i + 1, j, k)] - aU(i, j, k) * state[U_OFF + id]) / DX;
  let dv = (aV(i, j + 1, k) * state[V_OFF + cidx(i, j + 1, k)] - aV(i, j, k) * state[V_OFF + id]) / DY;
  let dw = (vg[VG_RW + k + 1u] * state[W_OFF + id + NXY] - vg[VG_RW + k] * state[W_OFF + id]) / vg[VG_DZC + k];
  // wiersze ważone grubością warstwy dz_c: na siatce rozciągniętej w pionie dopiero wtedy macierz
  // jest symetryczna (współczynnik między k i k+1 taki sam z obu stron), czego wymagają gradienty
  // sprzężone – bez tego CG przy terenie rozbiegał się (niestabilność na siatce 10 km z górami)
  work[W_R + id] = vg[VG_DZC + k] * (vg[VG_RC + k] * (du + dv) + dw - applyA(W_PHI, i, j, k));
}

@compute @workgroup_size(WG)
fn dft_x(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let id = lin_id(gid, nwg);
  if (id >= N) { return; }
  let m = id % NX;
  let row = id - m;
  var re = 0.0;
  var im = 0.0;
  var t = 0u;
  for (var i = 0u; i < NX; i++) {
    let f = work[W_R + row + i];
    re += f * vg[TW_CX + t];
    im -= f * vg[TW_SX + t];
    t += m;
    if (t >= NX) { t -= NX; }
  }
  // residuum jest ważone grubością warstwy (patrz cg_init) – prekondycjoner rozwiązuje układ bez wag
  cx[id] = vec2f(re, im) / vg[VG_DZC + id / NXY];
}

@compute @workgroup_size(WG)
fn dft_y(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let id = lin_id(gid, nwg);
  if (id >= N) { return; }
  let m = id % NX;
  let n = (id / NX) % NY;
  let base = (id / NXY) * NXY + m;
  var acc = vec2f(0.0);
  var t = 0u;
  for (var j = 0u; j < NY; j++) {
    let c = cx[base + j * NX];
    let e = vec2f(vg[TW_CY + t], -vg[TW_SY + t]);
    acc += vec2f(c.x * e.x - c.y * e.y, c.x * e.y + c.y * e.x);
    t += n;
    if (t >= NY) { t -= NY; }
  }
  cx[N + id] = acc;
}

// ---- Szybka transformata Fouriera (FFT) w pamięci współdzielonej: jedna grupa robocza = jedna linia ----
// Stockham z mieszanymi podstawami (Govindaraju i in. 2008): czynniki długości z nagłówka (FRX, FRY), mała
// DFT w rejestrach dla każdej podstawy. ~10× mniej działań niż DFT „każdy z każdym” (dft_x, dft_y, …),
// które zostają jako zapas dla długości z dużym czynnikiem pierwszym (> 32).
const FFT_WG: u32 = 64u;
var<workgroup> fbuf: array<array<vec2f, FFT_LMAX>, 2>;

fn cmul(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }

// transformata linii długości L z fbuf[0]; sgn = 1 – w przód (e^{−iθ}), −1 – odwrotna; zwraca bufor z wynikiem.
// Każdy wątek liczy jeden punkt wyjścia etapu: y[(j/ns)·ns·R + k + t·ns] = Σ_r x[j + r·L/R] · w^r,
// w = exp(∓2πi (k + t·ns)/(ns·R)), k = j mod ns (obrót „twiddle” i mała DFT podstawy R w jednym)
fn fft_line(li: u32, L: u32, sgn: f32, isY: bool) -> u32 {
  let rx = FRX;
  let ry = FRY;
  let nr = select(FNRX, FNRY, isY);
  var ns = 1u;
  for (var st = 0u; st < nr; st++) {
    let R = select(rx[st], ry[st], isY);
    let src = st & 1u;
    let nb = L / R;
    for (var idx = li; idx < L; idx += FFT_WG) {
      let j = idx % nb;
      let t = idx / nb;
      let k = j % ns;
      let ang = -6.2831853 * sgn * f32(k + t * ns) / f32(ns * R);
      let w = vec2f(cos(ang), sin(ang));
      var e = vec2f(1.0, 0.0);
      var acc = vec2f(0.0);
      for (var r = 0u; r < R; r++) {
        acc += cmul(fbuf[src][j + r * nb], e);
        e = cmul(e, w);
      }
      fbuf[1u - src][(j / ns) * ns * R + k + t * ns] = acc;
    }
    ns *= R;
    workgroupBarrier();
  }
  return nr & 1u;
}

// x: linie = wiersze (j, k); wejście residuum (ważone dz_c, jak w dft_x)
@compute @workgroup_size(FFT_WG)
fn fft_x(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) li: u32) {
  let row = wid.x * NX;
  let dzc = vg[VG_DZC + wid.x / NY];
  for (var i = li; i < NX; i += FFT_WG) { fbuf[0][i] = vec2f(work[W_R + row + i] / dzc, 0.0); }
  workgroupBarrier();
  let rs = fft_line(li, NX, 1.0, false);
  for (var m = li; m < NX; m += FFT_WG) { cx[row + m] = fbuf[rs][m]; }
}

// y: linie = kolumny (m, k) widma x
@compute @workgroup_size(FFT_WG)
fn fft_y(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) li: u32) {
  let base = (wid.x / NX) * NXY + wid.x % NX;
  for (var j = li; j < NY; j += FFT_WG) { fbuf[0][j] = cx[base + j * NX]; }
  workgroupBarrier();
  let rs = fft_line(li, NY, 1.0, true);
  for (var n = li; n < NY; n += FFT_WG) { cx[N + base + n * NX] = fbuf[rs][n]; }
}

@compute @workgroup_size(FFT_WG)
fn ifft_y(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) li: u32) {
  let base = (wid.x / NX) * NXY + wid.x % NX;
  for (var n = li; n < NY; n += FFT_WG) { fbuf[0][n] = cx[N + base + n * NX]; }
  workgroupBarrier();
  let rs = fft_line(li, NY, -1.0, true);
  for (var j = li; j < NY; j += FFT_WG) { cx[base + j * NX] = fbuf[rs][j]; }
}

// odwrotna w x → część rzeczywista / (NX·NY) do W_Z; mask – zero pod gruntem (prekondycjoner CG)
fn ifft_x_line(wid: u32, li: u32, mask: bool) {
  let row = wid * NX;
  for (var m = li; m < NX; m += FFT_WG) { fbuf[0][m] = cx[row + m]; }
  workgroupBarrier();
  let rs = fft_line(li, NX, -1.0, false);
  let j = i32(wid % NY);
  let k = wid / NY;
  for (var i = li; i < NX; i += FFT_WG) {
    var z = fbuf[rs][i].x / f32(NXY);
    if (mask && !fluid(i32(i), j, k)) { z = 0.0; }
    work[W_Z + row + i] = z;
  }
}
@compute @workgroup_size(FFT_WG)
fn ifft_x(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) li: u32) { ifft_x_line(wid.x, li, true); }
@compute @workgroup_size(FFT_WG)
fn ifft_xt(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) li: u32) { ifft_x_line(wid.x, li, false); }

// sumy częściowe r·z (po FFT; w starej ścieżce liczyło je idft_z)
@compute @workgroup_size(WG)
fn cg_rz(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32,
         @builtin(workgroup_id) wid: vec3u) {
  let id = gid.x;
  var rz = 0.0;
  if (id < N) { rz = work[W_R + id] * work[W_Z + id]; }
  let s = wg_sum(li, rz);
  if (li == 0u) { work[W_PART + wid.x] = s; }
}

// Dla każdej harmonicznej (m, n): układ trójdiagonalny w pionie (algorytm Thomasa)
@compute @workgroup_size(64)
fn tridiag(@builtin(global_invocation_id) gid: vec3u) {
  let id = gid.x;
  if (id >= NXY) { return; }
  let m = id % NX;
  let n = id / NX;
  let lam = -(2.0 - 2.0 * vg[TW_CX + m]) / (DX * DX) - (2.0 - 2.0 * vg[TW_CY + n]) / (DY * DY);
  var cp: array<f32, NZ>;
  var dp: array<vec2f, NZ>;
  for (var k = 0u; k < NZ; k++) {
    let a = vg[VG_TA + k];
    var c = vg[VG_TCU + k];
    var b = -a - c + vg[VG_RC + k] * lam;
    var r = cx[N + k * NXY + id];
    if (id == 0u && k == 0u) { b = 1.0; c = 0.0; r = vec2f(0.0); } // średnia pozioma: φ(k=0) = 0
    var den = b;
    if (k > 0u) {
      den = b - a * cp[k - 1u];
      r -= a * dp[k - 1u];
    }
    cp[k] = c / den;
    dp[k] = r / den;
  }
  var x = dp[NZ - 1u];
  cx[N + (NZ - 1u) * NXY + id] = x;
  for (var kk = i32(NZ) - 2; kk >= 0; kk--) {
    let k = u32(kk);
    x = dp[k] - cp[k] * x;
    cx[N + k * NXY + id] = x;
  }
}

@compute @workgroup_size(WG)
fn idft_y(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let id = lin_id(gid, nwg);
  if (id >= N) { return; }
  let m = id % NX;
  let j = (id / NX) % NY;
  let base = N + (id / NXY) * NXY + m;
  var acc = vec2f(0.0);
  var t = 0u;
  for (var n = 0u; n < NY; n++) {
    let c = cx[base + n * NX];
    let e = vec2f(vg[TW_CY + t], vg[TW_SY + t]);
    acc += vec2f(c.x * e.x - c.y * e.y, c.x * e.y + c.y * e.x);
    t += j;
    if (t >= NY) { t -= NY; }
  }
  cx[id] = acc;
}

// z = M⁻¹ r (zerowane pod gruntem) + sumy częściowe r·z
@compute @workgroup_size(WG)
fn idft_z(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32,
          @builtin(workgroup_id) wid: vec3u) {
  let id = gid.x;
  var rz = 0.0;
  if (id < N) {
    let i = id % NX;
    let row = id - i;
    var re = 0.0;
    var t = 0u;
    for (var m = 0u; m < NX; m++) {
      let c = cx[row + m];
      re += c.x * vg[TW_CX + t] - c.y * vg[TW_SX + t];
      t += i;
      if (t >= NX) { t -= NX; }
    }
    var z = re / f32(NXY);
    if (!fluid(i32(i), i32((id / NX) % NY), id / NXY)) { z = 0.0; }
    work[W_Z + id] = z;
    rz = work[W_R + id] * z;
  }
  let s = wg_sum(li, rz);
  if (li == 0u) { work[W_PART + wid.x] = s; }
}

// ---- Wiatr docelowy bez części rozbieżnej (na każdym poziomie, 2D): profil wiatru z modelu
// synoptycznego (wiatr + ścinanie liniowe do tropopauzy) ma zbieżności, które w domenie zamieniały się
// w fałszywe wznoszenie (wstrząs i rozległy opad); wznoszenie dużej skali wchodzi osobno (lsTend) ----
fn tgU(l: u32) -> u32 { return P.bslot * TG_SLOT + 2u * N + l; }
fn tgV(l: u32) -> u32 { return P.bslot * TG_SLOT + 3u * N + l; }
@compute @workgroup_size(WG)
fn tgt_div(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let id = lin_id(gid, nwg);
  if (id >= N) { return; }
  let i = i32(id % NX);
  let j = i32((id / NX) % NY);
  let k = id / NXY;
  let d = (tgt[tgU(cidx(i + 1, j, k))] - tgt[tgU(id)]) / DX + (tgt[tgV(cidx(i, j + 1, k))] - tgt[tgV(id)]) / DY;
  work[W_R + id] = d * vg[VG_DZC + k];          // dft_x dzieli przez dz_c
}
@compute @workgroup_size(WG)
fn tgt_lam(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let id = lin_id(gid, nwg);
  if (id >= N) { return; }
  let m = id % NX;
  let n = (id / NX) % NY;
  let lam = -(2.0 - 2.0 * vg[TW_CX + m]) / (DX * DX) - (2.0 - 2.0 * vg[TW_CY + n]) / (DY * DY);
  cx[N + id] = select(cx[N + id] / lam, vec2f(0.0), abs(lam) < 1e-20);
}
@compute @workgroup_size(WG)
fn tgt_idx(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let id = lin_id(gid, nwg);
  if (id >= N) { return; }
  let i = id % NX;
  let row = id - i;
  var re = 0.0;
  var t = 0u;
  for (var m = 0u; m < NX; m++) {
    let c = cx[row + m];
    re += c.x * vg[TW_CX + t] - c.y * vg[TW_SX + t];
    t += i;
    if (t >= NX) { t -= NX; }
  }
  work[W_Z + id] = re / f32(NXY);
}
@compute @workgroup_size(WG)
fn tgt_proj(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let id = lin_id(gid, nwg);
  if (id >= N) { return; }
  let i = i32(id % NX);
  let j = i32((id / NX) % NY);
  let k = id / NXY;
  tgt[tgU(id)] -= (work[W_Z + id] - work[W_Z + cidx(i - 1, j, k)]) / DX;
  tgt[tgV(id)] -= (work[W_Z + id] - work[W_Z + cidx(i, j - 1, k)]) / DY;
}

// Bez terenu M = A, więc jedno zastosowanie M⁻¹ daje rozwiązanie dokładne
@compute @workgroup_size(WG)
fn phi_add(@builtin(global_invocation_id) gid: vec3u) {
  let id = gid.x;
  if (id >= N) { return; }
  work[W_PHI + id] += work[W_Z + id];
}

fn sum_partials(li: u32) -> f32 {
  var s = 0.0;
  for (var p = li; p < NPART; p += WG) { s += work[W_PART + p]; }
  return wg_sum(li, s);
}

// skalary CG: W_SC+0 = r·z, +1 = α, +2 = β
@compute @workgroup_size(WG)
fn cg_rz0(@builtin(local_invocation_index) li: u32) {
  let s = sum_partials(li);
  if (li == 0u) { work[W_SC] = s; work[W_SC + 2u] = 0.0; }
}

@compute @workgroup_size(WG)
fn cg_alpha(@builtin(local_invocation_index) li: u32) {
  let pap = sum_partials(li);
  if (li == 0u) { work[W_SC + 1u] = select(0.0, work[W_SC] / pap, abs(pap) > 1e-30); }
}

@compute @workgroup_size(WG)
fn cg_beta(@builtin(local_invocation_index) li: u32) {
  let rzn = sum_partials(li);
  if (li == 0u) {
    let rz = work[W_SC];
    work[W_SC + 2u] = select(0.0, rzn / rz, abs(rz) > 1e-30);
    work[W_SC] = rzn;
  }
}

// p = z + β p
@compute @workgroup_size(WG)
fn cg_p(@builtin(global_invocation_id) gid: vec3u) {
  let id = gid.x;
  if (id >= N) { return; }
  work[W_P + id] = work[W_Z + id] + work[W_SC + 2u] * work[W_P + id];
}

// Ap = A p, sumy częściowe p·Ap
@compute @workgroup_size(WG)
fn cg_ap(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32,
         @builtin(workgroup_id) wid: vec3u) {
  let id = gid.x;
  var pap = 0.0;
  if (id < N) {
    let i = i32(id % NX);
    let j = i32((id / NX) % NY);
    let k = id / NXY;
    var ap = 0.0;
    if (fluid(i, j, k)) { ap = vg[VG_DZC + k] * applyA(W_P, i, j, k); }
    work[W_AP + id] = ap;
    pap = work[W_P + id] * ap;
  }
  let s = wg_sum(li, pap);
  if (li == 0u) { work[W_PART + wid.x] = s; }
}

// φ += α p,  r −= α Ap
@compute @workgroup_size(WG)
fn cg_xr(@builtin(global_invocation_id) gid: vec3u) {
  let id = gid.x;
  if (id >= N) { return; }
  let a = work[W_SC + 1u];
  work[W_PHI + id] += a * work[W_P + id];
  work[W_R + id] -= a * work[W_AP + id];
}

// u = u* − ∇φ na otwartych ścianach, w miejscu w buforze state; skalary bez zmian
@compute @workgroup_size(WG)
fn project(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let id = lin_id(gid, nwg);
  if (id >= T_OFF) { return; }
  if (id < V_OFF) {
    let i = i32(id % NX);
    let j = i32((id / NX) % NY);
    let k = id / NXY;
    if (openU(i, j, k)) { state[id] -= (work[W_PHI + id] - work[W_PHI + cidx(i - 1, j, k)]) / DX; }
    else { state[id] = 0.0; }
  } else if (id < W_OFF) {
    let l = id - V_OFF;
    let i = i32(l % NX);
    let j = i32((l / NX) % NY);
    let k = l / NXY;
    if (openV(i, j, k)) { state[id] -= (work[W_PHI + l] - work[W_PHI + cidx(i, j - 1, k)]) / DY; }
    else { state[id] = 0.0; }
  } else {
    let l = id - W_OFF;
    let i = i32(l % NX);
    let j = i32((l / NX) % NY);
    let k = l / NXY;
    if (openW(i, j, k)) { state[id] -= (work[W_PHI + l] - work[W_PHI + l - NXY]) / vg[VG_DZW + k]; }
    else { state[id] = 0.0; }
  }
}

// ======================= Diagnostyka =======================

// Pola 3D w środku komórki (numeracja jak w interfejsie)
fn cellField(f: u32, i: i32, j: i32, k: u32) -> f32 {
  let c = cidx(i, j, k);
  let thp = state[T_OFF + c];
  let th = vg[VG_TC + k] + thp;
  let t = th * vg[VG_EXC + k];
  let qv = state[QV_OFF + c];
  switch f {
    case 0u: { return t - 273.15; }
    case 1u: { return th; }
    case 2u: { return th * exp(LV * qv / (CP * t)); }
    case 3u: { return 100.0 * qv / qsat(t, vg[VG_PRS + k]); }
    case 4u: { return 1000.0 * qv; }
    case 5u: { return 1000.0 * state[QC_OFF + c]; }
    case 6u: { return 1000.0 * state[QR_OFF + c]; }
    case 7u: { return 0.5 * (state[W_OFF + c] + state[W_OFF + c + NXY]); }
    case 8u: { return 0.5 * (state[U_OFF + c] + state[U_OFF + cidx(i + 1, j, k)]); }
    case 9u: { return 0.5 * (state[V_OFF + c] + state[V_OFF + cidx(i, j + 1, k)]); }
    case 10u: { return thp; }
    case 13u: { return 1000.0 * state[QI_OFF + c]; }
    case 12u: {
      let uc = 0.5 * (state[U_OFF + c] + state[U_OFF + cidx(i + 1, j, k)]);
      let vc = 0.5 * (state[V_OFF + c] + state[V_OFF + cidx(i, j + 1, k)]);
      return sqrt(uc * uc + vc * vc);
    }
    default: { return work[W_PHI + c] * vg[VG_RC + k] / P.dt; }
  }
}

// Pola mapy przy powierzchni
fn mapField(m: u32, col: u32) -> f32 {
  switch m {
    case 20u: { return sfc[sf(S_T2, col)]; }
    case 21u: { return sfc[sf(S_TD2, col)]; }
    case 22u: { return sfc[sf(S_PR, col)]; }
    case 23u: { return sfc[sf(S_PACC, col)]; }
    case 24u: { return sfc[sf(S_TS, col)] - 273.15; }
    case 25u: { return sfc[sf(S_H, col)]; }
    case 26u: { return sfc[sf(S_LE, col)]; }
    case 27u: { return sfc[sf(S_SW, col)]; }
    case 28u: { return 100.0 * sfc[sf(S_W, col)]; }
    case 29u: { return 1000.0 * sfc[sf(S_LWP, col)]; }
    case 31u: { return sfc[sf(S_TB, col)]; }
    case 32u: { return 100.0 * sfc[sf(S_SND, col)]; }
    case 33u: { return sfc[sf(S_GRN, col)]; }
    case 34u: { return sfc[sf(S_PSL, col)]; }
    case 38u: { return sfc[sf(S_DBZ, col)]; }
    case 39u: { return sfc[sf(S_TBWV, col)]; }
    case 40u: { return sfc[sf(S_VIS, col)]; }
    case 41u: { return sfc[sf(S_PHEN, col)]; }
    case 42u: { return sfc[sf(S_FLASH, col)]; }
    case 43u: { return sfc[sf(S_HAIL, col)]; }
    case 44u: { return sfc[sf(S_CAPE, col)]; }
    case 57u: { return sfc[sf(S_MUCAPE, col)]; }
    case 58u: { return 100.0 * sfc[sf(S_COVER, col)]; }
    case 45u: { return sfc[sf(S_QOUT, col)]; }
    case 46u: { return sfc[sf(S_TMAX, col)]; }
    case 47u: { return sfc[sf(S_TMIN, col)]; }
    case 48u: { return sfc[sf(S_SUNH, col)]; }
    case 49u: { return sfc[sf(S_GUST, col)]; }
    case 50u: { return sfc[sf(S_U10, col)]; }
    default: { return vg[VG_HGT + col]; }
  }
}

// Statystyki (16 liczb): 0 max w, 1 −min w, 2 max θ', 3 −min θ', 4 max |∇·ρu|/ρ, 5 max |V_h|,
// 6/7 max/−min pola na przekroju poziomym, 8/9 na pionowym, 10/11 na mapie (klucze porządkujące),
// 12 max q_c, 13 max q_r, 14 liczba kolumn z chmurą, 15 max opad [mm/h]
var<workgroup> wgs: array<atomic<u32>, 16>;

fn fpos(x: f32) -> u32 { return bitcast<u32>(max(x, 0.0)); }
// Klucz zachowujący porządek dla dowolnego znaku (atomicMax działa na u32)
fn fkey(x: f32) -> u32 {
  let b = bitcast<u32>(x);
  return select(b ^ 0x80000000u, ~b, (b & 0x80000000u) != 0u);
}

@compute @workgroup_size(WG)
fn stats_k(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u,
           @builtin(local_invocation_index) li: u32) {
  if (li < 16u) { atomicStore(&wgs[li], 0u); }
  workgroupBarrier();
  let id = lin_id(gid, nwg);
  if (id < N) {
    let i = i32(id % NX);
    let j = i32((id / NX) % NY);
    let k = id / NXY;
    if (fluid(i, j, k) && inDisp(u32(i), u32(j))) {
      let u0 = state[U_OFF + id];
      let v0 = state[V_OFF + id];
      let u1 = state[U_OFF + cidx(i + 1, j, k)];
      let v1 = state[V_OFF + cidx(i, j + 1, k)];
      let wb = state[W_OFF + id];
      let wt = state[W_OFF + id + NXY];
      let wc = 0.5 * (wb + wt);
      let th = state[T_OFF + id];
      let rc = vg[VG_RC + k];
      let div = rc * ((u1 - u0) / DX + (v1 - v0) / DY)
              + (vg[VG_RW + k + 1u] * wt - vg[VG_RW + k] * wb) / vg[VG_DZC + k];
      let uc = 0.5 * (u0 + u1);
      let vc = 0.5 * (v0 + v1);
      atomicMax(&wgs[0], fpos(wc));
      atomicMax(&wgs[1], fpos(-wc));
      atomicMax(&wgs[2], fpos(th));
      atomicMax(&wgs[3], fpos(-th));
      atomicMax(&wgs[4], fpos(abs(div) / rc));
      atomicMax(&wgs[5], fpos(sqrt(uc * uc + vc * vc)));
      atomicMax(&wgs[12], fpos(state[QC_OFF + id]));
      atomicMax(&wgs[13], fpos(state[QR_OFF + id]));
      let ks = u32(clamp(round(S_of_z(P.sliceZ) - 0.5), 0.0, f32(NZ - 1u)));
      if (P.fieldH < 20u && k == ks) {
        let v = cellField(P.fieldH, i, j, k);
        atomicMax(&wgs[6], fkey(v));
        atomicMax(&wgs[7], fkey(-v));
      }
      if (u32(j) == P.sliceJ && vg[VG_ZC + k] <= P.viewTop) {
        let v = cellField(P.fieldV, i, j, k);
        atomicMax(&wgs[8], fkey(v));
        atomicMax(&wgs[9], fkey(-v));
      }
    }
  }
  if (id < NXY && inDisp(id % NX, id / NX)) {
    if (P.fieldH >= 20u) {
      let v = mapField(P.fieldH, id);
      atomicMax(&wgs[10], fkey(v));
      atomicMax(&wgs[11], fkey(-v));
    }
    // zachmurzenie: oczko liczone z prawdopodobieństwem równym jego kryciu 1 − exp(−τ), τ = 0.15·LWP – to samo,
    // co widać na mapie (satelita, piętra) i w 3D (wcześniej tylko oczka z LWP > 10 g/m² – cienkie chmury pomijane)
    // (chmury kłębiaste – z ich pokrycia oczka COVC, jak na obrazie satelitarnym; warstwowe – na całe oczko)
    let lwC = 1000.0 * clamp(sfc[sf(S_LWPC, id)], 0.0, sfc[sf(S_LWP, id)]);
    let fCv = clamp(sfc[sf(S_COVC, id)], 0.05, 1.0);
    let opq = 1.0 - exp(-0.15 * (1000.0 * sfc[sf(S_LWP, id)] - lwC)) * (1.0 - fCv * (1.0 - exp(-0.15 * lwC / fCv)));
    if (f32(hash(id * 7919u + 1u)) / 4294967295.0 < opq) { atomicAdd(&wgs[14], 1u); }
    atomicMax(&wgs[15], fpos(sfc[sf(S_PR, id)]));
  }
  workgroupBarrier();
  if (li < 16u) {
    if (li == 14u) { atomicAdd(&stats[li], atomicLoad(&wgs[li])); }
    else { atomicMax(&stats[li], atomicLoad(&wgs[li])); }
  }
}

// Średnie poziome na każdym poziomie (jedna grupa robocza na poziom): θ', q_v, zachmurzenie, udział powietrza
@compute @workgroup_size(WG)
fn level_means(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) li: u32) {
  let k = wid.x;
  var sth = 0.0;
  var sqv = 0.0;
  var cnt = 0.0;
  var cld = 0.0;
  var smu = 0.0;
  var smv = 0.0;
  for (var col = li; col < NXY; col += WG) {
    if (k >= kbAt(i32(col % NX), i32(col / NX)) && inDisp(col % NX, col / NX)) {
      let c = k * NXY + col;
      sth += state[T_OFF + c];
      sqv += state[QV_OFF + c];
      smu += state[c];
      smv += state[N + c];
      cnt += 1.0;
      if (state[QC_OFF + c] > 1e-5 || state[QI_OFF + c] > 1e-6) { cld += 1.0; }
    }
  }
  let a = wg_sum(li, sth);
  let b = wg_sum(li, sqv);
  let n = wg_sum(li, cnt);
  let d = wg_sum(li, cld);
  let e = wg_sum(li, smu);
  let h = wg_sum(li, smv);
  if (li == 0u) {
    work[W_MUV + 2u * k] = e / max(n, 1.0);
    work[W_MUV + 2u * k + 1u] = h / max(n, 1.0);
    work[W_MEAN + 4u * k] = a / max(n, 1.0);
    work[W_MEAN + 4u * k + 1u] = b / max(n, 1.0);
    work[W_MEAN + 4u * k + 2u] = d / max(n, 1.0);
    work[W_MEAN + 4u * k + 3u] = n / f32(NXD * NYD);
  }
}

// ==== Tryb lekki (?lite=1; osobny ekran na stronie tytułowej) – dla słabszych kart ====
// Bez dynamiki domeny (adwekcja, rzut ciśnienia, turbulencja 3D, mikrofizyka, konwekcja – ~90% czasu kroku): atmosfera w każdym kroku
// to pole docelowe z modelu synoptycznego (te same profile, korekta klimatu, manipulacja, jądro cyklonu) + w każdej kolumnie:
//  – warstwa graniczna: odchyłka θ i q_v z bilansu przy gruncie (strumienie z jądra surface z poprzedniego kroku) – tempo H/(ρ·c_p·h)
//    bez jego średniej z ~doby (cel ma już ogrzewanie od gruntu modelu synoptycznego, jak HFF) i z powrotem do celu τ 12 h; grubość
//    warstwy z grzania (dzień ~0.2–1.8 km, noc ~120 m) – cykl dobowy, mrozowiska, inwersje;
//  – chmury z wilgotności (warstwowe od RH ~85%, bez cumulusów), pokład w strefach opadu;
//  – opad modelu synoptycznego × mnożnik korekty klimatu × manipulacja, rodzaj z temperatury przy gruncie, krople do radaru.
// Resztę (grunt, śnieg, T i Td 2 m, wiatr 10 m, satelita, radar, widzialność, zjawiska) liczy zwykłe jądro surface – mapy, stacje,
// CSV i analizy działają bez zmian. Pogoda gładka jak w modelu 75 km: bez pojedynczych burz, wyostrzonych frontów i chmur z siatki.
// tryb lekki: pole przy gruncie s – dwuliniowo w punkcie (X, Y) [oczka; środek oczka i: i + 0.5] i w sąsiednim oczku (przy brzegu – brzeg)
fn liteBil(s: u32, X: f32, Y: f32) -> f32 {
  let x = clamp(X - 0.5, 0.0, f32(NX) - 1.001);
  let y = clamp(Y - 0.5, 0.0, f32(NY) - 1.001);
  let i0 = u32(x);
  let j0 = u32(y);
  let fx = x - f32(i0);
  let fy = y - f32(j0);
  let c = j0 * NX + i0;
  return mix(mix(sfc[sf(s, c)], sfc[sf(s, c + 1u)], fx), mix(sfc[sf(s, c + NX)], sfc[sf(s, c + NX + 1u)], fx), fy);
}
// tryb lekki: parametr p sondażu – B-sklejane po węzłach (gładko, bez konturów z prostych odcinków jak dwuliniowo)
fn parBsp(p: u32, X: f32, Y: f32) -> f32 {
  let gx = X / f32(GS);
  let gy = Y / f32(GS);
  let fx = gx - floor(gx);
  let fy = gy - floor(gy);
  let wx = vec4f((1.0 - fx) * (1.0 - fx) * (1.0 - fx), 3.0 * fx * fx * fx - 6.0 * fx * fx + 4.0, -3.0 * fx * fx * fx + 3.0 * fx * fx + 3.0 * fx + 1.0, fx * fx * fx) / 6.0;
  let wy = vec4f((1.0 - fy) * (1.0 - fy) * (1.0 - fy), 3.0 * fy * fy * fy - 6.0 * fy * fy + 4.0, -3.0 * fy * fy * fy + 3.0 * fy * fy + 3.0 * fy + 1.0, fy * fy * fy) / 6.0;
  let b = VG_PGRID + p * NGX * NGY;
  var acc = 0.0;
  for (var m = 0; m < 4; m++) {
    let jj = wrapi(i32(floor(gy)) - 1 + m, NGY);
    var row = 0.0;
    for (var n = 0; n < 4; n++) { row += wx[n] * vg[b + jj * NGX + wrapi(i32(floor(gx)) - 1 + n, NGX)]; }
    acc += wy[m] * row;
  }
  return acc;
}
// wysokość terenu w oczku (przy brzegu – brzeg)
fn liteH(i: i32, j: i32) -> f32 { return vg[VG_HGT + u32(clamp(j, 0, i32(NY) - 1)) * NX + u32(clamp(i, 0, i32(NX) - 1))]; }
// gładki szum gradientowy (Perlin) – bez kształtów w osiach x–y jak szum wartości na siatce; odchylenie std. ~0.6
fn gNz(x: f32, y: f32, per: u32) -> f32 {
  let p0 = floor(vec2f(x, y));
  let f = vec2f(x, y) - p0;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let i0 = u32(i32(p0.x) + 4096);
  let j0 = u32(i32(p0.y) + 4096);
  var c = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
  for (var q = 0u; q < 4u; q++) {
    let di = q & 1u;
    let dj = q >> 1u;
    let a = 6.2832 * f32(hash(((i0 + di) * 73856093u) ^ ((j0 + dj) * 19349663u) ^ (per * 2654435761u))) / 4294967295.0;
    c[q] = dot(vec2f(cos(a), sin(a)), f - vec2f(f32(di), f32(dj)));
  }
  return 2.2 * mix(mix(c[0], c[1], u.x), mix(c[2], c[3], u.x), u.y);
}
// to samo płynące z wiatrem (um, vm [m/s]): dwa pokolenia przesunięte o tau, przejście kosinusowe (jak flowNoise)
fn liteFlow(X: f32, Y: f32, lc: f32, tau: f32, sd: u32, um: f32, vm: f32) -> f32 {
  let per = u32(P.time / tau);
  let ft = fract(P.time / tau);
  let ag = ft * tau;
  let a = gNz((X - um * ag / DX) / lc, (Y - vm * ag / DY) / lc, per + sd);
  let b = gNz((X - um * (ag - tau) / DX) / lc, (Y - vm * (ag - tau) / DY) / lc, per + 1u + sd);
  return cos(1.5708 * ft) * a + sin(1.5708 * ft) * b;
}
fn liteNb(s: u32, i: i32, j: i32) -> f32 { return sfc[sf(s, u32(clamp(j, 0, i32(NY) - 1)) * NX + u32(clamp(i, 0, i32(NX) - 1)))]; }
// ---- Tryb lekki: burze jako obiekty (jądro lite_storm, jedna grupa robocza) ----
// Bez małych komórek – tylko duże układy: skupiska wielokomórkowe (r 15–30 km), pojedyncze superkomórki (r 12–18 km, przy silnym ścinaniu i SRH)
// i linie / MCS (rdzeń 12–20 km × 120–280 km poprzecznie do ścinania, z częścią warstwową za linią). Rodzą się co termin (30 min) tam, gdzie MUCAPE
// ≥ ~300–1500 J/kg i jest wymuszenie (opad konwekcyjny modelu synoptycznego, wznoszenie dużej skali, grzanie od gruntu), nie w zimnym wypływie
// i nie obok innej burzy; liczba narodzin ~1 na (150 km)² na 3 h przy pełnym potencjale. Płyną z wiatrem 0–6 km (superkomórki prawoskrętne wg
// Bunkersa), rosną ~40 min, gasną w ostatniej ⅓ życia (szybciej w powietrzu bez chwiejności). Losowanie z numeru kroku – przebieg powtarzalny.
// Miejsce s: 0 czynna, 1 wiek [s], 2 życie [s], 3–4 położenie [oczka], 5 rodzaj (1 skupisko, 2 superkomórka, 3 linia), 6 r [m], 7 L – połowa
// długości [m], 8 kierunek osi [rad], 9 opad rdzenia [mm/h], 10–11 ruch [m/s], 12 siła (cykl życia 0…1), 13 wierzchołek [m]
const NSTM: u32 = 32u;
var<workgroup> lsP: array<f32, 64>;
var<workgroup> lsQ: array<f32, 64>;
// budżet opadu burz (za 32 miejscami): 0 – współczynnik kS (liczba narodzin × kS, opad × kS w granicach 0.5…1.2)
const W_STK: u32 = W_STM + NSTM * 16u;
// opad konwekcyjny modelu synoptycznego, który zastępują burze [mm/h] w kandydacie q (jak w lite_col)
fn litePc(q: u32, nxc: u32) -> f32 {
  let ci = NE + 2u * (q % nxc) + 1u;
  let cj = NE + 2u * (q / nxc) + 1u;
  let X = f32(ci) + 0.5;
  let Y = f32(cj) + 0.5;
  let fpc = ccBil(X, Y, 7u);
  let mu = sfc[sf(S_MUCAPE, cj * NX + ci)];
  return max(parBsp(13u, X, Y), 0.0) * max(clamp(parBsp(14u, X, Y), 0.0, 1.0), smoothstep(500.0, 1500.0, mu)) * smoothstep(300.0, 1000.0, mu)
         * 1.0 * P.rainF;
}
fn stmU(seed: u32) -> f32 { return f32(hash(seed)) / 4294967295.0; }
// szum burzy zmieniający się w czasie (nowe ułożenie co ~40 min wieku burzy, przejście kosinusowe – stała wariancja): rdzenie się odnawiają
fn stNz(x: f32, y: f32, sd: u32, age: f32) -> f32 {
  let tq = age / 2400.0;
  let k = u32(tq);
  let f = 1.5708 * fract(tq);
  return 1.6 * (cos(f) * gNz(x, y, sd + 11u * k) + sin(f) * gNz(x, y, sd + 11u * (k + 1u)));   // (szum gradientowy – szum wartości ciął kształty w prostokąty)
}
// potencjał narodzin w kandydacie q (siatka co 2 oczka we wnętrzu, bez strefy brzegowej)
fn litePot(q: u32, nxc: u32) -> f32 {
  let ci = NE + 2u * (q % nxc) + 1u;
  let cj = NE + 2u * (q / nxc) + 1u;
  let c = cj * NX + ci;
  let X = f32(ci) + 0.5;
  let Y = f32(cj) + 0.5;
  let fpc = ccBil(X, Y, 7u);
  let peC = max(parAt(13u, X, Y), 0.0) * clamp(parAt(14u, X, Y), 0.0, 1.0) * 1.0 * P.rainF;
  let trig = max(max(smoothstep(0.05, 0.6, peC), smoothstep(0.01, 0.05, parAt(11u, X, Y))), 0.6 * smoothstep(100.0, 300.0, sfc[sf(S_H, c)]));
  let lbt = sfc[sf(select(S_LBT, S_LBT2, (P.step & 1u) == 1u), c)];
  var p = smoothstep(300.0, 1500.0, sfc[sf(S_MUCAPE, c)]) * trig * (1.0 - smoothstep(-1.0, -3.0, lbt));
  for (var s = 0u; s < NSTM; s++) {
    let b = W_STM + s * 16u;
    if (work[b] < 0.5) { continue; }
    let d = vec2f((X - work[b + 3u]) * DX, (Y - work[b + 4u]) * DY);
    if (length(d) < 2.5 * work[b + 7u] + 20000.0) { p = 0.0; }
  }
  return p;
}
@compute @workgroup_size(64)
fn lite_storm(@builtin(local_invocation_index) li: u32) {
  let dt = P.dt;
  // -- ruch i cykl życia --
  if (li < NSTM) {
    let b = W_STM + li * 16u;
    if (work[b] > 0.5) {
      var age = work[b + 1u] + dt;
      let life = work[b + 2u];
      var x = work[b + 3u];
      var y = work[b + 4u];
      let ci = u32(clamp(i32(x), 0, i32(NX) - 1));
      let cj = u32(clamp(i32(y), 0, i32(NY) - 1));
      let c = cj * NX + ci;
      var tv = vec2f(sfc[sf(S_MWU, c)], sfc[sf(S_MWV, c)]);
      let sh = vec2f(sfc[sf(S_SHU, c)], sfc[sf(S_SHV, c)]);
      // superkomórka: ruch prawoskrętny wg Bunkersa (7.5 m/s w prawo od ścinania; na półkuli S – w lewo)
      if (work[b + 5u] > 1.5 && work[b + 5u] < 2.5) { tv += 7.5 * sign(latAt(i32(cj)) + 1e-6) * vec2f(sh.y, -sh.x) / max(length(sh), 1.0); }
      var v = vec2f(work[b + 10u], work[b + 11u]);
      v += min(dt / 1800.0, 1.0) * (tv - v);
      x += v.x * dt / DX;
      y += v.y * dt / DY;
      // w powietrzu bez chwiejności starzeje się 3× szybciej
      age += dt * (1.0 - smoothstep(150.0, 500.0, sfc[sf(S_MUCAPE, c)]));     // (bez chwiejności 2× szybciej – przy 3× wieczorem wszystkie gasły naraz)
      let gone = x < f32(NE) || x > f32(NX - NE) || y < f32(NE) || y > f32(NY - NE);
      if (age >= life || gone) {
        work[b] = 0.0;
        work[b + 12u] = 0.0;
      } else {
        work[b + 1u] = age;
        work[b + 3u] = x;
        work[b + 4u] = y;
        work[b + 10u] = v.x;
        work[b + 11u] = v.y;
        work[b + 12u] = smoothstep(0.0, 5400.0, age) * (1.0 - smoothstep(0.65 * life, life, age));   // narasta ~1.5 h
      }
    }
  }
  workgroupBarrier();
  // -- narodziny: co termin (30 min) --
  let per = max(u32(1800.0 / dt + 0.5), 1u);
  if (P.step % per != 0u) { return; }
  let nxc = (NX - 2u * NE) / 2u;
  let nc = nxc * ((NY - 2u * NE) / 2u);
  var sum = 0.0;
  var sq = 0.0;
  for (var q = li; q < nc; q += 64u) { sum += litePot(q, nxc); sq += litePc(q, nxc); }
  lsP[li] = sum;
  lsQ[li] = sq;
  workgroupBarrier();
  if (li != 0u) { return; }
  var tot = 0.0;
  var qtot = 0.0;
  for (var t = 0u; t < 64u; t++) { tot += lsP[t]; qtot += lsQ[t]; }
  // Budżet: burze razem mają dawać tyle opadu, ile opad konwekcyjny modelu synoptycznego, który zastępują (z mnożnikiem korekty klimatu). Bez tego dokładały opad
  // niezależnie od modelu – roczne sumy 700–1600+ mm w Polsce (użytkownik). Regulator co termin: kS × (opad do zastąpienia / opad czynnych burz)^½ (0.7…1.3×);
  // mniej opadu konwekcyjnego w modelu – mniej narodzin (× kS) i słabsze burze (× kS w granicach 0.5…1.2)
  let pcv = qtot * 4.0 * DX * DY;                                // [mm/h·m²]
  var kS = work[W_STK];
  if (kS <= 0.0) { kS = 1.0; }
  var vst = 0.0;
  for (var s2 = 0u; s2 < NSTM; s2++) {
    let b2 = W_STM + s2 * 16u;
    if (work[b2] < 0.5) { continue; }
    let e2 = work[b2 + 12u];
    let r2 = work[b2 + 6u];
    let fl2 = clamp(work[b2 + 1u] / max(work[b2 + 2u], 1.0), 0.0, 1.0);
    if (work[b2 + 5u] > 2.5) {
      let Lc = work[b2 + 7u] * (0.3 + 0.7 * smoothstep(0.0, 0.4, fl2));
      let eC = smoothstep(0.0, 0.2, fl2) * (1.0 - smoothstep(0.7, 1.0, fl2));
      let wsum = max(0.35 * r2, 1.3 * DX) + max(0.7 * r2, 2.0 * DX);
      let ws = max(r2, 2.0 * DX) * (1.5 + 3.5 * smoothstep(0.15, 0.7, fl2));
      vst += work[b2 + 9u] * (eC * 1.45 * Lc * 0.886 * wsum * 0.5 + 0.11 * smoothstep(0.05, 0.4, fl2) * 1.8 * Lc * 0.886 * ws * 0.8);
    } else {
      let rf = max(r2, 2.2 * DX) * (0.45 + 0.55 * e2);
      vst += work[b2 + 9u] * (e2 * 3.1416 * rf * rf / 2.6 * 0.8 + 0.09 * smoothstep(0.2, 0.5, fl2) * 3.1416 * 2.89 * rf * rf);
    }
  }
  vst *= clamp(kS, 0.5, 1.2);
  if (vst > 1e8) { kS *= clamp(sqrt(pcv / vst), 0.7, 1.3); }
  else if (pcv > 1e8) { kS *= 1.2; }
  else { kS *= 0.85; }
  kS = clamp(kS, 0.02, 1.5);
  work[W_STK] = kS;
  let lam = kS * tot * 4.0 * DX * DY / 2.25e10 * (f32(per) * dt / 10800.0);
  var seed = hash(P.step * 7919u + 17u);
  var nsp = min(u32(floor(lam)) + select(0u, 1u, stmU(seed) < fract(lam)), 3u);
  for (var n = 0u; n < nsp; n++) {
    seed = hash(seed + 101u);
    var tg = stmU(seed) * tot;
    var t = 0u;
    while (t < 63u && tg > lsP[t]) { tg -= lsP[t]; t++; }
    var qc = t;
    var acc = 0.0;
    for (var q = t; q < nc; q += 64u) { acc += litePot(q, nxc); qc = q; if (acc >= tg) { break; } }
    if (litePot(qc, nxc) <= 0.0) { continue; }
    var s = NSTM;
    for (var k = 0u; k < NSTM; k++) { if (work[W_STM + k * 16u] < 0.5) { s = k; break; } }
    if (s == NSTM) { break; }
    let ci = NE + 2u * (qc % nxc) + 1u;
    let cj = NE + 2u * (qc / nxc) + 1u;
    let c = cj * NX + ci;
    let X = f32(ci) + 0.5;
    let Y = f32(cj) + 0.5;
    let mu = sfc[sf(S_MUCAPE, c)];
    let sh = vec2f(sfc[sf(S_SHU, c)], sfc[sf(S_SHV, c)]);
    let shm = length(sh);
    let fpc = ccBil(X, Y, 7u);
    let peC = max(parAt(13u, X, Y), 0.0) * clamp(parAt(14u, X, Y), 0.0, 1.0) * 1.0 * P.rainF;
    let u1 = stmU(seed + 1u);
    let u2 = stmU(seed + 2u);
    let u3 = stmU(seed + 3u);
    // opad rdzenia rośnie z CAPE i wilgotnością przy gruncie (6 → 16 g/kg: ×0.4 … ×1.3) i z manipulacją opadu
    let fq = clamp((state[QV_OFF + kbAt(i32(ci), i32(cj)) * NXY + c] * 1000.0 - 6.0) / 10.0 + 0.4, 0.4, 1.3) * (0.5 + 0.5 * smoothstep(500.0, 3000.0, mu)) * P.rainF;
    var ty = 1.0;
    var r = 15000.0 + 15000.0 * u1;
    var L = r;
    var R0 = (20.0 + 30.0 * u2) * fq;
    var life = 9000.0 + 7200.0 * u3;
    var ang = atan2(sh.y, sh.x);
    if (shm >= 18.0 && sfc[sf(S_SRH03, c)] >= 120.0) {
      ty = 2.0; r = 12000.0 + 6000.0 * u1; L = 1.3 * r; R0 = (50.0 + 40.0 * u2) * fq; life = 10800.0 + 7200.0 * u3;
    } else if (shm >= 10.0 && mu >= 800.0 && (peC > 0.2 || parAt(11u, X, Y) > 0.02)) {
      ty = 3.0; r = 12000.0 + 8000.0 * u1; L = 60000.0 + 80000.0 * u2; R0 = (30.0 + 30.0 * u3) * fq; life = 21600.0 + 21600.0 * u1;
      ang += 1.5708;                                              // linia poprzecznie do ścinania 0–6 km
    }
    let b = W_STM + s * 16u;
    work[b] = 1.0;
    work[b + 1u] = 0.0;
    work[b + 2u] = life;
    work[b + 3u] = X;
    work[b + 4u] = Y;
    work[b + 5u] = ty;
    work[b + 6u] = r;
    work[b + 7u] = L;
    work[b + 8u] = ang;
    work[b + 9u] = R0;
    work[b + 10u] = sfc[sf(S_MWU, c)];
    work[b + 11u] = sfc[sf(S_MWV, c)];
    work[b + 12u] = 0.0;
    work[b + 13u] = clamp(sfc[sf(S_MUEL, c)], 7000.0, 16000.0);
  }
}
@compute @workgroup_size(64)
fn lite_col(@builtin(global_invocation_id) gid: vec3u) {
  let col = gid.x;
  if (col >= NXY) { return; }
  let i = i32(col % NX);
  let j = i32(col / NX);
  let kb = kbAt(i, j);
  let X = f32(i) + 0.5;
  let Y = f32(j) + 0.5;
  let a = P.ta1;
  let dt = P.dt;
  let h = vg[VG_HGT + col];
  let rho = vg[VG_RC + kb];
  // -- warstwa graniczna --
  // wiatr ~300 m nad gruntem (przenoszenie odchyłki, grubość nocnej warstwy)
  var kw = kb;
  for (var k = kb; k < NZ - 1u; k++) { kw = k; if (vg[VG_ZC + k] - h > 300.0) { break; } }
  let uw = tgAt(2u, kw * NXY + col, a);
  let vw = tgAt(3u, kw * NXY + col, a);
  let hf = sfc[sf(S_H, col)];
  let hday = clamp(200.0 + 4.0 * max(hf, 0.0), 200.0, 1800.0);
  // noc: ~100 m w ciszy, z wiatrem grubsza (mieszanie mechaniczne) – przy wietrze ochłodzenie nad śniegiem i w dolinach słabsze
  let heff = mix(min(100.0 + 50.0 * length(vec2f(uw, vw)), 600.0), hday, smoothstep(-10.0, 40.0, hf));
  let rT = hf / (rho * CP * 0.89 * heff);                         // [K/s]
  let rQ = sfc[sf(S_LE, col)] / LV / (rho * 0.89 * heff);          // [1/s]
  let aD = min(dt / 86400.0, 1.0);
  let mT = sfc[sf(S_LBH, col)] + aD * (rT - sfc[sf(S_LBH, col)]);
  let mQ = sfc[sf(S_LBE, col)] + aD * (rQ - sfc[sf(S_LBE, col)]);
  sfc[sf(S_LBH, col)] = mT;
  sfc[sf(S_LBE, col)] = mQ;
  let aR = min(dt / 43200.0, 1.0);
  // odchyłka płynie z wiatrem (punkt odejścia, dwuliniowo) i miesza się trochę z sąsiadami – dwa bufory na zmianę wg parzystości kroku (wynik nie zależy
  // od kolejności wątków). Wcześniej każda kolumna osobno: zaśnieżone oczka wychładzały się bez wymiany z otoczeniem – kanciaste plamy zimna i ciepła (użytkownik)
  let odd = (P.step & 1u) == 1u;
  let sT = select(S_LBT, S_LBT2, odd);
  let sQ = select(S_LBQ, S_LBQ2, odd);
  let Xd = X - uw * dt / DX;
  let Yd = Y - vw * dt / DY;
  let nT = 0.25 * (liteNb(sT, i - 1, j) + liteNb(sT, i + 1, j) + liteNb(sT, i, j - 1) + liteNb(sT, i, j + 1));
  let nQ = 0.25 * (liteNb(sQ, i - 1, j) + liteNb(sQ, i + 1, j) + liteNb(sQ, i, j - 1) + liteNb(sQ, i, j + 1));
  var lbt = mix(liteBil(sT, Xd, Yd), nT, 0.05) + dt * (rT - mT);
  // przyciąganie do oczekiwanego cyklu dobowego (τ 4 h): połowa amplitudy z modelu synoptycznego (halfDiur = tsOff/0.4, ~±6–7 K w lipcu w Polsce przy
  // bezchmurnym niebie), maksimum ~15:00, minimum nad ranem; mniejsza przy chmurach, wietrze i nad wodą. Sam bilans przy gruncie z powrotem do średniej
  // (τ 12 h) dawał ~7 K zakresu przy ~10–11 K w pomiarach – za dużo nocy tropikalnych, za mało dni upalnych (użytkownik)
  let phiL = latAt(j);
  let ha = P.hang + radians((X - f32(MG) - 0.5 * f32(NXD)) * DX / (111195.0 * max(cos(phiL), 0.05)));
  // (zachmurzenie średnie z ~doby: z bieżącego noc – z chmurami z wilgotności częściej niż dzień – była ściągana do łagodniejszego minimum: więcej nocy
  // tropikalnych niż dni upalnych, użytkownik)
  let lcv = sfc[sf(S_LCV, col)] + min(dt / 86400.0, 1.0) * (clamp(sfc[sf(S_COVER, col)], 0.0, 1.0) - sfc[sf(S_LCV, col)]);
  sfc[sf(S_LCV, col)] = lcv;
  // (zakres ~30% większy niż połowa amplitudy halfDiur z modelu, słabiej tłumiony chmurami i wiatrem – prawie bez dni upalnych, użytkownik)
  let gA = 1.3 * (1.0 - 0.3 * lcv) * (1.0 - 0.25 * smoothstep(4.0, 12.0, length(vec2f(uw, vw))))
         * select(1.0, 0.15, u32(vg[VG_VEG + col] + 0.5) == 10u);
  // (cel podniesiony o średnią różnicę T 2 m − powietrze 1. warstwy z ~2 dób: do średniej dobowej z normy ściągane jest powietrze ~30 m nad gruntem, a nocna
  // inwersja przy gruncie obniżała średnią T 2 m o ~1 K – lato za zimne, czerwiec 15.7 °C, użytkownik)
  let lt21 = sfc[sf(S_LT21, col)] + min(dt / 172800.0, 1.0) * (sfc[sf(S_T2, col)] - sfc[sf(S_T1, col)] - sfc[sf(S_LT21, col)]);
  sfc[sf(S_LT21, col)] = lt21;
  let dStar = P.tsOff * (2.5 * gA * cos(ha - 0.7854) - 1.0) - clamp(lt21, -3.0, 3.0);
  lbt = clamp(lbt + min(dt / 14400.0, 1.0) * (dStar - lbt), -18.0, 15.0);
  var lbq = mix(liteBil(sQ, Xd, Yd), nQ, 0.05) + dt * (rQ - mQ);
  lbq = clamp(lbq - aR * lbq, -0.006, 0.006);
  // -- burze (lite_storm): opad rdzenia (i części warstwowej za linią MCS), chmura i kowadło, zimny wypływ --
  var prS = 0.0;                                                   // opad burz [mm/h]
  var stC = 0.0;                                                   // rdzeń (chmura do wierzchołka)
  var stA = 0.0;                                                   // kowadło
  var stZ = 0.0;                                                   // wierzchołek [m nad gruntem]
  var stK = 0.0;                                                   // zimny wypływ
  var stS = 0.0;                                                   // opad warstwowy burz [mm/h] – do pola LPR
  for (var s = 0u; s < NSTM; s++) {
    let b = W_STM + s * 16u;
    let e = work[b + 12u];
    if (work[b] < 0.5 || e < 0.01) { continue; }
    let d = vec2f((X - work[b + 3u]) * DX, (Y - work[b + 4u]) * DY);
    let r = work[b + 6u];
    let L = work[b + 7u];
    let age = work[b + 1u];
    let fl = clamp(age / max(work[b + 2u], 1.0), 0.0, 1.0);          // część życia
    let sd = u32(work[b + 2u]) ^ (s * 7919u);
    let dir = vec2f(cos(work[b + 8u]), sin(work[b + 8u]));
    var core = 0.0;
    var strat = 0.0;
    var dAn = 0.0;                                                   // odległość od obszaru kowadła (1 – brzeg)
    if (work[b + 5u] > 2.5) {
      // -- linia / MCS: młoda – kilka osobnych komórek na krótkim odcinku, które się łączą i wydłużają (do 40% życia), dojrzała – wygięta, w łuk w stronę ruchu
      // (bow echo), z rdzeniami odnawiającymi się co ~40 min, schyłek – rwie się na odcinki, a część warstwowa (pole opadu LPR) zostaje i dryfuje.
      // Szerokości i skale nie mniejsze niż ~1.3–2.5 oczka (węższa linia próbkowana w środkach oczek dawała schodki – użytkownik: kanciasto)
      let vm = vec2f(work[b + 10u], work[b + 11u]);
      var nrm = vec2f(-dir.y, dir.x);
      if (dot(nrm, vm) < 0.0) { nrm = -nrm; }                        // przód linii – w stronę ruchu
      let Lc = L * (0.3 + 0.7 * smoothstep(0.0, 0.4, fl));
      let al = dot(d, dir);
      let ua = al / Lc;
      let bow = 0.3 * Lc * (0.3 + 0.7 * stmU(sd + 5u)) * smoothstep(0.25, 0.6, fl) * max(1.0 - ua * ua, 0.0);
      let arc = 0.15 * Lc * (2.0 * stmU(sd + 4u) - 1.0) * ua * ua;   // wygięcie całej linii
      let db = dot(d, nrm) - bow - arc - 0.1 * Lc * gNz(al / (0.5 * Lc), 0.37, sd + 6u);
      let endA = 1.0 - smoothstep(0.45, 1.0, abs(ua));
      let w = select(max(0.7 * r, 2.0 * DX), max(0.35 * r, 1.3 * DX), db > 0.0);
      let lcell = max(1.2 * r, 2.5 * DX);
      let cAmp = mix(0.95, 0.6, smoothstep(0.1, 0.4, fl));          // młoda linia – wyraźnie osobne komórki
      let cells = clamp(0.55 + cAmp * stNz(al / lcell, db / lcell, sd + 7u, age), 0.03, 1.6);
      let tb0 = -1.2 + 2.4 * smoothstep(0.6, 1.0, fl);
      let seg = smoothstep(tb0, tb0 + 0.4, 1.6 * gNz(al / (0.35 * Lc), 0.71, sd + 8u));
      let eC = smoothstep(0.0, 0.2, fl) * (1.0 - smoothstep(0.7, 1.0, fl));
      core = eC * exp(-db * db / (w * w)) * cells * seg * endA;
      // strefa przejściowa i część warstwowa za linią: rośnie z wiekiem (szerokość do ~5 r), 2–7 mm/h
      let ws = max(r, 2.0 * DX) * (1.5 + 3.5 * smoothstep(0.15, 0.7, fl));
      let c0 = 1.3 * max(r, 2.0 * DX) + 0.55 * ws;
      let nS = stNz(al / max(0.9 * r, 2.0 * DX) + 0.3 * db / r, db / max(0.8 * r, 2.0 * DX), sd + 9u, age);
      let eS = smoothstep(0.05, 0.4, fl);
      strat = 0.11 * eS * exp(-sqr2((db + c0) / (0.5 * ws * clamp(1.0 + 0.3 * nS, 0.6, 1.4)))) * (1.0 - smoothstep(0.6, 1.2, abs(ua)))
              * clamp(0.75 + 0.45 * nS, 0.2, 1.4);
      let ex = max(abs(al) - 1.05 * Lc, 0.0);
      let ey = max(max(db - 0.8 * r, -(db + c0 + 0.6 * ws)), 0.0);
      dAn = sqrt(ex * ex + ey * ey) / (1.5 * r);
    } else {
      // -- skupiska i superkomórki: brzeg z płatów (harmoniczne kąta), rosną z siłą; od ~⅓ życia słabszy opad z kowadła wokół (pole LPR – zostaje po burzy) --
      let ea = max(abs(dot(d, dir)) - (L - r), 0.0);
      let eb = dot(d, vec2f(-dir.y, dir.x));
      let rr = sqrt(ea * ea + eb * eb);
      let th = atan2(d.y, d.x);
      let ph = 6.2832 * vec3f(stmU(sd + 11u), stmU(sd + 12u), stmU(sd + 13u)) + age * vec3f(1.3e-4, -2.1e-4, 3.0e-4);
      let lob = 0.2 * sin(2.0 * th + ph.x) + 0.14 * sin(3.0 * th + ph.y) + 0.08 * sin(5.0 * th + ph.z);
      let rf = max(r, 2.2 * DX) * (1.0 + lob) * (0.45 + 0.55 * e);
      let rho = rr / rf;
      let ca = 6.2832 * stmU(sd + 14u);
      let q1 = mat2x2f(cos(ca), sin(ca), -sin(ca), cos(ca)) * d / max(0.45 * r, 1.5 * DX);
      let q2 = mat2x2f(0.809, 0.588, -0.588, 0.809) * q1 * 1.8;
      let cl = clamp(0.8 + 0.25 * stNz(q1.x, q1.y, sd + 2u, age) + 0.12 * stNz(q2.x, q2.y, sd + 3u, age), 0.35, 1.3);
      core = e * exp(-2.6 * rho * rho) * (1.0 - smoothstep(0.85, 1.25, rho)) * cl;
      strat = 0.09 * smoothstep(0.2, 0.5, fl) * exp(-sqr2(rr / (1.7 * rf))) * clamp(0.8 + 0.3 * stNz(q1.x * 0.5, q1.y * 0.5, sd + 4u, age), 0.4, 1.3);
      dAn = rr / ((2.6 + 0.6 * lob) * max(r, 2.2 * DX));
    }
    // (część warstwowa nie tu, tylko w polu opadu LPR – po wygaśnięciu burzy zostaje i zanika ~1.5 h)
    let kI = clamp(select(1.0, work[W_STK], work[W_STK] > 0.0), 0.5, 1.2);     // (budżet opadu burz – lite_storm)
    stS = max(stS, kI * work[b + 9u] * strat);
    prS += kI * work[b + 9u] * core;
    stC = max(stC, core);
    let an = e * (1.0 - smoothstep(0.6, 1.0, dAn));
    stA = max(stA, an);
    if (an > 0.05) { stZ = max(stZ, work[b + 13u]); }
    stK = max(stK, min(core + 2.0 * strat, 1.0));
  }
  // zimny wypływ: przy gruncie do ~−5 K pod opadem (τ 30 min), dalej płynie z wiatrem jak cała odchyłka i hamuje nowe burze
  lbt += min(dt / 1800.0, 1.0) * stK * (min(lbt, -5.0) - lbt);
  sfc[sf(select(S_LBT2, S_LBT, odd), col)] = lbt;
  sfc[sf(select(S_LBQ2, S_LBQ, odd), col)] = lbq;
  // -- opad modelu synoptycznego --
  let fpc = ccBil(X, Y, 7u);
  // (opad konwekcyjny modelu synoptycznego zastępują burze tam, gdzie jest chwiejność – MUCAPE 300–1000 J/kg; gdzie jej nie ma, zostaje gładki)
  // Opad modelu synoptycznego przeskalowany do oczka (wcześniej gładkie pole ~75 km obok burz – użytkownik):
  //  – czytany gładko (B-sklejane po węzłach co 4 oczka – dwuliniowo kontury z prostych odcinków, „kanciaste”);
  //  – osobne pole płynie z wiatrem 0–6 km i dąży do opadu modelu z τ 45 min (pole modelu zmienia się tylko co termin – przy 20 000× opad skakał co ~0.1 s);
  //  – góry z nachylenia terenu wygładzonego na ±2 oczka (nawietrzne do ×1.6, zawietrzne do ×0.6; z nachylenia jednego oczka i do ×2.5 – pasma wzdłuż grzbietów);
  //  – faktura z gładkiego szumu gradientowego płynącego z wiatrem (×0.4…1.7, średnia zachowana; szum na siatce dawał kształty w osiach x–y)
  let mu6 = sfc[sf(S_MWU, col)];
  let mv6 = sfc[sf(S_MWV, col)];
  // (burze zastępują część konwekcyjną opadu modelu, a w powietrzu wyraźnie chwiejnym – MUCAPE 500–1500 J/kg – cały: model synoptyczny zalicza latem do konwekcji
  // mały ułamek opadu, a przy samej części konwekcyjnej budżet burz był znikomy – 0.6 z 23 mm w 15 dobach lipca)
  let muL = sfc[sf(S_MUCAPE, col)];
  let base = max(parBsp(13u, X, Y), 0.0) * (1.0 - max(clamp(parBsp(14u, X, Y), 0.0, 1.0), smoothstep(500.0, 1500.0, muL)) * smoothstep(300.0, 1000.0, muL))
             * 1.0 * P.rainF;
  let sP = select(S_LPR, S_LPR2, odd);
  let lpa = liteBil(sP, X - mu6 * dt / DX, Y - mv6 * dt / DY);
  // (nadwyżka ponad opad modelu – pozostałość burz – zanika wolniej, τ 90 min)
  let lpr = max(mix(lpa, base, min(dt / select(2700.0, 5400.0, lpa > base), 1.0)), stS);
  sfc[sf(select(S_LPR2, S_LPR, odd), col)] = lpr;
  let slx = (liteH(i + 2, j) - liteH(i - 2, j)) / (4.0 * DX);
  let sly = (liteH(i, j + 2) - liteH(i, j - 2)) / (4.0 * DY);
  let fOro = clamp(1.0 + 1.2 * (uw * slx + vw * sly), 0.6, 1.6);
  let lcT = max(30000.0 / DX, 2.0);
  let nT1 = liteFlow(X, Y, lcT, 5400.0, 31u, mu6, mv6);
  let nT2 = liteFlow(0.809 * X - 0.588 * Y, 0.588 * X + 0.809 * Y, 0.4 * lcT, 3600.0, 37u, 0.809 * mu6 - 0.588 * mv6, 0.588 * mu6 + 0.809 * mv6);
  let fTex = clamp(1.0 + 0.2 * nT1 + 0.1 * nT2, 0.55, 1.5);     // (słabsza – sumy opadu gładsze)
  // Opad do normy (tryb lekki; użytkownik: „przeskaluj ilość opadów”): każde oczko pamięta średni opad bez skalowania z ~30 dób (pole LRM, dwa bufory,
  // mieszane z sąsiadami 5%/krok – wygładzone na ~100–150 km, więc góry i różnice regionalne zostają), a opad × norma / ta średnia (0.15…1.5).
  // Norma miesięczna [mm/h] z węzłów korekty klimatu (slot 7 – w trybie lekkim norma zamiast mnożnika z kopii; < 0 – brak normy, bez skalowania).
  // Wcześniej mnożnik z kopii modelu (norma / średni opad kopii) – zostawiał miesiące po 300 mm (użytkownik)
  // wysokość względem średniej wysokości oczka danych normy (2.5°, węzły korekty – VG_CCE): +60% na 1000 m (×0.5…2.2). Względem średniej terenu ±100 km
  // kotliny w górach (Podhale) wychodziły „nisko” i suche – 288 mm lata na Podhalu przy 388 w centrum (użytkownik)
  let fEl = clamp(1.0 + 6e-4 * (h - ccElev(X, Y)), 0.5, 2.2);
  // regulator widzi tylko opad dużej skali (bez gór, wysokości i faktury) – wzór opadu z terenu zostaje w sumach (użytkownik: opad rozłożony zbyt równo)
  let prLS = lpr + prS;
  let prRaw = lpr * fOro * fTex * fEl + prS;
  // Regulator całkujący na opadzie już przeskalowanym: LRM – średni opad dużej skali × kP z ~20 dób (wygładzony na ~200 km), kP zmienia się powoli
  // (τ ~20 dób) tak, by LRM = norma. Wcześniej kP = norma / średni opad bez skalowania: średnia reaguje z opóźnieniem, a opad pada zwykle po suchym okresie,
  // kiedy średnia jest niska – mokre okresy dostawały systematycznie za duży mnożnik (lato w centrum 388 mm, użytkownik)
  let sR = select(S_LRM, S_LRM2, odd);
  var kP = sfc[sf(S_LKP, col)];
  if (kP <= 0.0) { kP = 1.0; }
  var lr0 = sfc[sf(sR, col)];
  if (lr0 <= 0.0) { lr0 = max(fpc, 0.0); }
  let nR = 0.25 * (liteNb(sR, i - 1, j) + liteNb(sR, i + 1, j) + liteNb(sR, i, j - 1) + liteNb(sR, i, j + 1));
  var lrm = mix(lr0, select(lr0, nR, nR > 0.0), 0.15);
  lrm += min(dt / 1728000.0, 1.0) * (prLS * kP - lrm);
  sfc[sf(select(S_LRM2, S_LRM, odd), col)] = lrm;
  if (fpc > 0.0) {
    kP = clamp(kP * exp(clamp(log(max(fpc, 1e-5) / max(lrm, 1e-5)), -1.0, 1.0) * min(dt / 1728000.0, 1.0)), 0.15, 2.5);
  } else {
    kP = 1.0;
  }
  sfc[sf(S_LKP, col)] = kP;
  // (× 0.8 po regulatorze – użytkownik: po regulatorze dalej za mokro, „obniż mnożnik”; regulator pilnuje opadu dużej skali, góry i faktura dokładały ponad normę)
  let kOut = 0.8 * kP;
  let pr = prRaw * kOut;     // [mm/h]
  // liczniki diagnostyczne trybu lekkiego [mm]: opad modelu bez skalowania (cały, przed zastąpieniem przez burze) i opad burz (rdzenie, po skalowaniu do normy)
  sfc[sf(S_LPB, col)] += max(parBsp(13u, X, Y), 0.0) * 1.0 * P.rainF * dt / 3600.0;
  sfc[sf(S_LPS, col)] += prS * kOut * dt / 3600.0;
  let wPr = smoothstep(0.02, 0.5, pr);
  // -- profil: cel + odchyłka warstwy granicznej, chmury z wilgotności --
  var ztop = 0.0;                                                  // wierzchołek chmur – krople opadu do radaru
  for (var k = 0u; k < NZ; k++) {
    let l = k * NXY + col;
    let zagl = max(vg[VG_ZC + k] - h, 0.0);
    let fz = select(0.0, exp(-pow(zagl / heff, 3.0)), k >= kb);
    let th = tgAt(0u, l, a) + lbt * fz;
    let T = (vg[VG_TC + k] + th) * vg[VG_EXC + k];
    let qs = qsatMix(T, vg[VG_PRS + k]);
    let qv = clamp(tgAt(1u, l, a) + lbq * fz, 0.0, qs);
    state[U_OFF + l] = tgAt(2u, l, a);
    state[V_OFF + l] = tgAt(3u, l, a);
    // (wiatr także w buforze tmp – stąd czytają go parametry burzowe w cumulus: ścinanie, SRH, ruch burz, wiatr chmur)
    tmp[U_OFF + l] = state[U_OFF + l];
    tmp[V_OFF + l] = state[V_OFF + l];
    state[T_OFF + l] = th;
    state[QV_OFF + l] = qv;
    var qcd = 0.0;
    if (k >= kb && zagl < 14000.0) {
      let rh = qv / max(qs, 1e-9);
      // warstwowe: od RH ~85% (pełne przy nasyceniu), w strefach opadu modelu pokład już od ~60%
      var cf = smoothstep(0.85, 1.0, rh);
      cf = max(cf, wPr * smoothstep(0.6, 0.85, rh) * (1.0 - smoothstep(7000.0, 9000.0, zagl)));
      qcd = cf * cf * clamp(0.1 * qs, 5e-6, 4e-4);
      if (cf > 0.3 && zagl < 8000.0) { ztop = zagl; }
      // burza: wieża od ~0.8 km do wierzchołka i kowadło lodowe w górnej ⅓
      if (zagl > 800.0 && zagl < stZ) {
        qcd = max(qcd, stC * 1.2e-3 * (1.0 - 0.5 * zagl / stZ));
        if (zagl > 0.65 * stZ) { qcd = max(qcd, stA * 3e-4); }
      }
    }
    let fl = clamp((T - 235.15) / 38.0, 0.0, 1.0);                 // woda ↔ lód między −38 i 0 °C
    state[QC_OFF + l] = qcd * fl;
    state[QI_OFF + l] = qcd * (1.0 - fl);
    state[QR_OFF + l] = 0.0;
    state[NR_OFF + l] = 0.0;
  }
  for (var k = 0u; k <= NZ; k++) { state[W_OFF + k * NXY + col] = 0.0; tmp[W_OFF + k * NXY + col] = 0.0; }
  // (bez cumulusów: na obrazie dawały mleczną zasłonę albo pola kłębów – użytkownik: w trybie lekkim bez nich)
  // -- opad: przy gruncie (rodzaj z temperatury ~30 m nad gruntem), krople do radaru od gruntu do wierzchołka chmur --
  let tb = tPhase(col, kb, state[T_OFF + kb * NXY + col], state[T_OFF + min(kb + 1u, NZ - 1u) * NXY + col]);
  let fsnow = clamp((TFRZ + 1.0 - tb) / 2.0, 0.0, 1.0);
  sfc[sf(S_PR, col)] = pr;
  sfc[sf(S_PSN, col)] = fsnow * pr;
  addPacc(col, pr * dt / 3600.0, fsnow * pr * dt / 3600.0);
  sfc[sf(S_PSL, col)] = tgSfc(2u, col, a);
  // opad burz do porywów, wyładowań i gradu (surface: PRCUS, CUTS – jak opad i wierzchołek schematu konwekcji)
  sfc[sf(S_PRCUS, col)] = prS * kOut;
  sfc[sf(S_CUTS, col)] = stZ;
  if (pr > 0.01) {
    let zt = max(max(ztop, 2000.0), select(0.0, 0.85 * stZ, prS * kOut > 0.5));
    for (var k = kb; k < NZ; k++) {
      let l = k * NXY + col;
      let zagl = vg[VG_ZC + k] - h;
      if (zagl > zt) { break; }
      let T = (vg[VG_TC + k] + state[T_OFF + l]) * vg[VG_EXC + k];
      let vt = mix(5.0, 1.0, clamp((TFRZ + 1.0 - T) / 2.0, 0.0, 1.0));
      let rk = vg[VG_RC + k];
      let qr = pr / 3600.0 / (rk * vt);
      // liczba kropel z rozkładu Marshalla–Palmera (N0 = 8·10⁶ m⁻⁴): λ = (π·ρ_w·N0 / (ρ·q_r))^¼, N_r tak, by λ = (π·ρ_w·N_r / q_r)^⅓ jak w micro
      let lam = pow(3.14159 * 1000.0 * 8e6 / (rk * qr), 0.25);
      state[QR_OFF + l] = qr;
      state[NR_OFF + l] = lam * lam * lam * qr / (3.14159 * 1000.0);
    }
  }
}
