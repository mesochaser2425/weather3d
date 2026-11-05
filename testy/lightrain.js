// Słaby opad ze schematu: co 2 h część domeny z opadem ≥ 0.1 mm/h i część „ze schematu, słabego”; doby: opad średni, część schematu, parowanie (bez pól DBG – działa na starym i nowym kodzie)
sim.stop();
const Q = new URLSearchParams(location.search), seed = +(Q.get('sd') || 1), days = +(Q.get('days') || 3);
await sim.roll(seed); sim.stop();
const G = (n) => sim.sfcGrid(n).v;
let acc0 = null, sumAll = 0, sumLight = 0, sumCu = 0, nS = 0;
const rows = [];
let first = true;
for (let h = 2; h <= days * 24; h += 2) {
  await sim.run(first ? 119 : 120); if (first) { await sim.run(1); first = false; }
  const pr = G('PR'), pc = G('PRCUS'), n = pr.length;
  let a = 0, l = 0, s = 0, sc = 0;
  for (let k = 0; k < n; k++) {
    s += pr[k]; const c = Math.min(pc[k], pr[k]); sc += c;
    if (pr[k] >= 0.1) { a++; if (pc[k] >= 0.5 * pr[k] && pr[k] < 1) l++; }
  }
  rows.push([h, +(100 * a / n).toFixed(1), +(100 * l / n).toFixed(1), +(s / n).toFixed(3), +(sc / n).toFixed(3)]);
  sumAll += s / n; sumCu += sc / n; nS++;
  if (h % 24 === 0) {
    const p = rows.slice(-12), mx = (i) => Math.max(...p.map((r) => r[i])), av = (i) => p.reduce((x, r) => x + r[i], 0) / p.length;
    const st = sim.sfcStats('PACC'), lwp = sim.sfcStats('LWP');
    log(`doba ${h / 24}: opad>=0.1 śr ${av(1).toFixed(1)}% maks ${mx(1).toFixed(1)}% | słaby ze schematu śr ${av(2).toFixed(1)}% maks ${mx(2).toFixed(1)}% | PR śr ${(24 * av(3)).toFixed(2)} mm/d, schemat ${(24 * av(4)).toFixed(2)} | PACC śr ${st.mean.toFixed(2)} maks ${st.max.toFixed(0)} | T2 ${sim.sfcStats('T2').mean.toFixed(1)} TD2 ${sim.sfcStats('TD2').mean.toFixed(1)} COVER ${sim.sfcStats('COVER').mean.toFixed(2)}`);
  }
}
log('razem PACC śr', sim.sfcStats('PACC').mean.toFixed(2), 'mm');
