// jasność widoku 3D w kolejnych chwilach (co 2 min symulacji przez 30 min) – wykrywa „mruganie” chmur
import puppeteer from 'puppeteer-core';
import fs from 'fs'; import os from 'os'; import path from 'path';
const [,, query, ...files] = process.argv;
const code = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n;\n');
const browser = await puppeteer.launch({ headless: 'new', executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--disable-gpu-sandbox', '--ignore-gpu-blocklist', '--window-size=1400,900'],
  protocolTimeout: 0, userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'w3d-')) });
const page = await browser.newPage(); await page.setViewport({ width: 1400, height: 900 });
await page.goto(`http://localhost:${process.env.PORT}/` + query, { waitUntil: 'load' });
await page.waitForFunction(() => window.__sim, { timeout: 120000 });
await page.evaluate(`(async () => { const sim = window.__sim; const log = () => {}; ${code}; })()`);
await page.evaluate(() => document.querySelector('#viewSeg button[data-v="3d"]').click());
const cv = await page.$('#cxy'); const bb = await cv.boundingBox();
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.wheel({ deltaY: -500 });
const out = [];
for (let k = 0; k < 16; k++) {
  await page.evaluate(async () => { const s = window.__sim; const a = await s.run(1), b = await s.run(1); const dt = (b.simHours - a.simHours) * 3600; await s.run(Math.max(1, Math.round(120 / dt) - 2)); await s.draw(); await new Promise((r) => setTimeout(r, 300)); await s.draw(); });
  const png = await page.screenshot({ clip: bb, encoding: 'base64' });
  const br = await page.evaluate(async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, Math.floor(img.height * 0.35), img.width, Math.floor(img.height * 0.6)).data; let s = 0, w = 0;
    for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; s += l; if (l > 200) w++; } return [s / (d.length / 4), 100 * w / (d.length / 4)]; }, png);
  out.push(`${2 * k + 2}min: jasność ${br[0].toFixed(0)}, białe ${br[1].toFixed(0)}%`);
}
console.log(out.join(' | ')); await browser.close();
