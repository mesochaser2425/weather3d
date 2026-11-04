// Sam model synoptyczny nad domeną: dobowe T ~1.5 km, wiatr i T przy gruncie przez rok. Do porównania z radiosondażami IGRA wg sektora wiatru i pory roku. Parametry: tp=data,ziarno,doby,szer,dł (domyślnie 2026-12-01,1,365,50,20). "?dx=8000&nx=40&ny=40&tp=…", MAXLOG=100000000, BLOCK_OM=1. Wiersz WND: [dzień roku, miesiąc, T 1.5 km, u, v, T przy gruncie, opad mm/d].
sim.stop();
const P = (new URLSearchParams(location.search).get('tp') || '2026-12-01,1,365,50,20').split(',');
sim.set('date', P[0]);
await sim.place(+P[3], +P[4]);
sim.stop(); await sim.roll(+P[1]); sim.stop();
const t0 = performance.now(), w = await sim.peWinds(+P[2]);
const d0 = new Date(P[0] + 'T12:00:00Z'), rows = [];
for (let d = 0; d + 4 <= w.length; d += 4) {
  const q = w.slice(d, d + 4), m = (k) => q.reduce((s, x) => s + x[k], 0) / 4;
  const dt = new Date(d0.getTime() + (d / 4) * 86400000), doy = Math.floor((dt - Date.UTC(dt.getUTCFullYear(), 0, 0)) / 86400000);
  rows.push([doy, dt.getUTCMonth() + 1, +m('t15').toFixed(2), +m('u15').toFixed(2), +m('v15').toFixed(2), +m('ts').toFixed(2), +(24 * m('pr')).toFixed(2)]);
}
log(`czas ${((performance.now() - t0) / 1000).toFixed(0)} s, ${rows.length} dób`);
log('WND ' + JSON.stringify(rows));
