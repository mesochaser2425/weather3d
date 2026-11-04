// Model synoptyczny wystartowany zimą (1 I): czy stan początkowy jest za zimny (rozbieg). Średnie 10-dobowe T2/T850/T700/T500
// w okolicy domeny vs przybliżony klimat Krakowa. A/B: ?pegl=6.5 (dawny gradient 6.5 K/km od gruntu) vs domyślny.
const CL = { 1: [-1.8, -6.0, -13.0, -30.0], 2: [-0.6, -5.5, -12.5, -29.5], 3: [3.0, -3.0, -10.5, -27.5], 4: [8.8, 0.5, -7.0, -24.0] };
sim.stop();
sim.set('date', window.__date || '2027-01-01');
await sim.dem(49.93, 19.91, 1.0, 0.8);
const seeds = window.__seeds || [1, 2, 3], days = window.__days || 90;
const f1 = (x) => x.toFixed(1);
const sum = [];
for (const sd of seeds) {
  sim.stop(); await sim.roll(sd); sim.stop();
  const Y = await sim.peYear(days);
  const line = [];
  for (let b = 0; b < days / 10; b++) {
    const R = Y.slice(10 * b, 10 * b + 10), n = R.length, avg = (k) => R.reduce((a, r) => a + r[k], 0) / n;
    const dt = new Date(Date.UTC(2027, 0, 1 + 10 * b + 5)), c = CL[dt.getUTCMonth() + 1];
    const v = [avg('ts') - c[0], avg('t15') - c[1], avg('t3') - c[2], avg('t5') - c[3]];
    (sum[b] = sum[b] || []).push(v);
    line.push(v.map(f1).join('/'));
  }
  log(`seed ${sd}: ` + line.join(' | '));
}
log('ŚREDNIA (odchyłki T2/T850/T700/T500 w dekadach od startu):');
sum.forEach((V, b) => { const a = (i) => V.reduce((s, v) => s + v[i], 0) / V.length; log(`  doby ${10 * b + 1}-${10 * b + 10}: ${[0, 1, 2, 3].map((i) => f1(a(i))).join(' / ')}`); });
