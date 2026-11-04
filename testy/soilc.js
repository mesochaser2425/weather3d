sim.stop();
for (const d of ['2026-04-15', '2026-07-15', '2026-08-25']) { sim.set('date', d); await sim.roll(2); sim.stop(); await sim.run(2); log(d, 'suwak gleby', document.getElementById('soil').value, '% SM1', sim.sfcStats('SM1').mean.toFixed(2), 'W', sim.sfcStats('W').mean.toFixed(2)); }
