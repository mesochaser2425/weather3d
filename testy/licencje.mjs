// public/THIRD-PARTY-LICENSES.txt: pakiety wkompilowane w gotową stronę (geotiff z zależnościami, pomocnik Vite) i ich licencje.
// Po zmianie zależności, w katalogu projektu: node testy/licencje.mjs
import fs from 'node:fs';
import path from 'node:path';
const nm = 'node_modules';
const seen = [];
function walk(n) {
  if (seen.includes(n)) return;
  seen.push(n);
  const p = JSON.parse(fs.readFileSync(path.join(nm, n, 'package.json'), 'utf8'));
  for (const d of Object.keys(p.dependencies || {})) walk(d);
}
walk('geotiff');
const SEP = `\n${'-'.repeat(78)}\n`;
let out = 'Weather3D – third-party software included in the built page\n\nThe Jura font is under the SIL Open Font License: see fonts/OFL-Jura.txt. Data sources: see README.md.\n';
for (const n of seen.sort()) {
  const dir = path.join(nm, n), p = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const f = fs.readdirSync(dir).find((x) => /^(licen[cs]e|copying)/i.test(x));
  out += `${SEP}${n} ${p.version} (${p.license})${p.homepage ? ` – ${p.homepage}` : ''}\n\n`;
  if (f) out += `${fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim()}\n`;
  else if (n === 'lerc') out += 'Copyright 2017-2021 Esri\n\nLicensed under the Apache License, Version 2.0 (see the text in the web-worker section below).\n';
  else throw new Error(`no licence file: ${n}`);
}
const v = JSON.parse(fs.readFileSync(path.join(nm, 'vite', 'package.json'), 'utf8'));
const lic = fs.readFileSync(path.join(nm, 'vite', 'LICENSE.md'), 'utf8').replace(/\r\n/g, '\n');
const cut = lic.indexOf('# Licenses of bundled dependencies');
out += `${SEP}vite ${v.version} (MIT) – module loading helper, ${v.homepage}\n\n${(cut > 0 ? lic.slice(0, cut) : lic).trim()}\n`;
fs.writeFileSync(path.join('public', 'THIRD-PARTY-LICENSES.txt'), out);
console.log(`${seen.length + 1} pakietów, ${out.length} znaków`);
