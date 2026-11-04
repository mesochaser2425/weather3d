// Atmosfera nowego widoku 3D (PLAN_WIDOK_3D.md, etap 2) – wspólne dla tablic (atmolut.wgsl) i obrazu (view3dn.wgsl).
// Model nieba Hillaire (2020, „A Scalable and Production Ready Sky and Atmosphere Rendering Technique”): kula planety
// (6360 km, atmosfera do 100 km), powietrze (Rayleigh, wysokość skali 8 km), aerozol (Mie: faza Cornette–Shanks g = 0.76,
// albedo pojedynczego rozpraszania 0.92, Ångström ~1 – daleki teren niebieskawy), ozon (warstwa 10–40 km – błękit zmierzchu).
// Tablice dla natężenia 1 nad atmosferą: przepuszczalność do granicy atmosfery (256 × 64, parametryzacja Bruneton 2008),
// rozpraszanie wielokrotne Ψ (32 × 32) i oświetlenie poziomej powierzchni przez niebo (32 × 32).
// Aerozol: w domenie zmętnienie każdego woksela (vol_light), poza nią i w tablicach profil średni domeny (atm_stats),
// nad wierzchem modelu zanik (6 km).

const PI: f32 = 3.14159265;
const RG: f32 = 6360000.0;          // promień planety [m]
const RT: f32 = 6460000.0;          // górna granica atmosfery
const HAT: f32 = 100000.0;          // RT − RG
const HH: f32 = 1132254.0;          // √(RT² − RG²): droga do granicy atmosfery wzdłuż horyzontu z poziomu gruntu
const BR = vec3f(5.802e-6, 13.558e-6, 33.1e-6);    // rozpraszanie Rayleigha przy gruncie [1/m] (680, 550, 440 nm)
const HR: f32 = 8000.0;
const BO = vec3f(0.650e-6, 1.881e-6, 0.085e-6);   // pochłanianie ozonu w maksimum warstwy (25 km)
const AEXP = vec3f(0.80, 1.0, 1.25);               // aerozol: ekstynkcja względem 550 nm
const AOM: f32 = 0.92;
const AG: f32 = 0.76;
const TDIF: f32 = 0.11;             // chmura: przepuszczalność całkowita 1/(1 + 0.75·(1 − g)·τ), g = 0.85 (dwa strumienie)
const ENIGHT = vec3f(3.0e-9, 3.6e-9, 4.6e-9);      // oświetlenie nocnego nieba bez księżyca (gwiazdy, poświata; ~0.0005 lx)

@group(0) @binding(20) var transT: texture_2d<f32>;
@group(0) @binding(21) var msT: texture_2d<f32>;
@group(0) @binding(22) var irrT: texture_2d<f32>;
// profil średni domeny na poziomach modelu: x – zmętnienie (ekstynkcja aerozolu przy 550 nm [1/m]), y – przepuszczalność
// chmur i gór do światła rzucającego cienie, z – przepuszczalność rozproszona chmur nad punktem, w – liczba kolumn;
// [NZ] – średnie albedo podłoża (rgb)
@group(0) @binding(23) var<storage, read> prof: array<vec4f>;
@group(0) @binding(24) var sAtm: sampler;

fn fromUnit(x: f32, n: f32) -> f32 { return 0.5 / n + x * (1.0 - 1.0 / n); }
fn toUnit(u: f32, n: f32) -> f32 { return (u - 0.5 / n) / (1.0 - 1.0 / n); }

// wysokość nad kulą po drodze t od punktu na wysokości h w kierunku o cosinusie kąta zenitalnego mu (bez utraty dokładności
// przy odejmowaniu promienia Ziemi)
fn hAlong(h: f32, mu: f32, t: f32) -> f32 {
  let q = h * (2.0 * RG + h) + t * (t + 2.0 * (RG + h) * mu);
  return q / (sqrt(max(RG * RG + q, 0.0)) + RG);
}
// odległość do granicy atmosfery
fn distTop(h: f32, mu: f32) -> f32 {
  let r = RG + h;
  let d2 = r * r * mu * mu + (HAT - h) * (RT + r);
  return max(-r * mu + sqrt(max(d2, 0.0)), 0.0);
}
// odległość do gruntu (kuli RG) albo −1
fn distGround(h: f32, mu: f32) -> f32 {
  let r = RG + h;
  let d2 = r * r * mu * mu - h * (2.0 * RG + h);
  if (mu >= 0.0 || d2 < 0.0) { return -1.0; }
  return max(-r * mu - sqrt(d2), 0.0);
}
// przecięcia z kulą o promieniu RG + H (bliższe, dalsze); brak – (−1, −1)
fn sphereHits(h: f32, mu: f32, H: f32) -> vec2f {
  let b = (RG + h) * mu;
  let c = (h - H) * (2.0 * RG + h + H);
  let disc = b * b - c;
  if (disc < 0.0) { return vec2f(-1.0); }
  let q = -(b + select(-sqrt(disc), sqrt(disc), b >= 0.0));
  if (abs(q) < 1e-6) { return vec2f(0.0); }
  let t1 = q;
  let t2 = c / q;
  return vec2f(min(t1, t2), max(t1, t2));
}

fn transUV(h: f32, mu: f32) -> vec2f {
  let rho = sqrt(h * (2.0 * RG + h));
  let d = distTop(h, mu);
  let dmin = HAT - h;
  let dmax = rho + HH;
  return vec2f(fromUnit(clamp((d - dmin) / max(dmax - dmin, 1.0), 0.0, 1.0), 256.0), fromUnit(rho / HH, 64.0));
}
// przepuszczalność od punktu na wysokości h do słońca (księżyca) o cosinusie zenitalnym mu; za horyzontem 0 (cień Ziemi),
// półcień w zakresie średnicy tarczy
fn transmit(h: f32, mu: f32) -> vec3f {
  let hc = clamp(h, 0.0, HAT);
  let muH = -sqrt(hc * (2.0 * RG + hc)) / (RG + hc);
  let vis = smoothstep(muH - 0.0047, muH + 0.0047, mu);
  if (vis <= 0.0) { return vec3f(0.0); }
  return textureSampleLevel(transT, sAtm, transUV(hc, mu), 0.0).rgb * vis;
}
// tablice 32 × 32: cosinus zenitalny słońca × √(h / 100 km) (gęściej przy gruncie)
fn uv32(h: f32, mu: f32) -> vec2f {
  return vec2f(fromUnit(clamp(mu * 0.5 + 0.5, 0.0, 1.0), 32.0), fromUnit(sqrt(clamp(h / HAT, 0.0, 1.0)), 32.0));
}
fn msLook(h: f32, mu: f32) -> vec3f { return textureSampleLevel(msT, sAtm, uv32(h, mu), 0.0).rgb; }
fn irrLook(h: f32, mu: f32) -> vec3f { return textureSampleLevel(irrT, sAtm, uv32(h, mu), 0.0).rgb; }

// profil domeny na wysokości h (interpolacja między poziomami modelu); nad wierzchem modelu aerozol zanika
fn profAt(h: f32) -> vec4f {
  let s = clamp(S_of_z(h) - 0.5, 0.0, f32(NZ) - 1.001);
  let k = u32(s);
  return mix(prof[k], prof[k + 1u], s - f32(k));
}
fn aerD(h: f32) -> f32 {
  if (h < HTOP) { return profAt(h).x; }
  return prof[NZ - 1u].x * exp(-(h - HTOP) / 6000.0);
}

// ośrodek: rozpraszanie Rayleigha, rozpraszanie aerozolu, ekstynkcja całkowita (aer – ekstynkcja aerozolu przy 550 nm)
struct Med { sR: vec3f, sM: vec3f, ext: vec3f }
fn medium(h: f32, aer: f32) -> Med {
  let sR = BR * exp(-max(h, 0.0) / HR);
  let eM = aer * AEXP;
  return Med(sR, eM * AOM, sR + eM + BO * max(0.0, 1.0 - abs(h - 25000.0) / 15000.0));
}
fn phaseR(c: f32) -> f32 { return 0.0596831 * (1.0 + c * c); }
fn phaseM(c: f32) -> f32 {
  let g2 = AG * AG;
  return 0.119366 * (1.0 - g2) * (1.0 + c * c) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * AG * c, 1e-4), 1.5));
}
// ∫₀^ds exp(−ext·s) ds (krok o stałej ekstynkcji – całkowanie zachowujące energię)
fn stepInt(ext: vec3f, ds: f32) -> vec3f {
  let x = ext * ds;
  return select((1.0 - exp(-x)) / max(ext, vec3f(1e-20)), ds * (1.0 - 0.5 * x), x < vec3f(1e-3));
}

// albedo podłoża (realne odbicie: trawa ~0.15, las ~0.05–0.1, śnieg ~0.85): typ roślinności, jej zieleń i śnieg
fn vegCol(v: u32, g: f32) -> vec3f {
  switch v {
    case 0u: { return mix(vec3f(0.22, 0.20, 0.14), vec3f(0.11, 0.16, 0.06), g); }
    case 1u: { return mix(vec3f(0.09, 0.08, 0.065), vec3f(0.045, 0.10, 0.035), g); }
    case 2u: { return vec3f(0.03, 0.065, 0.04); }
    case 3u: { return mix(vec3f(0.20, 0.18, 0.15), vec3f(0.14, 0.16, 0.10), g); }
    case 4u: { return vec3f(0.80, 0.83, 0.87); }
    case 5u: { return vec3f(0.03, 0.085, 0.03); }
    case 6u: { return mix(vec3f(0.30, 0.25, 0.15), vec3f(0.20, 0.21, 0.09), g); }
    case 7u: { return vec3f(0.45, 0.37, 0.25); }
    case 8u: { return mix(vec3f(0.28, 0.25, 0.17), vec3f(0.19, 0.20, 0.10), g); }
    case 9u: { return vec3f(0.18, 0.17, 0.16); }
    case 10u: { return vec3f(0.02, 0.04, 0.06); }
    default: { return mix(vec3f(0.12, 0.13, 0.08), vec3f(0.08, 0.12, 0.06), g); }
  }
}
fn groundAlb(gt: vec4f) -> vec3f {
  let v = u32(gt.w + 0.5);
  let forest = v == 1u || v == 2u || v == 5u || v == 11u;
  return mix(vegCol(v, gt.y), vec3f(0.85, 0.87, 0.90), gt.z * select(1.0, 0.55, forest));
}
