// Klimat: normy temperatury (szerokość, pora roku, kontynentalizm, wysokość) i biomy (roślinność).
// Proste przybliżenia dopasowane do znanych stacji (Warszawa, Londyn, Moskwa, równik, Arktyka).

// Gotowe lokalizacje: szerokość, kontynentalizm (0.5 oceaniczny … 2.5 skrajnie kontynentalny),
// wilgotność klimatu (0 pustynia … 1 bardzo wilgotny)
export const LOCATIONS = {
  krakow: { name: 'Kraków (temperate transitional)', lat: 50.1, lon: 19.9, cont: 1.1, hum: 0.75 },
  gdansk: { name: 'Gdańsk (Baltic coast)', lat: 54.4, lon: 18.6, cont: 0.9, hum: 0.8 },
  zakopane: { name: 'Zakopane (foot of the Tatras)', lat: 49.3, lon: 19.95, cont: 1.0, hum: 0.9 },
  london: { name: 'London (oceanic)', lat: 51.5, lon: -0.1, cont: 0.6, hum: 0.8 },
  moscow: { name: 'Moscow (continental)', lat: 55.8, lon: 37.6, cont: 1.3, hum: 0.7 },
  yakutsk: { name: 'Yakutsk (extreme continental)', lat: 62.0, lon: 129.7, cont: 2.3, hum: 0.45 },
  tromso: { name: 'Tromsø (subpolar)', lat: 69.6, lon: 18.9, cont: 0.7, hum: 0.8 },
  rome: { name: 'Rome (Mediterranean)', lat: 41.9, lon: 12.5, cont: 0.8, hum: 0.45 },
  sahara: { name: 'Sahara (hot desert)', lat: 24.0, lon: 8.0, cont: 1.4, hum: 0.05 },
  mongolia: { name: 'Mongolia (steppe)', lat: 47.9, lon: 106.9, cont: 1.9, hum: 0.3 },
  miami: { name: 'Florida (humid subtropical)', lat: 25.8, lon: -80.2, cont: 0.6, hum: 0.9 },
  amazon: { name: 'Amazonia (equatorial)', lat: -3.1, lon: -60.0, cont: 0.8, hum: 1.0 },
};

// poprawka średniej rocznej z danych (miejsce wybrane na mapie świata; 0 dla gotowych lokalizacji)
export const CLIM = { bias: 0 };

// Normy dla poziomu morza: średnia roczna, półamplituda roczna, średnia dobowa dla dnia roku
export function climate(lat, doy, cont, h = 0) {
  const a = Math.abs(lat);
  const tAnn = 28 - 0.0072 * a * a - 0.006 * h + CLIM.bias;   // −6 K/km z wysokością
  const amp = (0.5 + 0.19 * a) * cont;
  const season = Math.cos(2 * Math.PI * (doy - 20) / 365);  // +1 w środku zimy na półkuli N
  const sign = lat >= 0 ? 1 : -1;
  return { tAnn, amp, tDay: tAnn - sign * amp * season, tWarm: tAnn + amp, tCold: tAnn - amp };
}

// Typy roślinności (numeracja jak w sim.wgsl)
export const VEG = {
  GRASS: 0, DECID: 1, TAIGA: 2, TUNDRA: 3, GLACIER: 4, RAINFOREST: 5, SAVANNA: 6, DESERT: 7, STEPPE: 8,
  URBAN: 9, WATER: 10, SCLERO: 11,
};
export const VEG_NAMES = ['fields and meadows', 'deciduous / mixed forest', 'taiga (coniferous forest)', 'tundra / alpine meadow',
  'glacier / permanent snow', 'tropical forest', 'savanna', 'desert', 'steppe', 'urban area', 'water',
  'maquis / sclerophyll forest'];

// Biom w kolumnie z klimatu i wysokości. landClass: 0 otwarte (pola), 1 las, 2 zabudowa, 3 woda.
export function biome(landClass, lat, cont, hum, h, r = 0.5) {
  if (landClass === 3) return VEG.WATER;
  if (landClass === 2) return VEG.URBAN;
  const c = climate(lat, 200, cont, h);
  const forest = landClass === 1;
  if (c.tWarm < 2 || c.tAnn < -12) return VEG.GLACIER;         // wieczny śnieg (Alpy ~3 km)
  if (c.tWarm < 10) return VEG.TUNDRA;                      // powyżej górnej granicy lasu
  if (hum < 0.2) return VEG.DESERT;
  if (hum < 0.4) return forest && hum > 0.3 ? VEG.SCLERO : VEG.STEPPE;
  if (c.tAnn > 22) return forest && hum > 0.6 ? VEG.RAINFOREST : VEG.SAVANNA;
  if (c.tAnn > 15 && hum < 0.6) return forest ? VEG.SCLERO : VEG.STEPPE;
  // Las iglasty z temperatury rocznej, a przez nią z wysokości: poniżej 5.5 °C większość drzew iglasta (Zakopane ~5.9 °C, regiel górny), do 7.5 °C pas mieszany –
  // coraz więcej oczek liściastych (r – stała liczba losowa oczka). Wcześniej dopiero poniżej 3 °C: lasy wokół Tatr wychodziły liściaste
  if (forest && c.tAnn < 7.5 && (c.tAnn < 5.5 || r > (c.tAnn - 5.5) / 2)) return VEG.TAIGA;
  return forest ? VEG.DECID : VEG.GRASS;
}

// Kolory do podglądu (satelita: kolor zielony/uśpiony)
export const VEG_COLORS = [
  [[0.36, 0.48, 0.22], [0.55, 0.50, 0.36]], [[0.15, 0.32, 0.13], [0.40, 0.33, 0.25]],
  [[0.09, 0.20, 0.12], [0.10, 0.20, 0.13]], [[0.42, 0.45, 0.30], [0.50, 0.46, 0.38]],
  [[0.90, 0.92, 0.95], [0.90, 0.92, 0.95]], [[0.07, 0.26, 0.09], [0.07, 0.26, 0.09]],
  [[0.52, 0.55, 0.25], [0.72, 0.62, 0.38]], [[0.84, 0.72, 0.52], [0.84, 0.72, 0.52]],
  [[0.55, 0.58, 0.32], [0.70, 0.64, 0.45]], [[0.50, 0.48, 0.46], [0.50, 0.48, 0.46]],
  [[0.06, 0.16, 0.32], [0.06, 0.16, 0.32]], [[0.27, 0.36, 0.20], [0.35, 0.38, 0.24]],
];
