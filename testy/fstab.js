// Stabilność po zmianach (fronty, fenologia): co 6 h zakres w, T 2 m, opad, pole frontów; NaN = błąd. Na końcu czasy jąder.
// Parametry: window.__hours (domyślnie 48), __dt
sim.stop();
// scenariusz z terenem z sieci: czekaj, aż przebieg startowy zbuduje model synoptyczny
for (let n = 0; n < 600 && (window.__waitSyn !== false) && !(await sim.syn()).cls; n++) await new Promise((r) => setTimeout(r, 500));
await sim.run(1);
const dt = window.__dt || 20, hours = window.__hours || 48;
for (let h = 6; h <= hours; h += 6) {
  const r = await sim.run(Math.round(6 * 3600 / dt));
  const st = r.stats, t2 = sim.sfcStats('T2'), pr = sim.sfcStats('PR'), fr = sim.sfcStats('FRT');
  const bad = [st[0], st[1], t2.mean, pr.max].some((x) => !Number.isFinite(x));
  log(`${String(h).padStart(3)} h: w ${(-st[1]).toFixed(1)}…${st[0].toFixed(1)} m/s | T2 ${t2.min.toFixed(1)}…${t2.max.toFixed(1)} (śr. ${t2.mean.toFixed(1)}) | opad maks ${pr.max.toFixed(1)} mm/h | front ${fr.min.toFixed(2)}…${fr.max.toFixed(2)}${bad ? ' | NaN!' : ''}`);
  if (bad) break;
}
const kp = await sim.kprofile(10);
if (kp) log('czasy jąder [ms]: ' + Object.entries(kp).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(', ') + ` | suma ${Object.values(kp).reduce((a, b) => a + b, 0).toFixed(2)}`);
