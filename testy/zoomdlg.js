// okno wyboru miejsca: zoom kółkiem i przesunięcie na mapie świata, potem klik – czy wybiera właściwy punkt
document.getElementById('worldOpen').click();
await new Promise((r) => setTimeout(r, 4000));
const cv = document.getElementById('cworld'), box = cv.parentElement;
const r0 = box.getBoundingClientRect();
const at = (fx, fy) => ({ clientX: r0.left + fx * r0.width, clientY: r0.top + fy * r0.height, bubbles: true });
box.dispatchEvent(new WheelEvent('wheel', { ...at(0.55, 0.3), deltaY: -600 }));
const r1 = cv.getBoundingClientRect();
cv.dispatchEvent(new MouseEvent('click', at(0.55, 0.3)));
await new Promise((r) => setTimeout(r, 300));
log(`skala ${(r1.width / r0.width).toFixed(2)}, transform ${cv.style.transform}; wybrano: ${document.getElementById('worldInfo').textContent.slice(0, 60)}`);
