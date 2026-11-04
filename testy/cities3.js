// miasta: Polska, zoom 1 i 4 (okolice Warszawy), przejście do 3D i z powrotem
sim.stop();
await sim.dem(52.0, 19.3, 1.0, 0.9);
sim.stop();
for (let n = 0; n < 40 && !document.querySelector('.city'); n++) await new Promise((r) => setTimeout(r, 250));
const rep = (t) => { const lab = [...document.querySelectorAll('.city.lab span')].map((e) => e.firstChild.textContent);
  log(`${t}: kropek ${document.querySelectorAll('.city').length}, podpisów ${lab.length}: ${lab.join(', ')}`); };
rep('zoom 1');
sim.zoom(4, 0.6, 0.45); await new Promise((r) => setTimeout(r, 300)); rep('zoom 4 (Warszawa)');
document.querySelector('#viewSeg button[data-v="3d"]').click(); await new Promise((r) => setTimeout(r, 500));
log(`3D: kropek ${document.querySelectorAll('.city').length}, stacji ${document.querySelectorAll('.stmark').length}`);
document.querySelector('#viewSeg button[data-v="map"]').click(); await new Promise((r) => setTimeout(r, 500)); rep('powrót do mapy');
