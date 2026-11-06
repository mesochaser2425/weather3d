// Widok 3D – przygotowanie danych (compute):
//   noise_gen    – kafelkowy szum 3D 64³ (Perlin–Worley, Worley) do detalu chmur, raz na starcie
//   ground_build – tekstura 2D gruntu: wysokość, zieleń, śnieg, typ roślinności
//   vol_build    – tekstura 3D chmur (cloudAt): ekstynkcja, część oczka z chmurą, udział lodu, rodzaj chmury
//   vol_light    – grubość optyczna od każdego woksela w stronę słońca (cienie chmur i gór), prąd pionowy, zmętnienie
//                  powietrza i grubość optyczna chmur nad wokselem (nowy widok 3D)
// Współrzędne: x na wschód, y na północ, z w górę [m]; tekstury obejmują widoczną domenę
// (NXV × NYV oczek) i poziomy modelu (współrzędna S, jak w symulacji).

struct VolP {
  sun: vec3f,       // kierunek do słońca
  sunUp: f32,       // > 0 w dzień
  zTop: f32,        // górna granica tekstury [m]
  cloudScale: f32,  // przelicznik chmur podsiatkowych (0 na siatkach LES)
  blend: f32,      // wygładzenie w czasie tekstury chmur (część nowego stanu, ~Δt_sym / 10 min)
  leafAut: f32,    // 1 – jesień (kolory drzew: main.js leafAut)
}

@group(0) @binding(0) var<uniform> VP: VolP;
@group(0) @binding(1) var<storage, read> vg: array<f32>;
@group(0) @binding(2) var<storage, read> state: array<f32>;
@group(0) @binding(3) var<storage, read> sfc: array<f32>;
@group(0) @binding(4) var noiseOut: texture_storage_3d<rgba8unorm, write>;
@group(0) @binding(5) var groundOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var densOut: texture_storage_3d<rgba16float, write>;
@group(0) @binding(7) var densIn: texture_3d<f32>;
@group(0) @binding(8) var groundIn: texture_2d<f32>;
@group(0) @binding(9) var samp: sampler;
@group(0) @binding(10) var lightOut: texture_storage_3d<rgba16float, write>;
@group(0) @binding(11) var frzOut: texture_storage_2d<rgba16float, write>;

fn ldb(b: u32, i: u32) -> f32 { return state[i]; }

// ---------- szum kafelkowy (okres P komórek) ----------
fn h3(p: vec3u) -> u32 {
  var h = p.x * 374761393u + p.y * 668265263u + p.z * 2246822519u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return h ^ (h >> 16u);
}
fn rnd3(p: vec3u, s: u32) -> vec3f {
  let a = h3(p + vec3u(s, 0u, 0u));
  let b = h3(p + vec3u(0u, s * 7u + 1u, 0u));
  let c = h3(p + vec3u(0u, 0u, s * 13u + 2u));
  return vec3f(f32(a), f32(b), f32(c)) / 4294967295.0;
}
fn wrap3(p: vec3i, P: i32) -> vec3u { return vec3u(((p % P) + P) % P); }

// szum gradientowy (Perlin) o okresie P
fn perlin(x: vec3f, P: i32) -> f32 {
  let i = vec3i(floor(x));
  let f = fract(x);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  var acc = array<f32, 8>();
  for (var n = 0; n < 8; n++) {
    let o = vec3i(n & 1, (n >> 1) & 1, (n >> 2) & 1);
    let g = normalize(rnd3(wrap3(i + o, P), 3u) * 2.0 - 1.0);
    acc[n] = dot(g, f - vec3f(o));
  }
  let x00 = mix(acc[0], acc[1], u.x);
  let x10 = mix(acc[2], acc[3], u.x);
  let x01 = mix(acc[4], acc[5], u.x);
  let x11 = mix(acc[6], acc[7], u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

// szum komórkowy (Worley) o okresie P: 1 przy punktach, 0 daleko
fn worley(x: vec3f, P: i32) -> f32 {
  let i = vec3i(floor(x));
  let f = fract(x);
  var d = 9.0;
  for (var a = -1; a <= 1; a++) {
    for (var b = -1; b <= 1; b++) {
      for (var c = -1; c <= 1; c++) {
        let o = vec3i(a, b, c);
        let pt = vec3f(o) + rnd3(wrap3(i + o, P), 11u);
        d = min(d, length(pt - f));
      }
    }
  }
  return clamp(1.0 - d, 0.0, 1.0);
}

@compute @workgroup_size(4, 4, 4)
fn noise_gen(@builtin(global_invocation_id) g: vec3u) {
  if (any(g >= vec3u(64u))) { return; }
  let p = (vec3f(g) + 0.5) / 64.0;
  // R: Perlin–Worley (kalafiorowa podstawa cumulusów), G/B: Worley (kłęby), A: Perlin fbm
  var pf = 0.0;
  var amp = 0.5;
  var fr = 4;
  for (var o = 0; o < 4; o++) { pf += amp * perlin(p * f32(fr), fr); amp *= 0.5; fr *= 2; }
  pf = clamp(pf * 1.2 + 0.5, 0.0, 1.0);
  let w1 = worley(p * 4.0, 4) * 0.625 + worley(p * 8.0, 8) * 0.25 + worley(p * 16.0, 16) * 0.125;
  let w2 = worley(p * 8.0, 8) * 0.625 + worley(p * 16.0, 16) * 0.25 + worley(p * 32.0, 32) * 0.125;
  let pw = clamp(pf + (w1 - 0.5) * 0.9, 0.0, 1.0);
  textureStore(noiseOut, g, vec4f(pw, w1, w2, pf));
}

// ---------- grunt ----------
@compute @workgroup_size(8, 8)
fn ground_build(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= NXD || g.y >= NYD) { return; }
  let col = (g.y + MG) * NX + g.x + MG;
  let veg = vg[VG_VEG + col];
  let isW = veg > 9.5 && veg < 10.5;
  let iced = isW && sfc[S_ICE * NXY + col] > 0.0;
  // śnieg (0..1); zamarznięta woda jako „śnieg” ≥ 0.6, otwarta woda bez śniegu
  let snow = select(select(clamp(sfc[S_SWE * NXY + col] / 10.0, 0.0, 1.0), 0.0, isW), max(0.6, clamp(sfc[S_SWE * NXY + col] / 10.0, 0.0, 1.0)), iced);
  textureStore(groundOut, vec2u(g.x, g.y), vec4f(vg[VG_HGT + col], select(1.0, -1.0, VP.leafAut > 0.5) * sfc[S_GRN * NXY + col], snow, veg));   // zieleń ze znakiem: ujemna – jesień (leafCol)
  // wysokość izotermy 0 °C [m n.p.m.] (najwyższe przejście przez 0 °C w kolumnie; −1 – całość < 0 °C)
  let kb = u32(vg[VG_KB + col]);
  var zf = -1.0;
  for (var k = kb + 1u; k < NZ; k++) {
    let ta = (vg[VG_TC + k - 1u] + state[T_OFF + (k - 1u) * NXY + col]) * vg[VG_EXC + k - 1u] - 273.15;
    let tb = (vg[VG_TC + k] + state[T_OFF + k * NXY + col]) * vg[VG_EXC + k] - 273.15;
    if (ta >= 0.0 && tb < 0.0) { zf = mix(vg[VG_ZC + k - 1u], vg[VG_ZC + k], ta / max(ta - tb, 1e-3)); }
  }
  // najniższa podstawa chmur nad gruntem [m] (0 – bez chmur): wzór kłębów chmur piętra średniego płynie z wiatrem 0–6 km
  // i wierzchołek tej najniższej warstwy (y) – chmury wyżej to osobna warstwa
  var zcb = 0.0;
  var zct = 0.0;
  var inC = false;
  for (var k = kb; k < NZ; k++) {
    let cl = state[QC_OFF + k * NXY + col] + state[QI_OFF + k * NXY + col] > 1e-5;
    if (cl && !inC && zcb == 0.0) { zcb = vg[VG_ZC + k] - vg[VG_ZW + kb]; inC = true; }
    if (inC) { if (cl) { zct = vg[VG_ZC + k] - vg[VG_ZW + kb]; } else { break; } }
  }
  textureStore(frzOut, vec2u(g.x, g.y), vec4f(zf, zct, 0.0, zcb));
}

// ---------- chmury ----------
// Tekstura z jednego opisu chmury (cloudAt w common.wgsl – ten sam co obraz satelitarny, przekrój i promieniowanie):
// x – średnia ekstynkcja oczka [1/m] (cienie, światło), y – część oczka zajęta przez chmurę, z – udział lodu,
// w – rodzaj (0 warstwowa … 1 kłębiasta). Widok 3D wycina przerwy szumem wg y i dobiera detal wg z, w.
@compute @workgroup_size(4, 4, 4)
fn vol_build(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= NXD || g.y >= NYD || g.z >= NZ) { return; }
  let k = g.z;
  let col = (g.y + MG) * NX + g.x + MG;
  let c = k * NXY + col;
  let kb = u32(vg[VG_KB + col]);
  if (k < kb) { textureStore(densOut, g, vec4f(0.0)); return; }
  let rho = vg[VG_RC + k];
  let t = (vg[VG_TC + k] + state[T_OFF + c]) * vg[VG_EXC + k];
  let p = vg[VG_PRS + k];
  let qv = max(state[QV_OFF + c], 0.0);
  let z = vg[VG_ZC + k];
  let w = 0.5 * (state[W_OFF + c] + state[W_OFF + c + NXY]);
  let cl = cloudAt(rho, state[QC_OFF + c], state[QI_OFF + c], state[QR_OFF + c], qv / qsat(t, p), qv / qsat_ice(t, p), t, z,
                   convFlag(w, sfc[S_H * NXY + col], z - vg[VG_ZW + kb], sfc[S_PBLH * NXY + col], sfc[S_MUCAPE * NXY + col], sfc[S_MUEL * NXY + col]),
                   sfc[S_CULS * NXY + col], sfc[S_CUBS * NXY + col], sfc[S_CUTS * NXY + col]);
  // chmury kłębiaste zajmujące część oczka (w 3D rysowane jako kłęby): zaokrąglony wierzchołek – w górnych 60% chmury
  // część oczka maleje jak kopuła (promień kłębu ~ okrąg), zamiast walców z płaskim szczytem
  var sh = 1.0;
  let wdome = smoothstep(0.3, 0.7, cl.w) * (1.0 - smoothstep(0.85, 0.97, cl.y));
  if (wdome > 0.0) {
    let cul = sfc[S_CULS * NXY + col];
    let cub = sfc[S_CUBS * NXY + col];
    let cut = sfc[S_CUTS * NXY + col];
    var kt = k;
    for (var kk = k + 1u; kk < NZ; kk++) {
      let zk = vg[VG_ZC + kk];
      let cc = kk * NXY + col;
      if (state[QC_OFF + cc] + state[QI_OFF + cc] < 1e-6 && !(cul > 0.02 && zk > cub && zk < cut)) { break; }
      kt = kk;
    }
    var kbt = k;
    for (var kk = i32(k) - 1; kk >= i32(kb); kk--) {
      let zk = vg[VG_ZC + u32(kk)];
      let cc = u32(kk) * NXY + col;
      if (state[QC_OFF + cc] + state[QI_OFF + cc] < 1e-6 && !(cul > 0.02 && zk > cub && zk < cut)) { break; }
      kbt = u32(kk);
    }
    let zb = vg[VG_ZC + kbt] - 0.5 * vg[VG_DZC + kbt];
    let zt = vg[VG_ZC + kt] + 0.5 * vg[VG_DZC + kt];
    let zr = clamp((z - zb) / max(zt - zb, 1.0), 0.0, 1.0);
    let d = max(zr - 0.4, 0.0) / 0.6;
    // (płynnie z udziałem chmury kłębiastej – przy przejściu w chmurę warstwową kopuła zanika stopniowo)
    sh = mix(1.0, max(1.0 - d * d, 0.0), wdome);
  }
  // chmury w 3D wygładzone w czasie (τ ~10 min czasu symulacji, jak pola chmur na mapie) – bez migotania cumulusów
  textureStore(densOut, g, mix(textureLoad(densIn, g, 0), vec4f(cl.x * cl.y * sh, cl.y * sh, cl.z, cl.w), VP.blend));
}

// współrzędne tekstury dla punktu (x, y, z) [m]
fn texc(p: vec3f) -> vec3f {
  return vec3f(p.x / (f32(NXD) * DX), p.y / (f32(NYD) * DY), S_of_z(p.z) / f32(NZ));
}

// zmętnienie suchego aerozolu przy wilgotności 50% [1/m przy 550 nm] (widzialność ~75 km)
const HZ0: f32 = 3.5e-5;

// Grubość optyczna od woksela w stronę słońca – albo księżyca w nowym widoku nocą (także cień gór)
@compute @workgroup_size(4, 4, 4)
fn vol_light(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= NXD || g.y >= NYD || g.z >= NZ) { return; }
  let p0 = vec3f((f32(g.x) + 0.5) * DX, (f32(g.y) + 0.5) * DY, vg[VG_ZC + g.z]);
  let sun = normalize(vec3f(VP.sun.x, VP.sun.y, max(VP.sun.z, 0.02)));
  var tau = 0.0;
  var s = 20.0;
  var p = p0;
  for (var n = 0; n < 48; n++) {
    let ds = s;
    p += sun * ds;
    if (p.z > VP.zTop) { break; }
    let tc = texc(p);
    if (any(tc.xy < vec2f(0.0)) || any(tc.xy > vec2f(1.0))) { break; }
    let hg = textureSampleLevel(groundIn, samp, tc.xy, 0.0).x;
    if (p.z < hg) { tau += 50.0; break; }
    tau += textureSampleLevel(densIn, samp, tc, 0.0).x * ds;
    s = min(s * 1.25, max(DX, 400.0));
  }
  if (VP.sunUp <= 0.0) { tau = 50.0; }
  // y – prąd pionowy w wokselu (przekrój tnący w widoku 3D)
  let col = (g.y + MG) * NX + g.x + MG;
  let c = g.z * NXY + col;
  // z – zmętnienie (nowy widok 3D): powietrze warstwy granicznej niesie aerozol razem z parą – stosunek q_v do wartości
  // przy gruncie, do kwadratu (nad warstwą graniczną ostry spadek, nocą zostaje warstwa rezydualna), × wzrost cząstek
  // z wilgotnością √(0.5/(1 − RH)) (RH ≤ 0.97) + tło swobodnej troposfery; pod gruntem – jak na pierwszym poziomie nad gruntem
  let kb = u32(vg[VG_KB + col]);
  let kk = max(g.z, kb);
  let ck = kk * NXY + col;
  let qv = max(state[QV_OFF + ck], 0.0);
  let rh = min(qv / qsat((vg[VG_TC + kk] + state[T_OFF + ck]) * vg[VG_EXC + kk], vg[VG_PRS + kk]), 0.97);
  let qr = qv / max(state[QV_OFF + kb * NXY + col], 1e-5);
  let haze = HZ0 * clamp(qr * qr, 0.03, 1.5) * sqrt(0.5 / (1.0 - rh)) + 1.0e-6 * exp(-vg[VG_ZC + kk] / 8000.0);
  // w – grubość optyczna chmur nad wokselem (światło nieba i rozproszone pod chmurami)
  var tup = 0.0;
  for (var k = g.z + 1u; k < NZ; k++) { tup += textureLoad(densIn, vec3u(g.x, g.y, k), 0).x * vg[VG_DZC + k]; }
  textureStore(lightOut, g, vec4f(tau, 0.5 * (state[W_OFF + c] + state[W_OFF + c + NXY]), haze, tup));
}
