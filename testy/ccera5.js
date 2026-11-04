// Do testy/ccab.js (INITJS): normy ERA5 1991–2020 i analizy 2022–2025 dla Krakowa (tablice z main.js) jako wpisy pamięci przeglądarki dla oczka 50.00, 20.00 – test bez Open-Meteo.
try {
  localStorage.setItem('w3d-norm2-50.00,20.00', JSON.stringify({ elev: 240, T: [-2.0, -0.6, 3.2, 8.8, 13.7, 17.2, 19.1, 18.9, 14.0, 9.0, 3.9, -0.5],
    Td: [-4.7, -3.8, -1.1, 3.4, 8.7, 12.3, 14.0, 13.7, 9.9, 5.7, 1.5, -3.0], P: [1.39, 1.54, 1.67, 1.95, 2.99, 3.0, 3.38, 2.47, 2.47, 1.87, 1.55, 1.35] }));
  localStorage.setItem('w3d-plev2-50.00,20.00', JSON.stringify({ elev: 220, lap: [
    [3.9, 6.3, 6.2, 8.2, 8.4, 8.9, 8.9, 8.0, 7.0, 5.5, 3.6, 2.4],
    [11.0, 13.3, 14.1, 16.6, 17.6, 18.0, 18.7, 17.2, 15.8, 13.0, 10.9, 9.4],
    [26.6, 28.8, 30.2, 32.9, 33.6, 33.5, 33.8, 32.6, 31.4, 28.8, 26.9, 25.1]], rh: null }));
} catch { /* about:blank – bez localStorage */ }
