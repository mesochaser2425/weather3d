// NOWY widok 3D (w budowie – PLAN_WIDOK_3D.md; przełącznik „nowy” w panelu 3D, stary widok: view3d.wgsl).
// Etap 1: skala 1:1 – przewyższenie tylko rozciąga obraz w pionie, kształty chmur w prawdziwych metrach.
// Etap 2: niebo i atmosfera (atmo.wgsl, atmolut.wgsl). Wszystko liczone w prawdziwych metrach na kuli ziemskiej: domena
// „owinięta” wokół kamery (horyzont obniża się z wysokością lotu, daleki teren i chmury chowają się za krzywizną), za domeną
// równina na poziomie morza w średnim kolorze podłoża domeny. Jeden ośrodek dla nieba, gruntu i chmur, całkowany wzdłuż
// promienia: powietrze, aerozol (w domenie z każdego woksela – warstwa zamglenia ze stropem na wierzchu warstwy granicznej,
// poza nią profil średni), ozon. Światło słońca i księżyca przez tablice przepuszczalności (barwy zachodu, cień Ziemi, wysokie
// chmury oświetlone po zachodzie) i rozpraszania wielokrotnego (zmierzch); w domenie cienie chmur i gór w powietrzu (smugi
// światła), pod chmurami światło rozproszone (szara mgiełka pod pokładem chmur zamiast słonecznej). Noc: księżyc z fazą,
// gwiazdy i Droga Mleczna obracające się z czasem gwiazdowym, poświata nieba. Obraz HDR (× ekspozycja poprzedniej klatki),
// ekspozycja ze średniej jasności obrazu (atm_expo, częściowa adaptacja: zmierzch i noc ciemniejsze), obraz końcowy fs_post.
// Jednostki światła: natężenie słońca nad atmosferą = 1.

struct V3 {
  camPos: vec3f, tanF: f32,
  right: vec3f, aspect: f32,
  up: vec3f, exag: f32,       // przewyższenie pionowe (tylko obraz)
  fwd: vec3f, time: f32,
  sun: vec3f, sunUp: f32,     // światło rzucające cienie (słońce albo księżyc) w układzie domeny – jak w vol_light
  size: vec2f, zTop: f32, blobS: f32,         // blobS – odstęp kłębów chmur kłębiastych [m]
  windDir: vec2f, frame: f32, shadowM: f32,   // shadowM: 1 – cienie rzuca księżyc
  flags: u32, cutY: f32, cuPh: f32, cuNx: f32,   // bit 0: powierzchnia 0 °C, bit 1: przekrój tnący (y = cutY [m]); cuPh – faza pokoleń cumulusów
  cuNy: f32, mDisc: f32, pix: f32, _p0: f32,     // mDisc – jasność tarczy księżyca w pełni (0 – pod horyzontem); pix – rozmiar piksela [rad]
  nofs: vec4f,                                  // ciągłe przesunięcie szumu brzegów chmur [m]: xy – warstwa cumulusów, zw – średni wiatr 0–6 km
  lS: vec4f,                                    // słońce: kierunek w układzie kamery, natężenie (0 – głęboko pod horyzontem)
  lM: vec4f,                                    // księżyc: kierunek w układzie kamery, oświetlenie względem słońca (0 w dzień)
  eq0: vec4f, eq1: vec4f, eq2: vec4f,           // obrót kierunku z układu kamery do równikowego (gwiazdy)
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
// ekspozycja (atm_expo): [0] ekspozycja tej klatki, [2] widzenie nocne, [3] gotowe, [5] ekspozycja zapisu obrazu HDR
@group(0) @binding(41) var<storage, read> expoIn: array<f32, 8>;
@group(0) @binding(40) var hdrIn: texture_2d<f32>;

fn ldb(b: u32, i: u32) -> f32 { return 0.0; }

var<private> RO: vec3f;       // kamera w prawdziwych metrach (z – wysokość nad poziomem morza)
var<private> EXPO: f32;       // ekspozycja

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

// --- kula ziemska wokół kamery: punkt p (x, y jak w domenie, z nad płaszczyzną styczną w punkcie kamery) ---
fn altOf(p: vec3f) -> f32 {
  let d = p.xy - RO.xy;
  let q = dot(d, d) + p.z * (2.0 * RG + p.z);
  return q / (sqrt(RG * RG + q) + RG);
}
fn upOf(p: vec3f) -> vec3f { return normalize(vec3f(p.xy - RO.xy, RG + p.z)); }

fn hg(c: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

// ---- światło ----
fn shadowLight() -> vec4f { return select(C.lS, C.lM, C.shadowM > 0.5); }

// światło rozproszone w powietrzu z jednego źródła (L – kierunek w układzie kamery, natężenie): pojedyncze (faza) przez chmury
// i góry do źródła (sh) i wielokrotne (Ψ) osłabione przez chmury nad punktem (tUp – ich grubość optyczna) + światło przechodzące
// przez te chmury jako rozproszone
fn lightJ(m: Med, h: f32, up: vec3f, rd: vec3f, L: vec4f, sh: f32, tUp: f32) -> vec3f {
  if (L.w <= 0.0) { return vec3f(0.0); }
  let mu = dot(up, L.xyz);
  let T = transmit(h, mu);
  let nu = dot(rd, L.xyz);
  let tdf = 1.0 / (1.0 + TDIF * tUp);
  let mup = max(mu, 0.0);
  let conv = select(0.0, max(tdf - exp(-tUp / max(mup, 0.05)), 0.0), mup > 0.0);
  return L.w * ((m.sR * phaseR(nu) + m.sM * phaseM(nu)) * T * sh + (m.sR + m.sM) * (msLook(h, mu) * tdf + T * (mup * conv / (2.0 * PI))));
}
// słońce i księżyc; sh – przepuszczalność do światła rzucającego cienie (drugie bez cieni chmur)
fn airJ(m: Med, h: f32, up: vec3f, rd: vec3f, sh: f32, tUp: f32) -> vec3f {
  let moonSh = C.shadowM > 0.5;
  return lightJ(m, h, up, rd, C.lS, select(sh, 1.0, moonSh), tUp) + lightJ(m, h, up, rd, C.lM, select(1.0, sh, moonSh), tUp);
}
// oświetlenie poziomej powierzchni przez niebo (oba źródła) i nocne niebo
fn skyIrr(h: f32, up: vec3f) -> vec3f {
  var e = ENIGHT;
  if (C.lS.w > 0.0) { e += C.lS.w * irrLook(h, dot(up, C.lS.xyz)); }
  if (C.lM.w > 0.0) { e += C.lM.w * irrLook(h, dot(up, C.lM.xyz)); }
  return e;
}
// oświetlenie poziomej powierzchni na wysokości h w miejscu kamery: źródła przez atmosferę i średnie chmury domeny na tej
// wysokości (bezpośrednie i przechodzące przez chmury), niebo
fn illum(h: f32) -> vec3f {
  let pf = profAt(h);
  var e = ENIGHT;
  for (var i = 0; i < 2; i++) {
    let l = select(C.lS, C.lM, i == 1);
    if (l.w <= 0.0) { continue; }
    let sh = (i == 1) == (C.shadowM > 0.5);
    let mup = max(l.z, 0.0);
    e += transmit(h, l.z) * l.w * mup * select(1.0, pf.y + max(pf.z - pf.y, 0.0), sh) + l.w * irrLook(h, l.z) * pf.z;
  }
  return e;
}

// odcinek promienia poza domeną (bez chmur, profil średni domeny): n kroków, gęściej tam, gdzie promień jest niżej
fn airSeg(ro: vec3f, rd: vec3f, t0: f32, t1: f32, n: i32, jit: f32, L: ptr<function, vec3f>, T: ptr<function, vec3f>) {
  if (t1 <= t0) { return; }
  let down = altOf(ro + rd * t1) < altOf(ro + rd * t0);
  for (var i = 0; i < n; i++) {
    var ua = f32(i) / f32(n);
    var ub = f32(i + 1) / f32(n);
    var us = (f32(i) + jit) / f32(n);
    if (down) { ua = 1.0 - ua; ub = 1.0 - ub; us = 1.0 - us; }
    let ta = t0 + (t1 - t0) * select(ua * ua, 1.0 - ua * ua, down);
    let tb = t0 + (t1 - t0) * select(ub * ub, 1.0 - ub * ub, down);
    let ts = t0 + (t1 - t0) * select(us * us, 1.0 - us * us, down);
    let p = ro + rd * ts;
    let h = altOf(p);
    let pf = profAt(h);
    let m = medium(h, aerD(h));
    let J = airJ(m, h, upOf(p), rd, pf.y, (1.0 / max(pf.z, 0.02) - 1.0) / TDIF);
    let ds = abs(tb - ta);
    *L += *T * J * stepInt(m.ext, ds);
    *T *= exp(-m.ext * ds);
  }
}
// niebo w kierunku dir z punktu p (bez chmur domeny) – odbicie w wodzie
fn skyRad(p: vec3f, dir: vec3f, jit: f32) -> vec3f {
  var L = vec3f(0.0);
  var T = vec3f(1.0);
  airSeg(p, dir, 0.0, distTop(altOf(p), dot(upOf(p), dir)), 12, jit, &L, &T);
  return L;
}

// ---- chmury ----
// Gęstość (ekstynkcja [1/m]) w punkcie p z tekstury chmur (jeden opis – cloudAt): b.x średnia ekstynkcja oczka,
// b.y część oczka z chmurą, b.z udział lodu, b.w rodzaj (kłębiasta / warstwowa).
// Kłęby zajmujące część fc powierzchni: kształt z cuShape (common.wgsl – ten sam co na obrazie satelitarnym), bok blobS
// w prawdziwych metrach. Brzeg kalafiorowy: odległość zaburzona gładkim szumem 3D. Pokolenia cumulusów płyną z lokalnym
// wiatrem warstwy chmur (cuGen) – ten sam wzór i ruch co na obrazie satelitarnym.
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
  let S = C.blobS;
  // chmury z podstawą wysoko nad gruntem (altocumulus – frzT.w) i kłęby > ~0.5 km nad wierzchołkiem najniższej warstwy
  // (frzT.y) płyną z wiatrem średnim 0–6 km, wieże ciągłe od podstawy – z wiatrem podstawy
  let fz = textureSampleLevel(frzT, sClamp, p.xy / vec2f(LX(), LY()), 0.0);
  let zag = p.z - groundH(p.x, p.y);
  let wm = select(0.0, max(smoothstep(2500.0, 4000.0, fz.w), smoothstep(300.0, 800.0, zag - fz.y)), fz.w > 0.0);
  let d = mix(cuDisp(p.xy), cuDisp2(p.xy), wm);
  var m = 0.0;
  for (var g = 0u; g < 2u; g++) {
    let gq = cuGen(p.xy, select(d.xy, d.zw, g == 1u), C.cuPh, S, g);
    let sh = cuShape(gq.xy, fc, gq.z);
    if (sh.x > 2.0 * sh.y) { continue; }
    let n = textureSampleLevel(noiseT, sRep, vec3f(gq.xy, p.z / S), 0.0);
    let dd = sh.x - 0.5 * sh.y * (n.g - 0.55);
    m = max(m, 1.0 - smoothstep(sh.y - 0.04, sh.y + 0.04, dd));
  }
  return m;
}
fn cloudExt(p: vec3f, b: vec4f) -> f32 {
  if (b.x < 2e-6) { return 0.0; }
  // chmury kłębiaste zajmujące część oczka (b.y < 1, siatki ≥ ~1 km): ta sama średnia ekstynkcja skupiona w kłębach
  // pokrywających b.y powierzchni – jak na satelicie i w zachmurzeniu ogólnym (COVC); warstwowe – równo w całym oczku
  let fc = clamp(b.y, 1e-3, 1.0);
  let wb = smoothstep(0.3, 0.7, b.w) * smoothstep(300.0, 900.0, DX) * (1.0 - smoothstep(0.85, 0.97, fc));
  if (wb < 1e-3) { return b.x; }
  return mix(b.x, b.x / fc * blobMask(p, fc), wb);
}
// współrzędne tekstury chmur z zaginaniem gładkim szumem (±~0.6 oczka poziomo, płynie z wiatrem warstwy): brzegi chmur
// nieregularne zamiast prostokątów oczek
fn warpTC(pm: vec3f) -> vec3f {
  let no = mix(C.nofs.xy, C.nofs.zw, smoothstep(2500.0, 5000.0, pm.z));
  let wn = textureSampleLevel(noiseT, sRep, vec3f(pm.xy - no, pm.z) / (4.0 * DX), 0.0);
  return tcoord(pm + vec3f((wn.r - 0.5) * 2.0 * DX, (wn.a - 0.5) * 2.0 * DX, 0.0));
}

// Cień na gruncie: promień do światła przez te same chmury, które widać (kłęby z przerwami, zaginane brzegi), i przez teren
fn groundShadow(pm0: vec3f, jit: f32) -> f32 {
  if (C.sunUp <= 0.0) { return 50.0; }
  let sd = normalize(vec3f(C.sun.x, C.sun.y, max(C.sun.z, 0.03)));
  let L = max(C.zTop - pm0.z, 0.0) / sd.z;
  let NSH = 80;
  let ds = L / f32(NSH);
  var tau = 0.0;
  for (var n = 0; n < NSH; n++) {
    let q = pm0 + sd * (ds * (f32(n) + jit) + 30.0);
    if (q.x < 0.0 || q.y < 0.0 || q.x > LX() || q.y > LY()) { break; }
    if (n > 0 && q.z < groundH(q.x, q.y)) { tau += 50.0; break; }
    let bs = textureSampleLevel(densT, sClamp, warpTC(q), 0.0);
    if (bs.x > 2e-6) { tau += cloudExt(q, bs) * ds; }
    if (tau > 8.0) { break; }
  }
  return tau;
}

// ---- powierzchnia ----
// teren domeny w punkcie p (układ kamery): oświetlenie bezpośrednie (atmosfera, cień chmur i gór), niebo i światło przechodzące
// przez chmury nad punktem; woda – odbicie nieba (Fresnel) i blask słońca
fn terrainCol(p: vec3f, rd: vec3f, jit: f32) -> vec3f {
  let a = altOf(p);
  let pm = vec3f(p.xy, a);
  let gtx = textureSampleLevel(groundT, sClamp, pm.xy / vec2f(LX(), LY()), 0.0);
  let e = max(DX, 60.0);
  let hx = (groundH(pm.x + e, pm.y) - groundH(pm.x - e, pm.y)) / (2.0 * e);
  let hy = (groundH(pm.x, pm.y + e) - groundH(pm.x, pm.y - e)) / (2.0 * e);
  let nrm = normalize(vec3f(-hx, -hy, 1.0));
  let up = upOf(p);
  let Ls = shadowLight();
  let tauG = groundShadow(pm, jit);
  let tUp = max(textureSampleLevel(lightT, sClamp, tcoord(vec3f(pm.xy, gtx.x + 40.0)), 0.0).w, 0.0);
  let tdf = 1.0 / (1.0 + TDIF * tUp);
  let mu = dot(up, Ls.xyz);
  let mup = max(mu, 0.0);
  let Tl = transmit(a, mu) * Ls.w;
  let conv = select(0.0, max(tdf - exp(-tUp / max(mup, 0.05)), 0.0), mup > 0.0);
  let eDir = Tl * max(dot(nrm, C.sun), 0.0) * exp(-tauG);
  let eDif = skyIrr(a, up) * tdf + Tl * mup * conv;
  var gc = groundAlb(gtx) / PI * (eDir + eDif * (0.5 + 0.5 * nrm.z));
  if (u32(gtx.w + 0.5) == 10u && gtx.z < 0.5) {
    let rf = reflect(rd, up);
    let fr = 0.02 + 0.98 * pow(1.0 - clamp(-dot(rd, up), 0.0, 1.0), 5.0);
    gc = gc * (1.0 - fr) + fr * skyRad(p, rf, jit) + Tl * exp(-tauG) * fr * 50.0 * pow(max(dot(rf, Ls.xyz), 0.0), 300.0);
  }
  return gc;
}
// równina za domeną (kula na poziomie morza): średnie albedo i średnie chmury domeny
fn plainCol(p: vec3f) -> vec3f {
  let up = upOf(p);
  let pf = profAt(0.0);
  let Ls = shadowLight();
  let mu = dot(up, Ls.xyz);
  let mup = max(mu, 0.0);
  let Tl = transmit(0.0, mu) * Ls.w;
  return prof[NZ].rgb / PI * (Tl * mup * (pf.y + max(pf.z - pf.y, 0.0)) + skyIrr(0.0, up) * pf.z);
}

// ---- niebo: tarcze, gwiazdy ----
fn hs3(p: vec3u) -> u32 {
  var h = p.x * 374761393u + p.y * 668265263u + p.z * 2246822519u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return h ^ (h >> 16u);
}
fn faceDir(f: u32, uv: vec2f) -> vec3f {
  switch f {
    case 0u: { return vec3f(1.0, uv.x, uv.y); }
    case 1u: { return vec3f(-1.0, uv.x, uv.y); }
    case 2u: { return vec3f(uv.x, 1.0, uv.y); }
    case 3u: { return vec3f(uv.x, -1.0, uv.y); }
    case 4u: { return vec3f(uv.x, uv.y, 1.0); }
    default: { return vec3f(uv.x, uv.y, -1.0); }
  }
}
// gwiazdy (losowe, ~9000 do 6.5 mag, liczba rośnie ×3 na wielkość gwiazdową; barwy od błękitnych do pomarańczowych),
// Droga Mleczna (prawdziwe położenie płaszczyzny Galaktyki, jaśniej ku centrum w Strzelcu, ciemne smugi pyłu) i poświata
// nieba (jaśniej ku horyzontowi). e – kierunek w układzie równikowym, rz – wysokość nad horyzontem (sin)
fn nightSky(e: vec3f, rz: f32) -> vec3f {
  var c = vec3f(0.0);
  let a = abs(e);
  var f = 0u;
  var uv = vec2f(0.0);
  if (a.x >= a.y && a.x >= a.z) { f = select(1u, 0u, e.x > 0.0); uv = e.yz / a.x; }
  else if (a.y >= a.z) { f = select(3u, 2u, e.y > 0.0); uv = e.xz / a.y; }
  else { f = select(5u, 4u, e.z > 0.0); uv = e.xy / a.z; }
  let NC = 160.0;
  let cell = min(floor((uv * 0.5 + 0.5) * NC), vec2f(NC - 1.0));
  let h = hs3(vec3u(vec2u(cell), f + 7u));
  if (f32(h & 0xffffu) / 65535.0 < 0.0586) {
    let h2 = hs3(vec3u(h, f, 3u));
    let h3 = hs3(vec3u(h2, 11u, f));
    let sp = (cell + 0.25 + 0.5 * vec2f(f32(h2 & 0xffffu), f32(h2 >> 16u)) / 65535.0) / NC * 2.0 - 1.0;
    let sd = normalize(faceDir(f, sp));
    let ang = length(cross(e, sd));
    let sg = 0.7 * C.pix;
    if (ang < 4.0 * sg) {
      let mag = 6.5 + log2(max(f32(h3 & 0xffffu) / 65535.0, 1e-5)) * 0.30103 / 0.47;
      let E = pow(10.0, -0.4 * (mag + 14.18)) / 1.28e5;
      let ct = f32(h3 >> 16u) / 65535.0;
      let col = select(select(vec3f(1.0, 0.96, 0.88), vec3f(0.78, 0.88, 1.25), ct < 0.2), vec3f(1.25, 0.86, 0.62), ct > 0.8);
      c += col * E / (2.0 * PI * sg * sg) * exp(-0.5 * ang * ang / (sg * sg));
    }
  }
  // Droga Mleczna: biegun Galaktyki i kierunek do centrum (J2000)
  let b = asin(clamp(dot(e, vec3f(-0.86762, -0.19837, 0.45598)), -1.0, 1.0));
  let l = atan2(dot(e, vec3f(0.49426, -0.44486, 0.74693)), dot(e, vec3f(-0.05487, -0.87344, -0.48390)));
  let n = textureSampleLevel(noiseT, sRep, e * 1.7, 0.0);
  let wb = 0.13 + 0.14 * exp(-l * l / 0.25);
  let band = exp(-b * b / (wb * wb)) * (0.35 + 0.65 * exp(-l * l / 1.2));
  let dust = 1.0 - 0.65 * exp(-b * b / 0.0016) * smoothstep(-1.2, -0.6, l) * (1.0 - smoothstep(1.2, 1.6, l)) * n.g;
  c += vec3f(1.0, 0.95, 0.86) * 2.4e-9 * band * (0.5 + n.a) * dust;
  // poświata (~22 mag/″²), jaśniej ku horyzontowi (warstwa ~90 km)
  c += vec3f(0.85, 1.0, 0.72) * 1.0e-9 / sqrt(max(1.0 - 0.972 * (1.0 - rz * rz), 0.05));
  return c;
}
// słońce (pociemnienie brzegu tarczy), księżyc (faza, morza, światło popielate) i nocne niebo w kierunku rd
fn skyDiscs(rd: vec3f) -> vec3f {
  var c = vec3f(0.0);
  let rs = 0.00465;
  if (C.lS.w > 0.0) {
    let ang = atan2(length(cross(rd, C.lS.xyz)), dot(rd, C.lS.xyz));
    if (ang < rs + C.pix) {
      let r = min(ang / rs, 1.0);
      let limb = 1.0 - 0.6 * (1.0 - sqrt(max(1.0 - r * r, 0.0)));
      c += C.lS.w / (PI * rs * rs) * limb * (1.0 - smoothstep(rs - 0.5 * C.pix, rs + 0.5 * C.pix, ang));
    }
  }
  if (C.mDisc > 0.0) {
    let rm = 0.0045;
    let m = C.lM.xyz;
    let ca = dot(rd, m);
    let ang = atan2(length(cross(rd, m)), ca);
    if (ang < rm + C.pix && ca > 0.0) {
      let off = (rd - m * ca) / rm;
      let r2 = min(dot(off, off), 1.0);
      let mue = sqrt(1.0 - r2);
      let nm = normalize(off - m * mue);
      let mu0 = dot(nm, C.lS.xyz);
      // układ tarczy: „góra” ku biegunowi nieba, „prawo” – na zachód
      let pole = C.eq2.xyz;
      let nN = normalize(pole - m * dot(pole, m));
      let nE = cross(m, nN);
      let q = vec2f(dot(off, nE), dot(off, nN));
      // morza (ciemniejsze bazalty, albedo ~0.55 jasnych wyżyn): Imbrium, Serenitatis, Tranquillitatis, Crisium, Fecunditatis,
      // Nectaris, Oceanus Procellarum, Nubium, Humorum, Frigoris
      let mc = array<vec3f, 10>(vec3f(-0.35, 0.45, 0.25), vec3f(0.25, 0.42, 0.17), vec3f(0.40, 0.12, 0.20), vec3f(0.78, 0.28, 0.12),
        vec3f(0.65, -0.12, 0.15), vec3f(0.45, -0.25, 0.10), vec3f(-0.62, 0.05, 0.33), vec3f(-0.20, -0.35, 0.18),
        vec3f(-0.58, -0.38, 0.10), vec3f(0.0, 0.74, 0.12));
      var mar = 0.0;
      for (var i = 0; i < 10; i++) {
        let dd = q - mc[i].xy;
        mar = max(mar, exp(-dot(dd, dd) / (mc[i].z * mc[i].z)));
      }
      let nz = textureSampleLevel(noiseT, sRep, vec3f(q * 1.3, 0.37), 0.0);
      let alb = 1.15 * mix(1.0, 0.55, clamp(mar * (0.7 + 0.6 * nz.a), 0.0, 1.0)) * (0.9 + 0.2 * nz.g);
      // Lommel–Seeliger (tarcza bez pociemnienia brzegu); po stronie nocnej światło popielate
      let b = select(0.0, 2.0 * mu0 / (mu0 + mue + 1e-4), mu0 > 0.0) + 0.002;
      // jasność tarczy ograniczona do ~3× bieli obrazu (bez przepalenia – widać fazę i morza)
      let k = min(1.0, 3.0 / max(C.mDisc * EXPO, 1e-12));
      c += vec3f(1.0, 0.97, 0.92) * C.mDisc * k * b * alb * (1.0 - smoothstep(rm - 0.5 * C.pix, rm + 0.5 * C.pix, ang));
    }
  }
  if (EXPO > 2.0e3) {
    let e = vec3f(dot(C.eq0.xyz, rd), dot(C.eq1.xyz, rd), dot(C.eq2.xyz, rd));
    c += nightSky(e, rd.z);
  }
  return c;
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / C.size * 2.0 - 1.0;
  let rdD = normalize(C.fwd + C.right * (uv.x * C.tanF * C.aspect) - C.up * (uv.y * C.tanF));
  // kierunek w prawdziwych metrach (przewyższenie tylko rozciąga obraz)
  let rd = normalize(vec3f(rdD.xy, rdD.z / C.exag));
  RO = vec3f(C.camPos.xy, C.camPos.z / C.exag);
  let ro = RO;
  let hc = ro.z;
  // przesunięcie startu promienia: szum gradientowy przeplatany (Jimenez 2014)
  let jit = fract(52.9829189 * fract(dot(pos.xy, vec2f(0.06711056, 0.00583715))) + C.frame * 0.6180339);
  // ekspozycja z poprzedniej klatki (obraz HDR zapisywany po jej przemnożeniu – nocne niebo ~10⁻⁹ mieści się w f16)
  EXPO = select(4.0, expoIn[0], expoIn[3] > 0.5);
  // światło odbite od podłoża (oświetla podstawy chmur)
  let gB = 0.5 * prof[NZ].rgb * illum(0.0);

  var L = vec3f(0.0);
  var T = vec3f(1.0);
  // granice: atmosfera (100 km), kula gruntu (poziom morza – równina poza domeną), domena (pudło x–y, wierzch zTop nad kulą)
  let sa = sphereHits(hc, rd.z, HAT);
  var tS = 0.0;
  var tE = -1.0;
  if (hc <= HAT) { tE = sa.y; } else if (sa.x > 0.0) { tS = sa.x; tE = sa.y; }
  let sg = sphereHits(hc, rd.z, 0.0);
  var hitPlain = false;
  if (hc > 0.0 && sg.x > 0.0 && tE > 0.0 && sg.x < tE) { tE = sg.x; hitPlain = true; }
  let inv = 1.0 / select(rd.xy, vec2f(1e-9), abs(rd.xy) < vec2f(1e-9));
  let ta = -ro.xy * inv;
  let tb = (vec2f(LX(), LY()) - ro.xy) * inv;
  var d0 = max(max(min(ta.x, tb.x), min(ta.y, tb.y)), tS);
  var d1 = min(min(max(ta.x, tb.x), max(ta.y, tb.y)), tE);
  let sz = sphereHits(hc, rd.z, C.zTop);
  if (hc > C.zTop) {
    if (sz.x > 0.0) { d0 = max(d0, sz.x); d1 = min(d1, sz.y); } else { d1 = -1.0; }
  } else { d1 = min(d1, sz.y); }

  var hitT = false;
  var tH = 0.0;
  if (tE > tS) {
    if (d1 > d0) {
      airSeg(ro, rd, tS, d0, 12, jit, &L, &T);
      // ---- domena: chmury, zamglenie z wokseli, cienie w powietrzu ----
      // krok: 150 na całej drodze przez domenę, w obszarze chmur 5× drobniejszy – przy wejściu krokiem zgrubnym cofnięcie
      let NS = 150;
      let dt = (d1 - d0) / f32(NS);
      var t = d0 + dt * jit;
      var step = dt;
      let Ls = shadowLight();
      let cosT = dot(rd, Ls.xyz);
      let showFrz = (C.flags & 1u) != 0u;
      let cut = (C.flags & 2u) != 0u;
      var prevF = 0.0;
      var prevC = 0.0;
      var fineLeft = 0;
      for (var n = 0; n < 5 * NS; n++) {
        if (t > d1) { break; }
        let p = ro + rd * t;
        let a = altOf(p);
        let pm = vec3f(p.xy, a);
        // powierzchnia 0 °C: półprzezroczysta różowa warstwa przy przejściu promienia przez izotermę
        if (showFrz) {
          let zf = textureSampleLevel(frzT, sClamp, pm.xy / vec2f(LX(), LY()), 0.0).x;
          let sf = select(0.0, sign(pm.z - zf), zf > 0.0);
          if (n > 0 && sf != 0.0 && prevF != 0.0 && sf != prevF) {
            L += T * vec3f(0.95, 0.40, 0.70) * 0.35 / EXPO;
            T *= 0.72;
          }
          prevF = sf;
        }
        // przekrój tnący: płaszczyzna y = cutY – kolor prądu pionowego, chmury za nią ukryte
        if (cut) {
          let sc = sign(pm.y - C.cutY);
          if (n > 0 && sc != prevC && pm.z < C.zTop) {
            let wv = textureSampleLevel(lightT, sClamp, tcoord(pm), 0.0).y;
            let aw = clamp(abs(wv) / 3.0, 0.0, 1.0);
            let wc = select(vec3f(0.25, 0.45, 1.0), vec3f(1.0, 0.25, 0.2), wv > 0.0);
            L += T * mix(vec3f(0.35), wc, aw) * 0.5 / EXPO;
            T *= 0.45;
          }
          prevC = sc;
        }
        if (a < groundH(pm.x, pm.y)) {
          var ga = t - step;
          var gb = t;
          for (var r = 0; r < 7; r++) {
            let mid = 0.5 * (ga + gb);
            let q = ro + rd * mid;
            if (altOf(q) < groundH(q.x, q.y)) { gb = mid; } else { ga = mid; }
          }
          tH = gb;
          hitT = true;
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
        // x – grubość optyczna do światła (chmury, góry), z – zmętnienie, w – grubość optyczna chmur nad punktem
        let lt = textureSampleLevel(lightT, sClamp, tc, 0.0);
        let up = upOf(p);
        let tUp = max(lt.w, 0.0);
        let m = medium(a, max(lt.z, 0.0));
        var J = airJ(m, a, up, rd, exp(-lt.x), tUp);
        if (ext > 1e-6) {
          // rozpraszanie wielokrotne w chmurze: kolejne „oktawy” z mniejszą ekstynkcją i spłaszczoną fazą
          var S = 0.0;
          var aa = 1.0;
          var bb = 1.0;
          var cc = 1.0;
          for (var o = 0; o < 3; o++) {
            S += aa * mix(hg(cosT, 0.8 * cc), hg(cosT, -0.25 * cc), 0.3) * exp(-bb * lt.x);
            aa *= 0.7; bb *= 0.25; cc *= 0.5;
          }
          // „proszek”: ciemniejsze brzegi zwrócone do światła w gęstych chmurach
          let powder = 1.0 - 0.6 * exp(-ext * 400.0);
          // cienki welon świeci słabiej niż gęsta chmura
          let msf = 0.65 + 0.35 * smoothstep(2e-4, 4e-3, ext);
          // niebo słabnie w głąb chmury; od dołu światło odbite od podłoża
          let amb = (skyIrr(a, up) / (1.0 + 0.25 * tUp) + gB) / PI;
          J += ext * (transmit(a, dot(up, Ls.xyz)) * Ls.w * S * 2.7 * powder + amb) * msf;
        }
        let ex = m.ext + vec3f(ext);
        L += T * J * stepInt(ex, step);
        T *= exp(-ex * step);
        if (max(T.x, max(T.y, T.z)) < 0.005) { T = vec3f(0.0); break; }
        // w obszarze chmur i tuż za nim krok 5× krótszy
        if (region) { fineLeft = 6; } else if (fineLeft > 0) { fineLeft -= 1; }
        step = select(dt, dt / 5.0, fineLeft > 0);
        t += step;
      }
      // grunt domeny na poziomie morza (płaski teren, morze): promień kończy się na kuli gruntu przed testem terenu
      if (!hitT && hitPlain && d1 >= tE - 1.0) { hitT = true; tH = tE; }
      if (!hitT) { airSeg(ro, rd, d1, tE, 32, jit, &L, &T); }
    } else {
      airSeg(ro, rd, tS, tE, 48, jit, &L, &T);
    }
  }
  if (hitT) {
    L += T * terrainCol(ro + rd * tH, rd, jit);
  } else if (hitPlain) {
    L += T * plainCol(ro + rd * tE);
  } else {
    L += T * skyDiscs(rd);
  }

  return vec4f(min(L * EXPO, vec3f(6.0e4)), 1.0);
}

// obraz końcowy: zmiana ekspozycji od zapisu HDR, widzenie nocne (mniej barw, niebieskawo), krzywa filmowa ACES
// (Narkowicz 2015), sRGB z ditheringiem (gładkie przejścia nieba bez pasm)
@fragment
fn fs_post(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  var c = textureLoad(hdrIn, vec2u(pos.xy), 0).rgb * (expoIn[0] / max(expoIn[5], 1e-12));
  let lum = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  c = mix(c, lum * vec3f(0.55, 0.75, 1.25), expoIn[2] * 0.8);
  c = clamp(c * (2.51 * c + 0.03) / (c * (2.43 * c + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
  let s = select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, 12.92 * c, c <= vec3f(0.0031308));
  let dn = f32(hs3(vec3u(vec2u(pos.xy), u32(C.frame))) & 0xffffu) / 65535.0 - 0.5;
  return vec4f(s + dn / 255.0, 1.0);
}
