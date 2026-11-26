// Skąd słaby opad siatkowy (0.05–1 mm/h) w dzień: próbka kolumn z takim opadem – wierzchołek i grubość chmury, temperatura wierzchołka, woda chmurowa, lód, CAPE, duża skala (opad modelu synoptycznego ≈ front?) ?seed=, ?sd=
for (let i = 0; i < 900 && !(sim.ready && sim.ready()); i++) await new Promise((r) => setTimeout(r, 1000));
const Q = new URLSearchParams(location.search);
sim.stop(); await sim.roll(+(Q.get('seed') || 1)); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
let r = await sim.run(1);
const days = +(Q.get('sd') || 30), HOURS = [11, 13, 15, 17, 19], NS = 12;
const stepTo = async (h) => { while (!(r.clock.hour >= h && r.clock.hour < h + 0.5)) r = await sim.run(Math.max(1, Math.round(600 / dt))); };
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const cls = {}; const put = (k, x) => { const c = cls[k] ||= { n: 0, pr: 0, top: 0, ttop: 0, depth: 0, cwp: 0, iwp: 0, cape: 0, syn: 0, cul: 0 }; c.n++; for (const f in x) c[f] += x[f]; };
let nLt = 0, nAll = 0, nCu = 0;
for (let d = 0; d < days; d++) {
  for (const h of HOURS) {
    await stepTo(h);
    if (d < 2) continue;
    const G = (n) => sim.sfcGrid(n), PRg = G('PR'), PR = PRg.v, CU = G('PRCU').v, CA = G('CAPE').v, CUL = G('CUL').v, NX = PRg.nx, NY = PRg.ny, n = PR.length;
    const syn = await sim.syn();
    const list = [];
    for (let i = 0; i < n; i++) { nAll++; const tp = PR[i] + CU[i]; if (tp >= 0.05 && tp < 1) { nLt++; if (CU[i] > 0.5 * tp) nCu++; else list.push(i); } }
    for (let s = 0; s < NS && list.length; s++) {
      const g = list[Math.floor(rnd() * list.length)], jv = Math.floor(g / NX), iv = g - jv * NX;
      const col = await sim.colq(iv, jv);          // [z n.g., T °C, w, qv, qc, qi, qr, θ', Nr]
      let top = -1, base = -1, ttop = 0, cwp = 0, iwp = 0;
      for (let k = 0; k < col.length; k++) {
        const c = col[k], qc = c[4], qi = c[5];
        if (qc + qi > 0.01) { if (base < 0) base = c[0]; top = c[0]; ttop = c[1]; }
        const dz = k + 1 < col.length ? col[k + 1][0] - c[0] : 500; const rho = 1.2 * Math.exp(-c[0] / 8400);
        cwp += qc * rho * dz; iwp += qi * rho * dz;      // [g/m²]
      }
      const depth = top >= 0 ? top - base : 0;
      const k = top < 0 ? 'bez chmury nad oczkiem' : ttop > -10 && top < 3500 ? 'plytka, cieply wierzcholek (top<3.5 km, >-10 C)' : top < 6000 ? 'srednia (top 3.5-6 km)' : 'gleboka (top>6 km)';
      put(k, { pr: PR[g], top: Math.max(top, 0), ttop, depth, cwp, iwp, cape: CA[g], syn: syn.pr ? 3600 * syn.pr : 0, cul: CUL[g] });
    }
  }
  await stepTo(21);
  r = await sim.run(Math.round(3600 * 2 / dt));
}
log(`WYNIK: slaby opad w ${(100 * nLt / nAll).toFixed(2)}% oczko-terminow, z czego schemat ${(100 * nCu / nAll).toFixed(2)}%`);
for (const k in cls) { const c = cls[k], m = (f) => (c[f] / c.n).toFixed(f === 'pr' || f === 'syn' ? 2 : 0); log(`  ${k}: n ${c.n} (${(100 * c.n / Object.values(cls).reduce((s, v) => s + v.n, 0)).toFixed(0)}%) opad ${m('pr')} mm/h, wierzcholek ${m('top')} m, grubosc ${m('depth')} m, T wierzch ${m('ttop')} C, woda ${m('cwp')} g/m2, lod ${m('iwp')} g/m2, CAPE ${m('cape')}, opad modelu syn. nad srodkiem ${m('syn')} mm/h, CUL ${m('cul')}`); }
return 'ok';
