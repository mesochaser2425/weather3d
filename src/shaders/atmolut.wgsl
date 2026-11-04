// Nowy widok 3D – atmosfera (compute; funkcje wspólne w atmo.wgsl):
//   atm_stats – profil średni domeny na poziomach modelu (zmętnienie, przepuszczalność chmur do światła i rozproszona)
//               i średnie albedo podłoża; co klatkę, po vol_light
//   atm_trans – tablica przepuszczalności do granicy atmosfery (256 × 64)
//   atm_ms    – rozpraszanie wielokrotne Ψ (32 × 32; Hillaire 2020: drugi rząd z fazą izotropową, wyższe rzędy jako szereg
//               geometryczny 1/(1 − f_ms))
//   atm_irr   – oświetlenie poziomej powierzchni przez niebo (32 × 32)
//   atm_expo  – ekspozycja ze średniej jasności obrazu HDR (co klatkę, po obrazie)
// Tablice zależą tylko od profilu aerozolu – przeliczane co kilkanaście klatek.

fn ldb(b: u32, i: u32) -> f32 { return 0.0; }

@group(0) @binding(30) var<storage, read_write> profOut: array<vec4f>;
@group(0) @binding(31) var transOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(32) var msOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(33) var irrOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(34) var lightIn: texture_3d<f32>;
@group(0) @binding(35) var groundIn: texture_2d<f32>;
@group(0) @binding(36) var<storage, read> vgA: array<f32>;
@group(0) @binding(40) var hdrIn: texture_2d<f32>;
@group(0) @binding(41) var<storage, read_write> expoOut: array<f32, 8>;

var<workgroup> wsum: array<vec4f, 256>;
var<workgroup> wmin: array<u32, 256>;

// grupa robocza na poziom modelu (średnia z kolumn, w których poziom jest nad gruntem; poziomy niższe od najniższego gruntu
// domeny biorą wartości z najniższego poziomu nad gruntem) + jedna grupa na albedo podłoża
@compute @workgroup_size(256)
fn atm_stats(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let NC = NXD * NYD;
  if (wg.x < NZ) {
    var m = NZ - 1u;
    for (var c = li; c < NC; c += 256u) {
      m = min(m, u32(vgA[VG_KB + (c / NXD + MG) * NX + c % NXD + MG]));
    }
    wmin[li] = m;
    workgroupBarrier();
    for (var s = 128u; s > 0u; s >>= 1u) {
      if (li < s) { wmin[li] = min(wmin[li], wmin[li + s]); }
      workgroupBarrier();
    }
    let k = max(wg.x, wmin[0]);
    var acc = vec4f(0.0);
    for (var c = li; c < NC; c += 256u) {
      let ix = c % NXD;
      let iy = c / NXD;
      if (u32(vgA[VG_KB + (iy + MG) * NX + ix + MG]) > k) { continue; }
      let l = textureLoad(lightIn, vec3u(ix, iy, k), 0);
      acc += vec4f(max(l.z, 0.0), exp(-l.x), 1.0 / (1.0 + TDIF * max(l.w, 0.0)), 1.0);
    }
    wsum[li] = acc;
    workgroupBarrier();
    for (var s = 128u; s > 0u; s >>= 1u) {
      if (li < s) { wsum[li] += wsum[li + s]; }
      workgroupBarrier();
    }
    if (li == 0u) {
      let a = wsum[0];
      profOut[wg.x] = vec4f(a.xyz / max(a.w, 1.0), a.w);
    }
    return;
  }
  var acc = vec4f(0.0);
  for (var c = li; c < NC; c += 256u) {
    acc += vec4f(groundAlb(textureLoad(groundIn, vec2u(c % NXD, c / NXD), 0)), 1.0);
  }
  wsum[li] = acc;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { wsum[li] += wsum[li + s]; }
    workgroupBarrier();
  }
  if (li == 0u) { profOut[NZ] = vec4f(wsum[0].xyz / max(wsum[0].w, 1.0), 1.0); }
}

@compute @workgroup_size(8, 8)
fn atm_trans(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= 256u || g.y >= 64u) { return; }
  let xmu = toUnit((f32(g.x) + 0.5) / 256.0, 256.0);
  let rho = HH * toUnit((f32(g.y) + 0.5) / 64.0, 64.0);
  let h = rho * rho / (sqrt(rho * rho + RG * RG) + RG);
  let r = RG + h;
  let dmin = HAT - h;
  let d = dmin + xmu * (rho + HH - dmin);
  let mu = select(clamp(((HAT - h) * (RT + r) - d * d) / (2.0 * r * d), -1.0, 1.0), 1.0, d < 1.0);
  let N = 80;
  let ds = d / f32(N);
  var od = vec3f(0.0);
  for (var i = 0; i < N; i++) {
    let hs = hAlong(h, mu, (f32(i) + 0.5) * ds);
    od += medium(hs, aerD(hs)).ext * ds;
  }
  textureStore(transOut, g.xy, vec4f(exp(-od), 1.0));
}

// współrzędne tablic 32 × 32 → (cos zenitalny słońca, wysokość)
fn lut32(g: vec2u) -> vec2f {
  let sv = toUnit((f32(g.y) + 0.5) / 32.0, 32.0);
  return vec2f(toUnit((f32(g.x) + 0.5) / 32.0, 32.0) * 2.0 - 1.0, max(sv * sv * HAT, 5.0));
}

@compute @workgroup_size(8, 8)
fn atm_ms(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= 32u || g.y >= 32u) { return; }
  let q = lut32(g.xy);
  let mus = q.x;
  let h = q.y;
  let sunD = vec3f(sqrt(max(1.0 - mus * mus, 0.0)), 0.0, mus);
  let alb = prof[NZ].rgb;
  var L2 = vec3f(0.0);
  var F = vec3f(0.0);
  for (var i = 0; i < 8; i++) {
    for (var j = 0; j < 8; j++) {
      // kierunki równomiernie na sferze
      let ct = 1.0 - 2.0 * (f32(i) + 0.5) / 8.0;
      let st = sqrt(max(1.0 - ct * ct, 0.0));
      let ph = 2.0 * PI * (f32(j) + 0.5) / 8.0;
      let nu = st * cos(ph) * sunD.x + ct * mus;
      let tg = distGround(h, ct);
      let tmax = select(distTop(h, ct), tg, tg >= 0.0);
      let NS = 20;
      let ds = tmax / f32(NS);
      var T = vec3f(1.0);
      var Ls = vec3f(0.0);
      var f = vec3f(0.0);
      for (var s = 0; s < NS; s++) {
        let t = (f32(s) + 0.5) * ds;
        let hs = hAlong(h, ct, t);
        let mu_s = ((RG + h) * mus + t * nu) / (RG + hs);
        let m = medium(hs, aerD(hs));
        let si = T * stepInt(m.ext, ds);
        Ls += (m.sR + m.sM) * transmit(hs, mu_s) * si / (4.0 * PI);
        f += (m.sR + m.sM) * si;
        T *= exp(-m.ext * ds);
      }
      if (tg >= 0.0) {
        let mug = ((RG + h) * mus + tg * nu) / RG;
        Ls += T * transmit(0.0, mug) * max(mug, 0.0) * alb / PI;
      }
      L2 += Ls;
      F += f;
    }
  }
  L2 /= 64.0;
  F /= 64.0;
  textureStore(msOut, g.xy, vec4f(L2 / max(1.0 - F, vec3f(1e-3)), 1.0));
}

@compute @workgroup_size(8, 8)
fn atm_irr(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= 32u || g.y >= 32u) { return; }
  let q = lut32(g.xy);
  let mus = q.x;
  let h = q.y;
  let sx = sqrt(max(1.0 - mus * mus, 0.0));
  var E = vec3f(0.0);
  let NI = 12;
  for (var i = 0; i < NI; i++) {
    for (var j = 0; j < NI; j++) {
      // półkula górna, równe kąty bryłowe
      let ct = (f32(i) + 0.5) / f32(NI);
      let st = sqrt(max(1.0 - ct * ct, 0.0));
      let ph = 2.0 * PI * (f32(j) + 0.5) / f32(NI);
      let nu = st * cos(ph) * sx + ct * mus;
      let NS = 16;
      let ds = distTop(h, ct) / f32(NS);
      var T = vec3f(1.0);
      var Ls = vec3f(0.0);
      for (var s = 0; s < NS; s++) {
        let t = (f32(s) + 0.5) * ds;
        let hs = hAlong(h, ct, t);
        let mu_s = ((RG + h) * mus + t * nu) / (RG + hs);
        let m = medium(hs, aerD(hs));
        let J = (m.sR * phaseR(nu) + m.sM * phaseM(nu)) * transmit(hs, mu_s) + (m.sR + m.sM) * msLook(hs, mu_s);
        Ls += T * J * stepInt(m.ext, ds);
        T *= exp(-m.ext * ds);
      }
      E += Ls * ct;
    }
  }
  textureStore(irrOut, g.xy, vec4f(E * 2.0 * PI / f32(NI * NI), 1.0));
}

// Ekspozycja nowego widoku (jak aparat, z częściową adaptacją): średnia geometryczna jasności obrazu HDR (64 × 36 próbek),
// wygładzona w czasie (~20 klatek). Jasność odbierana rośnie wolniej niż jasność sceny (wykładnik 0.16): zachód ~0.5,
// zmierzch ~0.2, noc ~0.1 jasności dnia; nocą widzenie niebieskawe. Wcześniej ekspozycja
// z oświetlenia poziomej powierzchni – przy niskim słońcu spada jak sinus wysokości, a jasność nieba i mgiełki nie: o zachodzie
// cały obraz był różową mgłą.
const EXK: f32 = 4.0;      // ekspozycja typowej sceny dziennej
const EXL: f32 = 0.06;     // średnia jasność typowej sceny dziennej (natężenie słońca = 1)
@compute @workgroup_size(256)
fn atm_expo(@builtin(local_invocation_index) li: u32) {
  let sz = vec2f(textureDimensions(hdrIn));
  var acc = 0.0;
  for (var i = li; i < 2304u; i += 256u) {
    let px = vec2u((vec2f(f32(i % 64u), f32(i / 64u)) + 0.5) / vec2f(64.0, 36.0) * sz);
    acc += log(clamp(dot(textureLoad(hdrIn, px, 0).rgb, vec3f(0.2126, 0.7152, 0.0722)), 1e-7, 6e4));
  }
  wsum[li] = vec4f(acc, 0.0, 0.0, 0.0);
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { wsum[li] += wsum[li + s]; }
    workgroupBarrier();
  }
  if (li == 0u) {
    let ok = expoOut[3] > 0.5;
    let er = select(EXK, expoOut[0], ok);
    // log10(średnia jasność sceny / jasność dnia)
    let x = (wsum[0].x / 2304.0 - log(er) - log(EXL)) * 0.4342945;
    let y = select(x, mix(expoOut[1], x, 0.12), ok && abs(x - expoOut[1]) < 4.0);
    expoOut[5] = er;
    expoOut[1] = y;
    expoOut[0] = EXK * pow(10.0, -0.84 * y);
    expoOut[2] = 1.0 - smoothstep(-6.0, -3.5, y);
    expoOut[3] = 1.0;
  }
}
