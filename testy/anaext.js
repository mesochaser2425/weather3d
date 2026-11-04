// Analizy: ekstrema okresów wobec niezależnego liczenia z pól TMAX, TMIN i PACC co dobę (tuż przed północą); granica miesiąca po ~10 dobach
sim.stop();
sim.set('date', '2026-06-20'); sim.set('hour', 6);
await sim.run(1);
await new Promise((r) => setTimeout(r, 1500));
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const ND = +(new URLSearchParams(location.search).get('nd') || 14);
// od 6:00 do 23:45 pierwszej doby, potem co 24 h
await sim.run(Math.round((17.75 * 3600 - 2 * dt) / dt));
const mon = {};
let prev = null;
const t0 = performance.now();
for (let d = 0; d < ND; d++) {
  await sim.run(1);
  const tx = sim.sfcGrid('TMAX').v, tn = sim.sfcGrid('TMIN').v, pa = sim.sfcGrid('PACC').v;
  const key = d < 11 ? (d < 11 && 20 + d <= 30 ? 'Jun' : 'Jul') : 'Jul';
  const k = 20 + d <= 30 ? 'Jun' : 'Jul';
  const m = mon[k] || (mon[k] = { tX: -99, tN: 99, pD: 0, cellX: new Array(tx.length).fill(-99) });
  for (let i = 0; i < tx.length; i++) {
    m.tX = Math.max(m.tX, tx[i]); m.tN = Math.min(m.tN, tn[i]);
    m.cellX[i] = Math.max(m.cellX[i], tx[i]);
    m.pD = Math.max(m.pD, pa[i] - (prev ? prev[i] : 0));
  }
  prev = pa;
  if (d < ND - 1) await sim.run(Math.round(24 * 3600 / dt) - 1);
}
log('czas', ((performance.now() - t0) / 1000).toFixed(0), 's, modelowy zegar', JSON.stringify(sim.clockNow ? sim.clockNow() : ''));
await sim.run(Math.round(20 * 60 / dt));   // za północ
await sim.draw();
for (const p of sim.ana('m')) log(p.label, p.cur ? '(w toku)' : '', 'T', p.t?.toFixed(1), 'Tx', p.tx?.toFixed(1), 'Tn', p.tn?.toFixed(1), 'P', p.p?.toFixed(1), 'TXx', p.tX?.toFixed(2), 'TNn', p.tN?.toFixed(2), 'Rx1d', p.pD?.toFixed(1));
for (const [k, m] of Object.entries(mon)) log('niezależnie', k, 'TXx', m.tX.toFixed(2), 'TNn', m.tN.toFixed(2), 'Rx1d', m.pD.toFixed(1));
document.querySelector('#tabs button[data-tab="mon"]').click();
await new Promise((r) => setTimeout(r, 200));
[...document.querySelectorAll('#monBtns button')].find((x) => x.textContent === 'Absolute T max').click();
await sim.draw();
await new Promise((r) => setTimeout(r, 400));
await sim.draw();
log('legenda', document.getElementById('legXY').querySelector('.note').textContent.slice(0, 80), '| okres', document.getElementById('monV').textContent);
log('błąd', document.getElementById('err').textContent);
