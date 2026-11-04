// Sprawdzenie adiabaty wilgotnej z sounding.js wobec zachowania θe (Bolton 1980) i analizy prostego profilu
import { analyzeSounding } from '../src/sounding.js';
const RD = 287.04, CP = 1005.7, EPS = 0.622, LV = 2.501e6;
const es = (T) => 611.2 * Math.exp(17.67 * (T - 273.15) / (T - 29.65));
const qsat = (T, p) => { const e = Math.min(es(T), 0.5 * p); return EPS * e / (p - 0.378 * e); };
const rate = (T, p) => { const r = qsat(T, p); return (RD * T + LV * r) / (CP + LV * LV * r * EPS / (RD * T * T)) / p; };
const step = (T, a, b) => { const d = b - a, k = rate(T, a); return T + d * rate(T + 0.5 * d * k, a + 0.5 * d); };
const the = (T, p) => { const q = qsat(T, p), r = q / (1 - q); return T * (1e5 / p) ** (0.2854 * (1 - 0.28 * r)) * Math.exp((3376 / T - 2.54) * r * (1 + 0.81 * r)); };
for (const tw of [10, 20, 25]) {
  let T = tw + 273.15, p = 1e5; const out = [];
  while (p > 2e4) { const b = p - 600; T = step(T, p, b); p = b; if (Math.abs(p - 7e4) < 300 || Math.abs(p - 5e4) < 300 || Math.abs(p - 3e4) < 300) out.push(`${(p / 100).toFixed(0)} hPa ${(T - 273.15).toFixed(1)} °C (θe ${the(T, p).toFixed(1)})`); }
  console.log(`θw ${tw} °C, θe start ${the(tw + 273.15, 1e5).toFixed(1)}: ${out.join(' · ')}`);
}
// profil testowy: T spada 6.5 K/km, wilgotno przy gruncie, wiatr rosnący; CAPE, shear, SRH
const z = [], pr = [], Ts = [], q = [], u = [], v = [];
let pp = 1e5;
for (let zz = 0; zz <= 18000; zz += 250) {
  const T = zz < 11000 ? 300 - 0.0065 * zz : 300 - 71.5;
  z.push(zz); Ts.push(T); pr.push(pp); q.push(Math.max(1e-6, 0.016 * Math.exp(-zz / 2200)));
  u.push(zz / 300); v.push(zz < 3000 ? 10 * Math.sin(zz / 3000 * Math.PI / 2) : 10);
  pp *= Math.exp(-9.81 * 250 / (287.04 * T));
}
const A = analyzeSounding({ z, p: pr, T: Ts, q, u, v });
const f = (x) => (Number.isFinite(x) ? +x.toFixed(1) : x);
for (const k of ['sb', 'mu', 'ml']) { const c = A.parcels[k]; console.log(k, 'CAPE', f(c.cape), 'CIN', f(c.cin), 'LCL', f(c.lcl), 'LFC', f(c.lfc), 'EL', f(c.el), 'LI', f(c.li), 'CAPE03', f(c.cape03), 'HGL', f(c.hgl)); }
console.log('shear 0-6', f(A.bs.s6), '(analitycznie', f(Math.hypot(6000 / 300, 10)), ') SRH 0-3 RM', f(A.srh.rm[3]), 'PW', f(A.pw), 'lapse 3-6', f(A.lr.m36), '700-500', f(A.lr.lr75), 'DCAPE', f(A.dcape));
