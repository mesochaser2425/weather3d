// Bilans energii modelu synoptycznego w okolicy domeny (Tatry): N dób od daty, średnie z losowań
sim.stop();
sim.set('date', window.__date || '2026-12-15');
await sim.dem(49.25, 20.0, 1.0, 0.9);
const R = [];
for (const sd of (window.__seeds || [1, 2])) { sim.stop(); await sim.roll(sd); sim.stop(); R.push(...await sim.peYear(window.__days || 45)); }
const a = (k) => R.reduce((s, r) => s + r[k], 0) / R.length;
const f = (x) => x.toFixed(1);
log(`T2 ${f(a('ts'))} T850 ${f(a('t15'))} T700 ${f(a('t3'))} T500 ${f(a('t5'))} | opad ${f(24 * a('pr'))} mm/d | chmury ${f(100 * a('cloud'))}% | ASR ${f(a('asr'))} OLR ${f(a('olr'))} | SH ${f(a('sh'))} LH ${f(a('lh'))} | atm. promien. ${f(a('asr') - a('sws') + a('lwn') - a('olr'))}`);
