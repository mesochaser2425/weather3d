// Widok 3D: śledzenie promieni przez chmury (rozpraszanie światła słońca z fazą Henyeya–Greensteina,
// przybliżenie rozpraszania wielokrotnego, światło nieba), teren z roślinnością, śniegiem i cieniami
// chmur, niebo i słońce zależne od jego wysokości. Rodzaj chmury (cumulus / warstwowa / cirrus)
// wybiera detal z szumu: kalafiorowe kłęby, łagodne komórki albo włókna wzdłuż wiatru.

struct V3 {
  camPos: vec3f, tanF: f32,
  right: vec3f, aspect: f32,
  up: vec3f, exag: f32,       // przewyższenie pionowe
  fwd: vec3f, time: f32,
  sun: vec3f, sunUp: f32,
  size: vec2f, zTop: f32, blobS: f32,         // blobS – odstęp kłębów chmur kłębiastych [m]
  windDir: vec2f, frame: f32, fogL: f32,
  flags: u32, cutY: f32, cuPh: f32, cuNx: f32,   // bit 0: powierzchnia 0 °C, bit 1: przekrój tnący (y = cutY [m]); cuPh – faza pokoleń cumulusów
  cuNy: f32, _p0: f32, _p1: f32, _p2: f32,
  nofs: vec4f,                                  // ciągłe przesunięcie szumu brzegów chmur [m]: xy – warstwa cumulusów, zw – średni wiatr 0–6 km
  cuD: array<vec4f, 36>,                        // przesunięcie pokoleń cumulusów w kaflach (jak View.cuD w render.wgsl)
  cuD2: array<vec4f, 36>,                       // to samo z wiatrem średnim 0–6 km (chmury z podstawą ≥ ~2.5–4 km)
}

@group(0) @binding(0) var<uniform> C: V3;
@group(0) @binding(1) var densT: texture_3d<f32>;
@group(0) @binding(2) var lightT: texture_3d<f32>;
@group(0) @binding(3) var groundT: texture_2d<f32>;
@group(0) @binding(4) var noiseT: texture_3d<f32>;
@group(0) @binding(5) var sClamp: sampler;
@group(0) @binding(6) var sRep: sampler;
@group(0) @binding(7) var frzT: texture_2d<f32>;

fn ldb(b: u32, i: u32) -> f32 { return 0.0; }

const PI: f32 = 3.14159265;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn LX() -> f32 { return f32(NXD) * DX; }
fn LY() -> f32 { return f32(NYD) * DY; }
fn tcoord(p: vec3f) -> vec3f { return vec3f(p.x / LX(), p.y / LY(), S_of_z(p.z) / f32(NZ)); }
fn groundH(x: f32, y: f32) -> f32 {
  return textureSampleLevel(groundT, sClamp, vec2f(x / LX(), y / LY()), 0.0).x;
}

fn hg(c: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

// kolor słońca: przepuszczalność atmosfery wzdłuż drogi (masa optyczna rośnie przy niskim słońcu)
fn sunColor() -> vec3f {
  let e = clamp(C.sun.z, 0.0, 1.0);
  let ed = degrees(asin(e));
  let m = 1.0 / (e + 0.15 * pow(ed + 3.885, -1.253));
  return exp(-m * vec3f(0.055, 0.11, 0.24)) * smoothstep(-0.03, 0.04, C.sun.z);
}

fn skyColor(rd: vec3f) -> vec3f {
  let day = smoothstep(-0.12, 0.08, C.sun.z);
  let up = clamp(rd.z, 0.0, 1.0);
  let s = normalize(C.sun);
  let cs = max(dot(rd, s), 0.0);
  var col = mix(vec3f(0.60, 0.72, 0.88), vec3f(0.16, 0.34, 0.74), pow(up, 0.55));
  // zachód i wschód: pomarańczowy horyzont od strony słońca
  let low = 1.0 - smoothstep(0.0, 0.3, C.sun.z);
  col = mix(col, vec3f(1.0, 0.52, 0.22), low * pow(cs, 3.0) * pow(1.0 - up, 3.0) * 0.9);
  col += sunColor() * 0.25 * pow(cs, 24.0);
  col *= day;
  col += vec3f(0.006, 0.009, 0.02) * (1.0 - day);
  if (cs > 0.99985 && C.sun.z > -0.01) { col += sunColor() * 12.0; }
  return col;
}

// ---- perspektywa powietrzna (mgiełka) ----
// Grubość optyczna wzdłuż promienia od p0 do p1 (rzeczywiste metry, bez przewyższenia): powietrze (Rayleigh, wysokość skali
// 8 km, niebieskie rozpraszanie) i aerozol (1.5 km, białawy; przy gruncie 4e-5 /m – widzialność ~80 km, grubość optyczna
// ~0.06; przy 8e-5 chmury oglądane z dołu z kilkudziesięciu km były szare i mdłe); światło rozproszone: słońce (pojedyncze
// rozpraszanie, faza Rayleigha i HG g = 0.7) + niebo.
// Daleki teren niebieskawy i mniej kontrastowy, z góry obraz jak zdjęcie satelitarne (wcześniej mgła tylko z odległości –
// z góry prawie niewidoczna)
const BRAY = vec3f(5.8e-6, 13.5e-6, 33.1e-6);
const BAER: f32 = 4.0e-5;
fn odExp(z0: f32, z1: f32, L: f32, H: f32) -> f32 {
  let a = max(z0, 0.0);
  let b = max(z1, 0.0);
  if (abs(b - a) < 1.0) { return L * exp(-0.5 * (a + b) / H); }
  return L * H * (exp(-a / H) - exp(-b / H)) / (b - a);
}
struct Air { ex: vec3f, ins: vec3f }    // przepuszczalność i światło rozproszone na drodze
fn airPath(p0: vec3f, p1: vec3f) -> Air {
  let L = length(p1 - p0);
  if (L < 1.0) { return Air(vec3f(1.0), vec3f(0.0)); }
  let tR = BRAY * odExp(p0.z, p1.z, L, 8000.0);
  let tM = BAER * odExp(p0.z, p1.z, L, 1500.0);
  let tau = tR + vec3f(tM);
  let ex = exp(-tau);
  let mu = dot((p1 - p0) / L, normalize(C.sun));
  let sc = (tR * (0.0597 * (1.0 + mu * mu)) + vec3f(tM * hg(mu, 0.7))) / max(tau, vec3f(1e-7));
  // (jasność w tych samych jednostkach co grunt: albedo·1.7·cos → natężenie słońca ~1.7·π)
  let inS = (sunColor() * 5.3 * sc + ambientSky() * 0.3 * vec3f(0.75, 0.85, 1.0)) * (1.0 - ex);
  return Air(ex, inS);
}
fn airLight(col: vec3f, p0: vec3f, p1: vec3f) -> vec3f { let a = airPath(p0, p1); return col * a.ex + a.ins; }

fn ambientSky() -> vec3f {
  let day = smoothstep(-0.1, 0.15, C.sun.z);
  return vec3f(0.26, 0.36, 0.55) * day + vec3f(0.008, 0.01, 0.02);
}

// kolor podłoża: typ roślinności i jej zieleń (jak vegColor w render.wgsl)
fn vegCol(v: u32, g: f32) -> vec3f {
  switch v {
    case 0u: { return mix(vec3f(0.55, 0.50, 0.36), vec3f(0.36, 0.48, 0.22), g); }
    case 1u: { return mix(vec3f(0.27, 0.24, 0.21), vec3f(0.15, 0.32, 0.13), g); }
    case 2u: { return vec3f(0.09, 0.20, 0.12); }
    case 3u: { return mix(vec3f(0.50, 0.46, 0.38), vec3f(0.42, 0.45, 0.30), g); }
    case 4u: { return vec3f(0.90, 0.92, 0.95); }
    case 5u: { return vec3f(0.07, 0.26, 0.09); }
    case 6u: { return mix(vec3f(0.72, 0.62, 0.38), vec3f(0.52, 0.55, 0.25), g); }
    case 7u: { return vec3f(0.84, 0.72, 0.52); }
    case 8u: { return mix(vec3f(0.70, 0.64, 0.45), vec3f(0.55, 0.58, 0.32), g); }
    case 9u: { return vec3f(0.50, 0.48, 0.46); }
    case 10u: { return vec3f(0.05, 0.12, 0.22); }
    default: { return mix(vec3f(0.35, 0.38, 0.24), vec3f(0.27, 0.36, 0.20), g); }
  }
}

// Gęstość (ekstynkcja [1/m]) w punkcie p z tekstury chmur (jeden opis – cloudAt): b.x średnia ekstynkcja oczka,
// b.y część oczka z chmurą, b.z udział lodu, b.w rodzaj (kłębiasta / warstwowa). Szum wycina przerwy tak, żeby
// chmura zajmowała właśnie tę część oczka, i dodaje detal wg rodzaju: kalafiorowe kłęby (cumulus), łagodne
// komórki (stratus, stratocumulus), włókna wzdłuż wiatru (cirrus).
// Kłęby zajmujące część fc powierzchni: kształt z cuShape (common.wgsl – ten sam co na obrazie satelitarnym). Bok rośnie
// z przewyższeniem (×0.5·przewyższenie, ≥ 1), żeby przy ×4 cumulus miał proporcje cumulusa, a nie ołówka. Brzeg kalafiorowy:
// odległość zaburzona gładkim szumem komórkowym 3D w przestrzeni widoku (z × przewyższenie) – okrągłe guzy ~¼ boku, bez
// drobnego ziarna. Pokolenia cumulusów płyną z lokalnym wiatrem warstwy chmur (cuGen) przez obszar, w którym model daje chmury
// (ich część oczka), jak w rzeczywistości – ten sam wzór i ruch co na obrazie satelitarnym.
fn blobS() -> f32 { return C.blobS * max(1.0, 0.5 * C.exag); }
fn cuDisp(xy: vec2f) -> vec4f {
  let tx = cuTile(xy.x, LX(), C.cuNx);
  let ty = cuTile(xy.y, LY(), C.cuNy);
  let n = u32(C.cuNx);
  let a = mix(C.cuD[u32(ty.x) * n + u32(tx.x)], C.cuD[u32(ty.x) * n + u32(tx.y)], tx.z);
  let b = mix(C.cuD[u32(ty.y) * n + u32(tx.x)], C.cuD[u32(ty.y) * n + u32(tx.y)], tx.z);
  return mix(a, b, ty.z);
}
fn cuDisp2(xy: vec2f) -> vec4f {
  let tx = cuTile(xy.x, LX(), C.cuNx);
  let ty = cuTile(xy.y, LY(), C.cuNy);
  let n = u32(C.cuNx);
  let a = mix(C.cuD2[u32(ty.x) * n + u32(tx.x)], C.cuD2[u32(ty.x) * n + u32(tx.y)], tx.z);
  let b = mix(C.cuD2[u32(ty.y) * n + u32(tx.x)], C.cuD2[u32(ty.y) * n + u32(tx.y)], tx.z);
  return mix(a, b, ty.z);
}
fn blobMask(p: vec3f, fc: f32) -> f32 {
  let S = blobS();
  // przesunięcie pokoleń z kafli (wiatr warstwy cumulusów uśredniony na ~40 km, całkowany w czasie); chmury z podstawą wysoko
  // nad gruntem (altocumulus – frzT.w: najniższa podstawa chmur w kolumnie nad gruntem) płyną z wiatrem średnim 0–6 km – wcześniej
  // wzór chmur piętra średniego płynął z wolniejszym wiatrem przy gruncie
  // kłąb wyżej niż ~0.5 km nad wierzchołkiem najniższej warstwy chmur (frzT.y) to osobna warstwa (altocumulus nad cumulusami)
  // – też wiatr średni; wieże ciągłe od podstawy zostają przy wietrze podstawy
  let fz = textureSampleLevel(frzT, sClamp, p.xy / vec2f(LX(), LY()), 0.0);
  let zag = p.z - groundH(p.x, p.y);
  let dl = cuDisp(p.xy);
  let dh = cuDisp2(p.xy);
  let wm0 = select(0.0, max(smoothstep(2500.0, 4000.0, fz.w), smoothstep(300.0, 800.0, zag - fz.y)), fz.w > 0.0);
  // dwa osobne wzory o częściach powierzchni fc·(1 − wm) i fc·wm (przesunięcie mieszane wg wm ściskało wzór w cienkie smugi – cuBlob w render.wgsl);
  // jedna pętla po obu wzorach i pokoleniach, granice zależne od wm: drugi wzór pominięty poza przejściem (dwa wywołania w if albo continue w pętli 0..4
  // kosztowały obraz +30% także przy jednym wzorze – kompilator shaderów prawdopodobnie liczy wtedy obie strony)
  let wm = smoothstep(0.25, 0.75, wm0);
  var m = 0.0;
  let t1 = select(4u, 2u, wm <= 0.01);
  for (var t = select(0u, 2u, wm >= 0.99); t < t1; t++) {
    let mid = t >= 2u;
    let w = select(1.0 - wm, wm, mid);
    let g = t & 1u;
    let dd4 = select(dl, dh, mid);
    let gq = cuGen(p.xy, select(dd4.xy, dd4.zw, g == 1u), C.cuPh, S, g);
    let sh = cuShape(gq.xy + select(vec2f(0.0), CU_MID, mid), fc * w, gq.z);
    if (sh.x > 2.0 * sh.y) { continue; }
    let n = textureSampleLevel(noiseT, sRep, vec3f(gq.xy, p.z * C.exag / S), 0.0);
    let dd = sh.x - 0.5 * sh.y * (n.g - 0.55);
    m = max(m, 1.0 - smoothstep(sh.y - 0.04, sh.y + 0.04, dd));
  }
  return m;
}
fn cloudExt(p: vec3f, b: vec4f) -> f32 {
  // gładkie chmury bez drobnego szumu (życzenie: cumulusy małe i duże po prostu gładkie)
  if (b.x < 2e-6) { return 0.0; }
  // chmury kłębiaste zajmujące część oczka (b.y < 1, siatki ≥ ~2 km): ta sama średnia ekstynkcja skupiona w kłębach
  // pokrywających b.y powierzchni – jak na satelicie i w zachmurzeniu ogólnym (COVC). Rozłożona równo na całe oczko
  // dawała „zawalone” niebo (lipiec, 4 km: 3D ~90% zakryte przy 50% na satelicie). Warstwowe – równo w całym oczku.
  // (bez dolnego progu części oczka: przy progu 2% ślad wody zanikającej chmury skupiał się w widoczny słupek)
  let fc = clamp(b.y, 1e-3, 1.0);
  // (od ~0.5 km siatki: przy 1 km ~90% wody chmur to cumulusy płytkiej konwekcji parametryzowanej na części oczka –
  // rozłożone równo dawały w 3D ~80% zakrytego nieba przy ~45% na satelicie)
  let wb = smoothstep(0.3, 0.7, b.w) * smoothstep(300.0, 900.0, DX) * (1.0 - smoothstep(0.85, 0.97, fc));
  if (wb < 1e-3) { return b.x; }
  return mix(b.x, b.x / fc * blobMask(p, fc), wb);
}

// współrzędne tekstury chmur z zaginaniem gładkim szumem (±~0.6 oczka poziomo): brzegi chmur nieregularne zamiast
// prostokątów oczek (ilość chmury bez zmian – tylko przesunięcie miejsca odczytu)
fn warpTC(pm: vec3f) -> vec3f {
  // szum płynie z wiatrem warstwy (do ~2.5 km wiatr cumulusów, od ~5 km średni 0–6 km)
  let no = mix(C.nofs.xy, C.nofs.zw, smoothstep(2500.0, 5000.0, pm.z));
  let wn = textureSampleLevel(noiseT, sRep, vec3f(pm.xy - no, pm.z * C.exag) / (4.0 * DX), 0.0);
  return tcoord(pm + vec3f((wn.r - 0.5) * 2.0 * DX, (wn.a - 0.5) * 2.0 * DX, 0.0));
}

// Cień na gruncie: promień do słońca (w przestrzeni widoku – przewyższenie jak w oświetleniu stoków) przez te same chmury,
// które widać (kłęby z przerwami, zaginane brzegi), i przez teren (cień gór). Wcześniej grubość optyczna ze średniej oczka
// (tekstura światła): pod polem cumulusów cały grunt był równo przyciemniony, także w przerwach, a cień miał kształt oczek.
fn groundShadow(pd: vec3f, jit: f32) -> f32 {
  if (C.sunUp <= 0.0) { return 50.0; }
  let sd = normalize(vec3f(C.sun.x, C.sun.y, max(C.sun.z, 0.03) * C.exag));
  let L = max(C.zTop * C.exag - pd.z, 0.0) / sd.z;
  let NSH = 80;
  let ds = L / f32(NSH);
  let dm = length(vec3f(sd.xy, sd.z / C.exag));
  var tau = 0.0;
  for (var n = 0; n < NSH; n++) {
    let q = pd + sd * (ds * (f32(n) + jit) + 30.0);
    if (q.x < 0.0 || q.y < 0.0 || q.x > LX() || q.y > LY()) { break; }
    let pm = vec3f(q.xy, q.z / C.exag);
    if (n > 0 && pm.z < groundH(pm.x, pm.y)) { tau += 50.0; break; }
    let bs = textureSampleLevel(densT, sClamp, warpTC(pm), 0.0);
    if (bs.x > 2e-6) { tau += cloudExt(pm, bs) * ds * dm; }
    if (tau > 8.0) { break; }
  }
  return tau;
}

// poza domeną: płaska równina we mgle albo niebo
fn outside(ro: vec3f, rd: vec3f) -> vec3f {
  let sky = skyColor(rd);
  if (rd.z < -1e-4) {
    let t = -ro.z / rd.z;
    let hz = mix(vec3f(0.60, 0.72, 0.88), vec3f(0.16, 0.34, 0.74), 0.15) * smoothstep(-0.12, 0.08, C.sun.z);
    let g = vec3f(0.24, 0.30, 0.18) * (sunColor() * max(C.sun.z, 0.0) * 1.7 + ambientSky() * 0.6);
    let pe = ro + rd * t;
    // ta sama perspektywa powietrzna co w domenie; bardzo daleko – w horyzont
    let fog = 1.0 - exp(-t / (4.0 * C.fogL));
    return mix(airLight(g, vec3f(ro.xy, ro.z / C.exag), vec3f(pe.xy, 0.0)), hz + vec3f(0.006, 0.009, 0.02), fog);
  }
  return sky;
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / C.size * 2.0 - 1.0;
  let rd = normalize(C.fwd + C.right * (uv.x * C.tanF * C.aspect) - C.up * (uv.y * C.tanF));
  let ro = C.camPos;
  let bmax = vec3f(LX(), LY(), C.zTop * C.exag);
  let bmin = vec3f(0.0, 0.0, -20.0);          // dno trochę pod poziomem morza – trafienie w grunt
  let inv = 1.0 / select(rd, vec3f(1e-7), abs(rd) < vec3f(1e-7));
  let ta = (bmin - ro) * inv;
  let tb = (bmax - ro) * inv;
  let tmin = max(max(min(ta.x, tb.x), min(ta.y, tb.y)), min(ta.z, tb.z));
  let tmax = min(min(max(ta.x, tb.x), max(ta.y, tb.y)), max(ta.z, tb.z));
  var col = vec3f(0.0);
  var T = 1.0;
  if (tmax <= max(tmin, 0.0)) {
    col = outside(ro, rd);
  } else {
    let t0 = max(tmin, 0.0);
    // krok: 150 na całej drodze w pustym powietrzu, w obszarze chmur 5× drobniejszy – przy wejściu krokiem zgrubnym cofnięcie
    // i drobny krok (przy kroku ~1 km na mapie 350 km brzegi kłębów wychodziły w prążki)
    let NS = 150;
    let dt = (tmax - t0) / f32(NS);
    // przesunięcie startu promienia: szum gradientowy przeplatany (Jimenez 2014) – równomierny, prawie
    // niewidoczny wzór zamiast białego szumu
    let jit = fract(52.9829189 * fract(dot(pos.xy, vec2f(0.06711056, 0.00583715))) + C.frame * 0.6180339);
    var t = t0 + dt * jit;
    var step = dt;
    let sunD = normalize(C.sun);
    let cosT = dot(rd, sunD);
    let sunc = sunColor() * 3.2;
    let amb = ambientSky() * 1.1;
    let dm = length(vec3f(rd.xy, rd.z / C.exag));          // długość drogi w metrach modelu na jednostkę t
    var hit = false;
    var tg = 0.0;
    var firstT = -1.0;
    let showFrz = (C.flags & 1u) != 0u;
    let cut = (C.flags & 2u) != 0u;
    var prevF = 0.0;
    var prevC = 0.0;
    var fineLeft = 0;
    var wC = 0.0;     // średnia głębia chmur (ważona ich wkładem) – do mgiełki przed chmurą
    var tC = 0.0;
    for (var n = 0; n < 5 * NS; n++) {
      if (t > tmax) { break; }
      let pd = ro + rd * t;
      let pm = vec3f(pd.xy, pd.z / C.exag);
      // powierzchnia 0 °C: półprzezroczysta różowa warstwa przy przejściu promienia przez izotermę
      if (showFrz) {
        let zf = textureSampleLevel(frzT, sClamp, pm.xy / vec2f(LX(), LY()), 0.0).x;
        let sf = select(0.0, sign(pm.z - zf), zf > 0.0);
        if (n > 0 && sf != 0.0 && prevF != 0.0 && sf != prevF) {
          col += T * vec3f(0.95, 0.40, 0.70) * 0.35;
          T *= 0.72;
        }
        prevF = sf;
      }
      // przekrój tnący: płaszczyzna y = cutY – kolor prądu pionowego, chmury za nią ukryte
      if (cut) {
        let sc = sign(pm.y - C.cutY);
        if (n > 0 && sc != prevC && pm.z < C.zTop) {
          let wv = textureSampleLevel(lightT, sClamp, tcoord(pm), 0.0).y;
          let a = clamp(abs(wv) / 3.0, 0.0, 1.0);
          let wc = select(vec3f(0.25, 0.45, 1.0), vec3f(1.0, 0.25, 0.2), wv > 0.0);
          col += T * mix(vec3f(0.35), wc, a) * 0.5;
          T *= 0.45;
        }
        prevC = sc;
      }
      if (pm.z < groundH(pm.x, pm.y)) {
        var a = t - step;
        var b = t;
        for (var r = 0; r < 7; r++) {
          let mid = 0.5 * (a + b);
          let qd = ro + rd * mid;
          if (qd.z / C.exag < groundH(qd.x, qd.y)) { b = mid; } else { a = mid; }
        }
        tg = b;
        hit = true;
        break;
      }
      let tc = warpTC(pm);
      let bs = textureSampleLevel(densT, sClamp, tc, 0.0);
      let region = bs.x > 2e-6;
      if (region && fineLeft == 0 && n > 0) {
        t -= 0.8 * step;
        step = dt / 5.0;
        fineLeft = 6;
        continue;
      }
      var ext = cloudExt(pm, bs);
      if (cut && pm.y > C.cutY) { ext = 0.0; }
      if (ext > 1e-6) {
        if (firstT < 0.0) { firstT = t; }
        let ds = step * dm;
        let tau = textureSampleLevel(lightT, sClamp, tc, 0.0).x;
        // rozpraszanie wielokrotne: kolejne „oktawy” z mniejszą ekstynkcją i spłaszczoną fazą
        var S = 0.0;
        var aa = 1.0;
        var bb = 1.0;
        var cc = 1.0;
        for (var o = 0; o < 3; o++) {
          S += aa * mix(hg(cosT, 0.8 * cc), hg(cosT, -0.25 * cc), 0.3) * exp(-bb * tau);
          aa *= 0.7; bb *= 0.25; cc *= 0.5;
        }
        // efekt „proszku”: ciemniejsze brzegi zwrócone do słońca w gęstych chmurach
        let powder = 1.0 - 0.6 * exp(-ext * 400.0);
        // światło nieba: słabsze u podstawy chmury (zasłonięte przez nią samą)
        let skyVis = exp(-0.25 * tau) * 0.6 + 0.4 * smoothstep(0.0, 8000.0, pm.z);
        // rozpraszanie wielokrotne rozjaśnia tylko chmury gęste (stratocumulus, cumulus: ekstynkcja ~0.01–0.05 /m);
        // cienki welon (τ < 1, ~1e-4 /m) świeci słabiej i przepuszcza widok gruntu – jak na obrazie satelitarnym
        // (wcześniej nawet bardzo cienka chmura była jaskrawo biała i wyglądała jak gęsty pokład)
        let ms = 0.65 + 0.35 * smoothstep(2e-4, 4e-3, ext);
        // (słońce mocniej, niebo słabiej: chmury były szare – oświetlone prawie tylko rozproszonym światłem nieba)
        let lsc = (sunc * S * 4.5 * powder + amb * 0.85 * skyVis) * ms;
        let tr = exp(-ext * ds);
        col += T * lsc * (1.0 - tr);
        wC += T * (1.0 - tr);
        tC += T * (1.0 - tr) * t;
        T *= tr;
        if (T < 0.01) { break; }
      }
      // w obszarze chmur i tuż za nim krok 5× krótszy
      if (region) { fineLeft = 6; } else if (fineLeft > 0) { fineLeft -= 1; }
      step = select(dt, dt / 5.0, fineLeft > 0);
      t += step;
    }
    // promień wyszedł dnem domeny (płaski teren na poziomie morza)
    if (!hit && T > 0.01) {
      let pe = ro + rd * tmax;
      if (pe.z <= 0.0) { hit = true; tg = tmax - (pe.z + 20.0) / min(rd.z, -1e-6) * 0.0; tg = (0.0 - ro.z) / min(rd.z, -1e-6); }
    }
    // światło chmur zebrane po drodze – mgiełka przed chmurami do ich średniej głębi (ważonej wkładem), osobno od tła za nimi
    // (jedna „głębia piksela” skakała na brzegach chmur z losowym przesunięciem startu promienia – ziarniste brzegi)
    var cl = col;
    if (wC > 1e-4) {
      let pc = ro + rd * (tC / wC);
      let a = airPath(vec3f(ro.xy, ro.z / C.exag), vec3f(pc.xy, pc.z / C.exag));
      cl = col * a.ex + a.ins * wC;
    }
    col = cl;
    if (hit) {
      let pd = ro + rd * tg;
      let pm = vec3f(pd.xy, pd.z / C.exag);
      let gtx = textureSampleLevel(groundT, sClamp, pm.xy / vec2f(LX(), LY()), 0.0);
      let e = max(DX, 60.0);
      let hx = (groundH(pm.x + e, pm.y) - groundH(pm.x - e, pm.y)) / (2.0 * e) * C.exag;
      let hy = (groundH(pm.x, pm.y + e) - groundH(pm.x, pm.y - e)) / (2.0 * e) * C.exag;
      let nrm = normalize(vec3f(-hx, -hy, 1.0));
      let v = u32(gtx.w + 0.5);
      var alb = vegCol(v, gtx.y);
      let forest = v == 1u || v == 2u || v == 5u || v == 11u;
      alb = mix(alb, vec3f(0.92, 0.94, 0.97), gtx.z * select(1.0, 0.55, forest));
      let tauG = groundShadow(pd, jit);
      let sunS = normalize(vec3f(C.sun.x, C.sun.y, C.sun.z * C.exag));
      var gc = alb * (sunColor() * 1.7 * max(dot(nrm, sunS), 0.0) * exp(-tauG) + amb * (0.3 + 0.25 * nrm.z));
      if (v == 10u && gtx.z < 0.5) {
        // woda (bez lodu): odbicie nieba i blask słońca
        let rf = reflect(rd, vec3f(0.0, 0.0, 1.0));
        gc = gc * 0.6 + skyColor(rf) * 0.25 + sunColor() * pow(max(dot(rf, sunD), 0.0), 200.0) * 3.0 * exp(-tauG);
      }
      // grunt: mgiełka na całej drodze do niego
      let pg = ro + rd * tg;
      col += T * airLight(gc, vec3f(ro.xy, ro.z / C.exag), vec3f(pg.xy, pg.z / C.exag));
    } else {
      col += T * outside(ro, rd);
    }
  }
  // ekspozycja i korekcja gamma
  col = 1.0 - exp(-col * 1.25);
  return vec4f(pow(col, vec3f(1.0 / 2.2)), 1.0);
}
