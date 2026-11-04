// po lato352.js: zrzut widoku 3D (chmury) w tej samej chwili
document.querySelector('#viewSeg button[data-v="3d"]').click();
await sim.draw();
await new Promise((r) => setTimeout(r, 2500));
