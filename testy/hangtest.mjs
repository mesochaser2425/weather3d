// Start ze strony tytułowej przy zawieszonym Open-Meteo: zapytania bez odpowiedzi (nie błąd) – czas do działającej symulacji i etapy z ekranu wczytywania, koniec
// czekania po limicie czasu; potem odpowiedzi po 45 s (sztuczne dane, nic nie wychodzi do Open-Meteo) – normy dochodzą w działającej symulacji, korekta się przelicza,
// następny start z pamięci. Użycie: PORT=5230 node hangtest.mjs
import puppeteer from 'puppeteer-core';
import fs from 'fs'; import os from 'os'; import path from 'path';
const P = process.env.PORT || 5230;
const browser = await puppeteer.launch({ headless: 'new', executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--disable-gpu-sandbox', '--ignore-gpu-blocklist', '--window-size=1500,950'], protocolTimeout: 0,
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'w3d-')) });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });
page.on('console', (m) => { const t = m.text(); if (/error|Error|ERA5/.test(t)) console.log('  PAGE:', t.slice(0, 200)); });
page.on('pageerror', (e) => console.log('  PAGEERR:', e.message, (e.stack || '').split('\n').slice(0, 3).join(' | ')));
await page.setRequestInterception(true);
let mode = 'hang', asked = [];
// sztuczna odpowiedź: po jednym dniu w miesiącu (norma: T wg sinusa + 3 K względem typowych wartości, żeby korekta wyraźnie się zmieniła)
const days = Array.from({ length: 12 }, (_, m) => `2000-${String(m + 1).padStart(2, '0')}-15`);
const fake = (url) => {
  if (url.includes('archive-api')) return { elevation: 300, daily: { time: days, temperature_2m_mean: days.map((_, m) => 12 - 13 * Math.cos(2 * Math.PI * (m - 0.5) / 12)), dew_point_2m_mean: days.map((_, m) => 7 - 10 * Math.cos(2 * Math.PI * (m - 0.5) / 12)), precipitation_sum: days.map(() => 2) } };
  const time = days.map((d) => `${d}T12:00`), n = time.length, k = (v) => Array(n).fill(v);
  return { elevation: 300, hourly: { time, temperature_2m: k(15), temperature_850hPa: k(8), temperature_700hPa: k(0), temperature_500hPa: k(-15), relative_humidity_850hPa: k(60), relative_humidity_700hPa: k(50) } };
};
page.on('request', (r) => {
  if (!/open-meteo/.test(r.url())) { r.continue(); return; }
  asked.push(r.url().includes('archive-api') ? 'archive' : 'plev');
  if (mode === 'hang') return;                  // bez odpowiedzi – jak zawieszone połączenie
  setTimeout(() => r.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(fake(r.url())) }).catch(() => {}), 45000);
});
const q = (s) => page.evaluate(s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function start(label, lat, lon) {
  await page.goto(`http://localhost:${P}/?title`, { waitUntil: 'load' });
  await page.waitForSelector('#titleScr.on');
  await q(`localStorage.setItem('w3d-title', JSON.stringify({ lat: ${lat}, lon: ${lon}, lx: 500, ly: 500, res: 100, dx: 'auto', month: 5 }))`);
  await page.goto(`http://localhost:${P}/?title`, { waitUntil: 'load' });
  await page.waitForSelector('#titleScr.on');
  await wait(600);
  const t0 = Date.now();
  await q(`document.getElementById('ttStart').click()`);
  let lastMsg = '', tl = [];
  while (await q(`document.getElementById('loadScr').classList.contains('on')`)) {
    const m = (await q(`document.getElementById('loadMsg').textContent`)).replace(/\d+ \/ \d+/, '# / #').slice(0, 60);
    if (m !== lastMsg) { tl.push(`${((Date.now() - t0) / 1000).toFixed(1)} s: ${m}`); lastMsg = m; }
    await wait(150);
    if (Date.now() - t0 > 200000) { tl.push('PRZEKROCZONO 200 s'); break; }
  }
  console.log(`${label}: symulacja po ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  for (const x of tl) console.log('   ', x);
}
const info = () => q(`document.getElementById('ccInfo').textContent`);
const loc = () => q(`[document.getElementById('location').selectedOptions[0].text, 'cont', document.getElementById('cont').value, 'hum', document.getElementById('hum').value, document.getElementById('shape').value, document.getElementById('err').textContent].join(' ')`);

await start('1. Open-Meteo zawieszone, miejsce bez pamięci (Madryt)', 40.4, -3.7);
await wait(2500);
console.log('   miejsce:', await loc());
console.log('   korekta:', await info());
console.log('   tempo:', await q(`document.getElementById('chipSpeed').textContent`), '| zapytania do Open-Meteo:', asked.join(','));
// koniec czekania po limicie czasu (60 s od zapytania)
for (let n = 0; n < 45 && (await info()).includes('downloading'); n++) await wait(1000);
console.log('   po limicie czasu:', (await info()).slice(-70), '| tempo:', await q(`document.getElementById('chipSpeed').textContent`));

asked = []; mode = 'slow';
await start('2. odpowiedzi po 6 s (sztuczne), inne miejsce (Poznań)', 52.4, 16.9);
await wait(500);
console.log('   korekta od razu:', await info());
const c1 = await q(`JSON.stringify(window.__sim.cc().nodes[0])`);
for (let n = 0; n < 45 && (await info()).includes('downloading'); n++) await wait(1000);
console.log('   korekta po nadejściu:', await info());
console.log('   węzeł przed:', c1.slice(0, 150));
console.log('   węzeł po:', (await q(`JSON.stringify(window.__sim.cc().nodes[0])`)).slice(0, 150));
console.log('   tempo:', await q(`document.getElementById('chipSpeed').textContent`));
console.log('   zapytania:', asked.join(','), '| w pamięci:', await q(`Object.keys(localStorage).filter((k) => k.startsWith('w3d-norm2')).join(', ')`));

asked = []; mode = 'hang';
await start('3. to samo miejsce drugi raz (z pamięci, Open-Meteo znów zawieszone)', 52.4, 16.9);
await wait(500);
console.log('   korekta:', await info());
console.log('   miejsce:', await loc(), '| zapytania:', asked.length);
console.log('błąd:', await q(`document.getElementById('err').textContent`));
await browser.close();
