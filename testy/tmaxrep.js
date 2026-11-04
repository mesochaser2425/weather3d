// Tmax/Tmin stacji w trybie MAX: czy ekstrema nie przechodzą na następną dobę (powtórzenia co do 0.1 K)

const st = sim.stations();
for (let n = 0; n < 4; n++) st.addAtCell(20 + 8 * n, 20 + 6 * n);
document.querySelector('[data-speed="max"]').click();
if (document.getElementById('pause').textContent.includes('Wznów')) document.getElementById('pause').click();
const days = window.__days || 12;
const t0 = performance.now();
while (true) {
  await new Promise((r) => setTimeout(r, 5000));
  const d = st.days(0) || [];
  log(`${((performance.now() - t0) / 1000).toFixed(0)} s, dób ${d.length}`);
  if (d.length >= days || performance.now() - t0 > 600000) break;
}
let rx = 0, rn = 0, tot = 0, ext = 0;
for (let n = 0; n < 4; n++) {
  const d = st.days(n);
  for (let k = 1; k < d.length; k++) { tot++; rx += d[k].Tmax.toFixed(1) === d[k - 1].Tmax.toFixed(1); rn += d[k].Tmin.toFixed(1) === d[k - 1].Tmin.toFixed(1); ext += d[k].Tmax - d[k].Tmean; }
  log(d.map((r) => `${r.Tmin.toFixed(1)}/${r.Tmean.toFixed(1)}/${r.Tmax.toFixed(1)}`).join(' '));
}
log(`powtórzenia Tmax ${rx}/${tot}, Tmin ${rn}/${tot}, Tmax−Tśr ${(ext / tot).toFixed(1)} K`);
