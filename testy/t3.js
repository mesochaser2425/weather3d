const pe = await import('/src/pe.js');
const ad = await navigator.gpu.requestAdapter();
const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
for (const doy of [15, 105, 196, 288]) {
  const m = await pe.PEModel.create(dev, { lat: 50, cont: 1.1, hum: 0.75, doy, seed: 2 });
  await m.spinup(10);
  for (let d = 0; d < 30; d++) { for (let s = 0; s < 48; s++) m.step(); }
  log('doy', doy, 'bias T-Teq [K] @ z=200,1200,1850,3500,5900,9100 by lat:', JSON.stringify(await window.__peBias(m, dev, pe)));
  log('   profile 50N', JSON.stringify(await window.__peDiag(m, dev, pe)));
  m.destroy();
}
