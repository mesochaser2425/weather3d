// Wspólne funkcje: indeksowanie periodyczne, siatka pionowa, interpolacja trójliniowa.
// Moduł, który to dołącza, musi zdefiniować: fn ldb(b: u32, i: u32) -> f32

fn wrapi(i: i32, n: u32) -> u32 {
  let ni = i32(n);
  return u32(((i % ni) + ni) % ni);
}

// Zachmurzenie częściowe w oczku z wody chmurowej kolumny cw [g/m²] i strumienia ciepła z gruntu hs [W/m²]:
// na siatkach LES chmura wypełnia oczko; na grubych (W_PBL) chmury konwekcyjnej warstwy granicznej (za dnia
// nad nagrzanym gruntem) pokrywają tylko część oczka (pola cumulusów, porwane Sc), a chmury warstwowe
// w stałej stratyfikacji (noc, zima, mgła, stratus) – całe oczko
fn cloudFrac(cw: f32, hs: f32) -> f32 {
  return mix(1.0, 1.0 - exp(-cw / 25.0), W_PBL * smoothstep(0.0, 60.0, hs));
}

// ---- Opis chmury w punkcie siatki: JEDEN dla widoku 3D, obrazu satelitarnego, przekroju i promieniowania ----
// Wynik: x – ekstynkcja wewnątrz chmury [1/m], y – część oczka zajęta przez chmurę (0…1), z – udział lodu,
// w – rodzaj chmury (0 warstwowa … 1 kłębiasta). Składniki:
//  • woda i lód liczone wprost (q_c, q_i; opad q_r słabiej): na drobnych siatkach chmura wypełnia oczko, na grubych
//    chmura kłębiasta zajmuje jego część (pole cumulusów) – tym większą, im więcej wody;
//  • chmura podsiatkowa z wilgotności (Sundqvist): RH > RHc, RHc 98% (≤ ~1 km) … 85% (≥ ~8 km) – chmury mniejsze
//    od oczka, których model nie widzi jako nasycenia;
//  • chmura konwekcji parametryzowanej (CUL [g/m²] między podstawą cub i wierzchołkiem cut), kowadło lodowe u góry.
// rho – gęstość [kg/m³], rhw / rhi – wilgotność względna wobec wody / lodu, t [K], z – wysokość n.p.m. [m],
// conv0 – kłębiastość chmury liczonej wprost (prąd wstępujący, konwekcyjna warstwa graniczna)
fn cloudAt(rho: f32, qc: f32, qi: f32, qr: f32, rhw: f32, rhi: f32, t: f32, z: f32, conv0: f32,
           cul: f32, cub: f32, cut: f32) -> vec4f {
  // wagi skali: zachmurzenie częściowe chmur kłębiastych liczonych wprost od ~1 km, chmury podsiatkowe z wilgotności
  // od kilku km (na drobniejszych siatkach chmura to nasycenie widoczne w modelu)
  let gcv = smoothstep(500.0, 2500.0, DX);
  let gs = smoothstep(2000.0, 10000.0, DX);
  let ql = max(qc, 0.0) + max(qi, 0.0);
  // woda liczona wprost (opad: duże krople – słaba ekstynkcja)
  let eW = 150.0 * rho * max(qc, 0.0);
  let eI = 50.0 * rho * max(qi, 0.0);
  let eR = 6.0 * rho * max(qr, 0.0);
  // kowadła burz i cirrusy: chmura całkiem lodowa (bez wody przechłodzonej) poniżej ~−20 °C to warstwa rozlana na całe oczko,
  // gładka, a nie kłęby; wieża burzy niżej (z wodą przechłodzoną) zostaje kłębiasta. Wcześniej lód kowadła leżał w strefie
  // chwiejnej kolumny (do MUEL + 500 m) i był „kłębiasty”: na satelicie i w 3D rozrzucone kłębki na 10–45% oczka, z góry las
  // wież bez tarczy kowadła (burze, 4 km: chmury wysokie > 20 g/m² na 49% mapy, zachmurzenie 43%)
  let glac = smoothstep(0.8, 0.97, max(qi, 0.0) / max(ql, 1e-12)) * (1.0 - smoothstep(248.0, 258.0, t));
  let cr = conv0 * (1.0 - glac);
  // pokrycie oczka chmurą kłębiastą rośnie z ilością wody (siatki ≥ ~1 km: ślad wody = mały ułamek oczka) –
  // narasta płynnie zamiast zapalać się całym oczkiem; chmury warstwowe (As, St, Ns) pokrywają całe oczko
  var fr = mix(smoothstep(1e-7, 2e-5, ql), sqrt(clamp(ql / 1e-4, 0.0, 1.0)), gcv * cr) * mix(1.0, 0.25 + 0.75 * (1.0 - exp(-ql / 3e-4)), gcv * cr);
  fr = max(fr, 0.5 * smoothstep(1e-6, 1e-4, max(qr, 0.0)));
  // podsiatkowa z wilgotności (w zimnych warstwach wobec lodu)
  let cold = t < 253.15;
  let rh = select(rhw, rhi, cold);
  let rhc = select(mix(0.99, 0.85, gs), mix(1.05, 0.92, gs), cold);
  // (chmury z samej wilgotności wyłączone – chmura tylko przy nasyceniu: woda/lód w oczku albo konwekcja schematu)
  let fs = 0.0 * clamp(1.0 - sqrt(max(1.0 - rh, 0.0) / (1.0 - min(rhc, 0.995))), 0.0, 1.0) * select(1.0, smoothstep(rhc - 0.02, rhc + 0.03, rh), cold);
  let eS = fs * select(150.0 * rho * 1e-4, 50.0 * rho * 2e-5, cold);
  // konwekcja parametryzowana: wieża (pokrycie wg wody) i kowadło (górne 20% chmury głębokiej)
  var fcv = 0.0;
  var eC = 0.0;
  var iC = 0.0;
  if (cul > 0.02 && cut > cub + 300.0 && z > cub && z < cut) {
    let zr = (z - cub) / (cut - cub);
    let deep = smoothstep(2500.0, 5000.0, cut - cub);
    // pokrycie rośnie od zera z wodą chmur schematu (CUL [g/m²] średnio w oczku): ~3% przy 5, ~9% przy 16, ~22% przy 45,
    // ~57% przy 300 g/m²; wcześniej co najmniej 12% przy każdym śladzie CUL i woda 0.6 g/kg na całej wysokości –
    // w dni z CAPE średnio ~16 g/m² CUL dawało ~500 g/m² wody na obrazie: całe niebo zakryte wieżami
    fcv = 0.6 * (1.0 - exp(-cul / 100.0)) * mix(1.0, 1.6, deep * smoothstep(0.75, 0.95, zr));
    // zanikająca chmura (CUL → 0) blednie płynnie, bez nagłego zniknięcia przy progu
    fcv = min(fcv, 0.9) * smoothstep(0.0, 0.05, zr) * (1.0 - smoothstep(0.93, 1.0, zr)) * smoothstep(0.02, 4.0, cul);
    let anvil = t < 250.0;
    // woda w chmurze: płytkie cumulusy ~0.3 g/kg, głębokie ~0.6 g/kg
    eC = fcv * select(150.0 * rho * mix(3e-4, 6e-4, deep), 50.0 * rho * 3e-4, anvil);
    iC = select(0.0, eC, anvil);
  }
  let f = max(max(fr, fs), fcv);
  let em = eW + eI + eR + eS + eC;
  let ice = clamp((eI + select(0.0, eS, cold) + iC) / max(em, 1e-9), 0.0, 1.0);
  let cv = max(cr * step(1e-7, ql), select(0.0, 1.0, fcv > 0.0 && iC <= 0.0));
  return vec4f(em / max(f, 1e-3), f, ice, cv);
}
// kłębiastość chmury liczonej wprost: konwekcyjna warstwa graniczna za dnia (hs – ciepło z gruntu [W/m²], zagl – wysokość
// nad gruntem, pblh – wysokość warstwy granicznej) albo chwiejna kolumna (mu – MUCAPE [J/kg], muel – wierzchołek dodatniej
// wyporności tej cząstki nad gruntem): także nocą – konwekcja podniesiona, nad ciepłą wodą, w chłodnym napływie za frontem
// (wcześniej tylko ciepło z gruntu – po zachodzie wszystkie chmury siatki stawały się warstwowe)
fn convFlag(w: f32, hs: f32, zagl: f32, pblh: f32, mu: f32, muel: f32) -> f32 {
  // (bez lokalnego w: prąd pionowy oscyluje między wierszami siatki i rodzaj chmury zmieniał się co wiersz – paski)
  let heat = select(0.0, smoothstep(30.0, 80.0, hs), zagl < pblh + 1500.0);
  let inst = select(0.0, smoothstep(30.0, 200.0, mu), zagl < muel + 500.0);
  return max(heat, inst) * max(W_PBL, smoothstep(300.0, 1500.0, DX));
}

// ---- Pojedyncze cumulusy na części powierzchni (widok 3D i obraz satelitarny – ten sam wzór) ----
fn cuHash(v0: vec2u) -> vec2u {
  var v = v0 * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v = v ^ (v >> vec2u(16u));
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  return v ^ (v >> vec2u(16u));
}
fn cuRnd(c: vec2i, s: u32) -> vec2f { return vec2f(cuHash(bitcast<vec2u>(c) ^ vec2u(s * 0x9e3779b9u, s * 0x85ebca6bu))) / 4294967295.0; }
// gładki szum wartości 2D (0..1) i jego suma trzech oktaw
fn cuVal(p: vec2f) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cuRnd(i, 7u).x, cuRnd(i + vec2i(1, 0), 7u).x, u.x), mix(cuRnd(i + vec2i(0, 1), 7u).x, cuRnd(i + vec2i(1, 1), 7u).x, u.x), u.y);
}
fn cuFbm(p: vec2f) -> f32 { return 0.55 * cuVal(p) + 0.3 * cuVal(p * 2.03 + vec2f(17.1, 3.7)) + 0.15 * cuVal(p * 4.1 + vec2f(5.3, 11.9)); }
// Kształt cumulusów: q0 – położenie w bokach siatki kłębów (już z przesuwem z wiatrem), fc – część powierzchni z chmurą.
// Punkty na siatce o boku 1, losowo przesunięte; siatka wykrzywiona gładkim szumem (nieregularne odstępy, skupiska), rozmiar
// losowy 0.55–1.45; przy małym pokryciu mniej chmur o promieniu ≥ 0.3 boku (część punktów aktywna), a nie coraz cieńsze;
// brzeg płatowaty (szum w dwóch skalach). Średnie pokrycie = fc (sprawdzone numerycznie, scratchpad cushape.mjs: ±4%).
// Życie chmur (tau – faza pokolenia 0..1, cuGen): każda chmura rodzi się w losowej chwili w pierwszej połowie życia pokolenia,
// żyje pół okresu, promień rośnie i maleje jak √sin (pole ∝ sin); suma pokryć dwóch pokoleń jest wtedy stała w czasie
// (2/π·π/2 = 1), a chmury nie bledną wszystkie naraz (wcześniej waga całego pokolenia – co 15 min wszystkie na połowie gęstości:
// cumulusy w 3D „znikały na chwilę” co 1–3 s)
// Zwraca (odległość od najbliższego środka z zaburzonym brzegiem, promień) – chmura tam, gdzie x < y
fn cuShape(q0: vec2f, fc: f32, tau: f32) -> vec2f {
  let pa = min(fc / 0.287, 1.0);
  let fe = fc / max(pa, 1e-3);
  let r = sqrt(fe) * (0.5435 + fe * (-0.0589 + 0.2586 * fe));
  let q = q0 + 0.45 * vec2f(cuFbm(q0 * 0.9 + vec2f(3.1, 7.7)) - 0.5, cuFbm(q0 * 0.9 + vec2f(11.3, 1.9)) - 0.5);
  let ci = vec2i(floor(q));
  var d = 9.0;
  for (var a = -1; a <= 1; a++) {
    for (var b = -1; b <= 1; b++) {
      let c = ci + vec2i(a, b);
      let h = cuRnd(c, 1u);
      let g = cuRnd(c, 2u);
      let life = (tau - 0.5 * cuRnd(c, 3u).x) * 2.0;
      if (g.x < pa && life > 0.0 && life < 1.0) {
        let k = max(1.2533 * sqrt(sin(3.14159265 * life)), 1e-3);
        d = min(d, length(q - (vec2f(c) + 0.5 + 0.9 * (h - 0.5))) / ((0.55 + 0.9 * g.y) * k));
      }
    }
  }
  let dd = d - r * (0.55 * (cuFbm(q0 * 4.0 + vec2f(2.7, 9.1)) - 0.5) + 0.3 * (cuVal(q0 * 9.0) - 0.5));
  return vec2f(dd, r);
}

// Pokolenia cumulusów płynące z wiatrem warstwy chmur: dwa pokolenia przesunięte o pół okresu; każde ma własny wzór (chmury w nim
// rodzą się i zanikają – cuShape) i od narodzin płynie o przesunięcie d [m] – całkę z wiatru warstwy chmur (0.8–2 km) uśrednionego
// na kafle ~40 km, liczoną na CPU (main.js, cuTick) i interpolowaną dwuliniowo (cuDisp w render/view3d). Wcześniej przesunięcie
// = wiatr w danym miejscu × wiek: przy wietrze zmiennym na kilku km (wypływy i wciąganie burz) sąsiednie fragmenty wzoru
// przesuwały się o kilkanaście km różnie i wzór się zawijał – rozciągnięte smugi i spirale wokół burz.
// ph0 – faza (liczba okresów od startu; okres ≥ 30 min, przy dużym tempie dłuższy – chmura żyje na ekranie ≥ ~2 s).
// Zwraca (q.x, q.y – położenie we wzorze w bokach siatki, faza pokolenia 0..1)
fn cuGen(xy: vec2f, d: vec2f, ph0: f32, S: f32, g: u32) -> vec3f {
  let ph = ph0 + 0.5 * f32(g);
  let n = floor(ph);
  let tau = ph - n;
  let off = cuRnd(vec2i(i32(n), i32(g)), 5u) * 61.0;
  let q = (xy - d) / S + off;
  return vec3f(q, tau);
}
// położenie w kaflach przesunięcia (środki kafli w (i + 0.5)·L/n): indeksy i0, i1 i waga
fn cuTile(x: f32, L: f32, n: f32) -> vec3f {
  let f = clamp(x / L * n - 0.5, 0.0, n - 1.0);
  let i0 = floor(f);
  return vec3f(i0, min(i0 + 1.0, n - 1.0), f - i0);
}

fn z_of_S(S: f32) -> f32 {
  let s = S / f32(NZ);
  return HTOP * (STRA * s + (1.0 - STRA) * s * s);
}

fn S_of_z(z: f32) -> f32 {
  let q = 1.0 - STRA;
  let s = (-STRA + sqrt(STRA * STRA + 4.0 * q * max(z, 0.0) / HTOP)) / (2.0 * q);
  return s * f32(NZ);
}

// dz/dS – grubość warstwy na jednostkę współrzędnej obliczeniowej
fn dzdS(S: f32) -> f32 {
  let s = clamp(S, 0.0, f32(NZ)) / f32(NZ);
  return HTOP * (STRA + 2.0 * (1.0 - STRA) * s) / f32(NZ);
}

// Interpolacja trójliniowa pola o nk poziomach, zaczynającego się od indeksu `off`.
// X, Y, K – współrzędne w indeksach punktów tego pola (poziomo periodycznie, pionowo obcięte).
fn trilin(b: u32, off: u32, nk: u32, X: f32, Y: f32, K: f32) -> f32 {
  let xf = floor(X);
  let yf = floor(Y);
  let fx = X - xf;
  let fy = Y - yf;
  let i0 = wrapi(i32(xf), NX);
  let i1 = (i0 + 1u) % NX;
  let j0 = wrapi(i32(yf), NY);
  let j1 = (j0 + 1u) % NY;
  let kc = clamp(K, 0.0, f32(nk - 1u));
  let k0 = min(u32(kc), nk - 1u);
  let k1 = min(k0 + 1u, nk - 1u);
  let fz = kc - f32(k0);
  let a0 = off + k0 * NXY;
  let a1 = off + k1 * NXY;
  let r0 = j0 * NX;
  let r1 = j1 * NX;
  let c00 = mix(ldb(b, a0 + r0 + i0), ldb(b, a0 + r0 + i1), fx);
  let c10 = mix(ldb(b, a0 + r1 + i0), ldb(b, a0 + r1 + i1), fx);
  let c01 = mix(ldb(b, a1 + r0 + i0), ldb(b, a1 + r0 + i1), fx);
  let c11 = mix(ldb(b, a1 + r1 + i0), ldb(b, a1 + r1 + i1), fx);
  return mix(mix(c00, c10, fy), mix(c01, c11, fy), fz);
}

// --- Termodynamika wilgoci ---
// Stosunek zmieszania nasycenia nad wodą (wzór Tetensa) [kg/kg]
fn qsat(T: f32, p: f32) -> f32 {
  let es = 610.78 * exp(17.27 * (T - 273.16) / (T - 35.86));
  return 0.622 * es / max(p - es, 1.0);
}

// Stosunek zmieszania nasycenia nad lodem (Tetens dla lodu) [kg/kg]
fn qsat_ice(T: f32, p: f32) -> f32 {
  let es = 610.78 * exp(21.875 * (T - 273.16) / (T - 7.66));
  return 0.622 * es / max(p - es, 1.0);
}

// Punkt rosy [K] ze stosunku zmieszania q i ciśnienia p (odwrócony wzór Tetensa)
fn dewpoint(q: f32, p: f32) -> f32 {
  let e = max(q * p / (0.622 + q), 1e-3);
  let a = log(e / 610.78);
  return (273.16 * 17.27 - 35.86 * a) / (17.27 - a);
}

// czy kolumna (i, j) leży w widocznej części mapy (bez niewidocznego marginesu MG i strefy brzegowej)
fn inDisp(i: u32, j: u32) -> bool { return i >= MG && j >= MG && i < MG + NXD && j < MG + NYD; }
