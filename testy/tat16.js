// Tatry, 2.5 km, lipiec: N dób – opad domeny (średnio, maks.) vs model synoptyczny, suma na szczytach (> 1500 m)
sim.stop();
sim.set('date', '2026-07-01');
await sim.dem(49.25, 20.0, 1.0, 0.9);
sim.stop(); await sim.roll(window.__sd || 1); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const days = window.__days || 16; let pe = 0;
for (let h = 0; h < days * 24; h += 3) { await sim.run(Math.round(3 * 3600 / dt)); pe += 3 * await sim.pePr(); }
const P = sim.sfcGrid('PACC').v, H = sim.hgt(); let s = 0, mx = 0, sh = 0, nh = 0, sl = 0, nl = 0;
for (let q = 0; q < P.length; q++) { s += P[q]; mx = Math.max(mx, P[q]); if (H[q] > 1500) { sh += P[q]; nh++; } if (H[q] < 700) { sl += P[q]; nl++; } }
log(`${days} dób: domena śr. ${(s / P.length).toFixed(0)} mm, maks. ${mx.toFixed(0)} mm, szczyty > 1500 m ${(sh / Math.max(nh, 1)).toFixed(0)} mm, niziny < 700 m ${(sl / Math.max(nl, 1)).toFixed(0)} mm | model synopt. ${pe.toFixed(0)} mm`);
