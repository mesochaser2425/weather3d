sim.stop();
// czekaj na pobranie terenu i restart (scenariusz z adresu ?scen=tatry)
for (let n = 0; n < 120; n++) { const h = sim.hgt(); const mx = Math.max(...h); if (mx > 1500) break; await new Promise((r) => setTimeout(r, 1000)); }
await new Promise((r) => setTimeout(r, 3000));
sim.stop();
const h = sim.hgt(); log('teren: maks', Math.max(...h).toFixed(0), 'm, średnio', (h.reduce((a, b) => a + b, 0) / h.length).toFixed(0), 'm; tryb', document.getElementById('wxMode').value, 'data', document.getElementById('date').value, 'lat/lon', document.getElementById('lat').value, document.getElementById('lon').value);
const t0 = performance.now();
for (let hr = 1; hr <= 10; hr++) {
  const r = await sim.run(180);
  const f = (n) => { const s = sim.sfcStats(n); return s ? `${s.mean.toFixed(1)}/${s.min !== undefined ? s.min.toFixed(1) + '…' : ''}${s.max.toFixed(1)}` : '-'; };
  log(`${r.clock.hour.toFixed(1)}h T2 ${f('T2')} Td ${f('TD2')} CAPE ${f('CAPE')} PR ${f('PR')} PACC ${f('PACC')} COVER ${f('COVER')}`);
}
log('czas', ((performance.now() - t0) / 1000).toFixed(0), 's');
