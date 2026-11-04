// Layers, „Most used”: gwiazdki (dodanie, usunięcie, trwałość), uczenie z użycia (próg 10 punktów, histereza, zanik), klawisze, czyszczenie
import puppeteer from 'puppeteer-core';
import fs from 'fs'; import os from 'os'; import path from 'path';
const P = process.env.PORT || 5230;
const browser = await puppeteer.launch({ headless: 'new', executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--disable-gpu-sandbox', '--ignore-gpu-blocklist', '--window-size=1500,950'], protocolTimeout: 0,
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'w3d-')) });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });
page.on('console', (m) => { const t = m.text(); if (/error|Error/.test(t)) console.log('PAGE:', t.slice(0, 400)); });
page.on('pageerror', (e) => console.log('PAGEERR:', e.message, (e.stack || '').split('\n').slice(0, 3).join(' | ')));
await page.setRequestInterception(true);
page.on('request', (r) => { if (/open-meteo/.test(r.url())) r.abort(); else r.continue(); });
const URL = `http://localhost:${P}/?dx=5000&nx=100&ny=100`;
const q = (s) => page.evaluate(s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const open = async () => {
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sim, { timeout: 180000 });
  await q(`window.__sim.stop()`);
  await wait(300);
  await q(`document.querySelector('#tabs button[data-tab="view"]').click()`);
  await wait(200);
};
const most = async () => { await q(`document.querySelector('#layTabs button[data-l="most"]').click()`); await wait(100); return q(`[...document.querySelectorAll('#layMostList button')].map((b) => b.textContent + (b.classList.contains('on') ? ' [ON]' : '')).join(' | ')`); };
const item = (group, start) => `[...[...document.querySelectorAll('.lygrp[data-g]')].find((g) => g.dataset.g.includes('${group}')).querySelectorAll('.lyi')].find((b) => b.textContent.startsWith('${start}'))`;
const pick = (group, start) => q(`${item(group, start)}.click()`);
const star = (group, start) => q(`${item(group, start)}.querySelector('.lystar').click()`);
const state = () => q(`[document.getElementById('fieldH').value, document.getElementById('fieldV').value, document.getElementById('zs').value, document.getElementById('xyInfo').textContent].join(' | ')`);
await open();
console.log('rozwijane elementy w Most used:', await q(`document.querySelectorAll('#layMost .lyh, #layMost details').length`));
console.log('start:', await most());
// 1. trzy oglądania to za mało
for (let n = 0; n < 3; n++) { await pick('Precipitation', 'Radar'); await wait(5400); await pick('Temperature', 'T 2 m'); await wait(200); }
console.log('po 3 oglądaniach radaru:', await most());
console.log('punkty:', await q(`localStorage.getItem('w3d-layuse')`));
// 2. gwiazdka w liście All: od razu na liście, stan gwiazdki, bez zmiany pokazywanej warstwy
await q(`document.querySelector('#layTabs button[data-l="all"]').click()`);
const before = await state();
await star('Thunderstorms', 'CAPE');
await star('850', 'T ');
console.log('gwiazdka nie zmienia mapy:', before === await state(), '| gwiazdka CAPE:', await q(`${item('Thunderstorms', 'CAPE')}.querySelector('.lystar').textContent`), '| komunikat:', await q(`document.getElementById('toast').textContent`));
console.log('po gwiazdkach CAPE i T 850:', await most());
await page.screenshot({ path: 'most4.png' });
await q(`document.querySelector('#layTabs button[data-l="all"]').click()`);
await q(`[...document.querySelectorAll('.lyh')].find((h) => h.textContent.startsWith('Thunderstorms')).click()`);
await wait(150);
await page.screenshot({ path: 'most5.png' });
// 3. klawisze: 6 – CAPE, 7 – T 850; klik wiersza
await page.keyboard.press('6'); await wait(80);
console.log('klawisz 6:', await state());
await page.keyboard.press('7'); await wait(80);
console.log('klawisz 7:', await state());
await page.keyboard.press('8'); await wait(80);
console.log('klawisz 8 (brak):', await state());
await page.keyboard.press('1'); await wait(80);
console.log('klawisz 1:', await state());
// 4. gwiazdka w Most used usuwa (także domyślną pozycję); po przeładowaniu tak samo
await most();
await q(`[...document.querySelectorAll('#layMostList button')].find((b) => b.textContent.startsWith('Satellite')).querySelector('.lystar').click()`);
console.log('bez Satellite:', await q(`[...document.querySelectorAll('#layMostList button')].map((b) => b.textContent).join(' | ')`));
await open();
console.log('po przeładowaniu:', await most());
// 5. uczenie: 9 punktów + jedno oglądanie = 10 → na liście; ☆ przy wyuczonej
await q(`localStorage.setItem('w3d-layuse', JSON.stringify({ t: Date.now(), s: { 38: 9 }, in: [] }))`);
await open();
console.log('9 punktów:', await most());
await pick('Precipitation', 'Radar'); await wait(5400); await pick('Temperature', 'T 2 m'); await wait(200);
console.log('10 punktów:', await most(), '| przycisk czyszczenia:', JSON.stringify(await q(`document.getElementById('layMostReset').style.display`)));
// 6. histereza i zanik
await q(`localStorage.setItem('w3d-layuse', JSON.stringify({ t: Date.now(), s: { 38: 6 }, in: ['38'] }))`);
await open();
console.log('wyuczona, 6 punktów (zostaje):', await most());
await q(`localStorage.setItem('w3d-layuse', JSON.stringify({ t: Date.now() - 30 * 864e5, s: { 38: 6 }, in: ['38'] }))`);
await open();
console.log('te same 6 punktów sprzed 30 dni (3 – wypada):', await most());
// 7. czyszczenie wyuczonych nie rusza gwiazdek
await q(`localStorage.setItem('w3d-layuse', JSON.stringify({ t: Date.now(), s: { 38: 12 }, in: ['38'] }))`);
await open();
console.log('wyuczona:', await most());
await q(`document.getElementById('layMostReset').click()`);
await wait(100);
console.log('po wyczyszczeniu:', await q(`[...document.querySelectorAll('#layMostList button')].map((b) => b.textContent).join(' | ')`));
console.log('błąd:', await q(`document.getElementById('err').textContent`));
await browser.close();
