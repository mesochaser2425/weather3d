# Generator src/soilclim.js: klimatologia wody w glebie dla modelu synoptycznego – reanaliza NCEP/NCAR R1, średnie miesięczne
# 1991–2020 wilgotności objętościowej warstwy 10–200 cm (strefa korzeni; downloads.psl.noaa.gov, surface_gauss,
# soilw.10-200cm.mon.ltm.1991-2020.nc). Wypełnienie wiadra W = (θ − 0.10)/(0.40 − 0.10) (0.10 – sucha pustynia, 0.40 – najwilgotniejsze
# gleby zimą), oczko 2.5° (73 × 144, cały glob), morze – wartość najbliższego lądu. Kodowanie: bajt = round(250·W), base64.
# Użycie (Python ≤ 3.13 z h5py): python -I -X utf8 soilclim.py <plik .nc> <wyjście soilclim.js>
import sys, base64
import numpy as np
import h5py

src, out = sys.argv[1], sys.argv[2]
h = h5py.File(src, 'r')
v = h['soilw']
a = v[:].astype(np.float64) * v.attrs.get('scale_factor', 1.0) + v.attrs.get('add_offset', 0.0)
a[np.abs(a) > 1] = np.nan                                  # brak danych (morze)
glat, glon = h['lat'][:].astype(float), h['lon'][:].astype(float)
W = np.clip((a - 0.10) / 0.30, 0, 1)

lats = 90 - 2.5 * np.arange(73)                            # 90 … −90
lons = 2.5 * np.arange(144)                                # 0 … 357.5
# siatka Gaussa → 2.5°: najbliższy punkt (rozdzielczość podobna)
JJ = np.array([np.argmin(np.abs(glat - la)) for la in lats])
II = np.array([np.argmin(np.abs(((glon - lo) + 180) % 360 - 180)) for lo in lons])
G = W[:, JJ, :][:, :, II]                                  # (12, 73, 144)

# morze: wartość najbliższego lądu (rozlewanie po sąsiadach, długość okresowo)
for m in range(12):
    g = G[m]
    for _ in range(200):
        nan = np.isnan(g)
        if not nan.any(): break
        s = np.zeros_like(g); c = np.zeros_like(g)
        for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh = np.roll(g, di, axis=1)
            sh = np.roll(sh, dj, axis=0)
            if dj == 1: sh[0, :] = np.nan
            if dj == -1: sh[-1, :] = np.nan
            ok = ~np.isnan(sh)
            s[ok] += sh[ok]; c[ok] += 1
        fill = nan & (c > 0)
        g[fill] = s[fill] / c[fill]
    g[np.isnan(g)] = 0.5
    G[m] = g

b = np.round(G * 250).astype(np.uint8).tobytes()
b64 = base64.b64encode(b).decode()
js = f"""// Klimatologia wody w glebie dla modelu synoptycznego (wygenerowane: testy/soilclim.py) – reanaliza NCEP/NCAR R1, średnie
// miesięczne 1991–2020 wilgotności warstwy 10–200 cm jako wypełnienie wiadra W = (θ − 0.10)/0.30 (0 – pustynia, 1 – gleba zimą
// po roztopach), oczko 2.5° (szerokość 90 … −90°, długość 0 … 357.5°), morze – wartość najbliższego lądu.
const B64 = '{b64}';
const RAW = typeof atob === 'function' ? Uint8Array.from(atob(B64), (c) => c.charCodeAt(0)) : new Uint8Array(Buffer.from(B64, 'base64'));
const at = (m, j, i) => RAW[(m * 73 + j) * 144 + i] / 250;
// W w punkcie (lat, lon [°]) w dniu roku doy: dwuliniowo w przestrzeni, liniowo między środkami miesięcy
export function soilClim(lat, lon, doy) {{
  const x = ((((doy - 15.2) / 30.44) % 12) + 12) % 12, m0 = Math.floor(x), fm = x - m0, m1 = (m0 + 1) % 12;
  const fj = Math.min(72, Math.max(0, (90 - lat) / 2.5)), j0 = Math.min(71, Math.floor(fj)), aj = fj - j0;
  const fi = (((lon % 360) + 360) % 360) / 2.5, i0 = Math.floor(fi) % 144, i1 = (i0 + 1) % 144, ai = fi - Math.floor(fi);
  const bil = (m) => (1 - aj) * ((1 - ai) * at(m, j0, i0) + ai * at(m, j0, i1)) + aj * ((1 - ai) * at(m, j0 + 1, i0) + ai * at(m, j0 + 1, i1));
  return bil(m0) + fm * (bil(m1) - bil(m0));
}}
"""
open(out, 'w', encoding='utf-8').write(js)
print('zapisano', out, len(js), 'B; Polska 52N 19E, styczeń/lipiec:', G[0, 15, 8].round(2), G[6, 15, 8].round(2))
