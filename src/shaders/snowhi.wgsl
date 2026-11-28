// Śnieg w rozdzielczości gęstszego terenu: te same punkty co demHi (F × F na oczko widocznej domeny, ~1 km przy oczku 7.5 km).
// Opad z oczek modelu (przyrost licznika), udział śniegu z oczek przesunięty o różnicę temperatury między prawdziwą wysokością punktu
// a gruntem modelu (profil kolumny – izoterma 0 °C i inwersje w punkcie), topnienie ze wskaźnika temperatury i słońca na stoku punktu
// (Hock 1999), gęstość świeżego śniegu i osiadanie jak w modelu. Tylko obraz (mapa grubości pokrywy, satelita) – model liczy śnieg
// dalej na oczku (main.js snowHiPass).
// Bufor snowHi: [0, NP) woda w śniegu [mm], [NP, 2NP) grubość [m], [2NP, 2NP + NXY) licznik opadu PACC przy ostatniej aktualizacji,
// [2NP + NXY, 2NP + 2NXY) licznik śniegu miesiąca MSN (NP = W·H punktów)
struct SnP { dt: f32, F: f32, init: f32, sunx: f32, suny: f32, sunz: f32, vh: f32, pad1: f32 }   // vh – gęsta mapa pokrycia wczytana
@group(0) @binding(0) var<uniform> SN: SnP;
@group(0) @binding(1) var<storage, read> vg: array<f32>;
@group(0) @binding(2) var<storage, read> state: array<f32>;
@group(0) @binding(3) var<storage, read> sfc: array<f32>;
@group(0) @binding(4) var<storage, read> demHi: array<f32>;
@group(0) @binding(5) var<storage, read_write> snowHi: array<f32>;
@group(0) @binding(6) var<storage, read> vegHi: array<u32>;     // typ powierzchni w tych samych punktach (1 bajt na punkt; 10 – woda; main.js buildVegHi)

const TK0: f32 = 273.15;

fn sAt(s: u32, col: u32) -> f32 { return sfc[s * NXY + col]; }
fn kbOf(col: u32) -> u32 { return u32(vg[VG_KB + col]); }
fn zgOf(col: u32) -> f32 { let kb = kbOf(col); return vg[VG_ZW + kb + 1u] - vg[VG_HF + col] * vg[VG_DZC + kb]; }
// temperatura powietrza [K] w kolumnie na wysokości z n.p.m.: między poziomami liniowo; poniżej 1. poziomu (środek części komórki
// przy gruncie nad gruntem) – 6.5 K/km (doliny poniżej gruntu modelu)
fn colT(col: u32, z: f32) -> f32 {
  let kb = kbOf(col);
  let z1 = zgOf(col) + 0.5 * vg[VG_HF + col] * vg[VG_DZC + kb];
  let t1 = (vg[VG_TC + kb] + state[T_OFF + kb * NXY + col]) * vg[VG_EXC + kb];
  if (z <= z1) { return t1 + 0.0065 * (z1 - z); }
  var zp = z1;
  var tp = t1;
  for (var k = kb + 1u; k < NZ; k++) {
    let zk = vg[VG_ZC + k];
    let tk = (vg[VG_TC + k] + state[T_OFF + k * NXY + col]) * vg[VG_EXC + k];
    if (z <= zk) { return mix(tp, tk, (z - zp) / max(zk - zp, 1.0)); }
    zp = zk;
    tp = tk;
  }
  return tp;
}

@compute @workgroup_size(8, 8)
fn snow_hi(@builtin(global_invocation_id) gid: vec3u) {
  let F = u32(SN.F);
  let W = NXD * F;
  let H = NYD * F;
  if (gid.x >= W || gid.y >= H) { return; }
  let p = gid.y * W + gid.x;
  let NP = W * H;
  // położenie w indeksach oczek siatki obliczeniowej (środek komórki i: i + 0.5) i cztery kolumny do interpolacji dwuliniowej
  let x = f32(MG) + (f32(gid.x) + 0.5) / f32(F) - 0.5;
  let y = f32(MG) + (f32(gid.y) + 0.5) / f32(F) - 0.5;
  let i0 = u32(floor(x));
  let j0 = u32(floor(y));
  let fx = x - floor(x);
  let fy = y - floor(y);
  var cs = array<u32, 4>(j0 * NX + i0, j0 * NX + i0 + 1u, (j0 + 1u) * NX + i0, (j0 + 1u) * NX + i0 + 1u);
  var ws = array<f32, 4>((1.0 - fx) * (1.0 - fy), fx * (1.0 - fy), (1.0 - fx) * fy, fx * fy);
  let zp = demHi[p];
  // woda bez lodu – bez pokrywy (śnieg wpada do wody): punkt wody z gęstej mapy pokrycia, bez niej – z oczka; lód z oczka
  let cn = u32(floor(f32(MG) + (f32(gid.y) + 0.5) / f32(F))) * NX + u32(floor(f32(MG) + (f32(gid.x) + 0.5) / f32(F)));
  let isW = select(u32(vg[VG_VEG + cn] + 0.5) == 10u, ((vegHi[p >> 2u] >> ((p & 3u) * 8u)) & 255u) == 10u, SN.vh > 0.5);
  if (isW && sAt(S_ICE, cn) <= 0.0) {
    snowHi[p] = 0.0;
    snowHi[NP + p] = 0.0;
    return;
  }
  if (SN.init > 0.5) {
    // start (nowy przebieg, wczytany gęstszy teren): woda w śniegu i grubość z oczek × e^(Δh/350 m) – w dolinach mniej, na grzbietach więcej
    var swe = 0.0;
    var snd = 0.0;
    var hc = 0.0;
    for (var k = 0; k < 4; k++) {
      swe += ws[k] * max(sAt(S_SWE, cs[k]), 0.0);
      snd += ws[k] * max(sAt(S_SND, cs[k]), 0.0);
      hc += ws[k] * vg[VG_HGT + cs[k]];
    }
    let fe = exp(clamp((zp - hc) / 350.0, -4.0, 2.0));
    snowHi[p] = swe * fe;
    snowHi[NP + p] = snd * fe;
    return;
  }
  // opad od ostatniej aktualizacji (przyrost licznika opadu oczek), udział śniegu z przyrostu licznika śniegu miesiąca (po zerowaniu
  // na granicy miesiąca – z temperatury); różnice temperatury punkt − grunt modelu na ~30 m (rodzaj opadu, jak tPhase) i 2 m (topnienie)
  var dP = 0.0;
  var dS = 0.0;
  var okS = true;
  var dT30 = 0.0;
  var dT2 = 0.0;
  var tc30 = 0.0;
  var t2 = 0.0;
  var sw = 0.0;
  for (var k = 0; k < 4; k++) {
    let c = cs[k];
    let ip = max(sAt(S_PACC, c) - snowHi[2u * NP + c], 0.0);
    let iS = sAt(S_MSN, c) - snowHi[2u * NP + NXY + c];
    if (iS < -1e-4) { okS = false; }
    dP += ws[k] * ip;
    dS += ws[k] * clamp(iS, 0.0, ip);
    let zg = zgOf(c);
    let tg30 = colT(c, zg + 30.0);
    tc30 += ws[k] * tg30;
    dT30 += ws[k] * (colT(c, zp + 30.0) - tg30);
    dT2 += ws[k] * (colT(c, zp + 2.0) - colT(c, zg + 2.0));
    t2 += ws[k] * sAt(S_T2, c);
    sw += ws[k] * max(sAt(S_SW, c), 0.0);
  }
  let fsc = select(clamp((TK0 + 1.0 - tc30) / 2.0, 0.0, 1.0), dS / max(dP, 1e-9), okS && dP > 1e-6);
  let fs = clamp(fsc - dT30 / 2.0, 0.0, 1.0);
  let dsn = dP * fs;
  let rain = dP - dsn;
  let tp = t2 + dT2;                                       // T 2 m w punkcie [°C]
  // słońce na stoku punktu: część bezpośrednia (~85%) × kąt padania na stok / kąt padania na poziomą powierzchnię
  let gx = select(i32(gid.x) - 1, i32(gid.x), gid.x == 0u);
  let gx1 = select(i32(gid.x) + 1, i32(gid.x), gid.x + 1u >= W);
  let gy = select(i32(gid.y) - 1, i32(gid.y), gid.y == 0u);
  let gy1 = select(i32(gid.y) + 1, i32(gid.y), gid.y + 1u >= H);
  let hs = DX / f32(F);
  let dzx = (demHi[gid.y * W + u32(gx1)] - demHi[gid.y * W + u32(gx)]) / (f32(gx1 - gx) * hs);
  let dzy = (demHi[u32(gy1) * W + gid.x] - demHi[u32(gy) * W + gid.x]) / (f32(gy1 - gy) * DY / f32(F));
  let nrm = normalize(vec3f(-dzx, -dzy, 1.0));
  let sun = vec3f(SN.sunx, SN.suny, SN.sunz);
  let inc = select(0.0, max(dot(nrm, sun), 0.0) / max(sun.z, 0.05), sun.z > 0.0);
  let swp = sw * (0.15 + 0.85 * min(inc, 4.0));
  var swe = snowHi[p];
  var snd = snowHi[NP + p];
  // świeży śnieg: gęstość z temperatury powietrza (Anderson 1976, jak model)
  let rhoN = 50.0 + 1.7 * pow(clamp(tp + 15.0, 0.0, 17.0), 1.5);
  swe += dsn;
  snd += dsn / rhoN;
  // topnienie: wskaźnik temperatury ze słońcem (~2.4 mm/K/dobę w cieniu, ~12 mm/K/dobę przy 600 W/m² na stoku)
  var melt = 0.0;
  if (swe > 0.0 && tp > 0.0) {
    melt = min(swe, tp * (0.1 + 0.0007 * swp) * SN.dt / 3600.0);
    snd *= (swe - melt) / swe;
    swe -= melt;
  }
  // osiadanie jak w modelu: suchy do 250 + 100 kg/m³ na metr pokrywy (τ 5 dób), mokry (topnienie, deszcz na śnieg) do 450 (τ 1.5 doby)
  if (swe > 0.0) {
    let wet = melt > 0.0 || rain > 0.1 * SN.dt / 3600.0 || tp > 0.5;
    let rmax = select(250.0 + 100.0 * min(snd, 1.0), 450.0, wet);
    let rho = swe / max(snd, 1e-6);
    snd = swe / max(rho, rmax - (rmax - rho) * exp(-SN.dt / (select(5.0, 1.5, wet) * 86400.0)));
    snd = clamp(snd, swe / 550.0, swe / 50.0);
  } else {
    snd = 0.0;
  }
  snowHi[p] = swe;
  snowHi[NP + p] = snd;
}

// po aktualizacji punktów: liczniki opadu i śniegu oczek do następnego przyrostu
@compute @workgroup_size(64)
fn snow_hi_mark(@builtin(global_invocation_id) gid: vec3u) {
  let col = gid.x;
  if (col >= NXY) { return; }
  let NP = NXD * u32(SN.F) * NYD * u32(SN.F);
  snowHi[2u * NP + col] = sAt(S_PACC, col);
  snowHi[2u * NP + NXY + col] = sAt(S_MSN, col);
}
