// Słaby opad i pseudokowadła: co dobę o 11, 13, 15, 17, 19 (czas słoneczny) udział domeny ze słabym opadem, kto go daje i ile chmur wysokich; A/B przy tej samej pogodzie. ?seed=, ?sd=
for (let i = 0; i < 900 && !(sim.ready && sim.ready()); i++) await new Promise((r) => setTimeout(r, 1000));
const Q = new URLSearchParams(location.search);
sim.stop(); await sim.roll(+(Q.get('seed') || 1)); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
let r = await sim.run(1);
const days = +(Q.get('sd') || 30), HOURS = [11, 13, 15, 17, 19];
const stepTo = async (h) => { while (!(r.clock.hour >= h && r.clock.hour < h + 0.5)) r = await sim.run(Math.max(1, Math.round(600 / dt))); };
const tot = {}, add = (k, v) => { tot[k] = (tot[k] || 0) + v; };
let nS = 0;
const p0 = sim.sfcStats('PACC').mean;
for (let d = 0; d < days; d++) {
  for (const h of HOURS) {
    await stepTo(h);
    if (d < 2) continue;
    const g = (n) => sim.sfcGrid(n).v;
    const PR = g('PR'), CU = g('PRCU'), CA = g('CAPE'), HI = g('CLH'), LO = g('CLL'), LA = g('LWPA'), n = PR.length;
    let lt = 0, ltCu = 0, ltCu100 = 0, cuAny = 0, cuDot = 0, hi = 0, la = 0, lo = 0, pt = 0, pc = 0, sP = 0;
    const NX = sim.sfcGrid('PR').nx;
    for (let i = 0; i < n; i++) {
      const tp = PR[i] + CU[i];
      if (tp >= 0.05 && tp < 1) { lt++; if (CU[i] > 0.5 * tp) { ltCu++; if (CA[i] >= 100) ltCu100++; } }
      if (CU[i] >= 0.05) {
        cuAny++;
        // kropka: oczko z opadem schematu bez sąsiadów z opadem (4 sąsiadów)
        const y = Math.floor(i / NX), x = i - y * NX; let nb = 0;
        if (x > 0 && CU[i - 1] >= 0.05) nb++; if (x < NX - 1 && CU[i + 1] >= 0.05) nb++; if (y > 0 && CU[i - NX] >= 0.05) nb++; if (i + NX < n && CU[i + NX] >= 0.05) nb++;
        if (nb === 0) cuDot++;
      }
      hi += HI[i]; la += LA[i]; lo += LO[i]; pt += tp; pc += CU[i];
    }
    const pctf = (x) => 100 * x / n;
    add('lt', pctf(lt)); add('ltCu', pctf(ltCu)); add('ltCu100', pctf(ltCu100)); add('cu', pctf(cuAny)); add('dot', pctf(cuDot)); add('hi', hi / n); add('la', la / n); add('lo', lo / n); add('pt', pt / n); add('pc', pc / n);
    nS++;
  }
  await stepTo(21);
  r = await sim.run(Math.round(3600 * 2 / dt));
}
const pa = sim.sfcStats('PACC').mean - p0;
const m = (k) => (tot[k] / nS).toFixed(3);
log(`WYNIK dob ${days}: suma opadu ${pa.toFixed(1)} mm; slaby opad 0.05-1 mm/h ${m('lt')}% domeny, z tego ze schematu ${m('ltCu')}%, ze schematu przy CAPE>=100 ${m('ltCu100')}%; opad schematu >=0.05 mm/h ${m('cu')}% (pojedyncze oczka ${m('dot')}%); opad sr. ${m('pt')} mm/h, schematu ${m('pc')}; chmury wysokie ${m('hi')}, niskie ${m('lo')}, LWPA ${m('la')}`);
return 'ok';
