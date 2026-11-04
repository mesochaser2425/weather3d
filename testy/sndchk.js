// Sprawdzenie sondażu: burzowa masa powietrza, popołudnie; CAPE z nowej analizy wobec dotychczasowego soundingIndices (panel Probe) i mapy CAPE; czas analizy i rysowania
sim.stop();
sim.set('airmass', 'storm');
document.getElementById('applyAir').click();
await new Promise((r) => setTimeout(r, 300));
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
await sim.run(Math.round(7.5 * 3600 / dt));
await sim.draw();
document.querySelector('#tabs button[data-tab="atm"]').click();
await new Promise((r) => setTimeout(r, 400));
await sim.draw();
const c = document.getElementById('csnd');
log('kanwa', c.width, c.height, 'wysokość CSS', c.style.height);
const prof = document.getElementById('profInfo').textContent;
log('panel Probe:', prof.slice(0, 260));
const st = sim.sfcStats('CAPE');
log('mapa CAPE min/śr/maks', st.min.toFixed(0), st.mean.toFixed(0), st.max.toFixed(0));
const A = sim.snd();
if (A) {
  for (const k of ['sb', 'mu', 'ml']) { const p = A.parcels[k]; log(k, 'CAPE', p.cape.toFixed(0), 'CIN', p.cin.toFixed(0), 'LI', p.li.toFixed(1), 'LCL', p.lcl, 'LFC', p.lfc, 'EL', p.el, 'mixr', p.mixr.toFixed(1)); }
  log('shear', JSON.stringify(A.bs), 'SRH', JSON.stringify(A.srh), 'PW', A.pw.toFixed(1), 'DCAPE', A.dcape.toFixed(0), 'SCP', A.scp.toFixed(2), 'STP', A.stp.toFixed(2), 'SHIP', A.ship.toFixed(2));
  log('RM', A.rm.map((v) => v.toFixed(1)).join(','), 'LM', A.lm.map((v) => v.toFixed(1)).join(','), 'mean', A.mean6.map((v) => v.toFixed(1)).join(','));
}
log('czas', JSON.stringify(sim.sndTime()));
