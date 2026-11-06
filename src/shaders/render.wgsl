// Podgląd: przekrój pionowy (x–z), przekrój poziomy (x–y na zadanej wysokości) albo mapa przy gruncie.
// Numeracja pól jak w interfejsie: 0–11 pola 3D, 20–30 mapy.

struct View {
  size: vec2f,
  mode: u32,      // 0 = przekrój poziomy / mapa, 1 = przekrój pionowy
  field: u32,
  sliceY: f32,    // położenie przekroju pionowego [komórki]
  sliceZ: f32,    // wysokość przekroju poziomego [m]
  viewTop: f32,   // górna granica przekroju pionowego [m]
  lo: f32,        // zakres skali kolorów
  hi: f32,
  iso: f32,       // odstęp izolinii (0 = brak)
  dt: f32,
  overlay: u32,   // 1 = chmury i deszcz na przekrojach
  sunX: f32,
  sunY: f32,
  sunZ: f32,
  hmax: f32,      // najwyższy punkt terenu [m]
  cloudAlpha: f32,  // krycie chmur na przekrojach (0 = przezroczyste)
  relief: u32,      // bit 0: cieniowanie rzeźby na mapach, bit 1: poziomice, 2–4 piętra chmur, 5 strzałki wiatru, 6 siatka
  time: f32,       // czas rzeczywisty [s] (miganie błyskawic)
  cuPh: f32,       // faza pokoleń cumulusów (cuGen; main.js cuTick)
  hiF: f32,        // gęstszy teren do obrazu: punktów na oczko (0 – brak, rzeźba z siatki modelu; main.js loadDemHi)
  hmaxD: f32,      // najwyższy punkt gęstszego terenu [m]
  zx: f32,         // zoom mapy: lewy górny róg okna widoku (ułamek domeny) i powiększenie (1 = cała mapa)
  zy: f32,
  zs: f32,
  accF: f32,       // rozciągnięcie skali sumy opadu wg okresu (progi × accF)
  blobS: f32,      // bok siatki pojedynczych cumulusów [m] (jak w widoku 3D)
  cuNx: f32,       // kafle przesunięcia wzoru cumulusów (main.js cuTick)
  cuNy: f32,
  nofx: f32,       // ciągłe przesunięcie szumu brzegów chmur [m] (wiatr warstwy cumulusów; main.js cuTick)
  nofy: f32,
  monS: f32,       // widok „Miesiące”, bieżący miesiąc: sekundy od jego początku i pełne doby (main.js monMidnight)
  monD: f32,
  monCur: f32,     // 1 – bieżący miesiąc (z liczników MTS…MSN), 0 – zapisany (pole MV)
  leafAut: f32,    // 1 – jesień (kolory drzew: main.js leafAut)
  vhF: f32,        // gęstsze pokrycie terenu do obrazu: punktów na oczko (0 – z oczek; main.js buildVegHi)
  cuD: array<vec4f, 36>,   // przesunięcie pokoleń 0 (xy) i 1 (zw) [m] w kaflach (wiersze po cuNx)
  cuD2: array<vec4f, 36>,  // to samo z wiatrem średnim 0–6 km – chmury kłębiaste piętra średniego (altocumulus)
}

@group(0) @binding(0) var<uniform> V: View;
@group(0) @binding(1) var<storage, read> vg: array<f32>;
@group(0) @binding(2) var<storage, read> state: array<f32>;
@group(0) @binding(3) var<storage, read> work: array<f32>;   // φ na początku bufora
@group(0) @binding(4) var<storage, read> sfc: array<f32>;
@group(0) @binding(5) var<storage, read> demHi: array<f32>;   // gęstszy teren (V.hiF × V.hiF punktów na oczko widocznej domeny)
@group(0) @binding(6) var<storage, read> vegHi: array<u32>;   // gęstsze pokrycie terenu (V.vhF × V.vhF punktów na oczko, 1 bajt na punkt, 12 – skały)

fn ldb(b: u32, i: u32) -> f32 {
  if (b == 0u) { return state[i]; }
  return work[i];
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

// ---------- skale kolorów ----------
fn diverging(t: f32) -> vec3f {
  let neg = vec3f(0.19, 0.32, 0.78);
  let mid = vec3f(0.96, 0.96, 0.96);
  let pos = vec3f(0.80, 0.10, 0.12);
  let s = clamp(t, -1.0, 1.0);
  if (s < 0.0) { return mix(mid, neg, pow(-s, 0.8)); }
  return mix(mid, pos, pow(s, 0.8));
}

// "turbo" (A. Mikhailov 2019): fiolet – błękit – zieleń – żółć – czerwień
fn turbo(x0: f32) -> vec3f {
  let x = clamp(x0, 0.0, 1.0);
  let v4 = vec4f(1.0, x, x * x, x * x * x);
  let v2 = v4.zw * v4.z;
  return vec3f(
    dot(v4, vec4f(0.13572138, 4.61539260, -42.66032258, 132.13108234)) + dot(v2, vec2f(-152.94239396, 59.28637943)),
    dot(v4, vec4f(0.09140261, 2.19418839, 4.84296658, -14.18503333)) + dot(v2, vec2f(4.27729857, 2.82956604)),
    dot(v4, vec4f(0.10667330, 12.64194608, -60.58204836, 110.36276771)) + dot(v2, vec2f(-89.90310912, 27.34824973)));
}

// 5 kolorów rozłożonych równo na [0, 1]
fn ramp(t: f32, a: vec3f, b: vec3f, c: vec3f, d: vec3f, e: vec3f) -> vec3f {
  let s = clamp(t, 0.0, 1.0) * 4.0;
  if (s < 1.0) { return mix(a, b, s); }
  if (s < 2.0) { return mix(b, c, s - 1.0); }
  if (s < 3.0) { return mix(c, d, s - 2.0); }
  return mix(d, e, s - 3.0);
}

// Te same skale są w src/fields.js (legendy)
// Klasyczna skala temperatury map pogodowych, stała od −50 do +50 °C (punkty co 10 °C):
// fiolet – granat – niebieski – błękit (0 °C) – zieleń – żółty – pomarańcz – czerwień – bordo
fn tempClassic(t: f32) -> vec3f {
  var c = array<vec3f, 11>(
    vec3f(0.95, 0.85, 1.00),
    vec3f(0.70, 0.45, 0.85),
    vec3f(0.45, 0.20, 0.70),
    vec3f(0.15, 0.20, 0.75),
    vec3f(0.15, 0.50, 0.95),
    vec3f(0.55, 0.85, 1.00),
    vec3f(0.35, 0.80, 0.35),
    vec3f(1.00, 0.90, 0.20),
    vec3f(1.00, 0.45, 0.05),
    vec3f(0.80, 0.05, 0.05),
    vec3f(0.50, 0.00, 0.25));
  let s = clamp(t, 0.0, 1.0) * 10.0;
  let i = min(u32(s), 9u);
  return mix(c[i], c[i + 1u], s - f32(i));
}

fn cmap(id: u32, t: f32) -> vec3f {
  switch id {
    case 0u: { return turbo(t); }
    case 1u: { return diverging(2.0 * t - 1.0); }
    case 2u: { return ramp(t, vec3f(0.50, 0.36, 0.20), vec3f(0.85, 0.72, 0.45), vec3f(0.70, 0.85, 0.55), vec3f(0.30, 0.65, 0.45), vec3f(0.15, 0.35, 0.75)); }
    case 3u: { return ramp(t, vec3f(0.97, 0.97, 0.92), vec3f(0.75, 0.90, 0.70), vec3f(0.35, 0.75, 0.60), vec3f(0.15, 0.50, 0.70), vec3f(0.10, 0.20, 0.55)); }
    case 4u: { return ramp(t, vec3f(0.42, 0.60, 0.85), vec3f(0.62, 0.74, 0.90), vec3f(0.80, 0.86, 0.94), vec3f(0.92, 0.94, 0.97), vec3f(1.0, 1.0, 1.0)); }
    case 5u: { return ramp(t, vec3f(0.97, 0.97, 0.97), vec3f(0.55, 0.85, 0.55), vec3f(0.15, 0.65, 0.25), vec3f(0.98, 0.85, 0.15), vec3f(0.90, 0.15, 0.10)); }
    case 7u: { return ramp(t, vec3f(0.97, 0.97, 0.97), vec3f(0.65, 0.85, 0.95), vec3f(0.30, 0.55, 0.90), vec3f(0.35, 0.25, 0.75), vec3f(0.55, 0.10, 0.55)); }
    case 8u: { return ramp(t, vec3f(0.05, 0.03, 0.10), vec3f(0.45, 0.08, 0.30), vec3f(0.85, 0.30, 0.10), vec3f(0.98, 0.70, 0.15), vec3f(1.0, 0.98, 0.80)); }
    case 11u: { return tempClassic(t); }
    case 13u: { return ramp(t, vec3f(0.55, 0.62, 0.90), vec3f(0.78, 0.84, 0.97), vec3f(0.97, 0.97, 0.95), vec3f(0.98, 0.86, 0.72), vec3f(0.92, 0.62, 0.50)); }
    default: { return vec3f(t); }
  }
}

fn cmapOf(f: u32) -> u32 {
  switch f {
    case 0u, 20u, 21u, 24u: { return 22u; }
    case 1u, 2u: { return 0u; }
    case 3u, 28u, 33u, 58u, 62u, 63u, 64u: { return 2u; }
    case 4u: { return 3u; }
    case 5u, 13u: { return 4u; }
    case 6u: { return 5u; }
    case 67u: { return 7u; }
    case 68u: { return 30u; }
    case 22u: { return 25u; }
    case 23u: { return 24u; }
    case 12u: { return 23u; }
    case 32u: { return 26u; }
    case 34u: { return 13u; }
    case 27u: { return 8u; }
    case 29u, 37u: { return 9u; }
    case 31u: { return 12u; }
    case 38u: { return 15u; }
    case 39u: { return 16u; }
    case 40u: { return 17u; }
    case 41u: { return 18u; }
    case 42u: { return 15u; }
    case 43u: { return 19u; }
    case 44u, 57u: { return 27u; }
    case 45u: { return 20u; }
    case 46u, 47u, 80u, 81u, 82u, 86u, 87u: { return 22u; }
    case 83u, 84u, 85u, 88u: { return 24u; }
    case 48u: { return 8u; }
    case 49u, 50u, 51u, 52u: { return 23u; }
    case 53u, 54u: { return 21u; }
    case 55u: { return 27u; }
    case 56u, 66u: { return 8u; }
    case 30u: { return 10u; }
    case 79u: { return 31u; }
    default: { return 1u; }
  }
}

// Klasyczna skala satelity IR (wzmocniona): ciepło – ciemno, zimno – jasno, wierzchołki
// poniżej −30 °C kolorowe (jak na obrazach wzmocnionych IR)
fn irColor(tb: f32) -> vec3f {
  if (tb > -30.0) { return vec3f(mix(0.08, 0.88, clamp((40.0 - tb) / 70.0, 0.0, 1.0))); }
  if (tb > -45.0) { return mix(vec3f(0.40, 0.80, 1.00), vec3f(0.10, 0.30, 0.90), (-30.0 - tb) / 15.0); }
  if (tb > -55.0) { return mix(vec3f(0.10, 0.70, 0.20), vec3f(0.95, 0.90, 0.10), (-45.0 - tb) / 10.0); }
  if (tb > -65.0) { return mix(vec3f(1.00, 0.55, 0.05), vec3f(0.85, 0.05, 0.05), (-55.0 - tb) / 10.0); }
  return mix(vec3f(0.30, 0.0, 0.30), vec3f(1.0), clamp((-65.0 - tb) / 15.0, 0.0, 1.0));
}

// Odbiciowość radarowa [dBZ] w klasach co 5 dBZ (paleta jak w serwisach radarowych)
fn dbzColor(z: f32) -> vec3f {
  let C = array<vec3f, 14>(vec3f(0.55, 0.85, 0.95), vec3f(0.25, 0.65, 0.95), vec3f(0.10, 0.35, 0.90), vec3f(0.10, 0.85, 0.25),
    vec3f(0.05, 0.65, 0.12), vec3f(0.02, 0.45, 0.05), vec3f(0.98, 0.95, 0.10), vec3f(0.90, 0.74, 0.00), vec3f(1.00, 0.55, 0.00),
    vec3f(1.00, 0.05, 0.05), vec3f(0.80, 0.00, 0.00), vec3f(0.62, 0.00, 0.10), vec3f(0.98, 0.05, 0.98), vec3f(0.60, 0.33, 0.78));
  return C[u32(clamp(floor((z - 5.0) / 5.0), 0.0, 13.0))];
}

// Satelita WV: ciepło (sucho) ciemnobrązowo, zimno (wilgotno) biało-niebiesko
fn wvColor(t: f32) -> vec3f {
  if (t > -25.0) { return mix(vec3f(0.30, 0.20, 0.12), vec3f(0.08, 0.05, 0.03), clamp((t + 25.0) / 15.0, 0.0, 1.0)); }
  if (t > -40.0) { return mix(vec3f(0.55, 0.55, 0.58), vec3f(0.30, 0.20, 0.12), (t + 40.0) / 15.0); }
  if (t > -55.0) { return mix(vec3f(0.92, 0.94, 0.97), vec3f(0.55, 0.55, 0.58), (t + 55.0) / 15.0); }
  return mix(vec3f(0.30, 0.55, 0.95), vec3f(0.92, 0.94, 0.97), clamp((t + 70.0) / 15.0, 0.0, 1.0));
}

// Skala radarowa opadu [mm/h], progi jak na mapach radarowych
fn radar(r: f32) -> vec3f {
  if (r < 0.5) { return vec3f(0.62, 0.90, 1.00); }
  if (r < 1.0) { return vec3f(0.30, 0.70, 1.00); }
  if (r < 2.0) { return vec3f(0.15, 0.80, 0.35); }
  if (r < 5.0) { return vec3f(0.05, 0.58, 0.12); }
  if (r < 10.0) { return vec3f(1.00, 0.90, 0.10); }
  if (r < 20.0) { return vec3f(1.00, 0.58, 0.00); }
  if (r < 50.0) { return vec3f(0.92, 0.10, 0.10); }
  return vec3f(0.82, 0.10, 0.82);
}

// suma opadu [mm]: klasy ACC_T (0.5 … 2000 mm) i kolory ACC_C z fields.js
fn accum(r: f32) -> vec3f {
  var n = 0u;
  for (var k = 1u; k < ACC_N; k++) { if (r >= ACC_T[k]) { n = k; } }
  return ACC_C[n];
}

// ---------- próbkowanie ----------
fn baseLin(off: u32, S: f32) -> f32 {
  let K = clamp(S - 0.5, 0.0, f32(NZ - 1u));
  let k0 = min(u32(K), NZ - 2u);
  return mix(vg[off + k0], vg[off + k0 + 1u], K - f32(k0));
}

fn field3(f: u32, X: f32, Y: f32, S: f32) -> f32 {
  switch f {
    case 5u: { return 1000.0 * trilin(0u, QC_OFF, NZ, X - 0.5, Y - 0.5, S - 0.5); }
    case 6u: { return 1000.0 * trilin(0u, QR_OFF, NZ, X - 0.5, Y - 0.5, S - 0.5); }
    case 13u: { return 1000.0 * trilin(0u, QI_OFF, NZ, X - 0.5, Y - 0.5, S - 0.5); }
    case 7u: { return trilin(0u, W_OFF, NZ + 1u, X - 0.5, Y - 0.5, S); }
    case 8u: { return trilin(0u, U_OFF, NZ, X, Y - 0.5, S - 0.5); }
    case 9u: { return trilin(0u, V_OFF, NZ, X - 0.5, Y, S - 0.5); }
    case 10u: { return trilin(0u, T_OFF, NZ, X - 0.5, Y - 0.5, S - 0.5); }
    case 11u: { return trilin(1u, W_PHI, NZ, X - 0.5, Y - 0.5, S - 0.5) * baseLin(VG_RC, S) / V.dt; }
    case 12u: {
      let u = trilin(0u, U_OFF, NZ, X, Y - 0.5, S - 0.5);
      let v = trilin(0u, V_OFF, NZ, X - 0.5, Y, S - 0.5);
      return sqrt(u * u + v * v);
    }
    default: {}
  }
  let qv = trilin(0u, QV_OFF, NZ, X - 0.5, Y - 0.5, S - 0.5);
  if (f == 4u) { return 1000.0 * qv; }
  let th = baseLin(VG_TC, S) + trilin(0u, T_OFF, NZ, X - 0.5, Y - 0.5, S - 0.5);
  let t = th * baseLin(VG_EXC, S);
  switch f {
    case 0u: { return t - 273.15; }
    case 1u: { return th; }
    case 2u: { return th * exp(LV * qv / (CP * t)); }
    default: { return min(100.0 * qv / qsat(t, baseLin(VG_PRS, S)), 100.0); }
  }
}

fn sfcAt(s: u32, col: u32) -> f32 { return sfc[s * NXY + col]; }

// szum wartości 2D (chmury porwane na mapie satelitarnej), wynik ~równomierny w 0..1
fn hash2(p: vec2i) -> f32 {
  var h = u32(p.x) * 374761393u + u32(p.y) * 668265263u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967295.0;
}
// szum komórkowy 2D (Worley): 1 w punktach losowych (jeden na komórkę siatki szumu), maleje z odległością
fn worley2(p: vec2f) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  var d = 9.0;
  for (var b = -1; b <= 1; b++) {
    for (var a = -1; a <= 1; a++) {
      let o = vec2i(a, b);
      let pt = vec2f(o) + vec2f(hash2(i + o), hash2(i + o + vec2i(4517, 9811)));
      d = min(d, length(pt - f));
    }
  }
  return clamp(1.0 - d, 0.0, 1.0);
}
fn vnoise(p: vec2f) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2i(1, 0)), u.x), mix(hash2(i + vec2i(0, 1)), hash2(i + vec2i(1, 1)), u.x), u.y);
}
fn cloudNoise(xm: f32, ym: f32) -> f32 {
  let p = vec2f(xm, ym);
  let L = max(3000.0, 1.2 * DX);           // skala płatów chmur rośnie z oczkiem
  let n = 0.6 * vnoise(p / L + 3.1) + 0.3 * vnoise(p / (0.4 * L) + 17.3) + 0.1 * vnoise(p / (0.15 * L) + 41.7);
  return clamp((n - 0.5) * 1.7 + 0.5, 0.0, 1.0);
}

fn mapCol(f: u32, col: u32) -> f32 {
  switch f {
    case 20u: { return sfcAt(S_T2, col); }
    case 21u: { return sfcAt(S_TD2, col); }
    case 22u: { return sfcAt(S_PR, col); }
    case 23u: { return sfcAt(S_PACC, col) - sfcAt(S_PBASE, col); }   // suma w wybranym okresie
    // widok „Miesiące”: bieżący miesiąc z liczników (średnie do tej chwili; T maks./min. przed pierwszą pełną dobą – z bieżącej
    // doby), zapisany miesiąc – pole MV (main.js wpisuje wybraną wielkość)
    case 80u: { return select(sfcAt(S_MV, col), sfcAt(S_MTS, col) / max(V.monS, 1.0), V.monCur > 0.5); }
    case 81u: { return select(sfcAt(S_MV, col), select(sfcAt(S_MTX, col) / max(V.monD, 1.0), sfcAt(S_TMAX, col), V.monD < 0.5), V.monCur > 0.5); }
    case 82u: { return select(sfcAt(S_MV, col), select(sfcAt(S_MTN, col) / max(V.monD, 1.0), sfcAt(S_TMIN, col), V.monD < 0.5), V.monCur > 0.5); }
    case 83u: { return select(sfcAt(S_MV, col), sfcAt(S_MPR, col), V.monCur > 0.5); }
    case 84u: { return select(sfcAt(S_MV, col), max(sfcAt(S_MPR, col) - sfcAt(S_MSN, col), 0.0), V.monCur > 0.5); }
    case 85u: { return select(sfcAt(S_MV, col), sfcAt(S_MSN, col), V.monCur > 0.5); }
    // ekstrema: bieżący miesiąc z liczników i bieżącej doby, zapisany – pole MV
    case 86u: { let s = sfcAt(S_MXA, col); return select(sfcAt(S_MV, col), max(select(-999.0, s - 1000.0, s > 0.0), sfcAt(S_TMAX, col)), V.monCur > 0.5); }
    case 87u: { let s = sfcAt(S_MNA, col); return select(sfcAt(S_MV, col), min(select(999.0, 1000.0 - s, s > 0.0), sfcAt(S_TMIN, col)), V.monCur > 0.5); }
    case 88u: { return select(sfcAt(S_MV, col), max(sfcAt(S_MPD, col), sfcAt(S_PACC, col) - sfcAt(S_PD0, col)), V.monCur > 0.5); }
    case 24u: { return sfcAt(S_TS, col) - 273.15; }
    case 25u: { return sfcAt(S_H, col); }
    case 26u: { return sfcAt(S_LE, col); }
    case 27u: { return sfcAt(S_SW, col); }
    case 28u: { return 100.0 * sfcAt(S_W, col); }
    case 29u: { return 1000.0 * sfcAt(S_LWP, col); }
    case 58u: { return 100.0 * sfcAt(S_COVER, col); }
    case 59u: { return 100.0 * sfcAt(S_COVC, col); }
    case 60u: { return 100.0 * sfcAt(S_COVS, col); }
    case 61u: { return 1000.0 * sfcAt(S_LWPC, col); }
    case 62u: { return 100.0 * 0.45 * sfcAt(S_SM1, col); }
    case 63u: { return 100.0 * 0.45 * sfcAt(S_SM2, col); }
    case 64u: { return 100.0 * 0.45 * sfcAt(S_SM3, col); }
    case 65u: { return sfcAt(S_LIFT, col); }
    case 66u: { return sfcAt(S_SMODE, col); }
    case 67u: { return max(sfcAt(S_ORG, col), sfcAt(S_ORGB, col)); }
    case 68u: { return sfcAt(S_FRT, col); }
    case 79u: { return vg[VG_VEG + col]; }
    case 69u: { return 1000.0 * sfcAt(S_LWPA, col); }
    case 37u: { return sfcAt(S_CLL, col) + sfcAt(S_CLM, col) + sfcAt(S_CLH, col); }
    case 31u: { return sfcAt(S_TB, col); }
    case 38u: { return sfcAt(S_DBZ, col); }
    case 39u: { return sfcAt(S_TBWV, col); }
    case 40u: { return sfcAt(S_VIS, col); }
    case 41u: { return sfcAt(S_PHEN, col); }
    case 42u: { return sfcAt(S_DBZC, col); }
    case 43u: { return sfcAt(S_HAIL, col); }
    case 45u: { return sfcAt(S_QOUT, col); }
    case 46u: { return sfcAt(S_TMAX, col); }
    case 47u: { return sfcAt(S_TMIN, col); }
    case 48u: { return sfcAt(S_SUNH, col); }
    case 49u: { return sfcAt(S_GUST, col); }
    case 50u: { return sfcAt(S_U10, col); }
    case 51u: { return length(vec2f(sfcAt(S_SHU, col), sfcAt(S_SHV, col))); }
    case 52u: { return sfcAt(S_SHR01, col); }
    case 53u: { return sfcAt(S_SRH03, col); }
    case 54u: { return sfcAt(S_SRH01, col); }
    case 44u, 55u: {
      // CAPE wygładzona po 3 × 3 oczka (pojedyncze termiki dawały „kropkowaną” mapę)
      let ci = i32(col % NX);
      let cj = i32(col / NX);
      var a = 0.0;
      for (var dj = -1; dj <= 1; dj++) { for (var di = -1; di <= 1; di++) { a += sfcAt(S_CAPE, wrapi(cj + dj, NY) * NX + wrapi(ci + di, NX)); } }
      return a / 9.0;
    }
    case 57u: {
      let ci = i32(col % NX);
      let cj = i32(col / NX);
      var a = 0.0;
      for (var dj = -1; dj <= 1; dj++) { for (var di = -1; di <= 1; di++) { a += sfcAt(S_MUCAPE, wrapi(cj + dj, NY) * NX + wrapi(ci + di, NX)); } }
      return a / 9.0;
    }
    case 56u: {
      // wskaźnik superkomórkowy SCP = (CAPE/1000)·(SRH 0–3/50)·(ścinanie 0–6/20; 0 poniżej 10 m/s, maks. 1.5)
      let sh = length(vec2f(sfcAt(S_SHU, col), sfcAt(S_SHV, col)));
      let fs = select(clamp(sh / 20.0, 0.0, 1.5), 0.0, sh < 10.0);
      return max(sfcAt(S_CAPE, col) / 1000.0 * sfcAt(S_SRH03, col) / 50.0 * fs, 0.0);
    }
    case 32u: { return 100.0 * sfcAt(S_SND, col); }
    case 33u: { return sfcAt(S_GRN, col); }
    case 34u: { return sfcAt(S_PSL, col); }
    case 35u: { return sfcAt(S_CUTOP, col); }                // wierzchołek chmury konwekcji parametryzowanej
    case 36u: { return sfcAt(S_CUBASE, col); }               // … i jej podstawa
    default: { return vg[VG_HGT + col]; }
  }
}

// Wagi interpolacji sześciennej Catmulla-Roma (gładkie izolinie zamiast kanciastych)
fn crw(t: f32) -> vec4f {
  let t2 = t * t;
  let t3 = t2 * t;
  return vec4f(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);
}
// indeks kolumny: przy brzegach otwartych bez wchodzenia w niewidoczną strefę wyrównania
fn colI(i: i32, n: u32, nv: u32) -> u32 { return select(wrapi(i, n), u32(clamp(i, 0, i32(nv) - 1)), NE > 0u); }

// Interpolacja dwusześcienna mapy (wartości w środkach kolumn), ograniczona do zakresu
// 4 najbliższych wartości (bez przestrzeleń, np. ujemnego opadu)
// pole wygładzone w skali oczka (obraz satelitarny: chmury mniejsze niż ~2 oczka nie są rozdzielone przez model –
// bez tego szum „piksel po pikselu” przy chmurach niskich)
fn mapBlur(f: u32, X: f32, Y: f32) -> f32 {
  let r = 0.75;
  return 0.36 * mapAt(f, X, Y) + 0.16 * (mapAt(f, X + r, Y + r) + mapAt(f, X - r, Y + r) + mapAt(f, X + r, Y - r) + mapAt(f, X - r, Y - r));
}
fn mapAt(f: u32, X0: f32, Y0: f32) -> f32 {
  let X = select(X0, clamp(X0, 0.5, f32(NXV) - 0.5), NE > 0u);
  let Y = select(Y0, clamp(Y0, 0.5, f32(NYV) - 0.5), NE > 0u);
  let xf = floor(X - 0.5);
  let yf = floor(Y - 0.5);
  let wx = crw(X - 0.5 - xf);
  let wy = crw(Y - 0.5 - yf);
  var acc = 0.0;
  var lo = 1e30;
  var hi = -1e30;
  for (var b = 0; b < 4; b++) {
    let j = colI(i32(yf) + b - 1, NY, NYV);
    var row = 0.0;
    for (var a = 0; a < 4; a++) {
      let v = mapCol(f, j * NX + colI(i32(xf) + a - 1, NX, NXV));
      row += wx[a] * v;
      if ((a == 1 || a == 2) && (b == 1 || b == 2)) { lo = min(lo, v); hi = max(hi, v); }
    }
    acc += wy[b] * row;
  }
  return clamp(acc, lo, hi);
}

// Przekroje pól 3D: interpolacja sześcienna w poziomie (środki komórek), w pionie liniowa
fn field3s(f: u32, X0: f32, Y0: f32, S: f32, horiz: bool) -> f32 {
  let X = select(X0, clamp(X0, 0.5, f32(NXV) - 0.5), NE > 0u);
  let Y = select(Y0, clamp(Y0, 0.5, f32(NYV) - 0.5), NE > 0u);
  let xf = floor(X - 0.5);
  let yf = floor(Y - 0.5);
  let wx = crw(X - 0.5 - xf);
  let wy = crw(Y - 0.5 - yf);
  var acc = 0.0;
  var lo = 1e30;
  var hi = -1e30;
  let nb = select(1, 4, horiz);
  for (var b = 0; b < nb; b++) {
    let Yc = select(Y, f32(colI(i32(yf) + b - 1, NY, NYV)) + 0.5, horiz);
    var row = 0.0;
    for (var a = 0; a < 4; a++) {
      let v = field3(f, f32(colI(i32(xf) + a - 1, NX, NXV)) + 0.5, Yc, S);
      row += wx[a] * v;
      if ((a == 1 || a == 2) && (!horiz || b == 1 || b == 2)) { lo = min(lo, v); hi = max(hi, v); }
    }
    acc += select(1.0, wy[b], horiz) * row;
  }
  return clamp(acc, lo, hi);
}

// Pojedyncze cumulusy zajmujące część fc powierzchni – kształt z cuShape (common.wgsl), ten sam bok siatki i przesuw z wiatrem
// ~1.5 km co w widoku 3D; brzeg miękki, środek gęstszy niż brzegi
fn sfcBil(sx: u32, X: f32, Y: f32) -> f32 {
  let x = clamp(X - 0.5, 0.0, f32(NX) - 1.001);
  let y = clamp(Y - 0.5, 0.0, f32(NY) - 1.001);
  let i = u32(x);
  let j = u32(y);
  let fx = x - f32(i);
  let fy = y - f32(j);
  return mix(mix(sfcAt(sx, j * NX + i), sfcAt(sx, j * NX + i + 1u), fx), mix(sfcAt(sx, (j + 1u) * NX + i), sfcAt(sx, (j + 1u) * NX + i + 1u), fx), fy);
}
// pole przy gruncie wygładzone w skali oczka (jak mapBlur) – udziały pięter chmur, śnieg na obrazie satelitarnym
fn sfcBlur(sx: u32, X: f32, Y: f32) -> f32 {
  let r = 0.75;
  return 0.36 * sfcBil(sx, X, Y) + 0.16 * (sfcBil(sx, X + r, Y + r) + sfcBil(sx, X - r, Y + r) + sfcBil(sx, X + r, Y - r) + sfcBil(sx, X - r, Y - r));
}
// przesunięcie pokoleń cumulusów w punkcie xy [m widocznej domeny] – dwuliniowo z kafli (jak cuDisp w view3d.wgsl)
fn cuDisp(xy: vec2f) -> vec4f {
  let tx = cuTile(xy.x, f32(NXD) * DX, V.cuNx);
  let ty = cuTile(xy.y, f32(NYD) * DY, V.cuNy);
  let n = u32(V.cuNx);
  let a = mix(V.cuD[u32(ty.x) * n + u32(tx.x)], V.cuD[u32(ty.x) * n + u32(tx.y)], tx.z);
  let b = mix(V.cuD[u32(ty.y) * n + u32(tx.x)], V.cuD[u32(ty.y) * n + u32(tx.y)], tx.z);
  return mix(a, b, ty.z);
}
// X, Y – położenie w oczkach siatki obliczeniowej (z marginesem); wzór w metrach widocznej domeny, jak w widoku 3D
fn cuDisp2(xy: vec2f) -> vec4f {
  let tx = cuTile(xy.x, f32(NXD) * DX, V.cuNx);
  let ty = cuTile(xy.y, f32(NYD) * DY, V.cuNy);
  let n = u32(V.cuNx);
  let a = mix(V.cuD2[u32(ty.x) * n + u32(tx.x)], V.cuD2[u32(ty.x) * n + u32(tx.y)], tx.z);
  let b = mix(V.cuD2[u32(ty.y) * n + u32(tx.x)], V.cuD2[u32(ty.y) * n + u32(tx.y)], tx.z);
  return mix(a, b, ty.z);
}
// wm – udział chmur piętra średniego: dwa osobne wzory (niskie płyną z wiatrem warstwy cumulusów, średnie z wiatrem średnim 0–6 km)
// o częściach powierzchni fc·(1 − wm) i fc·wm. Wcześniej jeden wzór z przesunięciem mieszanym wg wm: przesunięcia wzorów różnią się
// o dziesiątki km (różnica wiatrów × okres pokolenia, w MAX ~4 h), a wm zmienia się na 1–2 oczkach, więc wzór ściskał się w poprzek
// tego przejścia kilkanaście razy – cienkie, poskręcane białe smugi wzdłuż granicy pięter.
// Pętla po obu wzorach i pokoleniach, granice zależne od wm: drugi wzór liczony tylko w przejściu (jak blobMask w widokach 3D)
fn cuBlob(X: f32, Y: f32, fc: f32, wm: f32) -> f32 {
  let xy = vec2f((X - f32(MG)) * DX, (Y - f32(MG)) * DY);
  let dl = cuDisp(xy);
  let dh = cuDisp2(xy);
  var m = 0.0;
  let t1 = select(4u, 2u, wm <= 0.01);
  for (var t = select(0u, 2u, wm >= 0.99); t < t1; t++) {
    let mid = t >= 2u;
    let g = t & 1u;
    let d = select(dl, dh, mid);
    let gq = cuGen(xy, select(d.xy, d.zw, g == 1u), V.cuPh, V.blobS, g);
    let sh = cuShape(gq.xy + select(vec2f(0.0), CU_MID, mid), fc * select(1.0 - wm, wm, mid), gq.z);
    let mk = 1.0 - smoothstep(sh.y - 0.06, sh.y + 0.06, sh.x);
    m = max(m, mk * (0.75 + 0.5 * clamp(1.0 - sh.x / max(sh.y, 1e-3), 0.0, 1.0)));
  }
  return m;
}

// Cieniowanie rzeźby terenu: światło z NW (mapy) albo ze słońca (widok satelitarny)
fn hillshade(X: f32, Y: f32, light: vec3f) -> f32 {
  if (V.mode == 0u && V.hiF > 1.5) {
    let s = demSlope(X, Y);
    return max(dot(normalize(vec3f(-s.x, -s.y, 1.0)), normalize(light)), 0.0);
  }
  let col = wrapi(i32(floor(Y)), NY) * NX + wrapi(i32(floor(X)), NX);
  let n = normalize(vec3f(-vg[VG_SLX + col], -vg[VG_SLY + col], 1.0));
  return max(dot(n, normalize(light)), 0.0);
}

// Lód na punkcie wody: oczko wody – lód oczka; punkt wody gęstszej mapy w oczku lądu (brzeg morza, zatoka, jezioro mniejsze od oczka) – lód większości
// sąsiednich oczek wody (3 × 3), a bez nich (małe jezioro) – średnia T 2 m z ~15 dób (TPH) < −1 °C. Wcześniej grunt oczka lądu < −1 °C: każdej mroźnej
// nocy lód wzdłuż wszystkich brzegów, za dnia znikał (użytkownik)
fn waterIce(col: u32) -> bool {
  if (u32(vg[VG_VEG + col] + 0.5) == 10u) { return sfcAt(S_ICE, col) > 0.0; }
  let ci = i32(col % NX);
  let cj = i32(col / NX);
  var nw = 0u;
  var ni = 0u;
  for (var dj = -1; dj <= 1; dj++) {
    for (var di = -1; di <= 1; di++) {
      let c = u32(clamp(cj + dj, 0, i32(NY) - 1)) * NX + u32(clamp(ci + di, 0, i32(NX) - 1));
      if (u32(vg[VG_VEG + c] + 0.5) == 10u) { nw++; if (sfcAt(S_ICE, c) > 0.0) { ni++; } }
    }
  }
  if (nw > 0u) { return 2u * ni >= nw; }
  return sfcAt(S_TPH, col) < -1.0;
}

// Kolor podłoża: typ roślinności (biom) i jej zieleń (fenologia), jak w climate.js
fn vegColor(col: u32) -> vec3f { return vegColorT(u32(vg[VG_VEG + col] + 0.5), col, vec2i(i32(col % NX), i32(col / NX))); }
// vt – typ, col – oczko (zieleń, lód), p – punkt do plam drzew (oczko albo punkt gęstszej mapy)
fn vegColorT(vt: u32, col: u32, p: vec2i) -> vec3f {
  let g = sfcAt(S_GRN, col);
  // las liściasty: plamy drzew żółknących wcześniej i później, bez liści widać domieszkę drzew iglastych (zimą las ciemniejszy niż pola)
  if (vt == 1u) {
    let gp = clamp(g + 0.22 * (hash2(p) - 0.5) * 4.0 * g * (1.0 - g), 0.0, 1.0);
    return mix(leafCol(select(gp, -gp, V.leafAut > 0.5)), vec3f(0.09, 0.20, 0.12), (0.18 + 0.30 * hash2(p + vec2i(17, 41))) * (1.0 - g));
  }
  switch vt {
    case 0u: { return mix(vec3f(0.55, 0.50, 0.36), vec3f(0.36, 0.48, 0.22), g); }
    case 2u: { return vec3f(0.09, 0.20, 0.12); }
    case 3u: { return mix(vec3f(0.50, 0.46, 0.38), vec3f(0.42, 0.45, 0.30), g); }
    case 4u: { return vec3f(0.90, 0.92, 0.95); }
    case 5u: { return vec3f(0.07, 0.26, 0.09); }
    case 6u: { return mix(vec3f(0.72, 0.62, 0.38), vec3f(0.52, 0.55, 0.25), g); }
    case 7u: { return vec3f(0.84, 0.72, 0.52); }
    case 8u: { return mix(vec3f(0.70, 0.64, 0.45), vec3f(0.55, 0.58, 0.32), g); }
    case 9u: { return vec3f(0.50, 0.48, 0.46); }
    // woda: lód wg waterIce
    case 10u: { return select(vec3f(0.06, 0.16, 0.32), vec3f(0.72, 0.78, 0.84), waterIce(col)); }
    case 12u: { return vec3f(0.47, 0.45, 0.42); }        // skały, goły grunt w górach (tylko gęstsza mapa)
    default: { return mix(vec3f(0.35, 0.38, 0.24), vec3f(0.27, 0.36, 0.20), g); }
  }
}

// gęstsza mapa pokrycia: typ w punkcie (i, j) widocznej domeny i kolor podłoża w (X, Y) – mieszanka czterech najbliższych punktów (płynne przejście
// na ~1 punkt, jak rozmyta granica na zdjęciu); nearest – typ najbliższego punktu (śnieg na lesie, kolory mapy typów)
fn vegHiCode(i: i32, j: i32) -> u32 {
  let F = i32(V.vhF);
  let W = i32(NXD) * F;
  let H = i32(NYD) * F;
  let idx = u32(clamp(j, 0, H - 1) * W + clamp(i, 0, W - 1));
  return (vegHi[idx >> 2u] >> ((idx & 3u) * 8u)) & 255u;
}
fn vegHiCell(i: i32, j: i32) -> u32 {
  let F = i32(V.vhF);
  return u32(clamp(j / F, 0, i32(NYD) - 1) + i32(MG)) * NX + u32(clamp(i / F, 0, i32(NXD) - 1) + i32(MG));
}
struct GroundHi { c: vec3f, vt: u32, col: u32 }
// przy oddaleniu (piksel ekranu obejmuje kilka punktów: fp – punktów na piksel) kolor uśredniony po pikselu (2 × 2 próbki w odstępie fp/2) – bez migotania
// i ziarna z przypadkowego punktu
fn groundHiA(X: f32, Y: f32, fp: f32) -> GroundHi {
  let g0 = groundHi(X, Y);
  if (fp < 1.2) { return g0; }
  let e = 0.35 * min(fp, 6.0) / V.vhF;
  let c = 0.25 * (groundHi(X - e, Y - e).c + groundHi(X + e, Y - e).c + groundHi(X - e, Y + e).c + groundHi(X + e, Y + e).c);
  return GroundHi(mix(g0.c, c, smoothstep(1.2, 2.0, fp)), g0.vt, g0.col);
}
fn groundHi(X: f32, Y: f32) -> GroundHi {
  let u = (X - f32(MG)) * V.vhF - 0.5;
  let v = (Y - f32(MG)) * V.vhF - 0.5;
  let i0 = i32(floor(u));
  let j0 = i32(floor(v));
  let fx = u - floor(u);
  let fy = v - floor(v);
  var c = vec3f(0.0);
  for (var q = 0; q < 4; q++) {
    let i = i0 + (q & 1);
    let j = j0 + (q >> 1);
    let w = select(1.0 - fx, fx, (q & 1) == 1) * select(1.0 - fy, fy, (q >> 1) == 1);
    c += w * vegColorT(vegHiCode(i, j), vegHiCell(i, j), vec2i(i, j));
  }
  let ni = i0 + select(0, 1, fx > 0.5);
  let nj = j0 + select(0, 1, fy > 0.5);
  return GroundHi(c, vegHiCode(ni, nj), vegHiCell(ni, nj));
}

// gładka wysokość terenu (dwuliniowo, bez zawijania przy brzegach otwartych)
fn hgtAt(X: f32, Y: f32) -> f32 { return mapAt(30u, X, Y); }

// teren do obrazu na mapach: gęstszy DEM (dwuliniowo), gdy wczytany – inaczej siatka modelu. Model liczy na średniej z oczka
// (przy 5 km Tatry to jeden grzbiet ~1900 m), mapa pokazuje prawdziwe grzbiety i doliny
fn demAt(X: f32, Y: f32) -> f32 {
  if (V.hiF < 1.5) { return hgtAt(X, Y); }
  let W = NXD * u32(V.hiF);
  let H = NYD * u32(V.hiF);
  let u = clamp((X - f32(MG)) * V.hiF - 0.5, 0.0, f32(W) - 1.001);
  let v = clamp((Y - f32(MG)) * V.hiF - 0.5, 0.0, f32(H) - 1.001);
  let i = u32(u);
  let j = u32(v);
  let a = mix(demHi[j * W + i], demHi[j * W + i + 1u], u - f32(i));
  let b = mix(demHi[(j + 1u) * W + i], demHi[(j + 1u) * W + i + 1u], u - f32(i));
  return mix(a, b, v - f32(j));
}
// nachylenie dz/dx, dz/dy terenu do obrazu
fn demSlope(X: f32, Y: f32) -> vec2f {
  if (V.hiF < 1.5) { return mapSlope(X, Y); }
  let e = 0.5 / V.hiF;
  return vec2f((demAt(X + e, Y) - demAt(X - e, Y)) / (2.0 * e * DX), (demAt(X, Y + e) - demAt(X, Y - e)) / (2.0 * e * DY));
}

// Względne cieniowanie stoku: 1 na płaskim, > 1 na stoku zwróconym do światła (z NW), < 1 w cieniu
fn reliefShade(X: f32, Y: f32) -> f32 {
  let l = normalize(vec3f(-1.0, 1.0, 1.4));
  let sx = demSlope(X, Y);
  let n = normalize(vec3f(-sx.x, -sx.y, 1.0));
  return dot(n, l) / l.z;
}

// nachylenie dz/dx, dz/dy (dwuliniowo z mapy wysokości – gładsze niż z kolumn)
fn mapSlope(X: f32, Y: f32) -> vec2f {
  let e = 0.5;
  let gx = (hgtAt(X + e, Y) - hgtAt(X - e, Y)) / (2.0 * e * DX);
  let gy = (hgtAt(X, Y + e) - hgtAt(X, Y - e)) / (2.0 * e * DY);
  return vec2f(gx, gy);
}

fn hypso(h: f32) -> vec3f {
  return ramp(h / max(max(V.hmax, V.hmaxD), 1.0), vec3f(0.30, 0.52, 0.30), vec3f(0.58, 0.68, 0.38), vec3f(0.80, 0.72, 0.45), vec3f(0.62, 0.48, 0.36), vec3f(0.93, 0.93, 0.93));
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  var uv = pos.xy / V.size;
  if (V.mode == 0u) { uv = vec2f(V.zx, V.zy) + uv / V.zs; }   // zoom mapy
  let X = f32(MG) + uv.x * f32(NXD);    // widoczna część (bez marginesu i strefy brzegowej)
  var Y: f32;
  var z: f32;
  if (V.mode == 0u) {
    Y = f32(MG) + (1.0 - uv.y) * f32(NYD);
    z = V.sliceZ;
  } else {
    Y = V.sliceY;
    z = (1.0 - uv.y) * V.viewTop;
  }
  let S = S_of_z(z);
  let f = V.field;
  let isMap = f >= 20u;

  var val: f32;
  if (isMap) { val = mapAt(f, X, Y); } else { val = field3s(f, X, Y, S, V.mode == 0u); }
  let fw = max(fwidth(val), 1e-6);
  let t = (val - V.lo) / (V.hi - V.lo);
  let cm = cmapOf(f);
  var col = cmap(cm, t);

  // mapy specjalne
  let nw = vec3f(-1.0, 1.0, 1.4);
  if (cm >= 22u && cm <= 27u) {
    // skale WX Charts (klasy progowe, wxscales.js): wiatr w km/h; opad i śnieg poniżej pierwszego progu – teren
    let p = cm - 22u;
    let v = select(select(val, val * 3.6, p == 1u), val / max(V.accF, 1e-3), p == 2u);
    col = wxPal(p, v);
    if ((p == 2u || p == 3u || p == 4u) && (v < wxMin(p) || (p == 2u && val < 0.1))) { col = vec3f(0.80) * (0.55 + 0.45 * hillshade(X, Y, nw)); }
    // natężenie opadu: śnieg (> połowa opadu) kolorami skali śniegu
    if (p == 3u && v >= wxMin(p)) {
      let cq = wrapi(i32(floor(Y)), NY) * NX + wrapi(i32(floor(X)), NX);
      if (sfcAt(S_PSN, cq) > 0.5 * max(sfcAt(S_PR, cq), 1e-4)) { col = wxPal(6u, 10.0 * v); }
    }
  } else if (cm == 6u) {
    // opad: radar na tle cieniowanego terenu
    col = vec3f(0.80) * (0.55 + 0.45 * hillshade(X, Y, nw));
    if (val >= 0.1) {
      col = radar(val);
      // śnieg (> połowa opadu) w biało-fioletowej skali, jak na mapach radarowych z typem opadu
      let cq = wrapi(i32(floor(Y)), NY) * NX + wrapi(i32(floor(X)), NX);
      if (sfcAt(S_PSN, cq) > 0.5 * max(sfcAt(S_PR, cq), 1e-4)) {
        let s = clamp(log(val / 0.1) / log(100.0), 0.0, 1.0);
        col = mix(mix(vec3f(0.92, 0.95, 1.0), vec3f(0.55, 0.62, 1.0), smoothstep(0.0, 0.5, s)), vec3f(0.62, 0.20, 0.85), smoothstep(0.5, 1.0, s));
      }
    }
  } else if (cm == 14u) {
    // suma opadu na tle cieniowanego terenu
    col = vec3f(0.80) * (0.55 + 0.45 * hillshade(X, Y, nw));
    if (val >= 0.5) { col = accum(val); }
  } else if (cm == 15u) {
    col = vec3f(0.80) * (0.55 + 0.45 * hillshade(X, Y, nw));
    if (val >= 5.0) { col = dbzColor(val); }
    if (f == 42u) {
      // wyładowania: migające punkty, gęstość ∝ częstość błyskawic w oczku (sprawdzane 4 sąsiednie)
      let fl = sfcAt(S_FLASH, wrapi(i32(floor(Y)), NY) * NX + wrapi(i32(floor(X)), NX));
      // pola 10 × 10 px: w każdym co ~1/6 s losowo błysk (prawdopodobieństwo rośnie z częstością)
      let cell = vec2i(floor(pos.xy / 10.0));
      let tq = u32(V.time * 6.0);
      let hsh = hash2(cell + vec2i(i32(tq * 7919u % 10007u), i32(tq % 4099u)));
      let pfl = 1.0 - exp(-0.3 * fl);
      if (fl > 0.02 && hsh < pfl) {
        let d = length(fract(pos.xy / 10.0) - 0.5) * 10.0;
        col = mix(col, vec3f(1.0, 0.85, 0.2), 1.0 - smoothstep(2.5, 4.5, d));
        col = mix(col, vec3f(1.0, 1.0, 0.95), 1.0 - smoothstep(1.0, 2.2, d));
      }
    }
  } else if (cm == 31u) {
    // typ powierzchni: kolor podłoża w oczku (jak na satelicie) z cieniowaniem terenu
    // (gęstsza mapa: punkt przesunięty drobnym szumem jak na satelicie – nieregularne granice zamiast kwadratów punktów przy przybliżeniu)
    let fpT = max(fwidth(X), fwidth(Y)) * max(V.vhF, 1.0);                  // punktów gęstszej mapy na piksel ekranu
    let jT = (1.0 - smoothstep(1.0, 2.0, fpT)) / max(V.vhF, 1.0);           // szum brzegów słabnie przy oddaleniu
    let qt = vec2f(X, Y) * max(V.vhF, 1.0) / 2.5;
    let Xt = X + (0.9 * (vnoise(qt + vec2f(4.3, 17.9)) - 0.5) + 0.45 * (vnoise(qt * 2.7 + vec2f(13.1, 2.2)) - 0.5)) * jT;
    let Yt = Y + (0.9 * (vnoise(qt + vec2f(21.7, 3.4)) - 0.5) + 0.45 * (vnoise(qt * 2.7 + vec2f(6.6, 19.5)) - 0.5)) * jT;
    let gt = select(vegColor(wrapi(i32(floor(Y)), NY) * NX + wrapi(i32(floor(X)), NX)), groundHiA(Xt, Yt, fpT).c, V.vhF > 1.5);
    col = gt * (0.55 + 0.45 * hillshade(X, Y, nw));
  } else if (cm == 19u) {
    // grad: małe (< 2 cm) żółte, duże (2–5 cm) pomarańczowe, bardzo duże (> 5 cm) fioletowe
    col = vec3f(0.70) * (0.55 + 0.45 * hillshade(X, Y, nw));
    let hv = sfcAt(S_HAIL, wrapi(i32(floor(Y)), NY) * NX + wrapi(i32(floor(X)), NX));
    if (hv >= 0.5) { col = select(select(vec3f(0.85, 0.20, 0.85), vec3f(1.0, 0.55, 0.05), hv < 5.0), vec3f(1.0, 0.92, 0.25), hv < 2.0); }
  } else if (cm == 20u) {
    // rzeki: przepływ w oczku (bez interpolacji – linie sieci D8), skala logarytmiczna 0.5 … 1000 m³/s
    col = hypso(demAt(X, Y)) * (0.55 + 0.45 * hillshade(X, Y, nw)) * 0.8 + 0.1;
    let cq = wrapi(i32(floor(Y)), NY) * NX + wrapi(i32(floor(X)), NX);
    let q = sfcAt(S_QOUT, cq);
    if (u32(vg[VG_LAND + cq] + 0.5) == 3u) { col = vec3f(0.20, 0.40, 0.70); }
    if (q > 0.5) {
      let lq = clamp(log(q / 0.5) / log(2000.0), 0.0, 1.0);
      col = mix(col, mix(vec3f(0.45, 0.75, 1.0), vec3f(0.02, 0.15, 0.65), lq), 0.3 + 0.7 * lq);
    }
  } else if (cm == 21u) {
    // SRH [m²/s²]: ujemne (lewoskrętne) niebieskie, dodatnie: żółty 100, pomarańcz 200, czerwień 300, fiolet 500
    let s = val;
    col = vec3f(0.80) * (0.6 + 0.4 * hillshade(X, Y, nw));
    if (s < -50.0) { col = mix(col, vec3f(0.25, 0.45, 0.95), clamp((-s - 50.0) / 150.0, 0.2, 0.8)); }
    if (s > 50.0) {
      let c = select(select(select(vec3f(0.75, 0.2, 0.85), vec3f(0.92, 0.15, 0.12), s < 500.0), vec3f(1.0, 0.55, 0.05), s < 300.0), vec3f(1.0, 0.85, 0.2), s < 200.0);
      col = mix(col, c, clamp((s - 50.0) / 100.0, 0.25, 0.85));
    }
  } else if (cm == 30u) {
    // fronty (oś przy gruncie, wyostrzenie z modelu synoptycznego): tło – przygaszona temperatura 2 m, linie: chłodny ostry
    // granatowy, chłodny łagodny błękitny, ciepły czerwony, stacjonarny (słaby sygnał) – ledwo widoczny
    col = mix(vec3f(0.86), wxPal(0u, mapAt(20u, X, Y)), 0.5) * (0.6 + 0.4 * hillshade(X, Y, nw));
    if (val > 0.05) { col = mix(col, mix(vec3f(0.35, 0.68, 1.0), vec3f(0.04, 0.12, 0.70), clamp(val - 1.0, 0.0, 1.0)), clamp(1.4 * val, 0.0, 1.0)); }
    if (val < -0.05 && val > -1.25) { col = mix(col, vec3f(0.88, 0.10, 0.08), clamp(-1.4 * val, 0.0, 1.0)); }
    if (val <= -1.25) { col = mix(col, vec3f(0.55, 0.15, 0.70), clamp(1.4 * (-val - 1.0), 0.0, 1.0)); }   // stacjonarny – fioletowy
  } else if (cm == 16u) {
    col = wvColor(val);
  } else if (cm == 17u) {
    // widzialność: mgła biała (< 1 km), zamglenie żółtawe (1–5 km), przejrzyste powietrze – teren
    col = vec3f(0.45, 0.55, 0.45) * (0.55 + 0.45 * hillshade(X, Y, nw));
    let fog = 1.0 - smoothstep(0.2, 1.0, val);
    let haze = 1.0 - smoothstep(1.0, 10.0, val);
    col = mix(col, vec3f(0.85, 0.80, 0.62), 0.6 * haze);
    // szczyty w chmurach (nie mgła w dolinie) – fioletowoszare
    let hc = u32(sfcAt(S_PHEN, wrapi(i32(floor(Y)), NY) * NX + wrapi(i32(floor(X)), NX)) + 0.5) == 5u;
    col = mix(col, select(vec3f(0.97), vec3f(0.78, 0.74, 0.90), hc), fog);
  } else if (cm == 18u) {
    // zjawiska przy gruncie (z najbliższego oczka – kategorie)
    col = vec3f(0.62) * (0.55 + 0.45 * hillshade(X, Y, nw));
    let ph = u32(sfcAt(S_PHEN, wrapi(i32(floor(Y)), NY) * NX + wrapi(i32(floor(X)), NX)) + 0.5);
    if (ph == 1u) { col = vec3f(0.60, 0.90, 1.00); }
    if (ph == 2u) { col = vec3f(0.95, 0.95, 1.00); }
    if (ph == 3u) { col = vec3f(0.95, 0.10, 0.45); }
    if (ph == 4u) { col = vec3f(0.80, 0.80, 0.80); }
    if (ph == 5u) { col = mix(col, vec3f(0.72, 0.66, 0.86), 0.75); }     // szczyty / zbocza w chmurach
  } else if (cm == 12u) {
    col = irColor(val);
  } else if (cm == 9u) {
    // widok satelitarny w świetle widzialnym: teren oświetlony słońcem + chmury
    let sun = vec3f(V.sunX, V.sunY, max(V.sunZ, 0.0));
    let day = smoothstep(-0.05, 0.12, V.sunZ);
    let ccol = wrapi(i32(floor(Y)), NY) * NX + wrapi(i32(floor(X)), NX);
    // podłoże: pokrycie terenu (jedno w oczku) czytane w punkcie przesuniętym nieruchomym szumem (±~0.6 oczka, skala ~2.5 oczka) –
    // granice pól, lasów i śniegu nieregularne zamiast kwadratów siatki; grubość śniegu dwuliniowo
    let qg = vec2f(X, Y) / 2.5;
    let Xg = X + 0.9 * (vnoise(qg + vec2f(23.1, 5.7)) - 0.5) + 0.45 * (vnoise(qg * 2.7 + vec2f(3.1, 8.2)) - 0.5);
    let Yg = Y + 0.9 * (vnoise(qg + vec2f(7.9, 31.4)) - 0.5) + 0.45 * (vnoise(qg * 2.7 + vec2f(9.4, 1.3)) - 0.5);
    var gcol0 = wrapi(i32(floor(Yg)), NY) * NX + wrapi(i32(floor(Xg)), NX);
    var ground = vegColor(gcol0);
    var vt = u32(vg[VG_VEG + gcol0] + 0.5);
    // gęstsza mapa pokrycia (ESA WorldCover, ~0.5–1 km): kolory czterech najbliższych punktów zmieszane, punkt przesunięty drobnym szumem (±~0.6 punktu) –
    // rozmyte, nieregularne granice pól, lasów, hal i skał; śnieg i lód jezior z oczka
    var wice = vt == 10u && sfcAt(S_ICE, gcol0) <= 0.0;
    if (V.vhF > 1.5) {
      let fpH = max(fwidth(X), fwidth(Y)) * V.vhF;
      let jH = (1.0 - smoothstep(1.0, 2.0, fpH)) / V.vhF;
      let qh = vec2f(X, Y) * V.vhF / 2.5;
      let Xh = X + (0.9 * (vnoise(qh + vec2f(4.3, 17.9)) - 0.5) + 0.45 * (vnoise(qh * 2.7 + vec2f(13.1, 2.2)) - 0.5)) * jH;
      let Yh = Y + (0.9 * (vnoise(qh + vec2f(21.7, 3.4)) - 0.5) + 0.45 * (vnoise(qh * 2.7 + vec2f(6.6, 19.5)) - 0.5)) * jH;
      let gh = groundHiA(Xh, Yh, fpH);
      ground = gh.c; vt = gh.vt; gcol0 = gh.col;
      wice = vt == 10u && !waterIce(gcol0);
    }
    let lit = select(0.0, hillshade(X, Y, sun), V.sunZ > 0.0);
    let fsn = select(clamp(sfcBil(S_SWE, Xg, Yg) / 10.0, 0.0, 1.0) * select(1.0, 0.5, vt == 1u || vt == 2u || vt == 5u || vt == 11u), 0.0, wice);
    let gcol = mix(ground, vec3f(0.92, 0.94, 0.97), fsn) * (0.25 + 0.75 * lit);
    // zachmurzenie ogólne z tego samego opisu chmur co widok 3D i promieniowanie (cloudAt): w przerwach
    // widać grunt – chmury porwane wg szumu o skali kilku km, płynącego z wiatrem
    // dwie warstwy: najpierw mgła i chmury warstwowe (niżej, szarawe), na nich chmury kłębiaste (jaśniejsze,
    // z przerwami wg własnego zachmurzenia) – wcześniej jedno zachmurzenie kolumny: mgła zakrywała całe oczko
    // i cumulusy wyglądały jak pod zasłoną
    // pola chmur czytane w punkcie przesuniętym gładkim szumem (±~0.7 oczka, skala ~3 oczek, płynie z wiatrem) – brzegi chmur
    // nieregularne zamiast schodków siatki (pikseloza przy zbliżeniu)
    let qn = vec2f((X - f32(MG)) * DX - V.nofx, (Y - f32(MG)) * DY - V.nofy) / (3.0 * DX);
    let Xw = X + 1.4 * (vnoise(qn) - 0.5) + 0.7 * (vnoise(qn * 2.3 + vec2f(5.2, 1.7)) - 0.5);
    let Yw = Y + 1.4 * (vnoise(qn + vec2f(11.3, 7.1)) - 0.5) + 0.7 * (vnoise(qn * 2.3 + vec2f(2.9, 13.4)) - 0.5);
    let lwt = max(mapBlur(29u, Xw, Yw), 0.0);
    let lwc = clamp(mapBlur(61u, Xw, Yw), 0.0, lwt);
    // warstwowe: gładko, bez dziur – część oczka działa jak przezroczystość; kłębiaste: miękkie brzegi
    // krycie z grubości optycznej τ ≈ 0.15·LWP[g/m²] – tak samo jak w widoku 3D (exp(−∫ekstynkcja)) i w promieniowaniu
    // (wcześniej 0.06 – ta sama chmura na mapie 2.5× bardziej przezroczysta niż w 3D: piętro średnie jak mgiełka)
    // dokładnie to, co widać z góry w widoku 3D: przepuszczalność oczka exp(−τ) ze średniej grubości optycznej
    // (dzielenie przez część oczka i mnożenie przez nią ograniczało krycie częściowo zachmurzonych oczek do ~35%
    // nawet przy grubej chmurze – „mgiełka” zamiast pokładu)
    // kłębiaste: krycie z ich pokrycia oczka (COVC) – chmura porwana zakrywa najwyżej tę część oczka, w której jest
    // (wcześniej woda rozłożona na całe oczko: cumulusy na 20% oczka wyglądały jak pełny pokład)
    // kowadła i cirrusy (warstwowe lodowe < −20 °C) leżą nad kłębami – rysowane na końcu, zasłaniają wieże burz (wcześniej
    // wszystkie chmury warstwowe pod kłębami: wieże „na wierzchu” tarczy kowadła)
    let lwa = clamp(mapBlur(69u, Xw, Yw), 0.0, lwt - lwc);
    let aS = 1.0 - exp(-0.15 * (lwt - lwc - lwa));
    let aA = 1.0 - exp(-0.15 * lwa);
    let fC = clamp(mapBlur(59u, Xw, Yw) / 100.0, 0.05, 1.0);
    // pojedyncze cumulusy (ta sama część oczka): kłęby wokół punktów siatki ~2 oczek, płynące z wiatrem ~1.5 km – jak w widoku 3D
    // (wcześniej krycie rozłożone równo: nieruchome białawe plamy); przy części oczka bliskiej 1 i na siatkach < ~0.5 km – równo
    let wbC = smoothstep(300.0, 900.0, DX) * (1.0 - smoothstep(0.85, 0.97, fC));
    // (z pól wygładzonych w punkcie przesuniętym – wcześniej z jednego oczka: tam, gdzie chmury przechodziły z piętra niskiego na
    // średnie (nad górami podstawa wyżej), kłęby dwóch wzorów płynących z różnym wiatrem były przycinane na granicach oczek –
    // kwadratowe białe płaty, „pikseloza”)
    let clmB = sfcBlur(S_CLM, Xw, Yw);
    let wmC = smoothstep(0.4, 0.8, clmB / max(sfcBlur(S_CLL, Xw, Yw) + clmB, 1e-3));
    let aC = fC * (1.0 - exp(-0.15 * lwc / fC)) * mix(1.0, cuBlob(X, Y, fC, wmC) / fC, wbC);
    let sunf = 0.55 + 0.45 * clamp(V.sunZ * 2.0, 0.0, 1.0);
    col = mix(gcol, vec3f(0.92, 0.93, 0.95) * sunf, aS);
    col = mix(col, vec3f(0.98) * sunf, aC);
    col = mix(col, vec3f(0.95, 0.96, 0.97) * sunf, aA);
    // mgiełka atmosferyczna (jak na zdjęciach satelitarnych): powietrze (Rayleigh – niebieskie) i aerozol, droga słońce → grunt →
    // satelita; ciemny ląd i morze niebieskawe i mniej kontrastowe, przy niskim słońcu mocniej
    let mus = max(V.sunZ, 0.08);
    let tv = vec3f(0.045, 0.10, 0.24) + vec3f(0.12);
    let trn = exp(-tv * (0.5 / mus + 1.0) * 0.6);
    col = col * trn + vec3f(0.62, 0.72, 0.90) * sunf * 0.55 * (1.0 - exp(-tv * 1.3));
    col *= 0.06 + 0.94 * day;
    if (f == 37u) {
      // piętra chmur (bez światła słońca): niskie – pomarańczowe, średnie – zielone, wysokie – niebieskie;
      // widok z góry (wyższe zasłaniają niższe), przełączniki pięter w bitach 2–4 V.relief
      col = gcol / (0.25 + 0.75 * lit) * 0.45 + 0.1;
      let cs = vec3f(sfcAt(S_CLL, ccol), sfcAt(S_CLM, ccol), sfcAt(S_CLH, ccol));
      let on = vec3f(f32((V.relief >> 2u) & 1u), f32((V.relief >> 3u) & 1u), f32((V.relief >> 4u) & 1u));
      let al = (1.0 - exp(-0.15 * cs)) * on;
      col = mix(col, vec3f(1.00, 0.62, 0.22), al.x);
      col = mix(col, vec3f(0.35, 0.85, 0.40), al.y);
      col = mix(col, vec3f(0.55, 0.78, 1.00), al.z);
    }
  } else if (cm == 10u) {
    col = hypso(select(val, demAt(X, Y), V.mode == 0u)) * (0.55 + 0.45 * hillshade(X, Y, nw));
    let lc = u32(vg[VG_LAND + wrapi(i32(floor(Y)), NY) * NX + wrapi(i32(floor(X)), NX)] + 0.5);
    if (lc == 3u) { col = vec3f(0.20, 0.40, 0.70); }
    if (lc == 1u) { col *= vec3f(0.75, 0.9, 0.75); }
    if (lc == 2u) { col = mix(col, vec3f(0.6), 0.6); }
  }

  // rzeźba terenu na mapach i przekrojach poziomych: cieniowanie stoków i poziomice
  if (V.mode == 0u && V.hmax > 1.0) {
    let ht = demAt(X, Y);
    let hm = max(V.hmax, V.hmaxD);
    if ((V.relief & 1u) != 0u && cm != 9u && cm != 10u && cm != 6u && cm != 24u && cm != 25u && cm != 26u) {
      col *= clamp(1.0 + 0.85 * (reliefShade(X, Y) - 1.0), 0.4, 1.45);
    }
    if ((V.relief & 2u) != 0u) {
      // odstęp poziomic z najwyższego punktu: 50 / 100 / 200 / 500 m; co piąta pogrubiona
      let iv = select(select(select(500.0, 200.0, hm < 3000.0), 100.0, hm < 1500.0), 50.0, hm < 500.0);
      let fh = max(fwidth(ht), 1e-3);
      let d = abs(fract(ht / iv + 0.5) - 0.5) * iv / fh;
      let major = abs(fract(ht / (5.0 * iv) + 0.5) - 0.5) * 5.0 * iv / fh;
      // brązowe, kropkowane – żeby odróżniały się od izolinii pola (ciągłych, ciemnych)
      let dot = fract((pos.x + pos.y) / 5.0) < 0.6;
      // (przy izoliniach pola poziomice o połowę słabsze – w górach razem dawały gąszcz linii)
      let ra = select(1.0, 0.5, V.iso > 0.0);
      if (ht > 0.5 * iv && d < 0.6 && dot) { col = mix(col, vec3f(0.42, 0.25, 0.08), 0.5 * ra); }
      if (ht > 0.5 * iv && major < 0.9) { col = mix(col, vec3f(0.36, 0.20, 0.05), 0.7 * ra); }
    }
  }

  // izolinie (izotermy itp.); izoterma 0 °C wyróżniona
  if (V.iso > 0.0) {
    let isT = f == 0u || f == 20u || f == 21u || f == 24u || f == 46u || f == 47u || (f >= 80u && f <= 82u);
    if (isT && V.iso <= 1.0) {
      // izotermy w stałym układzie: co 5 °C grube, co 2 °C cienkie ciągłe, co 1 °C kreskowane; odległość od linii
      // w pikselach (fwidth) – grubość niezależna od gradientu; najgęstsze linie wygaszane płynnie dopiero, gdy
      // leżą bliżej niż ~4 px (strome stoki), bez przeskoków
      let d1 = abs(fract(val + 0.5) - 0.5) / fw;
      let d2 = abs(fract(val * 0.5 + 0.5) - 0.5) * 2.0 / fw;
      let d5 = abs(fract(val * 0.2 + 0.5) - 0.5) * 5.0 / fw;
      let dash = select(0.0, 1.0, fract((pos.x + pos.y) / 7.0) < 0.55);
      let a5 = 1.0 - smoothstep(0.9, 1.6, d5);
      // (spokojniej niż dawniej – razem z kropkami miejscowości i poziomicami pole ginęło pod liniami: co 2 °C 0.75 → 0.5, co 1 °C 0.6 → 0.35,
      // linie co 1 °C znikają, gdy leżą bliżej niż ~7 px, co 2 °C – bliżej niż ~5 px)
      let a2 = (1.0 - smoothstep(0.3, 0.9, d2)) * (1.0 - smoothstep(0.25, 0.45, fw));
      let a1 = (1.0 - smoothstep(0.2, 0.7, d1)) * dash * (1.0 - smoothstep(0.1, 0.15, fw));
      col = mix(col, vec3f(0.0), max(0.85 * a5, max(0.5 * a2, 0.35 * a1)));   // czarne
    } else {
      let d = abs(fract(val / V.iso + 0.5) - 0.5) * V.iso / fw;
      col = mix(col, vec3f(0.0), 0.8 * (1.0 - smoothstep(0.4, 0.9, d)));
    }
    if ((f == 0u || f == 20u || f == 21u || f == 24u || (f >= 80u && f <= 82u)) && abs(val) / fw < 1.3) { col = vec3f(1.0); }
  }

  // mapa „Parametry burzowe” (55): na tle CAPE izolinie SRH 0–3 km co 100 m²/s² (pogrubiona 200)
  if (V.mode == 0u && (f == 55u || f == 56u)) {
    let srh = mapAt(53u, X, Y);
    let fs = max(fwidth(srh), 1e-3);
    let d = abs(fract(srh / 100.0 + 0.5) - 0.5) * 100.0 / fs;
    if (srh > 50.0 && d < 0.8) { col = mix(col, vec3f(0.95, 0.1, 0.2), 0.85); }
    if (abs(srh - 200.0) / fs < 1.3) { col = vec3f(1.0, 0.05, 0.1); }
  }

  // strzałki wiatru na mapie (bit 5 V.relief): co 30 px, wiatr na przekroju poziomym albo – na mapach –
  // w pierwszej warstwie nad gruntem; długość rośnie z prędkością (pełna przy ≥ 15 m/s)
  if (V.mode == 0u && ((V.relief & 32u) != 0u || f == 50u || f == 51u || f == 55u || f == 56u)) {
    let cs = 30.0;
    let cp = (floor(pos.xy / cs) + 0.5) * cs;
    let cu = vec2f(V.zx, V.zy) + cp / V.size / V.zs;
    let Xc = f32(MG) + cu.x * f32(NXD);
    let Yc = f32(MG) + (1.0 - cu.y) * f32(NYD);
    let ci = wrapi(i32(floor(Xc)), NX);
    let cj = wrapi(i32(floor(Yc)), NY);
    let cc = cj * NX + ci;
    var kw = u32(vg[VG_KB + cc]);
    if (!isMap) { kw = max(kw, min(u32(S_of_z(V.sliceZ)), NZ - 1u)); }
    let l = kw * NXY + cc;
    let uw = 0.5 * (state[U_OFF + l] + state[U_OFF + kw * NXY + cj * NX + wrapi(i32(ci) + 1, NX)]);
    let vw = 0.5 * (state[V_OFF + l] + state[V_OFF + kw * NXY + wrapi(i32(cj) + 1, NY) * NX + ci]);
    var sp = length(vec2f(uw, vw));
    var ud = vec2f(uw, vw);
    // na mapach: kierunek z 1. poziomu, długość wg wiatru na 10 m (profil logarytmiczny)
    if (isMap) { sp = sfcAt(S_U10, cc); }
    // mapy burzowe: wektor ścinania 0–6 km (pełna długość przy 30 m/s)
    if (f == 51u || f == 55u || f == 56u) { ud = vec2f(sfcAt(S_SHU, cc), sfcAt(S_SHV, cc)); sp = 0.5 * length(ud); }
    if (sp > 0.3) {
      let d = normalize(vec2f(ud.x, -ud.y) + vec2f(1e-6, 0.0));
      let L = mix(4.0, 12.0, clamp(sp / 15.0, 0.0, 1.0));
      let p = pos.xy - cp;
      let al = dot(p, d);
      let pr = abs(dot(p, vec2f(-d.y, d.x)));
      let shaft = abs(al) < L && pr < 0.8;
      let head = al > L - 5.0 && al < L + 1.0 && pr < (L + 1.0 - al) * 0.65;
      let halo = abs(al) < L + 1.5 && pr < 2.2;
      if (halo) { col = mix(col, vec3f(1.0), 0.35); }
      if (shaft || head) { col = vec3f(0.05, 0.06, 0.09); }
    }
  }

  // chmury i deszcz na przekrojach 3D
  if (!isMap && V.overlay == 1u && f != 5u && f != 6u) {
    // chmury z jednego opisu (cloudAt – jak widok 3D i obraz satelitarny): krycie z grubości optycznej ~300 m
    // drogi w chmurze, przerwy szumem wg części oczka zajętej przez chmurę, kłębiaste jaśniejsze u góry
    let qcR = trilin(0u, QC_OFF, NZ, X - 0.5, Y - 0.5, S - 0.5);
    let qiR = trilin(0u, QI_OFF, NZ, X - 0.5, Y - 0.5, S - 0.5);
    let qrR = trilin(0u, QR_OFF, NZ, X - 0.5, Y - 0.5, S - 0.5);
    let qvR = trilin(0u, QV_OFF, NZ, X - 0.5, Y - 0.5, S - 0.5);
    let thR = trilin(0u, T_OFF, NZ, X - 0.5, Y - 0.5, S - 0.5);
    let kq = u32(clamp(S - 0.5, 0.0, f32(NZ - 1u)));
    let tR = (vg[VG_TC + kq] + thR) * vg[VG_EXC + kq];
    let pR = vg[VG_PRS + kq];
    let wR = trilin(0u, W_OFF, NZ + 1u, X - 0.5, Y - 0.5, S);
    let cq = wrapi(i32(floor(Y)), NY) * NX + wrapi(i32(floor(X)), NX);
    let kbq = u32(vg[VG_KB + cq]);
    let cl = cloudAt(vg[VG_RC + kq], qcR, qiR, qrR, qvR / qsat(tR, pR), qvR / qsat_ice(tR, pR), tR, z,
                     convFlag(wR, sfcAt(S_H, cq), z - vg[VG_ZW + kbq], sfcAt(S_PBLH, cq), sfcAt(S_MUCAPE, cq), sfcAt(S_MUEL, cq)),
                     sfcAt(S_CULS, cq), sfcAt(S_CUBS, cq), sfcAt(S_CUTS, cq));
    // przerwy jak w widoku 3D: kłęby wokół punktów szumu komórkowego (odstęp ~2.5–4 km), warstwowe – łagodny szum
    let nzc = vnoise(vec2f(X * DX / 1200.0, z / 400.0)) * 0.65 + 0.35 * vnoise(vec2f(X * DX / 450.0 + 7.1, z / 160.0));
    let cuS = max(2500.0, 1.2 * DX);
    let wl = worley2(vec2f(X * DX / cuS, z / (1.6 * cuS) + Y * 0.37));
    let rr = clamp(sqrt(cl.y / 3.0), 0.12, 0.85);
    let covCu = smoothstep(1.0 - rr - 0.1, 1.0 - rr + 0.06, wl + 0.3 * (nzc - 0.5));
    let cov = smoothstep(0.0, 0.7, cl.y);              // gładko, bez wycinania kształtów szumem
    let a = select(0.0, (1.0 - exp(-cl.x * 300.0)) * cov, cl.y > 0.005);
    let fq = max(fwidth(a), 1e-3);
    let shade = mix(mix(vec3f(0.97), vec3f(0.84, 0.91, 1.0), cl.z), vec3f(0.70, 0.72, 0.76), 0.35 * cl.w * (1.0 - smoothstep(0.0, 3000.0, z - sfcAt(S_CUBS, cq))));
    col = mix(col, shade, a * (0.25 + 0.7 * V.cloudAlpha));
    if (abs(a - 0.25) / fq < 0.8) { col = mix(col, vec3f(0.25), 0.5); }         // kontur chmury
    let qr = 1000.0 * qrR;
    if (V.mode == 1u && W_CU > 0.0 && sfcAt(S_PRCUS, cq) > 0.05 && z < sfcAt(S_CUBS, cq) && fract((pos.x - pos.y) / 6.0) < 0.25) {
      col = mix(col, vec3f(0.25, 0.45, 0.9), 0.5);                                // smugi opadu konwekcji parametryzowanej
    }
    if (qr > 0.05 && fract((pos.x + pos.y) / 7.0) < 0.3) {                   // kreskowanie deszczu
      col = mix(col, vec3f(0.10, 0.35, 0.90), clamp(0.35 + qr, 0.35, 0.9));
    }
  }

  // teren na przekrojach 3D (schodkowy, tak jak widzi go model)
  let tcol = wrapi(i32(floor(Y)), NY) * NX + wrapi(i32(floor(X)), NX);
  let kb = u32(vg[VG_KB + tcol]);
  let zt = vg[VG_ZW + kb];
  if (!isMap && V.mode == 1u && V.hmax > 1.0) {
    // przekrój pionowy: prawdziwy (gładki) profil terenu z cieniowaniem i obrysem; jaśniejsze
    // kreskowanie tam, gdzie model ma teren schodkowy wyżej niż gładki
    let hs = hgtAt(X, Y);
    let pz = V.viewTop / V.size.y;
    if (z < hs) {
      col = hypso(hs) * (0.62 + 0.25 * clamp((hs - z) / max(V.hmax, 1.0), 0.0, 1.0)) * mix(0.8, 1.15, clamp(0.5 + 2.0 * mapSlope(X, Y).x, 0.0, 1.0));
    } else if (z < zt) {
      col = mix(col, hypso(hs) * 0.9, select(0.15, 0.4, fract((pos.x - pos.y) / 6.0) < 0.5));
    }
    if (abs(z - hs) < 1.2 * pz) { col = vec3f(0.12, 0.09, 0.06); }
  } else if (!isMap && kb > 0u && z < zt) {
    col = hypso(vg[VG_HGT + tcol]) * 0.8;
  }

  let px = f32(NXD) / V.size.x / V.zs;

  // siatka pomocnicza: co 10 oczek w poziomie, co 1 km w pionie (przełącznik, bit 6 V.relief); na obrazach
  // satelitarnych wyłączona – na białych chmurach wyglądała jak artefakt
  let gridOn = (V.relief & 64u) != 0u && !(V.mode == 0u && (cm == 9u || cm == 12u || cm == 16u));
  let Xd = X - f32(MG);
  if (gridOn && abs(Xd - round(Xd / 10.0) * 10.0) < 0.5 * px) { col *= 0.88; }
  if (V.mode == 0u) {
    let py = f32(NYD) / V.size.y / V.zs;
    let Yd = Y - f32(MG);
    if (gridOn && abs(Yd - round(Yd / 10.0) * 10.0) < 0.5 * py) { col *= 0.88; }
    if (abs(Y - V.sliceY) < 0.75 * py) { col = vec3f(0.1, 0.1, 0.1); }
  } else {
    let pz = V.viewTop / V.size.y;
    if (gridOn && abs(z - round(z / 1000.0) * 1000.0) < 0.5 * pz) { col *= 0.88; }
    if (abs(z - V.sliceZ) < 0.75 * pz) { col = vec3f(0.1, 0.1, 0.1); }
  }
  return vec4f(col, 1.0);
}
