// Sondaż: analiza profilu (cząstki SB / MU / ML, CAPE, CIN, ścinanie, SRH, wskaźniki burzowe) i wykres w układzie jak sondaże thundeR
// (R-pakiet Czernecki, Taszarek, Szuster – licencja GPL ≥ 2): własny kod na podstawie standardowych wzorów, z pakietu wzięty tylko układ
// i konwencje wykresu (skew-T, hodograf, tabele). Skew-T: oś T jak na obrazku wzorcowym, izotermy pochylone o 75.5 K między 1050 a 100 hPa.

const G = 9.81, RD = 287.04, CP = 1005.7, EPS = 0.622, LV = 2.501e6, KAP = RD / CP;
const es = (T) => 611.2 * Math.exp(17.67 * (T - 273.15) / (T - 29.65));
const qsat = (T, p) => { const e = Math.min(es(T), 0.5 * p); return EPS * e / (p - 0.378 * e); };
const tdew = (q, p) => { const l = Math.log(Math.max(Math.max(q, 1e-7) * p / (EPS + 0.378 * Math.max(q, 1e-7)), 1e-3) / 611.2); return 243.5 * l / (17.67 - l) + 273.15; };
const tvir = (T, q) => T * (1 + 0.608 * q);
const tLcl = (T, Td) => 1 / (1 / (Td - 56) + Math.log(T / Td) / 800) + 56;       // Bolton 1980
function thetaE(T, q, p) {
  const r = q / (1 - q), TL = tLcl(T, Math.min(tdew(q, p), T));
  return T * Math.pow(1e5 / p, 0.2854 * (1 - 0.28 * r)) * Math.exp((3376 / TL - 2.54) * r * (1 + 0.81 * r));
}
const moistRate = (T, p) => { const r = qsat(T, p); return (RD * T + LV * r) / (CP + LV * LV * r * EPS / (RD * T * T)) / p; };   // dT/dp, adiabata pseudo-wilgotna
const moistStep = (T, p0, p1) => { const dp = p1 - p0, k1 = moistRate(T, p0); return T + dp * moistRate(T + 0.5 * dp * k1, p0 + 0.5 * dp); };
const dirOf = (u, v) => (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;

// P: { z[] [m nad gruntem, rosnąco, z[0] = grunt], p[] [Pa], T[] [K], q[] [kg/kg], u[], v[] } → wskaźniki i profile na siatce co 50 m
export function analyzeSounding(P) {
  const dz = 50, nz = P.z.length, n = Math.floor(Math.min(P.z[nz - 1], 20000) / dz) + 1;
  const Z = new Float64Array(n), PR = new Float64Array(n), TE = new Float64Array(n), QE = new Float64Array(n), UE = new Float64Array(n), VE = new Float64Array(n),
    TVE = new Float64Array(n), THE = new Float64Array(n), RH = new Float64Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const z = i * dz;
    while (m < nz - 2 && P.z[m + 1] < z) m++;
    const f = Math.min(1, Math.max(0, (z - P.z[m]) / Math.max(P.z[m + 1] - P.z[m], 1)));
    Z[i] = z;
    PR[i] = Math.exp(Math.log(P.p[m]) + f * Math.log(P.p[m + 1] / P.p[m]));
    TE[i] = P.T[m] + f * (P.T[m + 1] - P.T[m]);
    QE[i] = Math.max(1e-7, P.q[m] + f * (P.q[m + 1] - P.q[m]));
    UE[i] = P.u[m] + f * (P.u[m + 1] - P.u[m]);
    VE[i] = P.v[m] + f * (P.v[m + 1] - P.v[m]);
    TVE[i] = tvir(TE[i], QE[i]);
    THE[i] = thetaE(TE[i], QE[i], PR[i]);
    RH[i] = Math.min(100, 100 * QE[i] / qsat(TE[i], PR[i]));
  }
  const idx = (z) => Math.min(n - 1, Math.max(0, Math.round(z / dz)));
  const zOfP = (p) => { for (let i = 1; i < n; i++) if (PR[i] <= p) return Z[i - 1] + (Z[i] - Z[i - 1]) * Math.log(PR[i - 1] / p) / Math.log(PR[i - 1] / PR[i]); return NaN; };
  const iOfP = (p) => { const z = zOfP(p); return Number.isFinite(z) ? idx(z) : -1; };
  const zOfT = (t) => { for (let i = 1; i < n; i++) if (TE[i - 1] >= t && TE[i] < t) return Z[i - 1] + dz * (TE[i - 1] - t) / (TE[i - 1] - TE[i]); return NaN; };
  const i500 = iOfP(5e4), z0c = zOfT(273.15), zm10 = zOfT(263.15), zm30 = zOfT(243.15);

  // cząstka z poziomu i0: sucho do LCL (Bolton), dalej adiabata pseudo-wilgotna; wyporność z temperatury wirtualnej
  function parcel(i0, T0, q0) {
    const p0 = PR[i0], th = T0 * Math.pow(1e5 / p0, KAP), TL = tLcl(T0, Math.min(tdew(q0, p0), T0)), pL = p0 * Math.pow(TL / T0, 1 / KAP);
    const Tp = new Float64Array(n).fill(NaN), Tvp = new Float64Array(n).fill(NaN), B = new Float64Array(n);
    let sat = false, T = T0, pp = p0, iL = -1;
    for (let i = i0; i < n; i++) {
      const p = PR[i];
      if (!sat && p > pL) { T = th * Math.pow(p / 1e5, KAP); Tvp[i] = tvir(T, q0); } else {
        if (!sat) { sat = true; iL = i; T = TL; pp = pL; }
        T = moistStep(T, pp, p); pp = p;
        Tvp[i] = tvir(T, qsat(T, p));
      }
      Tp[i] = T;
      B[i] = (Tvp[i] - TVE[i]) / TVE[i];
    }
    let lfc = -1, el = -1, cape = 0, cin = 0, cape03 = 0, hgl = 0;
    if (iL >= 0) {
      for (let i = iL; i < n; i++) if (B[i] > 0) { lfc = i; break; }
      if (lfc >= 0) for (let i = n - 1; i >= lfc; i--) if (B[i] > 0) { el = i; break; }
    }
    if (lfc >= 0) {
      for (let i = lfc; i < el; i++) {
        const b = 0.5 * (B[i] + B[i + 1]);
        if (b > 0) { cape += b * G * dz; if (TE[i] <= 263.15 && TE[i] >= 243.15) hgl += b * G * dz; }
      }
      for (let i = i0; i < lfc; i++) { const b = 0.5 * (B[i] + B[i + 1]); if (b < 0) cin += b * G * dz; }
    }
    for (let i = i0; i < n - 1 && Z[i] < 3000; i++) { const b = 0.5 * (B[i] + B[i + 1]); if (b > 0 && (lfc >= 0 && i >= lfc)) cape03 += b * G * dz; }
    return { i0, T0, q0, mixr: 1000 * q0 / (1 - q0), pL, Tp, Tvp, B, iL, iLfc: lfc, iEl: el,
      lcl: iL >= 0 ? Z[iL] : NaN, lfc: lfc >= 0 ? Z[lfc] : NaN, el: el >= 0 ? Z[el] : NaN, cape, cin: lfc >= 0 ? cin : NaN, cape03, hgl,
      li: i500 >= i0 && i500 >= 0 ? TE[i500] - Tp[i500] : NaN };
  }
  const sb = parcel(0, TE[0], QE[0]);
  let thm = 0, qm = 0, nm = 0;
  for (let i = 0; i <= idx(500); i++) { thm += TE[i] * Math.pow(1e5 / PR[i], KAP); qm += QE[i]; nm++; }
  const ml = parcel(0, thm / nm * Math.pow(PR[0] / 1e5, KAP), qm / nm);
  let imu = 0;
  for (let i = 0; i <= idx(3000); i++) if (THE[i] > THE[imu]) imu = i;
  const mu = parcel(imu, TE[imu], QE[imu]);

  // wiatr
  const meanW = (z0, z1) => { let a = 0, b = 0, c = 0; for (let i = idx(z0); i <= idx(z1); i++) { a += UE[i]; b += VE[i]; c++; } return [a / c, b / c]; };
  const shear = (z0, z1) => Math.hypot(UE[idx(z1)] - UE[idx(z0)], VE[idx(z1)] - VE[idx(z0)]);
  const mean6 = meanW(0, 6000), sa = meanW(0, 500), sb6 = meanW(5500, 6000);
  const su = sb6[0] - sa[0], sv = sb6[1] - sa[1], sm = Math.max(Math.hypot(su, sv), 0.1);
  const rm = [mean6[0] + 7.5 * sv / sm, mean6[1] - 7.5 * su / sm], lm = [mean6[0] - 7.5 * sv / sm, mean6[1] + 7.5 * su / sm];
  const srh = (z1, c) => { let s = 0; for (let i = 0; i < idx(z1); i++) s += (UE[i + 1] - c[0]) * (VE[i] - c[1]) - (UE[i] - c[0]) * (VE[i + 1] - c[1]); return s; };
  const lapse = (z0, z1) => (TE[idx(z0)] - TE[idx(z1)]) / ((z1 - z0) / 1000);
  const z700 = zOfP(7e4), z500 = zOfP(5e4), lr75 = Number.isFinite(z700) && Number.isFinite(z500) ? (TE[idx(z700)] - TE[idx(z500)]) / ((z500 - z700) / 1000) : NaN;
  const meanS = (z0, z1) => { const w = meanW(z0, z1); return Math.hypot(w[0], w[1]); };
  // ścinanie do warstwy wzrostu gradu (−10…−30 °C): do średniego wiatru tej warstwy
  let bsHgl = NaN;
  if (Number.isFinite(zm10) && Number.isFinite(zm30)) { const w = meanW(zm10, zm30); bsHgl = Math.hypot(w[0] - UE[0], w[1] - VE[0]); }
  // ścinanie efektywne: od poziomu cząstki do połowy drogi do EL
  const ebwd = (c) => (c.cape > 0 && Number.isFinite(c.el) ? shear(Z[c.i0], 0.5 * (Z[c.i0] + c.el)) : NaN);
  const bs6 = shear(0, 6000), srh1 = srh(1000, rm), srh3 = srh(3000, rm);
  // wilgoć
  let pw = 0, flux = 0, nf = 0;
  for (let i = 0; i < n - 1; i++) {
    const rho = PR[i] / (RD * TVE[i]);
    pw += rho * QE[i] * dz;
    if (Z[i] <= 2000) { flux += rho * QE[i] * Math.hypot(UE[i], VE[i]) * 1000; nf++; }
  }
  const meanRH = (z0, z1) => { let a = 0, c = 0; for (let i = idx(z0); i <= idx(z1); i++) { a += RH[i]; c++; } return a / c; };
  // prąd zstępujący: z poziomu minimum θe w dolnych 4 km, temperatura mokrego termometru, w dół adiabatą wilgotną
  let imin = 0;
  for (let i = 0; i <= idx(4000); i++) if (THE[i] < THE[imin]) imin = i;
  let dcape = 0;
  {
    const T0 = TE[imin], p0 = PR[imin], TL = tLcl(T0, Math.min(tdew(QE[imin], p0), T0)), pL = p0 * Math.pow(TL / T0, 1 / KAP);
    let T = TL, pp = pL;
    const nw = Math.max(1, Math.ceil((p0 - pL) / 2000));
    for (let s = 0; s < nw; s++) { const p1 = pL + (p0 - pL) * (s + 1) / nw; T = moistStep(T, pp, p1); pp = p1; }
    for (let i = imin - 1; i >= 0; i--) { T = moistStep(T, PR[i + 1], PR[i]); const b = (TVE[i] - tvir(T, qsat(T, PR[i]))) / TVE[i]; if (b > 0) dcape += b * G * dz; }
  }
  // wskaźniki złożone (definicje SPC; SCP z SRH 0–3 km, jak na wykresach thundeR)
  const ebMu = ebwd(mu);
  const scp = (mu.cape / 1000) * (srh3 / 50) * (ebMu >= 10 ? Math.min(ebMu, 20) / 20 : 0);
  const stp = (ml.cape / 1500) * (srh1 / 150) * (bs6 < 12.5 ? 0 : Math.min(bs6, 30) / 20)
    * (ml.lcl < 1000 ? 1 : ml.lcl > 2000 ? 0 : (2000 - ml.lcl) / 1000) * (ml.cin > -50 ? 1 : ml.cin < -200 ? 0 : (200 + ml.cin) / 150);
  let ship = NaN;
  if (i500 >= 0 && Number.isFinite(lr75)) {
    const t500 = Math.min(TE[i500] - 273.15, -5.5);
    ship = mu.cape * Math.min(13.6, Math.max(11, mu.mixr)) * lr75 * -t500 * Math.min(27, Math.max(7, bs6)) / 42e6;
    if (mu.cape < 1300) ship *= mu.cape / 1300;
    if (lr75 < 5.8) ship *= lr75 / 5.8;
    if (z0c < 2400) ship *= z0c / 2400;
  }
  return { n, dz, Z, PR, TE, QE, UE, VE, TVE, THE, RH, idx, zm10, zm30, z0c, parcels: { sb, mu, ml },
    wmax: (c) => Math.sqrt(2 * Math.max(c.cape, 0)) * bs6, wmaxE: (c) => Math.sqrt(2 * Math.max(c.cape, 0)) * ebwd(c), ebwd,
    rm, lm, mean6,
    bs: { s1: shear(0, 1000), s3: shear(0, 3000), s6: bs6, s8: shear(0, 8000), hgl: bsHgl },
    srh: { rm: [srh(100, rm), srh(500, rm), srh1, srh3], lm: [srh(100, lm), srh(500, lm), srh(1000, lm), srh(3000, lm)] },
    mw: { s1: meanS(0, 1000), s2: meanS(0, 2000), m13: meanS(1000, 3000), s6: meanS(0, 6000) },
    lr: { s1: lapse(0, 1000), s3: lapse(0, 3000), m36: lapse(3000, 6000), lr75 },
    pw, rh25: meanRH(2000, 5000), rh02: meanRH(0, 2000), flux: nf ? flux / nf : NaN, dcape, dthe: THE[0] - THE[imin], scp, stp, ship };
}

// ---------- wykres ----------
const FONT = 'Arial, Helvetica, sans-serif';
const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : 'NA');
const PMIN = 100, PMAX = 1050, SKEW = 75.5;
const C = { iso: '#d4b48c', dry: '#efd2c8', moist: '#6fee6f', mix: '#b9b2f2', plev: '#9a9a9a', hgl: '#0a0a8c', T: '#ee1c1c', Td: '#35963c', par: '#ffa500', parF: 'rgba(255,165,0,0.16)', cin: 'rgba(255,60,60,0.22)',
  rh: '#1414ee', the: '#ff14ff', txt: '#111', grey: '#bdbdbd', srh: '#ffc2c2' };

function skewAxes(R) {
  const lp = Math.log(PMAX / PMIN);
  const f = (p) => Math.log(PMAX / p) / lp;
  const Y = (p) => R.y + R.h * (1 - f(p));
  const X = (T, p) => R.x + (T + 50 + SKEW * f(p)) / 100 * R.w;       // T [°C]
  return { Y, X };
}
const pline = (g, pts) => { g.beginPath(); pts.forEach(([x, y], n) => (n ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };

// tło skew-T (raz na rozmiar): izotermy, adiabaty, linie stosunku zmieszania, poziomy ciśnienia, osie
function skewBackground(g, R, s) {
  const { X, Y } = skewAxes(R), Ps = [];
  for (let p = PMAX; p >= PMIN; p -= 12.5) Ps.push(p);
  g.save();
  g.beginPath(); g.rect(R.x, R.y, R.w, R.h); g.clip();
  g.lineWidth = Math.max(0.6, 1.1 * s);
  g.strokeStyle = C.dry;
  for (let th = -40; th <= 170; th += 10) pline(g, Ps.map((p) => [X((th + 273.15) * Math.pow(p / 1000, KAP) - 273.15, p), Y(p)]));
  g.strokeStyle = C.iso;
  for (let t = -130; t <= 50; t += 10) pline(g, [[X(t, PMAX), Y(PMAX)], [X(t, PMIN), Y(PMIN)]]);
  g.strokeStyle = C.moist; g.setLineDash([2 * s + 1, 3 * s + 1.5]); g.lineWidth = Math.max(0.8, 1.5 * s);
  for (let tw = -10; tw <= 38; tw += 8) {
    let T = tw + 273.15, p0 = 1e5;
    const up = [[X(tw, 1000), Y(1000)]];
    for (let p = 1000 - 12.5; p >= 150; p -= 12.5) { T = moistStep(T, p0, p * 100); p0 = p * 100; up.push([X(T - 273.15, p), Y(p)]); }
    let Td = tw + 273.15; p0 = 1e5;
    const dn = [];
    for (let p = 1012.5; p <= PMAX; p += 12.5) { Td = moistStep(Td, p0, p * 100); p0 = p * 100; dn.unshift([X(Td - 273.15, p), Y(p)]); }
    pline(g, [...dn, ...up]);
  }
  g.setLineDash([]);
  g.strokeStyle = C.mix; g.lineWidth = Math.max(0.7, 1.2 * s);
  g.fillStyle = C.mix; g.font = `${Math.round(20 * s)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'bottom';
  for (const w of [1, 2, 4, 8, 16]) {
    const pts = [];
    for (let p = PMAX; p >= 560; p -= 25) pts.push([X(tdew(w / 1000, p * 100) - 273.15, p), Y(p)]);
    pline(g, pts);
    const [lx, ly] = pts[pts.length - 1];
    g.fillText(String(w), lx, ly - 2);
  }
  g.strokeStyle = C.plev; g.lineWidth = Math.max(0.7, 1 * s);
  for (const p of [200, 300, 500, 700, 850, 1000]) pline(g, [[R.x, Y(p)], [R.x + R.w, Y(p)]]);
  g.restore();
  g.strokeStyle = '#000'; g.lineWidth = Math.max(1, 1.8 * s);
  g.strokeRect(R.x, R.y, R.w, R.h);
  g.fillStyle = C.txt; g.font = `${Math.round(21 * s)}px ${FONT}`; g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const p of [100, 200, 300, 500, 700, 850, 1000]) g.fillText(String(p), R.x - 6 * s, Y(p));
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (let t = -50; t <= 50; t += 10) {
    const x = R.x + (t + 50) / 100 * R.w;
    g.beginPath(); g.moveTo(x, R.y + R.h); g.lineTo(x, R.y + R.h + 6 * s); g.stroke();
    g.fillText(String(t), x, R.y + R.h + 9 * s);
  }
  g.fillText('Temperature [°C]', R.x + R.w / 2, R.y + R.h + 34 * s);
  g.save();
  g.translate(R.x - 70 * s, R.y + R.h / 2); g.rotate(-Math.PI / 2); g.textBaseline = 'middle';
  g.fillText('Pressure [hPa]', 0, 0);
  g.restore();
}

// chorągiewka wiatru: trzon w stronę, skąd wieje (m/s → węzły; pół kreski 5, kreska 10, trójkąt 50 kt)
function barb(g, x, y, u, v, L) {
  const kt = Math.hypot(u, v) * 1.944;
  if (kt < 2.5) { g.beginPath(); g.arc(x, y, L * 0.12, 0, 2 * Math.PI); g.stroke(); return; }
  const a = Math.atan2(-v, -u), dx = Math.cos(a), dy = -Math.sin(a), px = -dy, py = dx, ex = x + dx * L, ey = y + dy * L, st = L * 0.17, wb = L * 0.42;
  g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke();
  let n = Math.round(kt / 5), pos = 0;
  while (n >= 10) {
    const bx = ex - dx * pos, by = ey - dy * pos;
    g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + px * wb - dx * st * 0.4, by + py * wb - dy * st * 0.4); g.lineTo(bx - dx * st, by - dy * st); g.fill();
    pos += st * 1.2; n -= 10;
  }
  while (n >= 2) {
    const bx = ex - dx * pos, by = ey - dy * pos;
    g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + px * wb + dx * st * 0.6, by + py * wb + dy * st * 0.6); g.stroke();
    pos += st; n -= 2;
  }
  if (n === 1) {
    if (pos === 0) pos = st;
    const bx = ex - dx * pos, by = ey - dy * pos;
    g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + px * wb * 0.55 + dx * st * 0.3, by + py * wb * 0.55 + dy * st * 0.3); g.stroke();
  }
}

const PAR_NAME = { ml: 'mixed-layer (0-500m)', sb: 'surface-based', mu: 'most-unstable' }, PAR_TAG = { ml: 'ML', sb: 'SB', mu: 'MU' };

function skewData(g, R, A, key, s, opt) {
  const { X, Y } = skewAxes(R), n = A.n, hp = (p) => p / 100, c = A.parcels[key];
  g.save();
  g.beginPath(); g.rect(R.x, R.y, R.w, R.h); g.clip();
  // warstwa wzrostu gradu: izotermy −10 i −30 °C
  g.strokeStyle = C.hgl; g.lineWidth = Math.max(0.8, 1.6 * s); g.setLineDash([5 * s + 1, 3 * s + 1]);
  for (const t of [-10, -30]) pline(g, [[X(t, PMAX), Y(PMAX)], [X(t, PMIN), Y(PMIN)]]);
  g.setLineDash([]);
  {
    const [px, py] = [X(-10, 330), Y(330)], ang = Math.atan2(Y(200) - Y(330), X(-10, 200) - X(-10, 330));
    g.save(); g.translate(px, py); g.rotate(ang); g.fillStyle = C.mix; g.font = `${Math.round(21 * s)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'bottom';
    g.fillText('Hail Growth', 0, -3 * s); g.textBaseline = 'top'; g.fillText('Layer (HGL)', 0, 3 * s); g.restore();
  }
  const i1 = (() => { for (let i = 0; i < n; i++) if (hp(A.PR[i]) < PMIN) return i; return n; })();
  // pola CAPE i CIN między temperaturą wirtualną cząstki i otoczenia
  const area = (i0, i9, col, cond) => {
    g.fillStyle = col;
    for (let i = i0; i < i9 - 1; i++) {
      if (!cond(i)) continue;
      const p0 = hp(A.PR[i]), p1 = hp(A.PR[i + 1]);
      g.beginPath();
      g.moveTo(X(A.TVE[i] - 273.15, p0), Y(p0)); g.lineTo(X(c.Tvp[i] - 273.15, p0), Y(p0));
      g.lineTo(X(c.Tvp[i + 1] - 273.15, p1), Y(p1)); g.lineTo(X(A.TVE[i + 1] - 273.15, p1), Y(p1));
      g.closePath(); g.fill();
    }
  };
  if (c.iLfc >= 0) {
    area(c.iLfc, Math.min(c.iEl + 1, i1), C.parF, (i) => c.B[i] > 0 && c.B[i + 1] > 0);
    area(c.i0, c.iLfc + 1, C.cin, (i) => c.B[i] < 0 && c.B[i + 1] < 0);
  }
  const prof = (f, i0, i9) => { const a = []; for (let i = i0; i < i9; i += 2) { const v = f(i); if (Number.isFinite(v)) a.push([X(v - 273.15, hp(A.PR[i])), Y(hp(A.PR[i]))]); } return a; };
  g.lineJoin = 'round';
  g.strokeStyle = C.par; g.lineWidth = Math.max(1, 2.2 * s);
  pline(g, prof((i) => c.Tvp[i], c.i0, i1));
  g.strokeStyle = C.T; g.lineWidth = Math.max(0.8, 1.4 * s); g.setLineDash([3 * s + 1, 3 * s + 1]);
  pline(g, prof((i) => A.TVE[i], 0, Math.min(i1, A.idx(5000))));
  g.setLineDash([]);
  g.strokeStyle = C.Td; g.lineWidth = Math.max(1.4, 4 * s);
  pline(g, prof((i) => tdew(A.QE[i], A.PR[i]), 0, i1));
  g.strokeStyle = C.T;
  pline(g, prof((i) => A.TE[i], 0, i1));
  // wysokości nad gruntem
  g.fillStyle = C.txt; g.font = `${Math.round(21 * s)}px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle';
  for (let km = 1; km <= 16; km++) {
    const i = A.idx(km * 1000);
    if (i * A.dz !== km * 1000 || i >= n) break;
    const p = hp(A.PR[i]);
    if (p < PMIN) break;
    if (R.h / 16 < 18 * s + 6 && km % 2) continue;
    g.fillText(`--- ${km} km`, R.x + 2 * s, Y(p));
  }
  g.fillText(`--- Sfc (${Math.round(opt.zg ?? 0)} m) ---`, R.x + 2 * s, Y(hp(A.PR[0])));
  // LCL i EL wybranej cząstki
  g.textAlign = 'left';
  const tag = PAR_TAG[key];
  if (c.iL >= 0) { const p = hp(A.PR[c.iL]); g.fillText(`---- ${tag} LCL`, Math.min(R.x + R.w - 130 * s, X(A.TE[c.iL] - 273.15, p) + 36 * s), Y(p)); }
  if (c.iEl >= 0) { const p = hp(A.PR[c.iEl]); if (p > PMIN) g.fillText(`---- ${tag} EL`, Math.min(R.x + R.w - 130 * s, X(A.TE[c.iEl] - 273.15, p) + 22 * s), Y(p)); }
  g.restore();
  // ramka opisu
  const bw = 296 * s, bh = 70 * s, bx = R.x + R.w - bw - 2 * s, by = R.y + 2 * s;
  g.fillStyle = '#fff'; g.fillRect(bx, by, bw, bh);
  g.strokeStyle = C.grey; g.lineWidth = 1; g.strokeRect(bx, by, bw, bh);
  g.fillStyle = C.txt; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.font = `700 ${Math.round(18 * s)}px ${FONT}`;
  const w1 = g.measureText('Storm-motion: ').width;
  g.fillText('Parcel:', bx + 12 * s, by + 24 * s); g.fillText('Storm-motion:', bx + 12 * s, by + 48 * s);
  g.font = `${Math.round(18 * s)}px ${FONT}`;
  g.fillText(PAR_NAME[key], bx + 12 * s + g.measureText('Parcel: ').width + 3 * s, by + 24 * s);
  g.fillText('Bunkers ID', bx + 12 * s + w1, by + 48 * s);
  // chorągiewki: co 1 km przy prawej krawędzi
  const bxx = R.x + R.w + 44 * s;
  g.strokeStyle = '#000'; g.fillStyle = '#000'; g.lineWidth = Math.max(0.8, 1.6 * s);
  for (let km = 0; km <= 16; km++) {
    const i = km === 0 ? 0 : A.idx(km * 1000);
    if (i >= n || (km && i * A.dz !== km * 1000)) break;
    const p = hp(A.PR[i]);
    if (p < PMIN) break;
    if (R.h / 16 < 30 * s && km % 2 && km) continue;
    barb(g, bxx, Y(p), A.UE[i], A.VE[i], 34 * s);
  }
}

// panel profilu 0–7 km (RH, θe)
function zPanel(g, R, A, arr, lo, hi, ticks, title, col, s) {
  g.fillStyle = '#fff'; g.fillRect(R.x, R.y, R.w, R.h);
  const zt = 7000, X = (v) => R.x + (v - lo) / (hi - lo) * R.w, Y = (z) => R.y + R.h * (1 - (z + 350) / (zt + 700));
  g.save();
  g.beginPath(); g.rect(R.x, R.y, R.w, R.h); g.clip();
  g.strokeStyle = col; g.lineWidth = Math.max(1.2, 3 * s); g.lineJoin = 'round';
  const pts = [];
  for (let i = 0; i <= A.idx(zt + 300) && i < A.n; i += 2) pts.push([X(arr(i)), Y(A.Z[i])]);
  pline(g, pts);
  g.restore();
  g.strokeStyle = '#000'; g.lineWidth = Math.max(1, 1.4 * s); g.strokeRect(R.x, R.y, R.w, R.h);
  g.fillStyle = C.txt; g.font = `${Math.round(20 * s)}px ${FONT}`; g.textAlign = 'right'; g.textBaseline = 'bottom';
  for (let km = 0; km <= 7; km++) {
    if (R.h < 120 && km % 2 && km !== 7) continue;       // mały panel: co 2 km
    const y = Y(km * 1000);
    g.fillText(km ? `${km} km` : 'sfc', R.x + R.w - 3 * s, y);
    g.lineWidth = Math.max(0.7, 1 * s);
    g.beginPath(); g.moveTo(R.x + R.w - 26 * s, y + 1); g.lineTo(R.x + R.w, y + 1); g.stroke();
  }
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (const t of ticks) {
    g.beginPath(); g.moveTo(X(t), R.y + R.h); g.lineTo(X(t), R.y + R.h + 5 * s); g.stroke();
    g.fillText(String(t), X(t), R.y + R.h + 7 * s);
  }
  g.font = `${Math.round(22 * s)}px ${FONT}`;
  g.fillText(title, R.x + R.w * 0.5, R.y + 7 * s);
}

// hodograf: pierścienie co 10 m/s (kropkowane co 5), odcinki 0–1 / 1–3 / 3–6 / 6–12 km, pole SRH 0–3 km, ruch burz wg Bunkersa
function hodograph(g, R, A, s) {
  g.fillStyle = '#fff'; g.fillRect(R.x, R.y, R.w, R.h);
  g.save();
  g.beginPath(); g.rect(R.x, R.y, R.w, R.h); g.clip();
  let vm = 20;
  for (let i = 0; i <= A.idx(12000) && i < A.n; i += 4) vm = Math.max(vm, Math.abs(A.UE[i]), Math.abs(A.VE[i]));
  vm = Math.max(vm, Math.abs(A.rm[0]), Math.abs(A.rm[1]), Math.abs(A.lm[0]), Math.abs(A.lm[1]));
  vm = Math.ceil(vm / 10) * 10;
  const cx = R.x + R.w / 2, cy = R.y + R.h / 2, k = 0.47 * Math.min(R.w, R.h) / vm;
  const px = (u) => cx + u * k, py = (v) => cy - v * k;
  g.lineWidth = Math.max(0.7, 1.6 * s);
  for (let r = 5; r <= vm + 20; r += 5) {
    g.strokeStyle = r % 10 ? '#cfcfcf' : '#c4c4c4';
    g.setLineDash(r % 10 ? [2 * s + 1, 3 * s + 1] : []);
    g.beginPath(); g.arc(cx, cy, r * k, 0, 2 * Math.PI); g.stroke();
  }
  g.setLineDash([]);
  g.strokeStyle = '#777'; g.lineWidth = Math.max(0.8, 2 * s);
  g.beginPath(); g.moveTo(R.x, cy); g.lineTo(R.x + R.w, cy); g.moveTo(cx, R.y); g.lineTo(cx, R.y + R.h); g.stroke();
  g.fillStyle = '#666'; g.font = `${Math.round(24 * s)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let r = 10; r <= vm + 20; r += 10) {
    const x = cx - r * k * Math.SQRT1_2, y = cy - r * k * Math.SQRT1_2;
    if (x > R.x + 14 * s && y > R.y + 10 * s) g.fillText(String(r), x, y);
  }
  // SRH 0–3 km: pole między ruchem prawej burzy a hodografem
  g.fillStyle = C.srh; g.beginPath(); g.moveTo(px(A.rm[0]), py(A.rm[1]));
  for (let i = 0; i <= A.idx(3000); i += 2) g.lineTo(px(A.UE[i]), py(A.VE[i]));
  g.closePath(); g.fill();
  // wektor ruchu burzy
  g.strokeStyle = '#a4a4a4'; g.fillStyle = '#a4a4a4'; g.lineWidth = Math.max(1.5, 5 * s);
  const mx = px(A.mean6[0]), my = py(A.mean6[1]), al = Math.atan2(my - cy, mx - cx), hl = 18 * s;
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(mx - Math.cos(al) * hl * 0.6, my - Math.sin(al) * hl * 0.6); g.stroke();
  g.beginPath(); g.moveTo(mx, my); g.lineTo(mx - hl * Math.cos(al - 0.45), my - hl * Math.sin(al - 0.45)); g.lineTo(mx - hl * Math.cos(al + 0.45), my - hl * Math.sin(al + 0.45)); g.closePath(); g.fill();
  // hodograf
  g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = Math.max(1.5, 5 * s);
  for (const [z0, z1, col] of [[0, 1000, '#ff14ff'], [1000, 3000, '#ee1414'], [3000, 6000, '#ffa500'], [6000, 12000, '#f4ee14']]) {
    const i1 = Math.min(A.idx(z1), A.n - 1);
    g.strokeStyle = col; g.beginPath();
    for (let i = A.idx(z0); i <= i1; i += 2) { const x = px(A.UE[i]), y = py(A.VE[i]); if (i === A.idx(z0)) g.moveTo(x, y); else g.lineTo(x, y); }
    g.stroke();
  }
  g.lineCap = 'butt';
  // ruch prawej i lewej burzy
  g.font = `700 ${Math.round(18 * s)}px ${FONT}`;
  for (const [w, lab, dy] of [[A.rm, 'RM', 26], [A.lm, 'LM', -26]]) {
    const x = px(w[0]), y = py(w[1]);
    g.strokeStyle = '#a8a8a8'; g.lineWidth = Math.max(0.8, 1.6 * s); g.beginPath(); g.arc(x, y, 12 * s, 0, 2 * Math.PI); g.stroke();
    g.strokeStyle = '#000'; g.lineWidth = Math.max(0.8, 2 * s); g.beginPath(); g.arc(x, y, 4 * s, 0, 2 * Math.PI); g.stroke();
    g.fillStyle = '#a8a8a8'; g.fillText(lab, x, y + dy * s);
  }
  // etykiety wysokości
  g.font = `700 ${Math.round(21 * s)}px ${FONT}`;
  for (const z of [0, 1, 3, 6, 12]) {
    const i = A.idx(z * 1000);
    if (i >= A.n) continue;
    const x = px(A.UE[i]), y = py(A.VE[i]);
    g.strokeStyle = '#fff'; g.lineWidth = 3 * s + 1; g.strokeText(String(z), x, y);
    g.fillStyle = '#000'; g.fillText(String(z), x, y);
  }
  g.restore();
  g.strokeStyle = '#000'; g.lineWidth = Math.max(1, 1.4 * s); g.strokeRect(R.x, R.y, R.w, R.h);
  g.fillStyle = '#666'; g.font = `${Math.round(24 * s)}px ${FONT}`; g.textAlign = 'right'; g.textBaseline = 'top';
  g.fillText('[m/s]', R.x + R.w - 12 * s, R.y + 14 * s);
  g.fillStyle = C.txt; g.font = `${Math.round(21 * s)}px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  const ln = (w) => `${fmt(dirOf(w[0], w[1]))} / ${fmt(Math.hypot(w[0], w[1]), 1)} m/s`;
  g.fillText(`Left-moving: ${ln(A.lm)}`, R.x + 12 * s, R.y + R.h - 76 * s);
  g.fillText(`Storm-motion: ${ln(A.mean6)}`, R.x + 12 * s, R.y + R.h - 44 * s);
  g.fillText(`Right-moving: ${ln(A.rm)}`, R.x + 12 * s, R.y + R.h - 12 * s);
}

// tabele parametrów (układ jak na wykresach thundeR)
function tables(g, R, A, s) {
  g.fillStyle = '#fff'; g.fillRect(R.x, R.y, R.w, R.h);
  g.strokeStyle = '#000'; g.lineWidth = Math.max(1, 1.4 * s);
  const x = (v) => R.x + v * s, y = (v) => R.y + v * s;
  g.strokeRect(R.x, R.y, R.w, R.h);
  const H = (x0, x1, yy) => { g.beginPath(); g.moveTo(x(x0), y(yy)); g.lineTo(x(x1), y(yy)); g.stroke(); };
  const V = (xx, y0, y1) => { g.beginPath(); g.moveTo(x(xx), y(y0)); g.lineTo(x(xx), y(y1)); g.stroke(); };
  H(0, 900, 162); V(191, 162, 501); V(504, 162, 367); V(689, 162, 367); H(191, 900, 367); V(450, 367, 501); V(754, 367, 501);
  g.textBaseline = 'middle'; g.fillStyle = C.txt;
  const f1 = `${Math.round(23 * s)}px ${FONT}`, f2 = `${Math.round(18 * s)}px ${FONT}`, f3 = `${Math.round(22 * s)}px ${FONT}`;
  const put = (t, xx, yy, al = 'left', fn = f3) => { g.font = fn; g.textAlign = al; g.fillText(t, x(xx), y(yy)); };
  const cols = [['MIXR', '[g/kg]', 67], ['CAPE', '[J/kg]', 137], ['CAPE03', '[J/kg]', 208], ['CAPEHGL', '[J/kg]', 304], ['CIN', '[J/kg]', 417], ['LI', '[K]', 483], ['LCL', '[m]', 533], ['LFC', '[m]', 600], ['EL', '[m]', 668], ['WMAXSHEAR', '[m2/s2]', 746]];
  for (const [a, b, xx] of cols) { put(a, xx, 22, 'left', f1); put(b, xx, 44, 'left', f2); }
  [['SB', 'sb', 76], ['MU', 'mu', 109], ['ML', 'ml', 142]].forEach(([n, k, yy]) => {
    const c = A.parcels[k], lcl = (v) => fmt(v);
    put(n, 20, yy);
    put(fmt(c.mixr, 1), 67, yy); put(fmt(c.cape), 137, yy); put(fmt(c.cape03), 208, yy); put(fmt(c.hgl), 304, yy); put(fmt(c.cin), 417, yy); put(fmt(c.li), 483, yy);
    put(lcl(c.lcl), 533, yy); put(lcl(c.lfc), 600, yy); put(lcl(c.el), 668, yy);
    put(`${fmt(A.wmax(c))}  (E ${fmt(A.wmaxE(c))})`, 746, yy);
  });
  // ścinanie
  put('Bulk wind shear', 176, 183, 'right', f3); put('[m/s]', 176, 204, 'right', f2);
  const ebs = [['Effec. (SB)', 'sb'], ['Effec. (MU)', 'mu'], ['Effec. (ML)', 'ml']];
  [['Sfc - 1 km', A.bs.s1], ['Sfc - 3 km', A.bs.s3], ['Sfc - 6 km', A.bs.s6], ['Sfc - 8 km', A.bs.s8], ['Sfc - HGL', A.bs.hgl], ...ebs.map(([n, k]) => [n, A.ebwd(A.parcels[k])])].forEach(([n, v], r) => {
    put(`${n}: ${fmt(v, 1)}`, 174, 233 + 35 * r, 'right');
  });
  // SRH
  put('SRH RM', 398, 183, 'right'); put('SRH LM', 492, 183, 'right'); put('[m2/s2]', 398, 204, 'right', f2); put('[m2/s2]', 492, 204, 'right', f2);
  ['Sfc - 100 m', 'Sfc - 500 m', 'Sfc - 1 km', 'Sfc - 3 km'].forEach((n, r) => {
    put(`${n}:`, 325, 234 + 35 * r, 'right'); put(fmt(A.srh.rm[r]), 333, 234 + 35 * r); put(fmt(A.srh.lm[r]), 427, 234 + 35 * r);
  });
  put('Mean wind', 675, 183, 'right'); put('[m/s]', 675, 204, 'right', f2);
  [['Sfc - 1 km', A.mw.s1], ['Sfc - 2 km', A.mw.s2], ['1 - 3 km', A.mw.m13], ['Sfc - 6 km', A.mw.s6]].forEach(([n, v], r) => put(`${n}: ${fmt(v, 1)}`, 675, 234 + 35 * r, 'right'));
  put('Lapse rate', 888, 183, 'right'); put('[K/km]', 888, 204, 'right', f2);
  [['Sfc - 1 km', A.lr.s1], ['Sfc - 3 km', A.lr.s3], ['3 - 6 km', A.lr.m36], ['500700 hPa', A.lr.lr75]].forEach(([n, v], r) => put(`${n}: ${fmt(v, 1)}`, 862, 234 + 35 * r, 'right'));
  // dolne pola
  [['Precip. water [mm]', A.pw, 0], ['2 - 5 km RH [%]', A.rh25, 0], ['Sfc - 2 km RH [%]', A.rh02, 0]].forEach(([n, v, d], r) => { put(`${n}:`, 392, 399 + 37 * r, 'right'); put(fmt(v, d), 400, 399 + 37 * r); });
  [['Moisture flux [g/s/m2]', A.flux, 0], ['4 km DCAPE [J/kg]', A.dcape, 0], ['4 km delta theta-e [K]', A.dthe, 0]].forEach(([n, v, d], r) => { put(`${n}:`, 684, 399 + 37 * r, 'right'); put(fmt(v, d), 692, 399 + 37 * r); });
  [['SHIP', A.ship, 1], ['SCP', A.scp, 1], ['STP', A.stp, 1]].forEach(([n, v, d], r) => { put(`${n}:`, 828, 399 + 37 * r, 'right'); put(fmt(v, d), 838, 399 + 37 * r); });
}

// skrócone tabele do panelu bocznego
function miniTables(g, R, A) {
  const x0 = R.x, y0 = R.y, W = R.w;
  g.fillStyle = C.txt; g.textBaseline = 'middle';
  const put = (t, xx, yy, al = 'left', bold = false) => { g.font = `${bold ? '700 ' : ''}11.5px ${FONT}`; g.textAlign = al; g.fillText(t, x0 + xx, y0 + yy); };
  const cols = [['', 8], ['CAPE', 58], ['CIN', 104], ['LI', 136], ['LCL', 180], ['LFC', 228], ['EL', 278], ['WMAXSH', W - 6]];
  cols.forEach(([t, xx]) => put(t, xx, 9, xx > 8 ? 'right' : 'left', true));
  [['SB', 'sb'], ['MU', 'mu'], ['ML', 'ml']].forEach(([n, k], r) => {
    const c = A.parcels[k], yy = 26 + 16 * r;
    put(n, 8, yy, 'left', true);
    [[fmt(c.cape), 58], [fmt(c.cin), 104], [fmt(c.li), 136], [fmt(c.lcl), 180], [fmt(c.lfc), 228], [fmt(c.el), 278], [fmt(A.wmax(c)), W - 6]].forEach(([t, xx]) => put(t, xx, yy, 'right'));
  });
  g.strokeStyle = '#000'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x0, y0 + 70); g.lineTo(x0 + W, y0 + 70); g.stroke();
  const L = [
    ['Shear 0–1 / 0–3 / 0–6 km', `${fmt(A.bs.s1, 0)} / ${fmt(A.bs.s3, 0)} / ${fmt(A.bs.s6, 0)} m/s`],
    ['SRH RM 0–1 / 0–3 km', `${fmt(A.srh.rm[2])} / ${fmt(A.srh.rm[3])} m²/s²`],
    ['Mean wind 0–1 / 0–6 km', `${fmt(A.mw.s1, 0)} / ${fmt(A.mw.s6, 0)} m/s`],
    ['Lapse 0–3 / 3–6 km, 700–500 hPa', `${fmt(A.lr.s3, 1)} / ${fmt(A.lr.m36, 1)}, ${fmt(A.lr.lr75, 1)} K/km`],
    ['Precip. water · RH 0–2 / 2–5 km', `${fmt(A.pw)} mm · ${fmt(A.rh02)} / ${fmt(A.rh25)} %`],
    ['DCAPE · Δθe (4 km)', `${fmt(A.dcape)} J/kg · ${fmt(A.dthe)} K`],
    ['SHIP · SCP · STP', `${fmt(A.ship, 1)} · ${fmt(A.scp, 1)} · ${fmt(A.stp, 1)}`],
  ];
  L.forEach(([a, b], r) => { put(a, 8, 84 + 16 * r); put(b, W - 6, 84 + 16 * r, 'right', true); });
}

const bgCache = new Map();
function cachedBackground(g, R, s, dpr, W, H, key) {
  const k = `${key}|${W}|${H}|${dpr}|${R.x}|${R.y}|${R.w}|${R.h}`;
  let c = bgCache.get(k);
  if (!c) {
    c = document.createElement('canvas');
    c.width = W; c.height = H;
    const b = c.getContext('2d');
    b.scale(dpr, dpr);
    skewBackground(b, R, s);
    if (bgCache.size > 4) bgCache.clear();
    bgCache.set(k, c);
  }
  g.drawImage(c, 0, 0, W / dpr, H / dpr);
}

// A – wynik analyzeSounding; opt: { layout: 'full' | 'compact', parcel, title, zg, credit }
export function renderSounding(cv, A, opt) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (opt.layout === 'compact') {
    const w = cv.clientWidth || 370, hSk = Math.round(w * 0.94), hH = Math.round(w * 0.5), h = 8 + hSk + 34 + hH + 6 + 186;
    if (cv.style.height !== `${h}px`) cv.style.height = `${h}px`;
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    const s = 0.47, Rs = { x: 38, y: 8, w: w - 38 - 44, h: hSk };
    cachedBackground(g, Rs, s, dpr, W, H, 'c');
    skewData(g, Rs, A, opt.parcel, s, opt);
    const y1 = Rs.y + Rs.h + 34, hh = hH;
    hodograph(g, { x: 6, y: y1, w: hh + 12, h: hh }, A, 0.42);
    const xr = hh + 26, wr = w - xr - 6, hr = Math.round((hh - 34) / 2);
    zPanel(g, { x: xr, y: y1, w: wr, h: hr }, A, (i) => A.RH[i], 0, 100, [0, 50, 100], 'RH [%]', C.rh, 0.42);
    zPanel(g, { x: xr, y: y1 + hr + 18, w: wr, h: hr }, A, (i) => A.THE[i] , 270, 370, [270, 320, 370], 'Theta-e [K]', C.the, 0.42);
    miniTables(g, { x: 0, y: y1 + hh + 6, w }, A);
    return;
  }
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  // układ w jednostkach 2000 × 1200, wpisany w okno
  const s = Math.min(w / 2000, h / 1200), ox = (w - 2000 * s) / 2, oy = (h - 1200 * s) / 2;
  const Q = (x, y, ww, hh) => ({ x: ox + x * s, y: oy + y * s, w: ww * s, h: hh * s });
  g.fillStyle = C.txt; g.font = `700 ${Math.round(40 * s)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(opt.title || '', ox + 1000 * s, oy + 46 * s);
  const Rs = Q(92, 100, 892, 1022);
  cachedBackground(g, Rs, s, dpr, W, H, 'f');
  skewData(g, Rs, A, opt.parcel, s, opt);
  zPanel(g, Q(1080, 98, 280, 229), A, (i) => A.RH[i], -5, 105, [0, 20, 40, 60, 80, 100], 'RH [%]', C.rh, s);
  zPanel(g, Q(1080, 361, 280, 229), A, (i) => A.THE[i], 240, 375, [245, 270, 295, 320, 345, 370], 'Theta-e [K]', C.the, s);
  hodograph(g, Q(1380, 98, 600, 514), A, s);
  tables(g, Q(1080, 623, 900, 501), A, s);
  g.fillStyle = C.txt; g.font = `${Math.round(22 * s)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(opt.credit || '', ox + 1530 * s, oy + 1156 * s);
}
