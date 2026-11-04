// kalibracja schematu długofalowego (2 pasma) na profilach AFGL, warstwy modelu PE
const ZW = [0, 400, 900, 1500, 2200, 3000, 4000, 5200, 6600, 8200, 10000, 12500, 16000];
const NZ = 12, G = 9.81, RD = 287, SIG = 5.67e-8;
const ZC = ZW.slice(0, NZ).map((z, k) => 0.5 * (z + ZW[k + 1]));
const T0z = (z) => (z < 11000 ? 288.15 - 0.0065 * z : 216.65);
const p0z = (z) => (z < 11000 ? 101325 * (T0z(z) / 288.15) ** (G / (RD * 0.0065)) : 22632 * Math.exp(-G * (z - 11000) / (RD * 216.65)));
const M = ZC.map((z, k) => p0z(z) / (RD * T0z(z)) * (ZW[k + 1] - ZW[k]));
const P = ZC.map(p0z);
const prof = {
  TRO: { hr: [-2.0, -2.3, -2.4, -2.4, -2.3, -2.3, -2.3, -2.3, -2.3, -2.2, -1.8, -0.8], T: [299.7, 293.7, 287.7, 283.7, 277.0, 270.3, 263.6, 257.0, 250.3, 243.6, 237.0, 230.1, 223.6, 217.0, 210.3, 203.7, 197.0, 194.8], w: [19, 13, 9.3, 4.7, 2.2, 1.5, 0.85, 0.47, 0.25, 0.12, 0.05, 0.017, 0.006, 0.0018, 0.001, 0.00076, 0.00064, 0.00056], ref: [290, 402] },
  MLS: { hr: [-1.6, -1.8, -1.9, -2.0, -2.0, -2.1, -2.1, -2.2, -2.1, -1.8, -1.0, -0.3], T: [294.2, 289.7, 285.2, 279.2, 273.2, 267.2, 261.2, 254.7, 248.2, 241.7, 235.3, 228.8, 222.3, 216.8, 216, 216, 216, 216], w: [14, 9.3, 5.9, 3.3, 1.9, 1.0, 0.61, 0.37, 0.21, 0.12, 0.064, 0.022, 0.006, 0.0018, 0.001, 0.00076, 0.00064, 0.00056], ref: [280, 348] },
  USS: { hr: [-1.3, -1.5, -1.6, -1.7, -1.8, -1.9, -1.9, -1.8, -1.6, -1.2, -0.5, -0.2], T: [288.2, 281.7, 275.2, 268.7, 262.2, 255.7, 249.2, 242.7, 236.2, 229.7, 223.3, 216.8, 216.7, 216.7, 216.7, 216.7, 216.7, 216.7], w: [5.9, 4.2, 2.9, 1.8, 1.1, 0.64, 0.38, 0.21, 0.12, 0.046, 0.018, 0.0082, 0.0037, 0.0018, 0.0008, 0.0005, 0.0004, 0.0004], ref: [264, 283] },
  MLW: { hr: [-0.9, -1.2, -1.4, -1.6, -1.7, -1.8, -1.8, -1.7, -1.4, -0.8, -0.4, -0.2], T: [272.2, 268.7, 265.2, 261.7, 255.7, 249.7, 243.7, 237.7, 231.7, 225.7, 219.7, 219.2, 218.7, 218.2, 217.7, 217.2, 216.7, 216.2], w: [3.5, 2.5, 1.8, 1.2, 0.66, 0.38, 0.21, 0.085, 0.035, 0.016, 0.0075, 0.0069, 0.006, 0.0018, 0.001, 0.0008, 0.0006, 0.0005], ref: [234, 218] },
  SAW: { hr: [-0.3, -0.8, -1.1, -1.3, -1.4, -1.5, -1.4, -1.0, -0.6, -0.3, -0.2, -0.2], T: [257.2, 259.1, 255.9, 252.7, 247.7, 240.9, 234.1, 227.3, 220.6, 217.2, 217.2, 217.2, 217.2, 217.2, 217.2, 217.2, 216.6, 216.0], w: [1.2, 1.2, 0.94, 0.68, 0.41, 0.20, 0.098, 0.054, 0.011, 0.0084, 0.0055, 0.0038, 0.0026, 0.0018, 0.001, 0.0008, 0.0006, 0.0005], ref: [202, 167] },
};
const at = (a, z) => { const x = z / 1000, i = Math.min(Math.floor(x), a.length - 2); return a[i] + (a[i + 1] - a[i]) * (x - i); };
const atLog = (a, z) => { const x = z / 1000, i = Math.min(Math.floor(x), a.length - 2); return Math.exp(Math.log(a[i]) + (Math.log(a[i + 1]) - Math.log(a[i])) * (x - i)); };
export function lw(T, q, Ts, C) {
  // C: { co2, wv, cont, w0, fw0, fwT }
  const fw = (t) => Math.min(0.4, Math.max(0.12, C.fw0 + C.fwT * (t - 288)));
  let pm = 0; for (let k = 0; k < NZ; k++) pm += P[k] * M[k];
  let olr = 0, dlr = 0; const H = new Array(NZ).fill(0);
  for (const band of [0, 1]) {
    const tr = [], B = [];
    // ścieżki skumulowane od góry (pasmo nieprzezroczyste: prawo „silnej linii” τ ∝ u^n)
    const uT = new Array(NZ + 1).fill(0), mT = new Array(NZ + 1).fill(0);
    for (let k = NZ - 1; k >= 0; k--) { uT[k] = uT[k + 1] + M[k] * q[k] * Math.pow(P[k] / 1e5, C.pexp); mT[k] = mT[k + 1] + M[k] * P[k] / 1e5; }
    for (let k = 0; k < NZ; k++) {
      const w = M[k] * q[k], e = q[k] * P[k] / 0.622;
      const dt = band === 0 ? C.co2 * (Math.pow(mT[k] / mT[0], C.nc) - Math.pow(mT[k + 1] / mT[0], C.nc)) + C.wv * (Math.pow(uT[k], C.nw) - Math.pow(uT[k + 1], C.nw))
        : C.cont * w * e / 1000 + C.w0 * M[k] / 10200;
      tr.push(Math.exp(-1.66 * dt));
      const f = band === 0 ? 1 - fw(T[k]) : fw(T[k]);
      B.push(f * SIG * T[k] ** 4);
    }
    const fs = band === 0 ? 1 - fw(Ts) : fw(Ts);
    // temperatury na granicach warstw (liniowo między środkami; dół – ekstrapolacja, góra – izotermicznie)
    const Ti = new Array(NZ + 1);
    for (let k = 1; k < NZ; k++) Ti[k] = T[k - 1] + (T[k] - T[k - 1]) * (ZW[k] - ZC[k - 1]) / (ZC[k] - ZC[k - 1]);
    Ti[0] = T[0] + (T[0] - T[1]) * ZC[0] / (ZC[1] - ZC[0]); Ti[NZ] = T[NZ - 1];
    const Bi = Ti.map((t) => (band === 0 ? 1 - fw(t) : fw(t)) * SIG * t ** 4);
    const lin = (tr) => { const ta = Math.max(-Math.log(Math.max(tr, 1e-12)), 1e-6); return ta < 1e-3 ? 0.5 * ta : (1 - tr * (1 + ta)) / ta; };
    const Fd = new Array(NZ + 1).fill(0), Fu = new Array(NZ + 1).fill(0);
    for (let k = NZ - 1; k >= 0; k--) Fd[k] = Fd[k + 1] * tr[k] + Bi[k] * (1 - tr[k]) + (Bi[k + 1] - Bi[k]) * lin(tr[k]);
    Fu[0] = fs * SIG * Ts ** 4;
    for (let k = 0; k < NZ; k++) Fu[k + 1] = Fu[k] * tr[k] + Bi[k + 1] * (1 - tr[k]) + (Bi[k] - Bi[k + 1]) * lin(tr[k]);
    for (let k = 0; k < NZ; k++) H[k] += Fu[k] - Fu[k + 1] + Fd[k + 1] - Fd[k];
    olr += Fu[NZ]; dlr += Fd[0];
  }
  return { olr, dlr, rate: H.map((h, k) => h / (1004 * M[k]) * 86400) };
}
export function run(C, show = false) {
  let err = 0; const out = {};
  for (const [n, p] of Object.entries(prof)) {
    const T = ZC.map((z) => at(p.T, z)), q = ZC.map((z, k) => atLog(p.w, z) * 1e-3 / (P[k] / (RD * T[k])));
    const pw = q.reduce((a, x, k) => a + x * M[k], 0);
    const r = lw(T, q, p.T[0], C);
    err += (r.olr - p.ref[0]) ** 2 + (r.dlr - p.ref[1]) ** 2;
    for (let k = 0; k < NZ; k++) err += (globalThis.WHR ?? 0) * (r.rate[k] - p.hr[k]) ** 2 * M[k] / 1000;
    out[n] = `OLR ${r.olr.toFixed(0)}/${p.ref[0]} DLR ${r.dlr.toFixed(0)}/${p.ref[1]} PW ${pw.toFixed(1)} rate ${r.rate.map((x) => x.toFixed(1)).join(' ')}`;
  }
  if (show) console.log(out);
  return Math.sqrt(err / 10);
}
// przeszukiwanie (losowe + lokalne)
globalThis.WHR = Number(process.argv[2] || 30);
let best = null, bc = null;
const rnd = (a, b) => a + Math.random() * (b - a);
for (let it = 0; it < 60000; it++) {
  const C = bc && it > 20000 ? { ...bc, co2: bc.co2 * rnd(0.9, 1.1), wv: bc.wv * rnd(0.9, 1.1), nw: bc.nw * rnd(0.97, 1.03), cont: bc.cont * rnd(0.85, 1.15), fw0: bc.fw0 * rnd(0.97, 1.03), nc: bc.nc * rnd(0.95, 1.05), pexp: Math.max(0, bc.pexp + rnd(-0.05, 0.05)) }
    : { co2: rnd(0.3, 4), wv: rnd(0.2, 3), nw: rnd(0.3, 1), cont: rnd(0.002, 0.06), w0: 0.03, fw0: rnd(0.2, 0.4), fwT: 0.002, nc: rnd(0.4, 1.5), pexp: rnd(0, 1) };
  const e = run(C);
  if (!best || e < best) { best = e; bc = C; }
}
console.log('best rms', best.toFixed(1), JSON.stringify(bc)); run(bc, true);
