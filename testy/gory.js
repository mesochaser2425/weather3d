// Opad w górach (stan z linku, np. @testy/tatry1300.url): co 12 h suma opadu w przedziałach wysokości terenu, maks. suma, maks. natężenie,
// CAPE; na końcu wilgotność celu (duża skala) i domeny nad najwyższym oczkiem i nad najniższym na tych samych wysokościach n.p.m.
// Parametry: __hours (domyślnie 48)
sim.stop();
for (let n = 0; n < 600 && !(await sim.syn()).cls; n++) await new Promise((r) => setTimeout(r, 500));
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const h = sim.hgt(), B = sim.base();
const bins = [[0, 800], [800, 1200], [1200, 1600], [1600, 3000]];
const H = window.__hours || 48;
let p0 = Array.from(sim.sfcGrid('PACC').v), prMax = 0;
for (let t = 1; t <= H; t++) {
  const r = await sim.run(Math.round(3600 / dt));
  const PR = sim.sfcGrid('PR').v;
  for (const x of PR) prMax = Math.max(prMax, x);
  if (t % (window.__every || 12) === 0) {
    const P = sim.sfcGrid('PACC').v, C = sim.sfcGrid('CAPE').v;
    const s = bins.map(([lo, hi]) => { let sum = 0, n = 0; for (let k = 0; k < P.length; k++) if (h[k] >= lo && h[k] < hi) { sum += P[k] - p0[k]; n++; } return n ? (sum / n).toFixed(1) : '–'; });
    let mx = 0; for (let k = 0; k < P.length; k++) mx = Math.max(mx, P[k] - p0[k]);
    log(`${String(t).padStart(2)} h (${r.clock.hour.toFixed(0)}:00): suma okresu wg wysokości ${bins.map((x) => x.join('–')).join(' / ')} m: ${s.join(' / ')} mm | maks ${mx.toFixed(0)} mm | maks natężenie ${prMax.toFixed(0)} mm/h | CAPE śr ${(C.reduce((x, y) => x + y, 0) / C.length).toFixed(0)}`);
    p0 = Array.from(P); prMax = 0;
  }
}
// profil nad najwyższym i najniższym oczkiem (q domeny / celu na tych samych wysokościach n.p.m.)
let kh = 0, kl = 0;
h.forEach((v, k) => { if (v > h[kh]) kh = k; if (v < h[kl]) kl = k; });
const nx = sim.sfcGrid('T2').nx;
const ch = await sim.column(kh % nx + B.mg, Math.floor(kh / nx) + B.mg), cl = await sim.column(kl % nx + B.mg, Math.floor(kl / nx) + B.mg);
const rows = [];
for (let k = 0; k < ch.length; k++) {
  const z = ch[k][0];
  if (z < 1500 || z > 4500) continue;
  rows.push(`${z} m: szczyt q ${ch[k][7]}/${ch[k][8]} | dolina q ${cl[k][7]}/${cl[k][8]} g/kg (domena/cel)`);
}
log(`szczyt ${h[kh].toFixed(0)} m, dolina ${h[kl].toFixed(0)} m:\n` + rows.join('\n'));
