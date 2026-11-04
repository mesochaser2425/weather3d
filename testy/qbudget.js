// budżet pary wodnej jądro po jądrze w suchym przypadku (Kraków, lipiec, losowanie 3) – średnio przez 30 kroków
sim.stop();
sim.set('date', '2026-07-10');
await sim.dem(50.06, 19.94, 1.0, 0.75);
sim.stop(); await sim.roll(3); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
await sim.run(Math.round((window.__hh || 40) * 3600 / dt));
const seq = [['surface'], ['advect'], ['mass_sum', 'mass_scale', 'mass_apply'], ['lbc_means', 'lbc_apply'], ['turb_k', 'lap4', 'diffuse'], ['micro'], ['cumulus', 'org_update', 'cu_spread']];
const where = ['state', 'tmp', 'tmp', 'tmp', 'state', 'state', 'state'];
const acc = seq.map(() => 0);
const NS = 30;
for (let s = 0; s < NS; s++) {
  let prev = (await sim.water('state')).qv;
  for (let n = 0; n < seq.length; n++) {
    await sim.kernels(seq[n]);
    const now = (await sim.water(where[n])).qv;
    acc[n] += now - prev; prev = now;
  }
  await sim.run(1);   // pełny krok (ciśnienie, przełączenie terminów) – stan do kolejnej próbki
}
log('zmiana pary [kg/m² na krok, średnia domeny] po jądrach:\n' + seq.map((x, n) => `${x.join('+')}: ${(acc[n] / NS * 1000).toFixed(3)} g/m²`).join('\n') + `\n(krok ${dt} s)`);
