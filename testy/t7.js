const pe = await import('/src/pe.js');
const ad = await navigator.gpu.requestAdapter();
const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
const doy = window.__doy1 || 196;
const m = await pe.PEModel.create(dev, { lat: 50, cont: 1.1, hum: 0.75, doy, seed: 2 });
const rows = [];
const rec = async (d) => {
  const mp = await m.readMap();
  const z = (f, j0, j1) => { let a = 0, n = 0; for (let j = j0; j < j1; j++) for (let i = 0; i < pe.NXP; i++) { a += f[j * pe.NXP + i]; n++; } return a / n; };
  rows.push(`d${d} 50°: T2 ${z(mp.ts, 44, 52).toFixed(1)} T850 ${z(mp.t15, 44, 52).toFixed(1)} T500 ${z(mp.t5, 44, 52).toFixed(1)} | kanał: T2 ${z(mp.ts, 0, 96).toFixed(1)} TOA ${(z(mp.asr, 0, 96) - z(mp.olr, 0, 96)).toFixed(0)} cl ${z(mp.cloud, 0, 96).toFixed(2)} pr ${(24 * z(mp.pr, 0, 96)).toFixed(1)}`);
};
await rec(0);
for (let d = 1; d <= 60; d++) { for (let s = 0; s < 48; s++) m.step(); if (d % 5 === 0) await rec(d); }
log('\n' + rows.join('\n'));
