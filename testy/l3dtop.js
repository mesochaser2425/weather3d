// widok 3D z góry (przeciągnięcie kamery), do porównania z satelitą
const cv = document.getElementById('cxy'); cv.setPointerCapture = () => {}; const rc = cv.getBoundingClientRect(), x = rc.left + rc.width / 2, y = rc.top + rc.height / 2;
cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
cv.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y + 250, bubbles: true }));
cv.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y + 250, bubbles: true }));
await sim.draw();
await new Promise((r) => setTimeout(r, 2500));
