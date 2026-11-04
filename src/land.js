// Pokrycie terenu: klasa w każdej kolumnie i początkowa wilgotność gleby.
// Klasy (te same co w sim.wgsl): 0 pola/łąki, 1 las, 2 zabudowa, 3 woda.
// Zróżnicowane podłoże nagrzewa się różnie – powstają cyrkulacje lokalne i linie zbieżności,
// które wyzwalają konwekcję (zamiast losowego szumu).

export const LANDUSE = {
  mosaic: 'Mosaic: fields, forests, villages, varied soil moisture',
  uniform: 'Uniform meadow',
  lake: 'Lake in the centre (lake breeze)',
  coast: 'Coast – sea on the west side (sea breeze)',
  city: 'City in the centre (urban heat island)',
};

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gładki szum periodyczny (suma kilku fal o losowych fazach), wartości ~0..1
function smoothNoise(NX, NY, rand, waves = 8, kmax = 5) {
  const comps = [];
  for (let n = 0; n < waves; n++) {
    comps.push({ kx: 1 + Math.floor(rand() * kmax), ky: 1 + Math.floor(rand() * kmax), sx: rand() < 0.5 ? 1 : -1,
      ph: rand() * 2 * Math.PI, a: 0.5 + rand() });
  }
  const out = new Float32Array(NX * NY);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      let v = 0;
      for (const c of comps) v += c.a * Math.cos(2 * Math.PI * (c.sx * c.kx * i / NX + c.ky * j / NY) + c.ph);
      out[j * NX + i] = v;
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
  }
  for (let c = 0; c < out.length; c++) out[c] = (out[c] - lo) / (hi - lo);
  return out;
}

// Zwraca { cls, w }: klasa pokrycia i wilgotność gleby (0..1) w kolumnach
export function makeLand(kind, cfg, seed, soil, heights) {
  const { NX, NY } = cfg;
  const n = NX * NY;
  const cls = new Float32Array(n), w = new Float32Array(n).fill(soil);
  const rand = rng(seed * 7919 + 13);
  const d = (a) => { const x = a - 0.5; return x - Math.round(x); };   // odległość periodyczna od środka
  if (kind === 'mosaic') {
    // las: średnia skala (wiele kęp rozłożonych równomiernie) + drobny detal; brzeg rozmyty –
    // w strefie przejściowej las losowo, z prawdopodobieństwem rosnącym w głąb kępy
    const fA = smoothNoise(NX, NY, rand, 16, 10), fB = smoothNoise(NX, NY, rand, 16, 22);
    const town = smoothNoise(NX, NY, rand, 12, 9);
    const wet = smoothNoise(NX, NY, rand, 8, 4);
    const forest = new Float32Array(n);
    for (let c = 0; c < n; c++) forest[c] = 0.7 * fA[c] + 0.3 * fB[c];
    const sorted = Float32Array.from(forest).sort();
    const f0 = sorted[Math.floor(n * 0.62)], f1 = sorted[Math.floor(n * 0.80)];   // ~30% lasu
    for (let c = 0; c < n; c++) {
      const p = Math.min(1, Math.max(0, (forest[c] - f0) / (f1 - f0)));
      cls[c] = rand() < p * p * (3 - 2 * p) ? 1 : town[c] > 0.86 ? 2 : 0;
      w[c] = Math.min(1, Math.max(0.05, soil * (0.5 + wet[c])));    // ±50% wokół średniej
    }
  } else if (kind === 'lake') {
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      if (Math.hypot(d((i + 0.5) / NX), d((j + 0.5) / NY)) < 0.2) cls[j * NX + i] = 3;
    }
  } else if (kind === 'coast') {
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      // pas morza szerokości 35% domeny, brzeg lekko falujący
      const x = (i + 0.5) / NX, y = (j + 0.5) / NY;
      if (x < 0.35 + 0.03 * Math.sin(2 * Math.PI * 2 * y)) cls[j * NX + i] = 3;
    }
  } else if (kind === 'city') {
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      if (Math.hypot(d((i + 0.5) / NX), d((j + 0.5) / NY)) < 0.15) { cls[j * NX + i] = 2; w[j * NX + i] = 0.1; }
    }
  }
  // woda tylko na nizinach (nie na zboczach gór)
  if (heights) for (let c = 0; c < n; c++) if (cls[c] === 3 && heights[c] > 50) cls[c] = 0;
  return { cls, w };
}
