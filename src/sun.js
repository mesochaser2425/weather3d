// Położenie słońca: kierunek w układzie lokalnym (x = wschód, y = północ, z = pion).
// lat – szerokość geograficzna [°], doy – dzień roku (1–365), hour – lokalny czas słoneczny [h].

export function sunVector(lat, doy, hour) {
  const rad = Math.PI / 180;
  const dec = 23.44 * rad * Math.sin(2 * Math.PI * (284 + doy) / 365);   // deklinacja
  const phi = lat * rad;
  const h = (hour - 12) * 15 * rad;                                         // kąt godzinny
  const z = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h);
  const x = -Math.cos(dec) * Math.sin(h);
  const y = Math.cos(phi) * Math.sin(dec) - Math.sin(phi) * Math.cos(dec) * Math.cos(h);
  const s0 = 1361 * (1 + 0.033 * Math.cos(2 * Math.PI * doy / 365));       // stała słoneczna z odl. Ziemia–Słońce
  return { x, y, z, s0, elev: Math.asin(Math.max(-1, Math.min(1, z))) / rad };
}

export function dayOfYear(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  if (isNaN(d)) return 172;
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d - start) / 86400000) + 1;
}

export function dateFromDoy(year, doy) {
  const d = new Date(Date.UTC(year, 0, 1) + (doy - 1) * 86400000);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

// Księżyc i czas gwiazdowy (wzory przybliżone jak w suncalc / Meeus; dokładność ~0.3°) – nowy widok 3D.
// Położenie księżyca liczone względem słońca modelu (ten sam kąt godzinny co sunVector), więc faza i odległość kątowa od słońca
// są zgodne z obrazem. Zwraca kierunek (x – wschód, y – północ, z – pion) i lokalny czas gwiazdowy lst [rad] (obrót nieba).
// year, doy – data, hour – lokalny czas słoneczny [h], lon – długość geograficzna [°] (tylko czas uniwersalny).
export function moonSky(lat, year, doy, hour, lon = 19) {
  const rad = Math.PI / 180;
  const d = (Date.UTC(year, 0, 1) - Date.UTC(2000, 0, 1, 12)) / 86400000 + (doy - 1) + (hour - lon / 15) / 24;
  const e = rad * 23.4397;
  // słońce: anomalia średnia → długość ekliptyczna → rektascensja
  const M = rad * (357.5291 + 0.98560028 * d);
  const ls = M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
  const raS = Math.atan2(Math.sin(ls) * Math.cos(e), Math.cos(ls));
  // księżyc: długość i szerokość ekliptyczna → rektascensja, deklinacja
  const L = rad * (218.316 + 13.176396 * d), Mm = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.229350 * d);
  const l = L + rad * 6.289 * Math.sin(Mm), b = rad * 5.128 * Math.sin(F);
  const raM = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  const lst = raS + (hour - 12) * 15 * rad;
  const H = lst - raM, phi = lat * rad;
  return {
    x: -Math.cos(dec) * Math.sin(H),
    y: Math.cos(phi) * Math.sin(dec) - Math.sin(phi) * Math.cos(dec) * Math.cos(H),
    z: Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H),
    lst,
  };
}
