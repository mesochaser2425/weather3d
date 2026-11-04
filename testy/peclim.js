// Klimat modelu synoptycznego w miejscu domeny: rok samego modelu od 1 I (peYear), średnie miesięczne T 2 m, T na 1.5 / 3 / 5.6 km
// (≈ 850 / 700 / 500 hPa), gradienty i opad – do porównania z danymi (Open-Meteo, poziomy ciśnienia). Wynik JSON w logu.
// Parametry: __lat/__lon (50.06, 19.94), __sd (1), __days (365).
sim.stop();
sim.set('date', '2027-01-01');
await sim.dem(window.__lat ?? 50.06, window.__lon ?? 19.94, 1.0, 0.8);
sim.stop(); await sim.roll(window.__sd || 1); sim.stop();
const y = await sim.peYear(window.__days || 365);
const md = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], out = [];
let d0 = 0;
for (let m = 0; m < 12 && d0 < y.length; m++) {
  const r = y.slice(d0, d0 + md[m]); d0 += md[m];
  const av = (k) => r.reduce((s, x) => s + x[k], 0) / r.length;
  out.push({ m: m + 1, ts: av('ts'), t15: av('t15'), t3: av('t3'), t5: av('t5'), pr: av('pr'), cloud: av('cloud') });
}
log('PECLIM ' + JSON.stringify(out));
