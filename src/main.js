import { ccN, kfrOf, CFG, SFC, AIRMASSES, NPAR as NPAR_G, scaleClass, NICE_DX, RES_OPTS, planGrid, buildGrid, wgslHeader, makeSounding, dewpoint, qsat, soundingIndices, fftOk } from './grid.js';
import { SHAPES, genShape, shapeFromImage, paintBrush, deriveTerrain, heightPng } from './terrain.js';
import { LANDUSE, makeLand } from './land.js';
import { LOCATIONS, CLIM, climate, biome, VEG, VEG_NAMES } from './climate.js';
import { baseClim } from './climbase.js';
import { fetchTerrain, fetchTerrainHi, peakFine, fetchLandCover, fetchCities, cachedClimate, cachedNormals, climateOf, MONTH_DAYS, fetchNormals, worldDem, worldElev, regionDem, demColor, lonLatToTile, tileToLonLat } from './geo.js';
import { PEModel, DTQ, NXP, NYP, DXP, LXP, LYP, classifyCenter, nestNodes, sstClim } from './pe.js';
import { parVec, paramGrid, paramAt, airTz, embed } from './nesting.js';
import { sunVector, dayOfYear, dateFromDoy, moonSky } from './sun.js';
import { FIELDS, FIELDS_3D, FIELDS_MAP, LAYER_GROUPS, rangeFor, legendCss, RADAR_STEPS, ACC_STEPS, ACC_WGSL, legendTicks, niceStep } from './fields.js';
import { WXS, WX_CMAP0, WX_WGSL, WX_INDEX, wxTicks, wxColor, wxLegendCss } from './wxscales.js';
const tempColor = (t) => wxColor('temp', t);
const radarColor = (r) => wxColor('prate', r);
import { drawProfile, drawMeteogram, newView, attachView, MET_L, MET_R } from './profile.js';
import { analyzeSounding, renderSounding } from './sounding.js';
import { createStations } from './stations.js';
import { toD, fromD, unitD, nD, fm, fT, fdT, fmH, fmZ, fmDx, fmVis, rnd, isImp, setImp, onUnits } from './units.js';
import { MANIP_RAIN, MANIP_VAR, fmtT, fmtX, nearest, manipQuery, seg, segAt } from './manip.js';
import { packRun, openRun, jsonPack, jsonUnpack, stashRun, stashedRun, clearStash, resumeUrl } from './runfile.js';
import commonSrc from './shaders/common.wgsl?raw';
import simSrc from './shaders/sim.wgsl?raw';
import renderSrc from './shaders/render.wgsl?raw';
import volSrc from './shaders/vol.wgsl?raw';
import view3dSrc from './shaders/view3d.wgsl?raw';
import view3dnSrc from './shaders/view3dn.wgsl?raw';
import atmoSrc from './shaders/atmo.wgsl?raw';
import atmoLutSrc from './shaders/atmolut.wgsl?raw';

const MAX_STEPS = 128;      // maks. liczba kroków na klatkę
const SLOT = 256;           // odstęp slotów parametrów w buforze uniform (wyrównanie dynamicznego offsetu)
const WG = 256;
const CG_ITERS = (+new URLSearchParams(location.search).get('cg')) || 4;   // iteracje gradientów sprzężonych na krok (tylko z terenem; z FFT 4 wystarczą – błąd ~2e-7 1/s; test: ?cg=20)
const PARAM_BYTES = 144;
const VIEW_BYTES = 144 + 2 * 576;   // + przesunięcie wzoru cumulusów (36 kafli × vec4): wiatr warstwy cumulusów i średni 0–6 km
// zoom mapy: powiększenie s (1 = cała mapa, ≤ 16) i lewy górny róg okna widoku (x, y – ułamek domeny, y w dół)
const mz = { s: 1, x: 0, y: 0 };
const STATS_BYTES = 64;
const OMEGA = 7.292e-5;

// Gotowe scenariusze: ustawiają suwaki i restartują
// dx: siatka, na której scenariusz działa najlepiej (zmiana przeładowuje stronę)
const SCENARIOS = {
  cumulus: { dx: 250, air: 'cumulus', shape: 'flat', hills: 0, land: 'mosaic', wind: 3, wdir: 270, soil: 40, hour: 6, fieldH: 29, fieldV: 0, zt: 6 },
  breeze: { dx: 500, air: 'cumulus', shape: 'flat', hills: 0, land: 'coast', wind: 1, wdir: 90, soil: 50, hour: 6, water: 17, fieldH: 29, fieldV: 8, zt: 4 },
  storms: { dx: 1000, air: 'storm', shape: 'perlin', hills: 600, land: 'mosaic', wind: 4, wdir: 240, soil: 70, hour: 6, fieldH: 22, fieldV: 0, zt: 14 },
  // wzorzec wysokiej rozdzielczości (Bryan i in. 2003: przy 1 km burze i wypływy są niedorozdzielone; 500 m – bliżej zbieżności)
  storms500: { dx: 500, n: 160, air: 'storm', shape: 'perlin', hills: 600, land: 'mosaic', wind: 4, wdir: 240, soil: 70, hour: 6, fieldH: 22, fieldV: 0, zt: 14 },
  foehn: { dx: 1000, air: 'humid', shape: 'ridge', hills: 1800, land: 'uniform', wind: 15, wdir: 270, soil: 70, hour: 8, fieldH: 20, fieldV: 1, zt: 6 },
  valley: { dx: 500, air: 'dry', shape: 'valley', hills: 900, land: 'mosaic', wind: 1, wdir: 270, soil: 40, hour: 14, fieldH: 20, fieldV: 0, zt: 3 },
  dry: { dx: 250, air: 'dry', shape: 'flat', hills: 0, land: 'city', wind: 2, wdir: 270, soil: 10, hour: 6, fieldH: 20, fieldV: 7, zt: 4 },
  // realna symulacja: teren z DEM, pogoda z modelu synoptycznego (główny test „prawdziwej” pogody)
  tatry: { dx: 1000, n: 140, dem: { lat: 49.25, lon: 20.0, cont: 1.0, hum: 0.9 }, date: '07-15', hour: 6, fieldH: 22, fieldV: 0, zt: 12 },
};

const $ = (id) => document.getElementById(id);
const num = (id) => Number($(id).value);
const fail = (msg) => { $('loadScr').classList.remove('on'); $('err').textContent = msg; console.error(msg); };
const status = (msg) => { $('perf').textContent = msg; $('loadMsg').textContent = msg; };
window.__started = true;

async function init() {
  if (!navigator.gpu) return fail('This browser does not support WebGPU. Use a current Chrome or Edge on a computer.');
  status('looking for a graphics card…');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return fail('No graphics card with WebGPU support found.');
  const hasTS = adapter.features.has('timestamp-query');
  // limity buforów karty (domyślne 128 / 256 MB nie mieszczą stanu dużych siatek – 6 skalarów + wiatr)
  const device = await adapter.requestDevice({ requiredFeatures: hasTS ? ['timestamp-query'] : [],
    requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize } });
  device.lost.then((info) => fail('GPU device lost: ' + info.message));
  device.addEventListener('uncapturederror', (e) => fail('GPU error: ' + e.error.message));

  const { NX, NY, NZ, DT } = CFG;
  const NXY = NX * NY, N = NXY * NZ, NW = NXY * (NZ + 1);
  const T_OFF = 2 * N + NW, QV_OFF = T_OFF + N, STATE_LEN = T_OFF + 6 * N;   // θ', q_v, q_c, q_i, q_r, N_r
  const NSF = SFC.length;
  const S = Object.fromEntries(SFC.map((n, i) => [n, i]));
  const { NXV, NYV } = CFG;                  // domena liczona wprost (widoczna + niewidoczny margines)
  const { NXD, NYD, MG } = CFG;              // widoczna część i margines [oczka]
  const CFGV = { ...CFG, NX: NXV, NY: NYV };
  const L_KM = NXD * CFG.DX / 1000;          // bok widocznej mapy W–E [km]
  const LY_KM = NYD * CFG.DY / 1000;         // bok S–N [km]

  // --- UI: listy wyboru ---
  for (const [k, a] of Object.entries(AIRMASSES)) $('airmass').add(new Option(a.name, k));
  for (const [k, n] of Object.entries(SHAPES)) $('shape').add(new Option(n, k));
  for (const [k, n] of Object.entries(LANDUSE)) $('landuse').add(new Option(n, k));
  // nazwa grupy warstw: wysokość poziomu ciśnienia w jednostkach na ekranie
  const lyGrName = (n) => (isImp() ? n.replace(/~([\d,]+) m/, (_, x) => `~${(Math.round(+x.replace(',', '') * 3.28084 / 100) * 100).toLocaleString('en-US')} ft`) : n);
  const fieldOpt = (id) => `${FIELDS[id].name}${id === 29 || id === 30 ? '' : ` [${unitD(FIELDS[id].unit)}]`}`;
  for (const id of FIELDS_3D) $('fieldV').add(new Option(fieldOpt(id), id));
  const g3 = document.createElement('optgroup'); g3.label = 'Surface maps';
  for (const id of FIELDS_MAP) {
    const o = new Option(fieldOpt(id), id);
    o.hidden = id >= 80 && id <= 88;           // mapy miesięczne – wybierane w zakładce Miesiące (krótsza lista)
    g3.appendChild(o);
  }
  const g4 = document.createElement('optgroup'); g4.label = 'Horizontal section at height';
  for (const id of FIELDS_3D) g4.appendChild(new Option(fieldOpt(id), id));
  $('fieldH').append(g3, g4);
  $('fieldH').value = '20';
  $('fieldV').value = '0';

  status('compiling shaders…');
  const AIR_KEYS = ['tsfc', 'lapse', 'rhLow', 'rhHigh', 'ztrop', 'zinv', 'dinv', 'tnight'];
  const airParams = () => Object.fromEntries(AIR_KEYS.map((k) => [k, num(k)]));
  let snd = makeSounding(airParams());
  let grid = buildGrid(CFG, snd);
  const header = wgslHeader(CFG, grid);

  async function module(code, name) {
    const m = device.createShaderModule({ code, label: name });
    const info = await m.getCompilationInfo();
    const errs = info.messages.filter((x) => x.type === 'error');
    if (errs.length) throw new Error(name + ':\n' + errs.map((e) => `${e.lineNum}:${e.linePos} ${e.message}`).join('\n'));
    return m;
  }
  const simModule = await module(header + commonSrc + simSrc, 'sim');
  const renderModule = await module(header + commonSrc + ACC_WGSL + WX_WGSL + renderSrc, 'render');

  // --- Bufory ---
  const U = GPUBufferUsage;
  const buf = (size, usage, label) => device.createBuffer({ size, usage, label });
  const NPART = Math.ceil(N / WG);
  const W_MEAN = 5 * N + NPART + 8;
  const stateBuf = buf(STATE_LEN * 4, U.STORAGE | U.COPY_DST | U.COPY_SRC, 'state');
  const tmpBuf = buf(STATE_LEN * 4, U.STORAGE | U.COPY_DST | U.COPY_SRC, 'tmp');
  const W_MSC = W_MEAN + 4 * NZ + 8 * NPART;
  const W_MUV = W_MSC + 4 + 6 * CFG.MEB + 2 * NZ;      // średni wiatr na poziomach (2 · NZ), sondaż średniej domeny
  const workBuf = buf((W_MUV + 2 * NZ) * 4, U.STORAGE | U.COPY_DST | U.COPY_SRC, 'work');
  const cxBuf = buf(2 * N * 8, U.STORAGE, 'complex');
  const vgBuf = buf(grid.data.byteLength, U.STORAGE | U.COPY_DST | U.COPY_SRC, 'vgrid');
  const statsBuf = buf(STATS_BYTES, U.STORAGE | U.COPY_SRC | U.COPY_DST, 'stats');
  const sfcBuf = buf(NSF * NXY * 4, U.STORAGE | U.COPY_DST | U.COPY_SRC, 'surface');
  // sonda: kolumna w wybranym punkcie (u, v, θ', q_v, q_c, q_i, q_r po NZ poziomów + w na NZ + 1 ścianach)
  const PROBE_N = 7 * NZ + NZ + 1, PROBE_OFF = STATS_BYTES + 16 * NZ + NSF * NXY * 4;
  // stacje wyżej niż grunt modelu (szczyty): θ', q_v, u, v na dwóch poziomach wokół wysokości stacji (12 liczb na stację)
  const ST_AIR = 32, ST_AIR_OFF = PROBE_OFF + PROBE_N * 4;
  const MUV_OFF = ST_AIR_OFF + ST_AIR * 48;
  const DIAG_BYTES = MUV_OFF + 8 * NZ;
  const diagRead = buf(DIAG_BYTES, U.MAP_READ | U.COPY_DST, 'diagRead');
  const paramBuf = buf(SLOT * MAX_STEPS, U.UNIFORM | U.COPY_DST, 'params');
  const TG_SLOT = 4 * N + 15 * NXY;                // pola docelowe jednego terminu (3D: θ', q_v, u, v; 2D: u_g, v_g, p, w, geometria frontu ×8, diagnostyka ×3)
  const NF = kfrOf(grid) * NXY;                    // wyostrzenie frontów Φ (θ', q_v, u, v) na poziomach poniżej ~7 km, dwa bufory na zmianę
  const tgtBuf = buf((3 * TG_SLOT + 8 * NF) * 4, U.STORAGE | U.COPY_SRC | U.COPY_DST, 'targets');
  device.queue.writeBuffer(vgBuf, 0, grid.data);

  // --- Potoki obliczeniowe ---
  const C = GPUShaderStage.COMPUTE;
  const simLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: PARAM_BYTES } },
      { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } },
      ...[2, 3, 4, 5, 6, 7, 8].map((b) => ({ binding: b, visibility: C, buffer: { type: 'storage' } })),
    ],
  });
  const simBG = device.createBindGroup({
    layout: simLayout,
    entries: [
      { binding: 0, resource: { buffer: paramBuf, size: PARAM_BYTES } },
      ...[vgBuf, stateBuf, tmpBuf, workBuf, cxBuf, statsBuf, sfcBuf, tgtBuf].map((b, i) => ({ binding: i + 1, resource: { buffer: b } })),
    ],
  });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [simLayout] });
  const pipes = {};
  const pipe = (entryPoint) => (pipes[entryPoint] ??= device.createComputePipeline({ layout: pl, compute: { module: simModule, entryPoint } }));

  const groups = (total, wg = WG) => {
    const g = Math.ceil(total / wg);
    return g <= 65535 ? [g, 1] : [65535, Math.ceil(g / 65535)];
  };
  // Sekwencje dyspozycji jednego kroku: płaski teren (rozwiązanie dokładne) i z terenem (CG)
  const K = (e, total, wg) => ({ n: e, p: pipe(e), g: groups(total, wg) });
  const one = (e) => ({ n: e, p: pipe(e), g: [1, 1] });
  const head = [K('surface', NXY, 64), K('route', NXY, 64), K('front_phi', NF), K('advect', STATE_LEN),
    K('mass_sum', N), one('mass_scale'), K('mass_apply', 4 * N),        // korekta masy wilgoci
    ...(CFG.OPEN ? [{ n: 'lbc_means', p: pipe('lbc_means'), g: [4 * CFG.MEB + 2 * NZ, 1] }] : []), K('lbc_apply', NXY, 64),   // brzegi, duża skala
    K('turb_k', N), ...(CFG.DX > 400 ? [K('lap4', 4 * N)] : []), K('diffuse', 9 * NXY, 64), K('micro', NXY, 64),
    K('cumulus', NXY, 64), K('org_update', NXY, 64), K('cu_spread', NXY, 64),   // konwekcja parametryzowana (głęboka ≥ 2 km, płytka ≥ 0.5 km); zawsze CAPE
    K('cg_init', N)];
  // prekondycjoner (solver bez terenu): szybka transformata Fouriera w pamięci współdzielonej (linia na grupę),
  // a gdy długość linii ma czynnik pierwszy > 32 – zwykła DFT (wolniejsza)
  const FFT = fftOk(CFG) && !new URLSearchParams(location.search).has('dft');
  const lines = (e, n) => ({ n: e, p: pipe(e), g: [n, 1] });
  const precond = FFT
    ? [lines('fft_x', NY * NZ), lines('fft_y', NX * NZ), K('tridiag', NXY, 64), lines('ifft_y', NX * NZ), lines('ifft_x', NY * NZ), K('cg_rz', N)]
    : [K('dft_x', N), K('dft_y', N), K('tridiag', NXY, 64), K('idft_y', N), K('idft_z', N)];
  const seqFlat = [...head, ...precond, K('phi_add', N), K('project', T_OFF)];
  const iters = [];
  for (let it = 0; it < CG_ITERS; it++) {
    iters.push(K('cg_ap', N), one('cg_alpha'), K('cg_xr', N));
    if (it < CG_ITERS - 1) iters.push(...precond, one('cg_beta'), K('cg_p', N));
  }
  const seqTerrain = [...head, ...precond, one('cg_rz0'), K('cg_p', N), ...iters, K('project', T_OFF)];
  const statsPipe = K('stats_k', N);
  const tgtBuild = K('tgt_build', NXY, 64);
  // wiatr docelowy bez części rozbieżnej (2D na każdym poziomie)
  const tgtProj = FFT
    ? [K('tgt_div', N), lines('fft_x', NY * NZ), lines('fft_y', NX * NZ), K('tgt_lam', N), lines('ifft_y', NX * NZ), lines('ifft_xt', NY * NZ), K('tgt_proj', N)]
    : ['tgt_div', 'dft_x', 'dft_y', 'tgt_lam', 'idft_y', 'tgt_idx', 'tgt_proj'].map((e) => K(e, N));
  const initState = K('init_state', NXY, 64);
  const frontPhi = K('front_phi', NF);
  const meansPipe = { p: pipe('level_means'), g: [NZ, 1] };

  // --- Renderowanie ---
  const format = navigator.gpu.getPreferredCanvasFormat();
  const F = GPUShaderStage.FRAGMENT;
  // gęstszy teren tylko do obrazu (mapa: cieniowanie stoków, poziomice, kolory wysokości): DEMF × DEMF punktów na oczko
  // widocznej domeny, punkt ~0.5–0.6 km, najwyżej 2048 na bok; przy oczkach < ~0.9 km niepotrzebny (siatka modelu)
  const DEMF = Math.min(8, Math.max(1, Math.round(CFG.DX / 600)), Math.floor(2048 / Math.max(NXD, NYD)));
  const demHiBuf = buf(Math.max(16, DEMF >= 2 ? NXD * NYD * DEMF * DEMF * 4 : 16), U.STORAGE | U.COPY_DST, 'demHi');
  const renderLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: F, buffer: { type: 'uniform' } },
      ...[1, 2, 3, 4, 5].map((b) => ({ binding: b, visibility: F, buffer: { type: 'read-only-storage' } })),
    ],
  });
  const renderPipe = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [renderLayout] }),
    vertex: { module: renderModule, entryPoint: 'vs' },
    fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const views = [
    { canvas: $('cxy'), mode: 0 },
    { canvas: $('cxz'), mode: 1 },
  ].map((v) => {
    const ctx = v.canvas.getContext('webgpu');
    ctx.configure({ device, format, alphaMode: 'opaque' });
    const ubuf = buf(VIEW_BYTES, U.UNIFORM | U.COPY_DST, 'view');
    const bg = device.createBindGroup({
      layout: renderLayout,
      entries: [ubuf, vgBuf, stateBuf, workBuf, sfcBuf, demHiBuf].map((b, i) => ({ binding: i, resource: { buffer: b } })),
    });
    return { ...v, ctx, ubuf, bg };
  });


  // --- Widok 3D: tekstury (szum, grunt, chmury, światło) i potoki ---
  // newView – nowy widok 3D (w budowie, PLAN_WIDOK_3D.md): skala 1:1, przewyższenie tylko z suwaka
  const v3 = { on: false, yaw: -0.55, pitch: 0.38, dist: 1.0, exagMul: 1, frame: 0, drag: null, newView: false };
  // zegar pojedynczych cumulusów (widok 3D i satelita, cuGen): faza narasta z czasem symulacji, okres pokolenia Te ≥ 30 min,
  // a przy dużym tempie dłuższy (4 s rzeczywiste × tempo) – chmura żyje na ekranie ≥ ~2 s; podczas pauzy wzór stoi.
  // Przesunięcie pokoleń D (vec4 na kafel: pokolenie 0 – xy, 1 – zw) = całka z wiatru warstwy chmur (pola CWU/CWV) uśrednionego
  // na kafle ~40 km; okres ograniczony tak, żeby różnica przesunięć sąsiednich kafli w czasie życia ≤ ~80% ich odległości (bez zawijania wzoru)
  const cuc = { ph: 0, Te: 1800, rate: 0, nx: 1, ny: 1, U: new Float32Array(72), D: new Float32Array(144), U2: new Float32Array(72), D2: new Float32Array(144), N: new Float32Array(4), gen: [NaN, NaN], sfcT: null, gmax: 0 };
  const TU = GPUTextureUsage;
  const tex3 = (w, h, d, fmt, label) => device.createTexture({ size: [w, h, d], dimension: '3d', format: fmt, usage: TU.STORAGE_BINDING | TU.TEXTURE_BINDING, label });
  const noiseTex = tex3(64, 64, 64, 'rgba8unorm', 'noise');
  const densTex = device.createTexture({ size: [NXD, NYD, NZ], dimension: '3d', format: 'rgba16float', usage: TU.STORAGE_BINDING | TU.TEXTURE_BINDING | TU.COPY_SRC, label: 'dens' });
  const densPrev = device.createTexture({ size: [NXD, NYD, NZ], dimension: '3d', format: 'rgba16float', usage: TU.TEXTURE_BINDING | TU.COPY_DST, label: 'densPrev' });
  const lightTex = tex3(NXD, NYD, NZ, 'rgba16float', 'light');
  const groundTex = device.createTexture({ size: [NXD, NYD], format: 'rgba16float', usage: TU.STORAGE_BINDING | TU.TEXTURE_BINDING, label: 'ground' });
  const frzTex = device.createTexture({ size: [NXD, NYD], format: 'rgba16float', usage: TU.STORAGE_BINDING | TU.TEXTURE_BINDING, label: 'frz' });
  const volModule = await module(header + commonSrc + volSrc, 'vol');
  const v3Module = await module(header + commonSrc + view3dSrc, 'view3d');
  const v3nModule = await module(header + commonSrc + atmoSrc + view3dnSrc, 'view3dn');
  const atmModule = await module(header + commonSrc + atmoSrc + atmoLutSrc, 'atmolut');
  const volP = buf(32, U.UNIFORM | U.COPY_DST, 'volP');
  const v3U = buf(160 + 2 * 576, U.UNIFORM | U.COPY_DST, 'v3U');
  const sClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
  const sRep = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' });
  const cpipe = (entry) => device.createComputePipeline({ layout: 'auto', compute: { module: volModule, entryPoint: entry } });
  const pNoise = cpipe('noise_gen'), pGround = cpipe('ground_build'), pVol = cpipe('vol_build'), pLight = cpipe('vol_light');
  const bgOf = (p, entries) => device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: entries.map(([b, r]) => ({ binding: b, resource: r })) });
  const bNoise = bgOf(pNoise, [[4, noiseTex.createView()]]);
  const bGround = bgOf(pGround, [[1, { buffer: vgBuf }], [2, { buffer: stateBuf }], [3, { buffer: sfcBuf }], [5, groundTex.createView()], [11, frzTex.createView()]]);
  const bVol = bgOf(pVol, [[0, { buffer: volP }], [1, { buffer: vgBuf }], [2, { buffer: stateBuf }], [3, { buffer: sfcBuf }], [6, densTex.createView()], [7, densPrev.createView()]]);
  const bLight = bgOf(pLight, [[0, { buffer: volP }], [1, { buffer: vgBuf }], [2, { buffer: stateBuf }], [7, densTex.createView()], [8, groundTex.createView()], [9, sClamp], [10, lightTex.createView()]]);
  const p3 = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: v3Module, entryPoint: 'vs' },
    fragment: { module: v3Module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const b3 = bgOf(p3, [[0, { buffer: v3U }], [1, densTex.createView()], [2, lightTex.createView()], [3, groundTex.createView()],
    [4, noiseTex.createView()], [5, sClamp], [6, sRep], [7, frzTex.createView()]]);
  // nowy widok 3D: atmosfera – profil średni domeny (zmętnienie, chmury, albedo podłoża) i tablice nieba (przepuszczalność,
  // rozpraszanie wielokrotne, oświetlenie przez niebo); własny uniform (światła w układzie kamery, gwiazdy)
  const tex2 = (w, h, label) => device.createTexture({ size: [w, h], format: 'rgba16float', usage: TU.STORAGE_BINDING | TU.TEXTURE_BINDING | TU.COPY_SRC, label });
  const transTex = tex2(256, 64, 'atmTrans'), msTex = tex2(32, 32, 'atmMS'), irrTex = tex2(32, 32, 'atmIrr');
  const profBuf = buf((NZ + 2) * 16, U.STORAGE | U.COPY_SRC, 'atmProf');
  const v3nU = buf(1392, U.UNIFORM | U.COPY_DST, 'v3nU');
  const expoBuf = buf(32, U.STORAGE | U.COPY_SRC, 'atmExpo');
  const apipe = (entry) => device.createComputePipeline({ layout: 'auto', compute: { module: atmModule, entryPoint: entry } });
  const pStats = apipe('atm_stats'), pTrans = apipe('atm_trans'), pMS = apipe('atm_ms'), pIrr = apipe('atm_irr'), pExpo = apipe('atm_expo');
  const bStats = bgOf(pStats, [[30, { buffer: profBuf }], [34, lightTex.createView()], [35, groundTex.createView()], [36, { buffer: vgBuf }]]);
  const bTrans = bgOf(pTrans, [[23, { buffer: profBuf }], [31, transTex.createView()]]);
  const bMS = bgOf(pMS, [[20, transTex.createView()], [23, { buffer: profBuf }], [24, sClamp], [32, msTex.createView()]]);
  const bIrr = bgOf(pIrr, [[20, transTex.createView()], [21, msTex.createView()], [23, { buffer: profBuf }], [24, sClamp], [33, irrTex.createView()]]);
  // obraz HDR (rgba16float, × ekspozycja) → ekspozycja ze średniej jasności (atm_expo) → obraz końcowy (fs_post)
  const p3n = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: v3nModule, entryPoint: 'vs' },
    fragment: { module: v3nModule, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
    primitive: { topology: 'triangle-list' },
  });
  const pPost = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: v3nModule, entryPoint: 'vs' },
    fragment: { module: v3nModule, entryPoint: 'fs_post', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  let hdr = null;
  const hdrOf = (w, h) => {
    if (hdr && hdr.w === w && hdr.h === h) return hdr;
    if (hdr) hdr.tex.destroy();
    const tex = device.createTexture({ size: [w, h], format: 'rgba16float', usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, label: 'hdr3d' });
    hdr = { w, h, tex, view: tex.createView() };
    hdr.bExpo = bgOf(pExpo, [[40, hdr.view], [41, { buffer: expoBuf }]]);
    hdr.bPost = bgOf(pPost, [[0, { buffer: v3nU }], [40, hdr.view], [41, { buffer: expoBuf }]]);
    return hdr;
  };
  const b3n = bgOf(p3n, [[0, { buffer: v3nU }], [1, densTex.createView()], [2, lightTex.createView()], [3, groundTex.createView()],
    [4, noiseTex.createView()], [5, sClamp], [6, sRep], [7, frzTex.createView()],
    [20, transTex.createView()], [21, msTex.createView()], [22, irrTex.createView()], [23, { buffer: profBuf }], [24, sClamp], [41, { buffer: expoBuf }]]);
  {
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pNoise); pass.setBindGroup(0, bNoise); pass.dispatchWorkgroups(16, 16, 16);
    pass.end();
    device.queue.submit([enc.finish()]);
  }

  // --- Pomiar czasu GPU ---
  // widok 3D: tekstury (dwa przebiegi obliczeniowe) i obraz (przebieg rysowania) – początek i koniec każdego
  const ts3 = hasTS ? { qs: device.createQuerySet({ type: 'timestamp', count: 6 }), resolve: buf(48, U.QUERY_RESOLVE | U.COPY_SRC, 'ts3Resolve'),
    read: buf(48, U.MAP_READ | U.COPY_DST, 'ts3Read'), pending: false, armed: false, tex: 0, img: 0 } : null;
  function ts3Map() {
    if (!ts3 || !ts3.armed || ts3.pending) return;
    ts3.armed = false; ts3.pending = true;
    ts3.read.mapAsync(GPUMapMode.READ).then(() => {
      const t = new BigUint64Array(ts3.read.getMappedRange());
      const tex = Number(t[1] - t[0] + t[3] - t[2]) / 1e6, img = Number(t[5] - t[4]) / 1e6;
      ts3.read.unmap(); ts3.pending = false;
      if (tex >= 0 && img >= 0) { ts3.tex = ts3.tex ? 0.8 * ts3.tex + 0.2 * tex : tex; ts3.img = ts3.img ? 0.8 * ts3.img + 0.2 * img : img; }
    });
  }
  let ts = null;
  if (hasTS) {
    ts = {
      qs: device.createQuerySet({ type: 'timestamp', count: 2 }),
      resolve: buf(16, U.QUERY_RESOLVE | U.COPY_SRC, 'tsResolve'),
      read: buf(16, U.MAP_READ | U.COPY_DST, 'tsRead'),
      pending: false,
    };
  }

  // --- Stan symulacji ---
  const sim = {
    time: 0, step: 0, paused: false, debt: 0, msPerStep: 0, statsPending: false, lastStats: 0,
    stats: null, means: null, sfc: null, busy: true,
    flat: true, seed: 1, h: new Float32Array(NXY), hv: new Float32Array(NXV * NYV), hmax: 0, startHour: 6, doy0: 172, year: 2026,
    paint: null,
    probe: { i: MG + Math.floor(NXD / 2), j: MG + Math.floor(NYD / 2) },   // sonda (domyślnie środek mapy)
    probeEnc: -1, probeColAt: -1, probeCol: null,
  };
  let profMode = 'point';
  const speedHist = [];

  // Czas lokalny (słoneczny) i dzień roku dla czasu symulacji t [s]
  const clock = (t) => {
    const hrs = sim.startHour + t / 3600;
    return { hour: ((hrs % 24) + 24) % 24, doy: sim.doy0 + Math.floor(hrs / 24) };
  };
  // szerokość geograficzna wiersza oczka c (duże mapy: roślinność, klimat gleby)
  const latRow = (c) => num('lat') + ((Math.floor(c / NX) + 0.5 - MG - NYD / 2) * CFG.DY) / 111195;
  const windUV = () => {
    const sp = num('wind'), d = num('wdir') * Math.PI / 180;
    return [-sp * Math.sin(d), -sp * Math.cos(d)];
  };

  // --- Teren ---
  // teren: sim.hv na widocznej siatce, sim.h na pełnej (strefa wyrównania łączy brzegi gładko)
  // woda: teren poniżej poziomu morza (wysokość liczona od poziomu morza) + malowana maska
  // (sim.wmask: 1 – woda, −1 – ląd mimo poziomu morza)
  const isWaterV = (c) => (sim.wmask && sim.wmask[c] === 1) || (sim.hv[c] < num('sea') && !(sim.wmask && sim.wmask[c] === -1));
  const seaHeights = () => {
    const sea = num('sea');
    return Float32Array.from(sim.hv, (h) => Math.max(h - sea, 0));
  };
  // miejscowości na mapie (OpenStreetMap) – właściwa funkcja przypisana po utworzeniu stacji; wołane przy każdej zmianie terenu,
  // pobiera tylko przy zmianie miejsca / rozmiaru mapy
  let refreshCities = () => {};
  function applyTerrain() {
    sim.hs = seaHeights();
    sim.h = embed(sim.hs);
    const t = deriveTerrain(sim.h, CFG, new URLSearchParams(location.search).get('pc') !== '0');
    device.queue.writeBuffer(vgBuf, grid.off.KB * 4, t.kb);
    device.queue.writeBuffer(vgBuf, grid.off.HF * 4, t.hf);
    device.queue.writeBuffer(vgBuf, grid.off.HGT * 4, sim.h);
    device.queue.writeBuffer(vgBuf, grid.off.SLX * 4, t.slx);
    device.queue.writeBuffer(vgBuf, grid.off.SLY * 4, t.sly);
    device.queue.writeBuffer(vgBuf, grid.off.RCV * 4, flowNet());
    sim.flat = t.flat;
    sim.hmax = t.hmax;
    sim.kb = t.kb;
    refreshCities();
  }
  // Sieć spływu D8 na terenie z wypełnionymi zagłębieniami (priority-flood, Barnes 2014): ujścia to brzeg
  // siatki obliczeniowej (−2: woda opuszcza domenę) i woda (jeziora, morze; −1); każde inne oczko oddaje
  // wodę sąsiadowi o największym spadku – zagłębienia „przelewają się” jak jeziora bez odpływu
  function flowNet() {
    const n = NXY, f = new Float64Array(n), done = new Uint8Array(n), rcv = new Float32Array(n).fill(-1);
    const hk = [], hv = [];                                  // kopiec binarny (wysokość, oczko)
    const push = (e, c) => {
      let i = hk.length; hk.push(e); hv.push(c);
      while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= hk[i]) break; [hk[p], hk[i]] = [hk[i], hk[p]]; [hv[p], hv[i]] = [hv[i], hv[p]]; i = p; }
    };
    const pop = () => {
      const c = hv[0], last = hk.length - 1;
      hk[0] = hk[last]; hv[0] = hv[last]; hk.pop(); hv.pop();
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < hk.length && hk[l] < hk[m]) m = l;
        if (r < hk.length && hk[r] < hk[m]) m = r;
        if (m === i) break;
        [hk[m], hk[i]] = [hk[i], hk[m]]; [hv[m], hv[i]] = [hv[i], hv[m]]; i = m;
      }
      return c;
    };
    const water = (c) => sim.land && sim.land.cls[c] === 3;
    for (let c = 0; c < n; c++) {
      f[c] = sim.h[c];
      const i = c % NX, j = Math.floor(c / NX);
      if (i === 0 || j === 0 || i === NX - 1 || j === NY - 1 || water(c)) {
        done[c] = 1; rcv[c] = water(c) ? -1 : -2; push(f[c], c);
      }
    }
    while (hk.length) {
      const c = pop(), i = c % NX, j = Math.floor(c / NX);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if ((!di && !dj) || ii < 0 || jj < 0 || ii >= NX || jj >= NY) continue;
          const m = jj * NX + ii;
          if (done[m]) continue;
          done[m] = 1;
          f[m] = Math.max(f[m], f[c] + 1e-3);
          push(f[m], m);
        }
      }
    }
    for (let c = 0; c < n; c++) {
      if (rcv[c] < 0 && (rcv[c] === -2 || water(c))) continue;
      const i = c % NX, j = Math.floor(c / NX);
      let best = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if ((!di && !dj) || ii < 0 || jj < 0 || ii >= NX || jj >= NY) continue;
          const m = jj * NX + ii, s = (f[c] - f[m]) / Math.hypot(di, dj);
          if (s > best) { best = s; rcv[c] = m; }
        }
      }
    }
    return rcv;
  }

  // pokrycie terenu (klasy) i początkowa wilgotność gleby w kolumnach
  function applyLand() {
    const lv = makeLand($('landuse').value, CFGV, sim.seed, num('soil') / 100, sim.hs || sim.hv);
    for (let c = 0; c < NXV * NYV; c++) {
      if (isWaterV(c)) lv.cls[c] = 3;
      else if (lv.cls[c] === 3 && sim.wmask && sim.wmask[c] === -1) lv.cls[c] = 0;
      if (sim.lmask && sim.lmask[c] >= 0 && lv.cls[c] !== 3) lv.cls[c] = sim.lmask[c];   // pokrycie malowane pędzlem
      if (sim.lwet && sim.lwet[c] > 0) lv.w[c] = Math.min(1, lv.w[c] + 0.6 * sim.lwet[c]);   // mokradła z mapy pokrycia
    }
    sim.land = { cls: embed(lv.cls, CFG, true), w: embed(lv.w) };
    // roślinność z klimatu (szerokość, kontynentalizm, wilgotność klimatu) i wysokości terenu
    const veg = new Float32Array(NXY);
    for (let c = 0; c < NXY; c++) {
      veg[c] = biome(sim.land.cls[c], latRow(c), num('cont'), num('hum'), sim.h[c]);
      if (sim.vmask && sim.land.cls[c] !== 3 && c % NX < NXV && c < NYV * NX) {
        const pv = sim.vmask[Math.floor(c / NX) * NXV + c % NX];
        if (pv >= 0) veg[c] = pv;
      }
      if (veg[c] === VEG.DESERT) sim.land.w[c] = Math.min(sim.land.w[c], 0.05);
      if (veg[c] === VEG.STEPPE) sim.land.w[c] = Math.min(sim.land.w[c], 0.3);
    }
    sim.veg = veg;
    device.queue.writeBuffer(vgBuf, grid.off.LAND * 4, sim.land.cls);
    device.queue.writeBuffer(vgBuf, grid.off.VEG * 4, veg);
    device.queue.writeBuffer(vgBuf, grid.off.RCV * 4, flowNet());     // ujścia do jezior i morza
  }
  function setShape(kind) {
    if (kind === 'image' || kind === 'painted' || kind === 'dem') return;
    sim.wmask = null;
    const shape = genShape(kind, CFGV, sim.seed);
    const hm = kind === 'flat' ? 0 : num('hills');
    for (let c = 0; c < NXV * NYV; c++) sim.hv[c] = shape[c] * hm;
    applyTerrain();
  }

  // --- Masa powietrza: przebudowa stanu bazowego (profile w buforze vg) ---
  function rebuildBase() {
    snd = makeSounding(sim.air || airParams());
    grid = buildGrid(CFG, snd);
    // model synoptyczny ma radiację w swojej temperaturze (pola docelowe) – stałe ochładzanie atmosfery
    // (−1.5 K/dobę, równoważone osiadaniem z suwaka w trybie stałej masy) liczyłoby się podwójnie
    if (drv.mode === 'syn') grid.data.fill(0, grid.off.RCOOL, grid.off.RCOOL + NZ);
    device.queue.writeBuffer(vgBuf, 0, grid.data);
    applyTerrain();
    applyLand();
  }

  // ======================= Duża skala: model synoptyczny albo stała masa powietrza =======================
  // Pola docelowe w trzech terminach co DTQ (30 min): slot drv.slot = termin A (czas drv.tA), (A + 1) % 3 = A + 30 min,
  // (A + 2) % 3 = A − 30 min (krzywa B-sklejana w czasie – sim.wgsl tgW). Model synoptyczny jest zawsze o termin przed symulacją.
  const tgW = (a) => { const u = Math.min(1, Math.max(0, a)); return [0.5 * (1 - u) * (1 - u), 0.5 + u - u * u, 0.5 * u * u]; };
  const drv = { mode: 'syn', seed: 1 + Math.floor(Math.random() * 1e6), key: '', start: null, model: null,
    tA: 0, slot: 0, pg0: null, cls: null, fc: [], fcModel: null, synDirty: false, lastDraw: 0 };
  const climKey = () => [num('lat'), num('cont'), num('hum'), dayOfYear($('date').value), drv.seed, $('location').value === 'custom' ? num('lon') : 'x', num('tbias'), num('hour'), MANIP_VAR[num('manipV')]].join('|');
  // Manipulacja atmosfery (zakładka Weather, strona tytułowa): T – anomalia temperatury [K], R – mnożnik opadu, V – zmienność pogody. Przy starcie działa od razu
  // (stan początkowy, rozbieg modelu synoptycznego), a zmiana w trakcie przebiegu wchodzi liniowo przez wybrany czas (odcinek from → to w t0…t1). Ten sam odcinek
  // widzą kopie modelu synoptycznego w swoim czasie, więc prognoza już pokazuje to, co nadchodzi. log – historia nastaw (ostatni wiersz CSV).
  const manip = { T: seg(0), R: seg(1), V: seg(1), log: [] };
  {
    const q = new URLSearchParams(location.search);
    if (q.has('tan')) $('tanom').value = +q.get('tan');
    if (q.has('rnf')) $('manipR').value = nearest(MANIP_RAIN, +q.get('rnf'));
    if (q.has('vrf')) $('manipV').value = nearest(MANIP_VAR, +q.get('vrf'));
  }
  const manipTarget = () => ({ T: num('tanom'), R: MANIP_RAIN[num('manipR')], V: MANIP_VAR[num('manipV')] });
  const mAt = (k, t) => (drv.mode === 'syn' ? segAt(manip[k], t) : (k === 'T' ? 0 : 1));
  const manipVarAt = (t) => segAt(manip.V, t);
  // start przebiegu: od razu pełne nastawy
  function manipFlat() {
    const m = manipTarget();
    for (const k of ['T', 'R', 'V']) manip[k] = seg(m[k]);
    manip.log = [{ t: 0, ...m }];
  }
  // suwak w trakcie przebiegu: od bieżącej wartości do nowej przez czas „kick-in”
  function manipApply() {
    const m = manipTarget(), now = sim.time, ramp = +$('manipRamp').value * 86400;
    for (const k of ['T', 'R', 'V']) if (manip[k].to !== m[k]) manip[k] = { from: segAt(manip[k], now), to: m[k], t0: now, t1: now + ramp };
    const last = manip.log[manip.log.length - 1];
    if (last && now - last.t < 1800) Object.assign(last, m); else manip.log.push({ t: now, ...m });
    manipUi();
  }
  function manipUi() {
    const m = manipTarget(), now = sim.time, on = (id, x) => { $(id).style.color = x ? '#ff9a3c' : ''; };
    $('tanomV').textContent = fmtT(m.T); on('tanomV', m.T !== 0);
    $('manipRV').textContent = fmtX(m.R); on('manipRV', m.R !== 1);
    $('manipVV').textContent = fmtX(m.V); on('manipVV', m.V !== 1);
    const left = Math.max(manip.T.t1, manip.R.t1, manip.V.t1) - now;
    const txt = left > 0 ? `Kicking in, ${left >= 86400 ? `${(left / 86400).toFixed(1)} days` : `${Math.max(1, Math.round(left / 3600))} h`} left. Now ${fmtT(+segAt(manip.T, now).toFixed(1))}, precipitation ${fmtX(segAt(manip.R, now))}, variability ${fmtX(segAt(manip.V, now))}.` : '';
    if ($('manipNow').textContent !== txt) $('manipNow').textContent = txt;
  }
  // ostatni wiersz CSV: historia nastaw (bez niej raportu z przebiegu nie da się jednoznacznie opisać)
  function manipCsv() {
    if (!manip.log.some((e) => e.T !== 0 || e.R !== 1 || e.V !== 1)) return 'atmosphere manipulation none';
    return `atmosphere manipulation ${manip.log.map((e) => `day ${Math.floor(e.t / 86400) + 1}: T ${e.T} K, precip x${e.R}, variability x${e.V}`).join(' | ')}`;
  }
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  function constParams() {
    const [u0, v0] = windUV();
    return parVec({ ...(sim.air || airParams()), u0, v0 });
  }
  // parametry sondażu w punkcie (x, y) [m od środka domeny] – stała masa powietrza
  function sampler() { const v = constParams(); return () => v; }
  // pola docelowe w slocie (budowane na GPU): siatka parametrów z modelu synoptycznego (liczona na GPU,
  // zapis wprost do bufora vg) albo ze stałej masy powietrza (pg z CPU)
  function buildSlot(slot, pg = null) {
    if (pg) device.queue.writeBuffer(vgBuf, grid.off.PGRID * 4, pg);
    const ab = new ArrayBuffer(PARAM_BYTES);
    new Uint32Array(ab)[22] = slot;
    new Float32Array(ab)[31] = mAt('T', sim.time);     // manipulacja atmosfery: anomalia temperatury, mnożnik opadu
    new Float32Array(ab)[33] = mAt('R', sim.time);
    device.queue.writeBuffer(paramBuf, 0, ab);
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    if (!pg) drv.model.encodeParams(pass);
    pass.setPipeline(tgtBuild.p);
    pass.setBindGroup(0, simBG, [0]);
    pass.dispatchWorkgroups(tgtBuild.g[0], tgtBuild.g[1]);
    for (const k of tgtProj) { pass.setPipeline(k.p); pass.setBindGroup(0, simBG, [0]); pass.dispatchWorkgroups(k.g[0], k.g[1]); }
    pass.end();
    device.queue.submit([enc.finish()]);
  }
  // odczyt siatki parametrów z GPU (do inicjalizacji powierzchni)
  async function readPGrid() {
    const n = NPAR_G * (CFG.NX / CFG.GS) * (CFG.NY / CFG.GS);
    const rb = buf(n * 4, U.MAP_READ | U.COPY_DST, 'pgRead');
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(vgBuf, grid.off.PGRID * 4, rb, 0, n * 4);
    device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const a = new Float32Array(rb.getMappedRange()).slice();
    rb.unmap(); rb.destroy();
    return a;
  }
  // stan środka domeny z modelu synoptycznego (asynchronicznie): klasyfikacja masy powietrza, opis
  function refreshCenter() {
    const m = drv.model;
    if (!m || drv.centerBusy) return;
    drv.centerBusy = true;
    m.readCenter().then((c) => {
      if (m !== drv.model) return;
      drv.cls = classifyCenter(c); drv.synDirty = true;
    }).finally(() => { drv.centerBusy = false; });
  }

  // ---- Korekta klimatu modelu synoptycznego (metoda delta) ----
  // Model synoptyczny ma za zimną troposferę: Kraków, 3 losowania × rok wobec analiz 2022–2025 – 850/700/500 hPa o 5–9 K, przy gruncie
  // o 2–6 K, gradient grunt–850 hPa o 1–5 K za stromy (za duże CAPE, za dużo konwekcji, chmur i opadu). Profil docelowy domeny
  // dostaje poprawkę = średnia z danych − średnia modelu na 0 / 1.5 / 3 / 5.6 km n.p.m. (≈ grunt, 850, 700, 500 hPa) i mnożnik
  // wilgotności przy gruncie (norma punktu rosy / model). Węzły korekty co ≤ 600 km na obszarze domeny (1 węzeł do 600 km, 2 × 2 do
  // 1200 km, …, ≤ 6 × 6; grid.js ccN), poprawka interpolowana dwuliniowo (sim.wgsl ccBil, bufor vg CCG). Dla każdego węzła:
  // przy gruncie klimatologia wbudowana (stacje: GHCN_CAMS, GPCC; climbase.js), w tle normy ERA5 1991–2020 (T, Td, opad na wysokości oczka ERA5); swobodna atmosfera zawsze
  // z climbase.js: T NCEP 1991–2020 na stałych wysokościach – wobec radiosondaży IGRA (Polska płd.) ±0.5 K. Wcześniej norma T 2 m minus różnica T 2 m − T poziomu z analiz
  // 2022–2024: troposfera ~1.3 K za zimna na wszystkich poziomach (na 850 hPa styczeń −1.9, luty −2.6 K). Średnia modelu z okna ±CC_WIN dób wokół bieżącej chwili, tak samo
  // uśrednione dane. Próbki (co 12 h, siatka parametrów) z osobnej kopii modelu z zaburzonym stanem – własna pogoda, liczona CC_WIN dób
  // przed symulacją: korekta zabiera stały i sezonowy błąd modelu, a anomalie pogody przebiegu zostają. Wcześniej próbki z samego
  // przebiegu w oknie 60 dób wstecz – korekta zabierała też pogodę i oddawała ją z opóźnieniem z przeciwnym znakiem (chłodna wiosna →
  // korekta +1…+1.6 K w maju–czerwcu: cel w czerwcu +1.2…+2.6 K ponad normę; zima ciepła → marzec −3 K).
  const CC_Z = [0, 1500, 3000, 5600];
  // okno ±90 dób: szum oszacowania z jednej realizacji pogody ~0.5 K (±45 dób – ~0.9 K, tyle co naturalna odchyłka miesiąca);
  // na starcie kopia liczy CC_START, resztę dorabia w tle (pierwsza minuta)
  const CC_WIN = 90 * 86400, CC_START = 45 * 86400;
  const CCNX = ccN(CFG.NXV * CFG.DX), CCNY = ccN(CFG.NYV * CFG.DY);
  const newNode = (t) => ({ X: ((t % CCNX) + 0.5) * CFG.NXV / CCNX, Y: (Math.floor(t / CCNX) + 0.5) * CFG.NYV / CCNY,
    norm: null, free: null, smp: [], corr: [0, 0, 0, 0], fq: 1, fqa: [1, 1], fp: 1 });
  const cc = { nodes: Array.from({ length: CCNX * CCNY }, (_, t) => newNode(t)), src: '', off: false, busy: false };
  const qsatJ = (T, p) => { const e = 611.2 * Math.exp(17.67 * (T - 273.15) / (T - 29.65)); return 0.622 * e / (p - 0.378 * e); };
  // nasycenie woda → lód między 0 a −40 °C (jak qsatMix w sim.wgsl i qsatM w modelu synoptycznym)
  const qsatMixJ = (T, p) => {
    const ei = 610.78 * Math.exp(21.875 * (T - 273.16) / (T - 7.66)), qi = 0.622 * ei / (p - ei);
    return qi + (qsatJ(T, p) - qi) * Math.min(1, Math.max(0, (T - 233.15) / 40));
  };
  const pAt = (z) => 101325 * Math.exp(-z / 8400);
  const ccDoy = (t) => dayOfYear($('date').value) + (num('hour') * 3600 + t) / 86400;
  function ccMon(row, doy) {
    const x = ((((doy - 15.2) / 30.44) % 12) + 12) % 12, m0 = Math.floor(x), f = x - m0;
    return row[m0] + f * (row[(m0 + 1) % 12] - row[m0]);
  }
  // dane w węźle: normy przy gruncie (sprowadzone do poziomu morza 6.5 K/km), wyżej T na stałych wysokościach; wilgotność właściwa z normy punktu rosy
  function ccRef(nd, doy) {
    const n = nd.norm, tN = ccMon(n.T, doy) + 273.15, td = ccMon(n.Td, doy) + 273.15;
    return { t: [tN + 0.0065 * n.elev, ...nd.free.T.map((row) => ccMon(row, doy) + 273.15)], q: qsatJ(td, pAt(n.elev)) };
  }
  // próbka modelu w węzłach (siatka parametrów pg): profil docelowy ze średnią dobową przy gruncie (cel przy gruncie to profil
  // „popołudniowy”, o tsOff = 0.4·połowa amplitudy dobowej cieplejszy – P.tsOff; swobodna atmosfera bez zmian: di przesunięte o tyle
  // samo); wilgotność celu przy gruncie (wysokość normy) – jak w tgt_build: RH dolnej warstwy × nasycenie przy temperaturze celu
  // wilgotność względna celu na wysokości z [m n.p.m.] (jak tgt_build: airRH, nad warstwą dolną warstwy prawie nasycone w modelu
  // z węzłów 1.5 / 3 km, latem para wymieszana od gruntu do ~1.5 km) – względem nasycenia woda → lód, jak RH analiz ECMWF
  function ccRH(pv, z, hg) {
    const ts = pv[0], ztr = pv[2], zi = pv[3], di = pv[4], rhl = pv[5], rhh = pv[6];
    const sst = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
    const s = zi > 0 ? Math.min(1, Math.max(0, di)) : 0, z1 = 1500 + s * (zi - 1500), z2 = 3500 + s * (zi + 500 - 3500);
    const rh = z > ztr ? 0.05 : z < z1 ? rhl : z < z2 ? rhl + (rhh - rhl) * (z - z1) / (z2 - z1) : rhh;
    const T = airTz(pv, z), qs = qsatJ(T, pAt(z)), qm = qsatMixJ(T, pAt(z));
    let q = rh * qs;
    if (pv[21] > 0) {
      const rm = z <= 1500 ? pv[21] : z >= 3000 ? pv[20] : pv[21] + (pv[20] - pv[21]) * (z - 1500) / 1500;
      q += sst(z1 - 300, z1 + 300, z) * sst(0.85, 0.97, rm) * (1 - sst(287, 294, ts)) * (Math.max(q, rm * qm) - q);
    }
    const qml = Math.min(rhl * qsatJ(airTz(pv, hg), pAt(hg)), 0.95 * qs);
    const fml = sst(278, 290, ts) * (1 - sst(1200, 2000, z - hg));
    return Math.max(q, q + (qml - q) * fml) / qm;
  }
  // wielkości próbki zależne od wysokości normy węzła (norma ERA5 dochodzi w tle – inna wysokość niż w klimatologii wbudowanej)
  function ccFill(x, nd) {
    const zn = nd.norm.elev;
    x.tq = airTz(x.pv, zn);
    x.rhm = [ccRH(x.pv, 1500, zn), ccRH(x.pv, 3000, zn)];
  }
  function ccSample(t, pg, off) {
    const doy = ccDoy(t);
    for (const nd of cc.nodes) {
      const pv = paramAt(pg, nd.X, nd.Y), q = pv.slice(); q[0] -= off; q[4] += off;
      const x = { t, doy, pv: pv.slice(), pe: CC_Z.map((z) => airTz(q, z)), pr: Math.max(pv[13], 0) };
      ccFill(x, nd);
      nd.smp.push(x);
    }
  }
  function ccUpdate(now) {
    for (const nd of cc.nodes) {
      const s = nd.smp.filter((x) => x.t >= now - CC_WIN && x.t <= now + CC_WIN);
      if (!s.length || cc.off) { nd.corr = [0, 0, 0, 0]; nd.fq = 1; nd.fqa = [1, 1]; nd.fp = 1; continue; }
      // wagi kosinusowe w oknie (Hann): z równej średniej ±90 dób zostawało ~35% rocznego przebiegu błędu modelu (w lipcu cel +0.6 K na 1.5 km, zimą chłodniej), z wagami ~15%; szum oszacowania ~20% większy
      const wt = s.map((x) => Math.cos(0.5 * Math.PI * (x.t - now) / CC_WIN) ** 2);
      const ws = Math.max(wt.reduce((a, b) => a + b, 0), 1e-6);
      const d = [0, 0, 0, 0];
      let qr = 0;
      s.forEach((x, i) => { const r = ccRef(nd, x.doy); for (let k = 0; k < 4; k++) d[k] += wt[i] * (r.t[k] - x.pe[k]); qr += wt[i] * r.q; });
      nd.corr = d.map((v) => v / ws);
      // wilgotność celu po korekcie temperatury (przy stałej RH) względem normy punktu rosy
      const zc = nd.norm.elev, c0 = nd.corr[0] + (nd.corr[1] - nd.corr[0]) * Math.min(1, zc / 1500);
      // wilgotność: wykładnik a w RH → RH^a (sim.wgsl tgt_build), dobrany tak, by średnia wilgotność właściwa przy gruncie była równa normie (bisekcja; a < 1 – wilgotniej, a > 1 – sucho)
      const zcp = pAt(zc), qsm = s.map((x) => qsatMixJ(x.tq + c0, zcp)), rh0 = s.map((x, i) => Math.min(1, x.pv[5] * qsatJ(x.tq + c0, zcp) / qsm[i]));
      // (w cieple cel +8%: domena stoi latem ~0.7–1 g/kg poniżej celu przy gruncie – mieszanie z suchszym powietrzem nad warstwą graniczną – a to wilgotność domeny ma trafiać w normę)
      const tqm = s.reduce((v, x, i) => v + wt[i] * x.tq, 0) / ws, wq = Math.min(1, Math.max(0, (tqm - 278) / 12));
      nd.fq = ccExp((a) => s.reduce((v, _, i) => v + wt[i] * qsm[i] * Math.max(rh0[i], 1e-4) ** a, 0), qr * (1 + 0.08 * wq));
      // wilgotność swobodnej atmosfery: RH na 850 i 700 hPa (NCEP; wobec radiosondaży IGRA do −4 punktów) / RH celu na 1.5 i 3 km (cel latem za wilgotny: Kraków, lipiec,
      // ~77% przy ~70% w pomiarach na 850 hPa – za duże CAPE)
      nd.fqa = [0, 1].map((q) => {
        let rr = 0, rm = 0;
        s.forEach((x, i) => { rr += wt[i] * ccMon(nd.free.rh[q], x.doy); rm += wt[i] * (x.rhm ? x.rhm[q] : 0); });
        return rm > 0 ? Math.min(1.2, Math.max(0.5, rr / rm)) : 1;
      });
      // opad: norma ERA5 1991–2020 / średni opad modelu w węźle (model synoptyczny pada od jesieni do wiosny ~2× za dużo) – mnożnik
      // ≤ 1 sprzężenia domeny z opadem dużej skali (pełne unoszenie pary, napływ opadu przez brzeg)
      nd.fp = 1;
      if (nd.norm.P) {
        let pn = 0, pm = 0;
        s.forEach((x, i) => { pn += wt[i] * ccMon(nd.norm.P, x.doy); pm += wt[i] * 24 * (x.pr || 0); });
        if (pm > 0) nd.fp = Math.min(1, Math.max(0.3, pn / pm));
      }
    }
    ccUpload();
  }
  const ccOn = () => drv.mode === 'syn' && $('climcorr').checked && !cc.off;
  // wykładnik a ∈ [0.5, 2] taki, że f(a) = cel (f maleje z a); poza zakresem – granica
  function ccExp(f, target) {
    let lo = 0.5, hi = 2;
    if (f(lo) <= target) return lo;
    if (f(hi) >= target) return hi;
    for (let n = 0; n < 16; n++) { const m = 0.5 * (lo + hi); if (f(m) > target) lo = m; else hi = m; }
    return 0.5 * (lo + hi);
  }
  // poprawki węzłów do bufora vg (CCG: 8 wartości na węzeł – 4 temperatury, mnożniki wilgotności: grunt, 850, 700 hPa, mnożnik opadu);
  // wyłączona – zera i mnożniki 1
  function ccUpload() {
    const a = new Float32Array(8 * 36), on = ccOn();
    cc.nodes.forEach((nd, t) => {
      for (let k = 0; k < 4; k++) a[8 * t + k] = on ? nd.corr[k] : 0;
      a[8 * t + 4] = on ? nd.fq : 1; a[8 * t + 5] = on ? nd.fqa[0] : 1; a[8 * t + 6] = on ? nd.fqa[1] : 1; a[8 * t + 7] = on ? nd.fp : 1;
    });
    device.queue.writeBuffer(vgBuf, grid.off.CCG * 4, a);
    const el = $('ccInfo');
    if (!el) return;
    if (!on) { el.textContent = cc.off ? `correction off: ${cc.src}` : 'correction off'; return; }
    const m = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => cc.nodes.reduce((s, nd) => s + (k < 4 ? nd.corr[k] : k === 4 ? nd.fq : k === 7 ? nd.fp : nd.fqa[k - 5]), 0) / cc.nodes.length);
    el.textContent = `correction${cc.nodes.length > 1 ? ` (mean of ${cc.nodes.length} nodes)` : ''}: ${m.slice(0, 4).map((v) => (v >= 0 ? '+' : '') + v.toFixed(1)).join(' · ')} K `
      + `(ground · 1.5 · 3 · 5.6 km), humidity near the ground RH^${m[4].toFixed(2)}, at 1.5 km ×${m[5].toFixed(2)}, at 3 km ×${m[6].toFixed(2)}, `
      + `large-scale precipitation ×${m[7].toFixed(2)}; data: ${cc.src}`;
  }
  // ta sama poprawka na wysokości z w punkcie (X, Y) siatki (jak climCorr w sim.wgsl) – temperatura gruntu na starcie
  function ccAt(z, ztr, X, Y) {
    if (!ccOn()) return 0;
    const fx = Math.min(CCNX - 1, Math.max(0, X / CFG.NXV * CCNX - 0.5)), fy = Math.min(CCNY - 1, Math.max(0, Y / CFG.NYV * CCNY - 0.5));
    const i0 = Math.floor(fx), j0 = Math.floor(fy), i1 = Math.min(i0 + 1, CCNX - 1), j1 = Math.min(j0 + 1, CCNY - 1), ax = fx - i0, ay = fy - j0;
    const c = [0, 1, 2, 3].map((k) => {
      const v = (i, j) => cc.nodes[j * CCNX + i].corr[k];
      return (1 - ay) * ((1 - ax) * v(i0, j0) + ax * v(i1, j0)) + ay * ((1 - ax) * v(i0, j1) + ax * v(i1, j1));
    });
    let v = c[3];
    if (z < 1500) v = c[0] + (c[1] - c[0]) * Math.max(z, 0) / 1500;
    else if (z < 3000) v = c[1] + (c[2] - c[1]) * (z - 1500) / 1500;
    else if (z < 5600) v = c[2] + (c[3] - c[2]) * (z - 3000) / 2600;
    const s = Math.min(1, Math.max(0, (z - ztr) / 2000));
    return v * (1 - s * s * (3 - 2 * s));
  }
  // dane dla węzłów – od razu, bez sieci: wbudowana klimatologia (swobodna atmosfera zawsze), normy ERA5 przy gruncie z pamięci przeglądarki albo w tle
  // (ccLoad; korekta przelicza się w czasie przebiegu). Wcześniej start czekał na Open-Meteo: zawieszone połączenie albo limit zapytań to były minuty.
  let ccGen = 0;
  const ccLL = (nd) => {
    const la0 = num('lat');
    return [la0 + (nd.Y - CFG.NYV / 2) * CFG.DY / 111320, num('lon') + (nd.X - CFG.NXV / 2) * CFG.DX / (111320 * Math.cos(la0 * Math.PI / 180))];
  };
  function ccSrc() {
    const n = cc.nodes.length, ok = cc.nodes.filter((nd) => nd.hasN).length;
    cc.src = (ok === n ? `ERA5 normals 1991–2020 near the ground (${n} point${n === 1 ? '' : 's'})`
      : ok > 0 ? `ERA5 normals near the ground for ${ok} of ${n} points, the rest built-in station climatology` : 'built-in station climatology near the ground (GHCN_CAMS, GPCC)')
      + ', NCEP/NCAR reanalysis 1991–2020 above' + (cc.busy ? ' – downloading ERA5 normals in the background…' : '');
  }
  function ccFetch() {
    const gen = ++ccGen, custom = $('location').value === 'custom';
    cc.nodes = cc.nodes.map((_, t) => newNode(t)); cc.off = false; cc.busy = false;
    for (const nd of cc.nodes) {
      const [la, lo] = ccLL(nd), b = baseClim(la, lo), n = custom ? cachedNormals(la, lo) : null;
      nd.norm = n || b.norm; nd.free = b.free; nd.hasN = !!n;
    }
    ccSrc();
    if (custom) ccLoad(gen);
  }
  // normy ERA5 w tle, węzeł po węźle (limit czasu w geo.js); brak sieci albo limit zapytań – do końca przebiegu zostaje klimatologia
  // wbudowana, a to, co doszło, jest w pamięci przeglądarki na następny start
  async function ccLoad(gen) {
    for (const nd of cc.nodes) {
      if (nd.hasN) continue;
      const [la, lo] = ccLL(nd);
      cc.busy = true; ccSrc(); ccUpload();
      try {
        const n = await fetchNormals(la, lo);
        if (gen !== ccGen) return;
        nd.norm = n; nd.hasN = true;
        for (const x of nd.smp) ccFill(x, nd);
        ccSrc();
        ccUpdate(sim.time);
      } catch (e) {
        if (gen !== ccGen) return;
        console.warn(`ERA5 normals: ${e.message}`);
        break;
      }
    }
    if (gen !== ccGen) return;
    cc.busy = false; ccSrc(); ccUpload();
  }
  // siatka parametrów kopii modelu synoptycznego (zapis do bufora vg jak w buildSlot, odczyt)
  // przełącznik: nowe poprawki od następnego terminu pól docelowych (≤ 30 min)
  $('climcorr').addEventListener('change', () => { ccUpload(); if (drv.mode === 'syn' && drv.model && !sim.busy) buildSlot((drv.slot + 1) % 3); });
  async function pgOf(m) {
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    m.encodeParams(pass);
    pass.end();
    device.queue.submit([enc.finish()]);
    return readPGrid();
  }
  // to samo w czasie przebiegu: siatka modelu głównego (domena czyta ją co krok) zachowana i przywrócona w tym samym przebiegu GPU
  async function pgOfLive(m) {
    const nb = 4 * NPAR_G * (CFG.NX / CFG.GS) * (CFG.NY / CFG.GS);
    const keep = buf(nb, U.COPY_SRC | U.COPY_DST, 'pgKeep'), rb = buf(nb, U.MAP_READ | U.COPY_DST, 'pgLive');
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(vgBuf, grid.off.PGRID * 4, keep, 0, nb);
    const pass = enc.beginComputePass();
    m.encodeParams(pass);
    pass.end();
    enc.copyBufferToBuffer(vgBuf, grid.off.PGRID * 4, rb, 0, nb);
    enc.copyBufferToBuffer(keep, 0, vgBuf, grid.off.PGRID * 4, nb);
    device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const a = new Float32Array(rb.getMappedRange()).slice();
    rb.unmap(); rb.destroy(); keep.destroy();
    return a;
  }
  // następny termin: model synoptyczny krok dalej, starszy slot dostaje nowe pola
  // Suma opadu w okresie: o północy (czas słoneczny) kopia licznika opadu do historii na GPU (pierścień
  // dób); mapa pokazuje licznik minus stan sprzed N dób (pole PBASE)
  const ACC_SLOTS = Math.max(8, Math.min(91, Math.floor(64e6 / (NXY * 4))));
  const accBuf = buf(ACC_SLOTS * NXY * 4, U.STORAGE | U.COPY_DST | U.COPY_SRC, 'accHist');
  const acc = { days: new Map(), last: -1 };
  const dayTmp = buf(NXY * 4, U.COPY_DST | U.COPY_SRC, 'dayTmp');            // doba → slot
  const accDayNow = () => Math.floor((sim.startHour * 3600 + sim.time) / 86400 + 1e-6);
  function accSnapshot() {
    const d = accDayNow();
    if (d === acc.last) return;
    acc.last = d;
    const slot = d % ACC_SLOTS;
    for (const [k, v] of acc.days) if (v === slot) acc.days.delete(k);
    acc.days.set(d, slot);
    const enc = device.createCommandEncoder();
    monMidnight(enc);                                                          // widok „Miesiące”: doba, koniec miesiąca
    enc.copyBufferToBuffer(sfcBuf, S.PACC * NXY * 4, accBuf, slot * NXY * 4, NXY * 4);
    // nowa doba: T maks./min. od bieżącej T 2 m, usłonecznienie od zera
    enc.copyBufferToBuffer(sfcBuf, S.T2 * NXY * 4, dayTmp, 0, NXY * 4);       // (kopia w obrębie bufora niedozwolona)
    enc.copyBufferToBuffer(dayTmp, 0, sfcBuf, S.TMAX * NXY * 4, NXY * 4);
    enc.copyBufferToBuffer(dayTmp, 0, sfcBuf, S.TMIN * NXY * 4, NXY * 4);
    enc.clearBuffer(sfcBuf, S.SUNH * NXY * 4, NXY * 4);
    device.queue.submit([enc.finish()]);
    if (mon.pending) { const p = mon.pending; mon.pending = null; mon.finishing = monFinish(p); }
    monUi();
    accBase();
  }
  // Widok „Miesiące”: statystyki miesięcy kalendarzowych symulacji. Liczniki bieżącego miesiąca na GPU (pola MTS…MSN: Σ T 2 m·Δt,
  // Σ dobowych T maks. i min. z pełnych dób, opad i śnieg); o północy kończącej miesiąc – odczyt widocznej części do pamięci
  // (T × 100 jako Int16, opad × 10 jako Uint16 – 10 B na oczko i miesiąc: 200 × 200 oczek ~0.4 MB) i zerowanie liczników.
  // Zakładka „Analizy klimatyczne”: okresy – miesiące, pory roku (meteorologiczne: XII–II, III–V, VI–VIII, IX–XI) i lata
  // kalendarzowe, składane z zapisanych miesięcy (+ bieżący do tej chwili): T średnia ważona czasem, T maks. i min. – liczbą pełnych
  // dób, opad i śnieg sumowane. Przyciski map (pola 80–85), suwak okresu, tabela średnich po widocznej domenie.
  const MON_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const SEASONS = ['winter', 'spring', 'summer', 'autumn'];
  const MON_F = [S.MTS, S.MTX, S.MTN, S.MPR, S.MSN, S.MXA, S.MNA, S.MPD];
  const monDay = K('mon_day', NXY, 64), monAbs = K('mon_abs', NXY, 64);
  const mon = { list: [], key: -1, t0: 0, days: 0, dayT0: 0, pending: null };
  const monKey = (t) => {
    const d = new Date(Date.UTC(sim.year, 0, sim.doy0 + Math.floor((sim.startHour * 3600 + t) / 86400 + 1e-6)));
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  };
  const monLabel = (k) => `${MON_NAMES[k % 12]} ${Math.floor(k / 12)}`;
  const monFld = (f = num('fieldH')) => f >= 80 && f <= 88;
  // okresy rodzaju kind ('m' miesiące, 's' pory roku, 'y' lata): { key, months (zapisane), cur (obejmuje bieżący miesiąc) } –
  // chronologicznie; klucz pory roku = rok·4 + pora (zima z grudniem roku poprzedniego)
  let anaKind = 'm';
  const perKey = (kind, mk) => {
    if (kind === 'm') return mk;
    const y = Math.floor(mk / 12), m = mk % 12;
    return kind === 'y' ? y : (m === 11 ? y + 1 : y) * 4 + (m === 11 ? 0 : Math.floor((m + 1) / 3));
  };
  const perLabel = (kind, k, short) => {
    if (kind === 'm') return short ? `${MON_NAMES[k % 12].slice(0, 3)} ${Math.floor(k / 12)}` : monLabel(k);
    if (kind === 'y') return `${short ? '' : 'year '}${k}`;
    const y = Math.floor(k / 4);
    return k % 4 === 0 ? `winter ${y - 1}/${String(y % 100).padStart(2, '0')}` : `${SEASONS[k % 4]} ${y}`;
  };
  function periods(kind = anaKind) {
    const out = [], by = new Map();
    const get = (k) => { if (!by.has(k)) { const p = { key: k, months: [], cur: false }; by.set(k, p); out.push(p); } return by.get(k); };
    for (const m of mon.list) get(perKey(kind, m.key)).months.push(m);
    if (mon.key >= 0) get(perKey(kind, mon.key)).cur = true;
    return out;
  }
  const monSelIdx = () => Math.min(+$('monSel').value, Math.max(0, periods().length - 1));
  const monSelPer = () => periods()[monSelIdx()] || null;
  // wybrany okres to sam bieżący miesiąc – mapę liczy shader z liczników na bieżąco
  const monLive = () => { const p = monSelPer(); return !!p && p.cur && !p.months.length; };
  // długość okresu [s] (bieżący miesiąc – do chwili kopii pól)
  const perSecs = (p) => p.months.reduce((s, m) => s + m.secs, 0) + (p.cur ? Math.max(0, (sim.sfcT ?? sim.time) - mon.t0) : 0);
  function monReset() {
    Object.assign(mon, { list: [], key: monKey(0), t0: 0, days: 0, dayT0: 0, pending: null });
    $('monSel').max = '0'; $('monSel').value = '0';
    monUi();
  }
  function monMidnight(enc) {
    // ekstrema miesiąca: każda północ (także po niepełnej dobie)
    {
      const pass = enc.beginComputePass();
      pass.setPipeline(monAbs.p); pass.setBindGroup(0, simBG, [0]); pass.dispatchWorkgroups(monAbs.g[0], monAbs.g[1]);
      pass.end();
    }
    // doba zakończona: dobowe T maks. i min. do sum miesiąca, jeśli była pełna (pierwsza doba od startu o 6:00 – bez nocy – pominięta)
    if (sim.time - mon.dayT0 >= 20 * 3600) {
      const pass = enc.beginComputePass();
      pass.setPipeline(monDay.p); pass.setBindGroup(0, simBG, [0]); pass.dispatchWorkgroups(monDay.g[0], monDay.g[1]);
      pass.end();
      mon.days++;
    }
    mon.dayT0 = sim.time;
    const k = monKey(sim.time);
    if (k === mon.key) return;
    // koniec miesiąca: liczniki do odczytu, zerowanie
    const rb = buf(MON_F.length * NXY * 4, U.MAP_READ | U.COPY_DST, 'monRead');
    MON_F.forEach((s, n) => enc.copyBufferToBuffer(sfcBuf, s * NXY * 4, rb, n * NXY * 4, NXY * 4));
    for (const s of MON_F) enc.clearBuffer(sfcBuf, s * NXY * 4, NXY * 4);
    mon.pending = { rb, key: mon.key, days: mon.days, secs: Math.max(1, sim.time - mon.t0) };
    mon.key = k; mon.t0 = sim.time; mon.days = 0;
  }
  async function monFinish(p) {
    await p.rb.mapAsync(GPUMapMode.READ);
    const a = new Float32Array(p.rb.getMappedRange()), n = NXD * NYD;
    const T = [new Int16Array(n), new Int16Array(n), new Int16Array(n), new Int16Array(n), new Int16Array(n)], P = [new Uint16Array(n), new Uint16Array(n), new Uint16Array(n)];
    const q = (x) => Math.max(-32767, Math.min(32767, Math.round(100 * x)));
    for (let j = 0; j < NYD; j++) for (let i = 0; i < NXD; i++) {
      const c = (j + MG) * NX + i + MG, v = j * NXD + i, tm = a[c] / p.secs;
      T[0][v] = q(tm);
      T[1][v] = q(p.days ? a[NXY + c] / p.days : tm);
      T[2][v] = q(p.days ? a[2 * NXY + c] / p.days : tm);
      P[0][v] = Math.min(65535, Math.round(10 * a[3 * NXY + c]));
      P[1][v] = Math.min(65535, Math.round(10 * a[4 * NXY + c]));
      T[3][v] = q(a[5 * NXY + c] - 1000);
      T[4][v] = q(1000 - a[6 * NXY + c]);
      P[2][v] = Math.min(65535, Math.round(10 * a[7 * NXY + c]));
    }
    p.rb.unmap(); p.rb.destroy();
    const avg = (x, sc) => x.reduce((s, y) => s + y, 0) / n / sc;
    mon.list.push({ key: p.key, days: p.days, secs: p.secs, T, P,
      avg: { t: avg(T[0], 100), tx: avg(T[1], 100), tn: avg(T[2], 100), p: avg(P[0], 10), s: avg(P[1], 10),
        // ekstrema w widocznej domenie
        tX: T[3].reduce((m, y) => Math.max(m, y), -32768) / 100, tN: T[4].reduce((m, y) => Math.min(m, y), 32767) / 100, pD: P[2].reduce((m, y) => Math.max(m, y), 0) / 10 } });
    monUi(); monShow();
  }
  // wielkość f (80–85) okresu p w oczkach widocznej części [NXD·NYD]: zapisane miesiące + bieżący (z kopii liczników); T średnia
  // ważona czasem, T maks. i min. – liczbą pełnych dób (bez pełnych dób – T średnia), opad, deszcz i śnieg sumowane
  // (only ≥ 0 – tylko to oczko, wynik o długości 1)
  function perField(p, f, only = -1) {
    const v0 = only >= 0 ? only : 0, v1 = only >= 0 ? only + 1 : NXD * NYD, acc = new Float64Array(v1 - v0);
    if (f >= 86) {
      // ekstrema okresu: T maks. i min. absolutna, największy opad dobowy – po zapisanych miesiącach i bieżącym (liczniki, bieżąca doba)
      const up = f !== 87;
      acc.fill(up ? (f === 86 ? -Infinity : 0) : Infinity);
      const use = (k, x) => { acc[k] = up ? Math.max(acc[k], x) : Math.min(acc[k], x); };
      for (const m of p.months) for (let v = v0; v < v1; v++) use(v - v0, f === 88 ? m.P[2][v] / 10 : m.T[f - 83][v] / 100);
      if (p.cur && sim.sfc) {
        const g = (nm, c) => sim.sfc[S[nm] * NXY + c];
        for (let v = v0; v < v1; v++) {
          const c = (Math.floor(v / NXD) + MG) * NX + (v % NXD) + MG;
          if (f === 88) use(v - v0, Math.max(g('MPD', c), g('PACC', c) - g('PD0', c)));
          else if (f === 86) { const s = g('MXA', c); if (s > 0) use(v - v0, s - 1000); use(v - v0, g('TMAX', c)); }
          else { const s = g('MNA', c); if (s > 0) use(v - v0, 1000 - s); use(v - v0, g('TMIN', c)); }
        }
      }
      return acc;
    }
    let W = 0;
    for (const m of p.months) {
      const w = f === 80 ? m.secs : f <= 82 ? m.days : 1;
      if (!w) continue;
      for (let v = v0; v < v1; v++) {
        acc[v - v0] += f <= 82 ? w * m.T[f - 80][v] / 100 : f === 83 ? m.P[0][v] / 10 : f === 84 ? Math.max(0, m.P[0][v] - m.P[1][v]) / 10 : m.P[1][v] / 10;
      }
      W += w;
    }
    const cs = (sim.sfcT ?? -1) - mon.t0, cw = f === 80 ? cs : f <= 82 ? mon.days : 1;
    if (p.cur && sim.sfc && cs > 0 && cw > 0) {
      const g = (nm, c) => sim.sfc[S[nm] * NXY + c];
      for (let v = v0; v < v1; v++) {
        const c = (Math.floor(v / NXD) + MG) * NX + (v % NXD) + MG;
        acc[v - v0] += f === 80 ? g('MTS', c) : f === 81 ? g('MTX', c) : f === 82 ? g('MTN', c) : f === 83 ? g('MPR', c) : f === 84 ? Math.max(0, g('MPR', c) - g('MSN', c)) : g('MSN', c);
      }
      W += f <= 82 ? cw : 0;
    }
    if (f <= 82) {
      if (!(W > 0)) return f === 80 ? acc : perField(p, 80, only);
      for (let k = 0; k < acc.length; k++) acc[k] /= W;
    }
    return acc;
  }
  // wybrana wielkość okresu do pola MV (sam bieżący miesiąc liczy shader z liczników)
  function monShow() {
    const f = num('fieldH'), p = monSelPer();
    if (!monFld(f) || !p || monLive()) return;
    const a = perField(p, f);
    // (poza widoczną częścią – wartość z najbliższego brzegu: obraz wygładzany przez brzeg nie dostaje fałszywych 0 °C)
    const out = new Float32Array(NXY);
    for (let jc = 0; jc < NY; jc++) for (let ic = 0; ic < NX; ic++) {
      out[jc * NX + ic] = a[Math.min(NYD - 1, Math.max(0, jc - MG)) * NXD + Math.min(NXD - 1, Math.max(0, ic - MG))];
    }
    device.queue.writeBuffer(sfcBuf, S.MV * NXY * 4, out);
  }
  function monUi() {
    const el = $('monSel'), np = periods().length, atEnd = +el.value >= +el.max;
    el.max = String(Math.max(0, np - 1));
    if (atEnd) el.value = el.max;
    const p = monSelPer();
    const doby = (n) => `${n} full day${n === 1 ? '' : 's'}`;
    $('monV').textContent = p ? `${perLabel(anaKind, p.key)}${p.cur ? ' (in progress)' : ''} · ${doby(p.months.reduce((s, m) => s + m.days, 0) + (p.cur ? mon.days : 0))}` : '–';
    for (const b of $('anaKind').children) b.classList.toggle('on', b.dataset.k === anaKind);
    monTable(true);
  }
  // przyciski map; suwak i wiersz tabeli przy innej mapie włączają ostatnio wybraną mapę miesięczną
  let monLast = 80;
  function monPick(f) {
    if (f) monLast = f;
    if (f || !monFld()) $('fieldH').value = String(monLast);
    monUi(); monShow(); labels();
  }
  for (const [f, name] of [[80, 'Mean T'], [81, 'Mean T max'], [82, 'Mean T min'], [86, 'Absolute T max'], [87, 'Absolute T min'], [88, 'Max daily precip.'], [83, 'Precip.'], [84, 'Rain'], [85, 'Snow']]) {
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = name; b.title = FIELDS[f].name; b.dataset.f = f;
    b.onclick = () => monPick(f);
    $('monBtns').appendChild(b);
  }
  // średnie bieżącego miesiąca po widocznej domenie – z kopii pól przy gruncie (null, gdy kopia sprzed początku miesiąca)
  function monCur() {
    const secs = (sim.sfcT ?? -1) - mon.t0;
    if (!sim.sfc || secs <= 0) return null;
    const g = (nm) => {
      let s = 0;
      for (let j = MG; j < MG + NYD; j++) for (let i = MG, o = S[nm] * NXY + j * NX; i < MG + NXD; i++) s += sim.sfc[o + i];
      return s / (NXD * NYD);
    };
    // ekstrema w widocznej domenie do tej chwili
    let tX = -Infinity, tN = Infinity, pD = 0;
    for (let j = MG; j < MG + NYD; j++) {
      for (let i = MG; i < MG + NXD; i++) {
        const c = j * NX + i, v = (nm) => sim.sfc[S[nm] * NXY + c], a = v('MXA'), b = v('MNA');
        tX = Math.max(tX, a > 0 ? a - 1000 : -Infinity, v('TMAX'));
        tN = Math.min(tN, b > 0 ? 1000 - b : Infinity, v('TMIN'));
        pD = Math.max(pD, v('MPD'), v('PACC') - v('PD0'));
      }
    }
    return { t: g('MTS') / secs, tx: mon.days ? g('MTX') / mon.days : NaN, tn: mon.days ? g('MTN') / mon.days : NaN, p: g('MPR'), s: g('MSN'),
      tX, tN, pD, secs, days: mon.days };
  }
  // średnie okresu po widocznej domenie: z średnich zapisanych miesięcy i bieżącego (monCur) – T ważona czasem, maks. i min. liczbą
  // pełnych dób, opad i śnieg sumowane (null – brak danych)
  function perAvg(p, cur = monCur()) {
    const parts = [...p.months.map((m) => ({ ...m.avg, secs: m.secs, days: m.days })), ...(p.cur && cur ? [cur] : [])];
    if (!parts.length) return null;
    const S1 = (k, w) => parts.reduce((s, a) => s + (Number.isFinite(a[k]) ? a[k] * (w ? a[w] : 1) : 0), 0);
    const W = (w, k) => parts.reduce((s, a) => s + (Number.isFinite(a[k]) ? a[w] : 0), 0);
    const t = S1('t', 'secs') / W('secs', 't'), dx = W('days', 'tx'), dn = W('days', 'tn');
    return { t, tx: dx > 0 ? S1('tx', 'days') / dx : NaN, tn: dn > 0 ? S1('tn', 'days') / dn : NaN, p: S1('p'), s: S1('s'),
      tX: Math.max(...parts.map((a) => a.tX)), tN: Math.min(...parts.map((a) => a.tN)), pD: Math.max(...parts.map((a) => a.pD)) };
  }
  // tabela zakładki: sekcje miesiące, pory roku, lata (klik w wiersz – mapa tego okresu), okres w toku z gwiazdką, „Razem” – cały
  // przebieg; full = false – tylko wartości (co odczyt pól, bez przebudowy wierszy)
  function monTable(full) {
    const tb = $('monTab').tBodies[0];
    if (mon.key < 0) return;                                  // przed pierwszym startem (zakładka otwarta z zapamiętanego widoku)
    const cur = monCur();
    const fx = (v, u, d = 1) => Number.isFinite(v) ? nD(v, u, d) : '–';
    const cells = (a) => a ? [fx(a.t, '°C'), fx(a.tx, '°C'), fx(a.tn, '°C'), fx(a.p, 'mm', 0), fx(a.s, 'mm', 0), fx(a.tX, '°C'), fx(a.tN, '°C'), fx(a.pD, 'mm', 0)] : Array(8).fill('–');
    const secs = [['m', 'Months'], ['s', 'Seasons'], ['y', 'Years']].map(([k, name]) => ({ k, name, ps: periods(k) }));
    const nRows = secs.reduce((s, x) => s + 1 + x.ps.length, 0);
    if (full || tb.rows.length !== nRows) {
      tb.innerHTML = '';
      const selK = anaKind, sel = monSelIdx();
      for (const { k, name, ps } of secs) {
        const hr = tb.insertRow(); hr.className = 'sec';
        const hc = hr.insertCell(); hc.colSpan = 9; hc.textContent = name;
        ps.forEach((p, r) => {
          const tr = tb.insertRow();
          [`${perLabel(k, p.key, true)}${p.cur ? '*' : ''}`, ...cells(perAvg(p, cur))].forEach((t) => { tr.insertCell().textContent = t; });
          tr.classList.toggle('on', k === selK && r === sel);
          tr.onclick = () => { anaKind = k; monUi(); $('monSel').value = String(r); monPick(); };
        });
      }
    } else {
      let r = 0;
      for (const { ps } of secs) {
        r++;
        for (const p of ps) { if (p.cur) cells(perAvg(p, cur)).forEach((t, c) => { tb.rows[r].cells[c + 1].textContent = t; }); r++; }
      }
    }
    const all = { months: mon.list, cur: true }, tf = $('monTab').tFoot;
    if (mon.list.length < 1) { tf.innerHTML = ''; return; }
    if (!tf.rows.length) { const tr = tf.insertRow(); for (let c = 0; c < 9; c++) tr.insertCell(); tr.cells[0].textContent = 'Total'; }
    cells(perAvg(all, cur)).forEach((t, c) => { tf.rows[0].cells[c + 1].textContent = t; });
  }
  // skala sumy opadu: okres z listy „Suma opadu – okres” albo długość wybranego okresu analiz (mapy 83–85)
  function psumF(id) {
    if (id === 88) return Math.max(0.1, (1 / 16) ** 0.7);     // opad jednej doby
    if (!(id >= 83 && id <= 85)) return accF();
    const p = monSelPer(), days = Math.max(1, (p ? perSecs(p) : 0) / 86400);
    return Math.min(4, Math.max(0.1, (days / 16) ** 0.7));
  }
  // dymek: wartości wybranego okresu w oczku
  function monTip(col) {
    const i = col % NX - MG, j = Math.floor(col / NX) - MG;
    if (i < 0 || j < 0 || i >= NXD || j >= NYD) return '–';
    const pr = monSelPer();
    if (!pr) return '–';
    const v = j * NXD + i, at = (f) => perField(pr, f, v)[0];
    const t = at(80), tx = at(81), tn = at(82), p = at(83), s = at(85), ax = at(86), an = at(87), pd = at(88);
    return `T ${fT(t)} (${nD(tn, '°C', 1)} … ${nD(tx, '°C', 1)}) · precip. ${fm(p, 'mm', 1)} (rain ${nD(Math.max(0, p - s), 'mm', 1)}, snow ${nD(s, 'mm', 1)}) · absolute ${nD(an, '°C', 1)} … ${fT(ax)} · max day ${pd.toFixed(1)} mm`;
  }
  // skala sumy opadu rozciągana z długością okresu: progi WX Charts (0.1 … 2000 mm, pomyślane dla ~16 dób) × (dni/16)^0.7 –
  // doba: do ~290 mm, 7 dni ~1100, 30 dni ~3100, 90 dni ~6000 (okres „od startu” – liczba dób symulacji, co najmniej 1)
  function accF() {
    const N = num('accWin');
    const days = Math.max(1, N > 0 && (sim.accInfo || '').includes('last') ? N : sim.time / 86400);
    return Math.min(4, Math.max(0.1, (days / 16) ** 0.7));
  }
  // stan bazowy dla wybranego okresu: doba (dziś − N) z historii, a gdy jej nie ma – start (zero)
  function accBase() {
    const N = num('accWin'), d = accDayNow() - N;
    sim.accInfo = '';
    if (N > 0 && acc.days.has(d)) {
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(accBuf, acc.days.get(d) * NXY * 4, sfcBuf, S.PBASE * NXY * 4, NXY * 4);
      device.queue.submit([enc.finish()]);
      sim.accInfo = ` – last ${N} days`;
    } else {
      device.queue.writeBuffer(sfcBuf, S.PBASE * NXY * 4, new Float32Array(NXY));
      sim.accInfo = N > 0 ? ` since the start (run shorter than ${N} days)` : ' since the start of the simulation';
    }
  }
  function advanceDriver() {
    // północ: zapis licznika opadu (stan na granicy terminu, przed dalszymi krokami)
    if (Math.abs(((sim.startHour * 3600 + sim.time) % 86400 + 86400) % 86400) < 1) accSnapshot();
    // nowy termin do najstarszego slotu (poprzedni względem A) – staje się terminem B, dawny B – terminem A
    if (drv.mode === 'syn') { drv.model.step(); buildSlot((drv.slot + 2) % 3); refreshCenter(); }
    else buildSlot((drv.slot + 2) % 3, paramGrid(sampler()));
    drv.slot = (drv.slot + 1) % 3;
    drv.tA += DTQ;
  }
  // zmiana wiatru przy stałej masie: nowy cel w terminie B (płynne przejście w ciągu ≤ 30 min)
  function retarget() { if (drv.mode !== 'syn' && !sim.busy) buildSlot((drv.slot + 1) % 3, paramGrid(sampler())); }

  // węzły siatki parametrów (pozycje próbek modelu synoptycznego); w domenie periodycznej – jednorodnie
  const NODES = nestNodes(CFG);
  if (!CFG.OPEN) for (let n = 0; n < NODES.nodes.length; n += 3) { NODES.nodes[n] = 0; NODES.nodes[n + 1] = 0; }
  async function prepareModel() {
    const key = climKey();
    if (drv.start && drv.key === key) return;
    // rozbieg 15 dób: niże i wyże z zaburzeń startowych (~1 tydzień) i regulator średniej strefowej (pe.js, ~2 tygodnie)
    const SPIN = 15;
    status(`preparing the synoptic model: ${SPIN} days of spin-up…`);
    $('wxNow').textContent = `The synoptic model is spinning up (${SPIN} days)…`;
    await nextFrame();
    for (const m of [drv.start, drv.fcModel, drv.ccModel]) if (m) m.destroy();
    drv.ccModel = null;
    let geo = null;
    if ($('location').value === 'custom') {
      try { const w = await worldDem(); geo = { lon: num('lon'), elev: (la, lo) => worldElev(w, la, lo) }; } catch { geo = null; }
    }
    const m = await PEModel.create(device, { varAt: manipVarAt, lat: num('lat'), lon: num('lon'), cont: num('cont'), hum: num('hum'), doy: dayOfYear($('date').value), hour: num('hour'),   // godzina startu: słońce w PE zgodne z domeną
      seed: drv.seed, geo, nest: { vgBuf, pgOff: grid.off.PGRID, ...NODES } });
    await m.spinup(SPIN, (f) => { $('wxNow').textContent = `The synoptic model is spinning up: ${Math.round(SPIN * f)} / ${SPIN} days…`; });
    // korekta klimatu: kopia modelu z zaburzonym stanem i innym losowaniem rdzenia arktycznego (własna pogoda) liczy CC_START dób
    // naprzód (próbki co 12 h), dalej w tle – zawsze CC_WIN dób przed symulacją (weatherTick)
    ccFetch();
    const mc = m.clone();
    mc.seed = (drv.seed || 1) + 7919;
    await mc.perturb(drv.seed || 1, 0.1);
    const nd0 = Math.round(2 * CC_START / 86400);
    for (let d = 0; d < nd0; d++) {
      for (let s = 0; s < 24; s++) mc.step();
      ccSample(mc.time - m.time, await pgOf(mc), 0.4 * (mc.halfDiur ?? m.halfDiur));
      if (d % 10 === 9) $('wxNow').textContent = `Climate correction: ${Math.round((d + 1) / 2)} / ${nd0 / 2} days…`;
    }
    ccUpdate(0);
    drv.start = m; drv.key = key;
    drv.ccModel = mc; drv.ccBusy = false;
    drv.fcModel = m.clone(); drv.fc = []; drv.fcBusy = false;
  }

  // Restart: stan bazowy z masy powietrza nad środkiem domeny, pola docelowe w dwóch terminach,
  // stan początkowy z pól docelowych (na GPU), powierzchnia z lokalnej temperatury powietrza.
  let resetting = Promise.resolve();
  function reset() { resetting = resetting.then(doReset).catch((e) => fail(String(e.stack || e))); return resetting; }
  async function doReset() {
    sim.busy = true;
    manipFlat();
    if (drv.mode === 'syn') {
      await prepareModel();
      // w czasie rozbiegu użytkownik mógł wybrać scenariusz albo stałą masę – wtedy ten restart
      // ustępuje następnemu (już zakolejkowanemu)
      if (drv.mode !== 'syn') return;
      if (drv.model) drv.model.destroy();
      drv.model = drv.start.clone();
      const c = await drv.model.readCenter();
      for (const k of AIR_KEYS) $(k).value = c.air[k];
      sim.air = airParams();                      // edytor pokazuje bieżącą masę powietrza
      // wilgotność gleby domeny z modelu synoptycznego (wiadro 150 mm, woda dostępna = W/0.75) – po suchym miesiącu
      // domena nie startuje z mokrą glebą (za duże parowanie, chłodna i wilgotna warstwa graniczna, pokłady Sc)
      if (c.soil > 0) { $('soil').value = Math.round(100 * Math.min(1, c.soil / 0.75)); applyLand(); }
      // woda: temperatura morza z klimatu (opóźniona o ~miesiąc względem powietrza) – chyba że użytkownik ustawił suwak sam
      // (wcześniej każdy restart po zmianie suwaka nadpisywał go z klimatu: ustawione 29 °C wracało do 19 °C)
      if (!sim.waterUser) {
        const cw = climate(num('lat'), dayOfYear($('date').value) - 25, 0.9, 0).tDay;
        $('water').value = Math.min(30, Math.max(0, Math.round(2 * (cw + 1)) / 2));
      }
      drv.cls = classifyCenter(c);
    }
    rebuildBase();
    ccUpload();                                   // korekta klimatu (wyłączona przy stałej masie powietrza)
    if (drv.mode === 'syn') {
      buildSlot(0);
      buildSlot(2);                               // poprzedni termin = A (start bez historii)
      drv.pg0 = await readPGrid();
      drv.model.step();
      buildSlot(1);
    } else {
      drv.pg0 = paramGrid(sampler());
      buildSlot(0, drv.pg0);
      buildSlot(1, drv.pg0);
      buildSlot(2, drv.pg0);
    }
    drv.slot = 0; drv.tA = 0;
    // stan początkowy z pól docelowych (termin A) z poranną inwersją
    // (najpierw wyostrzenie frontów w chwili startu: krok „−1”, waga terminu 0 – Φ trafia do bufora kroku 0)
    const ab = new ArrayBuffer(PARAM_BYTES);
    new Uint32Array(ab)[2] = 0xffffffff;
    new Float32Array(ab)[20] = 0;
    new Uint32Array(ab)[21] = 0;
    new Float32Array(ab)[23] = snd.cool(0, num('hour'));
    new Float32Array(ab)[33] = 1;
    device.queue.writeBuffer(paramBuf, 0, ab);
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    for (const k of [frontPhi, initState]) {
      pass.setPipeline(k.p);
      pass.setBindGroup(0, simBG, [0]);
      pass.dispatchWorkgroups(k.g[0], k.g[1]);
    }
    pass.end();
    device.queue.submit([enc.finish()]);
    device.queue.writeBuffer(workBuf, 0, new Float32Array(5 * N));
    device.queue.writeBuffer(workBuf, (W_MSC + 4 + 4 * CFG.MEB + 2 * NZ) * 4, new Float32Array(2 * CFG.MEB));   // średnia dobowa odchyłki θ i q_v
    // powierzchnia: temperatura gruntu = lokalna temperatura powietrza przy gruncie
    const sf = new Float32Array(NSF * NXY);
    const water = num('water') + 273.15;
    const doy = dayOfYear($('date').value);
    const cool0 = snd.cool(0, num('hour'));
    const tan = drv.mode === 'syn' ? num('tanom') : 0;      // anomalia temperatury (suwak Pogoda): powietrze, gleba i morze na starcie
    for (let c = 0; c < NXY; c++) {
      const isWater = sim.land && sim.land.cls[c] === 3;
      const pv = paramAt(drv.pg0, (c % NX) + 0.5, Math.floor(c / NX) + 0.5);
      const h = sim.h[c], tAir = airTz(pv, h) + tan + ccAt(h, pv[2], (c % NX) + 0.5, Math.floor(c / NX) + 0.5), ph = snd.pres(h);
      // morze (woda na poziomie morza) w trybie synoptycznym: ta sama klimatologia SST co model synoptyczny
      // (wcześniej formuła klimatu lądu: Zatoka Alaska w styczniu ~0 °C zamiast ~+6 °C); jeziora – z suwaka „woda”
      const sxy = isWater && h <= 1 && drv.mode === 'syn' && drv.model ? drv.model.seaTemp(((c % NX) + 0.5 - NXV / 2) * CFG.DX, (Math.floor(c / NX) + 0.5 - NYV / 2) * CFG.DY) : null;
      // (suwak ustawiony ręcznie – także morze)
      const wT = isWater && h <= 1 && drv.mode === 'syn' && !sim.waterUser ? (sxy ?? sstClim(latRow(c), doy)) + 273.15 + tan : water;
      const tg = isWater ? wT : tAir - cool0;
      sf[S.TS * NXY + c] = tg;
      // głębsza warstwa gleby ≈ średnia temperatura z ostatnich tygodni: norma klimatyczna dla daty,
      // wysokości i miejsca (steruje też fenologią), przesunięta ku bieżącej masie powietrza
      const cl = climate(latRow(c), doy, num('cont'), h);
      sf[S.TD * NXY + c] = isWater ? wT : 0.5 * (cl.tDay + 273.15 + tan) + 0.5 * (tAir - 0.5 * snd.tn);
      // fenologia na starcie: średnia z ostatnich ~15 dób ≈ norma sprzed tygodnia (+ anomalia z suwaka)
      sf[S.TPHA * NXY + c] = sf[S.TPH * NXY + c] = sf[S.TPHN * NXY + c] = climate(latRow(c), doy - 7, num('cont'), h).tDay + tan;
      // pokrywa śnieżna na starcie z normy klimatycznej (zima, wysokie góry)
      // (przy średniej −1 °C brak, −3 °C ~16 mm wody ≈ 6 cm śniegu, −8 °C ~56 mm; w górach więcej) – wcześniej
      // ok. 3× za dużo: cała nizina pod 20–30 cm śniegu trzymała mróz nawet przy adwekcji ciepła
      if (!isWater) sf[S.SWE * NXY + c] = Math.min(150, Math.max(0, (-1 - cl.tDay) * 8));
      if (sim.veg && sim.veg[c] === VEG.GLACIER) sf[S.SWE * NXY + c] = 200;
      sf[S.SND * NXY + c] = sf[S.SWE * NXY + c] / 250;                // śnieg uleżały (~250 kg/m³)
      sf[S.W * NXY + c] = sim.land ? sim.land.w[c] : num('soil') / 100;
      sf[S.SM1 * NXY + c] = sf[S.SM2 * NXY + c] = sf[S.SM3 * NXY + c] = soilS(sf[S.W * NXY + c]);
      sf[S.T2 * NXY + c] = tg - 273.15;
      sf[S.TMAX * NXY + c] = tg - 273.15; sf[S.TMIN * NXY + c] = tg - 273.15; sf[S.SNAGE * NXY + c] = 10;
      sf[S.TD2 * NXY + c] = dewpoint(Math.min(0.97, pv[5]) * qsat(tAir - cool0, ph), ph) - 273.15;
      sf[S.PSL * NXY + c] = pv[12];
    }
    device.queue.writeBuffer(sfcBuf, 0, sf);
    sim.startHour = num('hour');
    sim.doy0 = doy;
    sim.year = Number(($('date').value || '2026').slice(0, 4));
    sim.time = 0; sim.step = 0; sim.debt = 0; speedHist.length = 0;
    acc.days.clear(); acc.last = -1; sim.accInfo = ' since the start of the simulation';
    monReset();
    sim.stats = null;
    drv.synDirty = true;
    sim.busy = false;
    labels();
    drawPreview();
  }

  // wilgotność względna warstw gleby (θ/θs) z wody dostępnej 0…1 (więdnięcie 0.34 … polowa 0.70)
  function soilS(w) { return 0.34 + 0.36 * Math.min(1, Math.max(0, w)); }

  function setSoil() {
    // ustawia wilgotność gleby (z rozkładem zależnym od pokrycia) bez restartu
    applyLand();
    device.queue.writeBuffer(sfcBuf, S.W * NXY * 4, sim.land.w);
    const sm = sim.land.w.map(soilS);
    for (const n of ['SM1', 'SM2', 'SM3']) device.queue.writeBuffer(sfcBuf, S[n] * NXY * 4, sm);
  }

  // --- Parametry kroku ---
  const sliceJ = () => MG + Math.min(NYD - 1, Math.max(0, Math.floor(num('ys') * 1000 / CFG.DY)));
  function writeParams(n) {
    const ab = new ArrayBuffer(SLOT * n);
    const [ug, vgeo] = windUV();
    const lat = num('lat');
    for (let s = 0; s < n; s++) {
      const f = new Float32Array(ab, s * SLOT, PARAM_BYTES / 4);
      const u = new Uint32Array(ab, s * SLOT, PARAM_BYTES / 4);
      const t = sim.time + s * DT;
      const ck = clock(t);
      const sun = sunVector(lat, ck.doy, ck.hour);
      f[0] = DT; f[1] = t; u[2] = sim.step + s; f[3] = 0.012;
      f[4] = 15000; f[5] = 300; f[6] = ug; f[7] = vgeo;
      f[8] = 2 * OMEGA * Math.sin(lat * Math.PI / 180); f[9] = sun.x; f[10] = sun.y; f[11] = sun.z;
      f[12] = sun.s0; f[13] = num('zs'); f[14] = num('zt') * 1000; u[15] = sliceJ();
      u[16] = num('fieldH'); u[17] = num('fieldV');
      f[18] = drv.mode === 'syn' ? 0 : -num('wls') / 100;
      // waga czasowa pól docelowych (między terminem A i B), slot terminu A, przyciąganie swobodnej
      // atmosfery do dużej skali (τ = 12 h)
      f[19] = (t - drv.tA) / DTQ; f[20] = (t + DT - drv.tA) / DTQ; u[21] = drv.slot;
      f[24] = 1 / (48 * 3600);
      f[25] = drv.mode === 'syn' && drv.model ? 0.4 * drv.model.halfDiur : 0;   // cel przy gruncie − średnia dobowa
      f[26] = sim.hmax;                                                           // cień gór
      // słońce w każdym oczku: szerokość środka, deklinacja, kąt godzinny w środku mapy
      f[28] = lat; f[29] = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + ck.doy) / 365); f[30] = (ck.hour - 12) * 15 * Math.PI / 180;
      f[27] = $('hydro').checked ? 1 : 0;                                         // hydrologia
      f[31] = mAt('T', t);                                                        // manipulacja atmosfery: anomalia temperatury dużej skali, mnożnik opadu
      f[33] = mAt('R', t);
      // zmiana deklinacji [rad/dobę] – fenologia (dzień się wydłuża / skraca)
      f[32] = 23.44 * Math.PI / 180 * 2 * Math.PI / 365 * Math.cos(2 * Math.PI * (284 + ck.doy) / 365);
    }
    device.queue.writeBuffer(paramBuf, 0, ab);
  }

  function advanceTime(n) { sim.time += n * DT; sim.step += n; }

  function encodeSteps(enc, n, useTS) {
    const pass = enc.beginComputePass(useTS
      ? { timestampWrites: { querySet: ts.qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {});
    for (let s = 0; s < n; s++) {
      for (const k of sim.flat ? seqFlat : seqTerrain) {
        pass.setPipeline(k.p);
        pass.setBindGroup(0, simBG, [s * SLOT]);
        pass.dispatchWorkgroups(k.g[0], k.g[1]);
      }
    }
    pass.end();
  }

  // n kroków; przy przejściu przez termin pól docelowych – nowy termin z modelu synoptycznego
  function runSteps(n, measure) {
    let done = 0, first = true;
    while (done < n) {
      if (sim.time + DT > drv.tA + DTQ + 1e-6) { advanceDriver(); continue; }
      const m = Math.max(1, Math.min(n - done, MAX_STEPS, Math.floor((drv.tA + DTQ - sim.time) / DT + 1e-6)));
      writeParams(m);
      const enc = device.createCommandEncoder();
      const useTS = measure && first && ts && !ts.pending;
      encodeSteps(enc, m, useTS);
      if (useTS) {
        enc.resolveQuerySet(ts.qs, 0, 2, ts.resolve, 0);
        enc.copyBufferToBuffer(ts.resolve, 0, ts.read, 0, 16);
      }
      const cpuT0 = performance.now();
      device.queue.submit([enc.finish()]);
      if (useTS) {
        ts.pending = true;
        ts.read.mapAsync(GPUMapMode.READ).then(() => {
          const t = new BigUint64Array(ts.read.getMappedRange());
          const ms = Number(t[1] - t[0]) / 1e6 / m;
          ts.read.unmap();
          ts.pending = false;
          if (ms > 0) sim.msPerStep = sim.msPerStep ? 0.8 * sim.msPerStep + 0.2 * ms : ms;
        });
      } else if (measure && first && !ts) {
        device.queue.onSubmittedWorkDone().then(() => {
          const ms = (performance.now() - cpuT0) / m;
          sim.msPerStep = sim.msPerStep ? 0.8 * sim.msPerStep + 0.2 * ms : ms;
        });
      }
      advanceTime(m); done += m; first = false;
    }
  }

  // Diagnostyka: statystyki, średnie poziome i pola przy gruncie → jeden bufor do odczytu
  function encodeDiag(enc) {
    sim.diagT = sim.time;   // chwila, z której pochodzi kopia pól (odczyt dociera później – w trybie MAX nawet godzinę symulacji)
    enc.clearBuffer(statsBuf);
    const pass = enc.beginComputePass();
    for (const k of [statsPipe, meansPipe]) {
      pass.setPipeline(k.p);
      pass.setBindGroup(0, simBG, [0]);
      pass.dispatchWorkgroups(k.g[0], k.g[1]);
    }
    pass.end();
    enc.copyBufferToBuffer(statsBuf, 0, diagRead, 0, STATS_BYTES);
    enc.copyBufferToBuffer(workBuf, W_MEAN * 4, diagRead, STATS_BYTES, 16 * NZ);
    enc.copyBufferToBuffer(workBuf, W_MUV * 4, diagRead, MUV_OFF, 8 * NZ);
    enc.copyBufferToBuffer(sfcBuf, 0, diagRead, STATS_BYTES + 16 * NZ, NSF * NXY * 4);
    if (sim.probe) {
      const col = sim.probe.j * NX + sim.probe.i;
      const offs = [0, N, T_OFF, QV_OFF, QV_OFF + N, QV_OFF + 2 * N, QV_OFF + 3 * N];   // u, v, θ', qv, qc, qi, qr
      offs.forEach((o, f) => {
        for (let k = 0; k < NZ; k++) enc.copyBufferToBuffer(stateBuf, (o + k * NXY + col) * 4, diagRead, PROBE_OFF + (f * NZ + k) * 4, 4);
      });
      for (let k = 0; k <= NZ; k++) enc.copyBufferToBuffer(stateBuf, (2 * N + k * NXY + col) * 4, diagRead, PROBE_OFF + (7 * NZ + k) * 4, 4);
      sim.probeEnc = col;
    } else sim.probeEnc = -1;
    // powietrze modelu na wysokości stacji położonych wyżej niż grunt modelu w oczku (stations.js reading)
    let req = [];
    try { req = stations.airReq().slice(0, ST_AIR); } catch { req = []; }
    req.forEach((q, n) => {
      let la = sim.kb[q.col];
      while (la + 1 < NZ - 1 && grid.zc[la + 1] <= q.zs) la++;
      q.la = la; q.lb = Math.min(la + 1, NZ - 1);
      [q.la, q.lb].forEach((k, m) => {
        const c = k * NXY + q.col, o = ST_AIR_OFF + (12 * n + 6 * m) * 4;
        [T_OFF + c, QV_OFF + c, c, c + 1, N + c, N + c + NX].forEach((src, f) => enc.copyBufferToBuffer(stateBuf, src * 4, diagRead, o + f * 4, 4));
      });
    });
    sim.stReqEnc = req;
  }

  function readDiag() {
    sim.statsPending = true;
    return diagRead.mapAsync(GPUMapMode.READ).then(() => {
      const raw = diagRead.getMappedRange().slice(0);
      diagRead.unmap();
      const st = Array.from(new Float32Array(raw, 0, 16));
      const keys = new Uint32Array(raw, 0, 16), tu = new Uint32Array(1), tf = new Float32Array(tu.buffer);
      const dec = (k) => { if (k === 0) return NaN; tu[0] = k & 0x80000000 ? k ^ 0x80000000 : ~k; return tf[0]; };
      for (let i = 6; i <= 10; i += 2) { st[i] = dec(keys[i]); st[i + 1] = -dec(keys[i + 1]); }
      st[14] = keys[14];
      sim.stats = st;
      sim.means = new Float32Array(raw, STATS_BYTES, 4 * NZ);
      sim.meanUV = new Float32Array(raw, MUV_OFF, 2 * NZ);
      sim.sfc = new Float32Array(raw, STATS_BYTES + 16 * NZ, NSF * NXY);
      sim.sfcT = sim.diagT;
      sim.probeCol = sim.probeEnc >= 0 ? new Float32Array(raw, PROBE_OFF, PROBE_N) : null;
      sim.probeColAt = sim.probeEnc;
      // stacje na szczytach: powietrze na wysokości stacji (liniowo między poziomami; poniżej pierwszego poziomu nad gruntem –
      // od wartości przy gruncie: T i Td 2 m, wiatr 10 m)
      const req = sim.stReqEnc || [], air = new Map();
      if (req.length) {
        const a = new Float32Array(raw, ST_AIR_OFF, ST_AIR * 12);
        const lev = (k, o) => ({
          T: (grid.data[grid.off.TC + k] + a[o]) * grid.data[grid.off.EXC + k] - 273.15,
          Td: dewpoint(Math.max(a[o + 1], 1e-7), grid.data[grid.off.PRS + k]) - 273.15,
          ua: 0.5 * (a[o + 2] + a[o + 3]), va: 0.5 * (a[o + 4] + a[o + 5]),
        });
        const mixr = (A, B, w) => ({ T: A.T + (B.T - A.T) * w, Td: A.Td + (B.Td - A.Td) * w, ua: A.ua + (B.ua - A.ua) * w, va: A.va + (B.va - A.va) * w });
        req.forEach((q, n) => {
          const A = lev(q.la, 12 * n), B = lev(q.lb, 12 * n + 6), za = grid.zc[q.la], zb = grid.zc[q.lb];
          let r = mixr(A, B, zb > za ? Math.min(1, Math.max(0, (q.zs - za) / (zb - za))) : 0);
          if (q.zs < za) {
            const v = (nm) => sim.sfc[S[nm] * NXY + q.col], z0 = sim.h[q.col] + 2;
            r = mixr({ T: v('T2'), Td: v('TD2'), ua: v('UA'), va: v('VA') }, A, Math.min(1, Math.max(0, (q.zs - z0) / Math.max(za - z0, 1))));
          }
          air.set(q.s, r);
        });
      }
      sim.stAir = air;
      recordMeteo();
      if (curTab() === 'mon' && document.body.classList.contains('drawer')) monTable(false);
      if (monFld() && !monLive() && monSelPer()?.cur) monShow();    // okres analiz z bieżącym miesiącem – mapa na bieżąco
      sim.statsPending = false;
    });
  }

  function resizeCanvas(c, scale = 1) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * scale;
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  // Zakres kolorów dla widoku na podstawie min/max ze statystyk
  function viewRange(v) {
    const id = v.mode === 0 ? num('fieldH') : num('fieldV');
    const st = sim.stats;
    let lo = NaN, hi = NaN;
    if (st) {
      if (v.mode === 1) { hi = st[8]; lo = st[9]; }
      else if (id >= 20) { hi = st[10]; lo = st[11]; }
      else { hi = st[6]; lo = st[7]; }
    }
    return { id, ...rangeFor(id, lo, hi, { contrast: Math.pow(2, -num('range')), hmax: sim.hmax, nIso: v.mode === 1 ? 20 : 8, vertical: v.mode === 1 }) };
  }

  function encodeRender(enc) {
    const ck = clock(sim.time);
    const sun = sunVector(num('lat'), ck.doy, ck.hour);
    for (const v of views) {
      if (v.mode === 0 && v3.on) {
        resizeCanvas(v.canvas, 0.6);              // widok 3D w mniejszej rozdzielczości (wygładza przeglądarka)
        encode3D(enc, v);
        continue;
      }
      resizeCanvas(v.canvas);
      const r = viewRange(v);
      v.range = r;
      const ab = new ArrayBuffer(VIEW_BYTES);
      const f = new Float32Array(ab), u = new Uint32Array(ab);
      f[0] = v.canvas.width; f[1] = v.canvas.height;
      u[2] = v.mode; u[3] = r.id;
      f[4] = MG + num('ys') * 1000 / CFG.DY; f[5] = num('zs'); f[6] = num('zt') * 1000;
      f[7] = r.lo; f[8] = r.hi; f[9] = r.iso; f[10] = DT; u[11] = $('overlay').checked ? 1 : 0;
      f[12] = sun.x; f[13] = sun.y; f[14] = sun.z; f[15] = sim.hmax; f[16] = num('cloudAlpha') / 100;
      u[17] = ($('reliefShade').checked ? 1 : 0) | ($('reliefIso').checked ? 2 : 0)
        | ($('clLow').checked ? 4 : 0) | ($('clMid').checked ? 8 : 0) | ($('clHigh').checked ? 16 : 0)
        | ($('windArrows').checked ? 32 : 0) | ($('gridLines').checked ? 64 : 0);
      f[18] = (performance.now() / 1000) % 1000;            // czas do migania błyskawic
      f[19] = cuc.ph; f[27] = cuc.nx; f[28] = cuc.ny; f[29] = cuc.N[0]; f[30] = cuc.N[1]; f.set(cuc.D, 36); f.set(cuc.D2, 36 + 144);   // zegar i przesunięcie wzoru cumulusów (cuGen)
      f[31] = sim.time - mon.t0; f[32] = mon.days; f[33] = monLive() ? 1 : 0;   // analizy klimatyczne: sam bieżący miesiąc – z liczników
      if (demHiOk()) { f[20] = DEMF; f[21] = sim.demHi.hmax; }        // gęstszy teren do obrazu (loadDemHi)
      if (v.mode === 0) { f[22] = mz.x; f[23] = mz.y; f[24] = mz.s; } else { f[24] = 1; }   // zoom (tylko mapa)
      f[25] = psumF(r.id);                                    // skala sumy opadu wg okresu (albo miesiąca)
      f[26] = Math.min(10000, Math.max(3000, 2 * CFG.DX)) * (v3.newView ? 1 : Math.max(1, 0.5 * exagAuto * v3.exagMul));   // bok siatki cumulusów jak w 3D
      device.queue.writeBuffer(v.ubuf, 0, ab);
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: v.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
      });
      pass.setPipeline(renderPipe);
      pass.setBindGroup(0, v.bg);
      pass.draw(3);
      pass.end();
    }
  }


  // Widok 3D: przygotowanie objętości chmur i światła, kamera orbitalna, śledzenie promieni
  const cxyEl = $('cxy');
  const LXm = NXD * CFG.DX, LYm = NYD * CFG.DY;
  const exagAuto = Math.min(8, Math.max(1, LXm / 80000));   // łagodne przewyższenie (×6 na 500 km)
  function encode3D(enc, v) {
    const ck = clock(sim.time);
    const sun = sunVector(num('lat'), ck.doy, ck.hour);
    const zTop = Math.min(CFG.HTOP, 16000);
    v3.newView = $('v3new').checked;
    // nowy widok: księżyc; cienie (tekstura światła) rzuca księżyc, gdy słońce jest > 4° pod horyzontem, a księżyc nad nim
    const mo = v3.newView ? moonSky(num('lat'), sim.year, ck.doy, ck.hour, num('lon') || 19) : null;
    const moonSh = !!mo && sun.elev < -4 && mo.z > 0;
    const shL = moonSh ? mo : sun;
    {
      const ab = new ArrayBuffer(32), f = new Float32Array(ab);
      f[0] = shL.x; f[1] = shL.y; f[2] = shL.z; f[3] = (moonSh || sun.z > -0.05) ? 1 : 0;
      f[4] = zTop; f[5] = Math.min(1, Math.max(0, (CFG.DX - 500) / 1500));
      // wygładzenie w czasie: część nowego stanu z upływu czasu symulacji od poprzedniej klatki (τ 10 min);
      // pierwsza klatka, restart albo długa przerwa – od razu bieżący stan
      const dts = sim.time - (v3.lastT ?? -1e9);
      const wall = performance.now(), gap = wall - (v3.lastWall ?? -1e9);   // widok 3D był wyłączony – tekstura nieaktualna
      // (przy dużym tempie także ≥ 1.5 s rzeczywistego – w trybie MAX 10 min symulacji to ~0.2 s i chmury „wyskakiwały”)
      f[6] = dts < 0 || dts > 6 * 3600 || gap > 1500 ? 1 : Math.min(1, dts / Math.max(600, 1.5 * cuc.rate));
      v3.lastT = sim.time; v3.lastWall = wall;
      device.queue.writeBuffer(volP, 0, ab);
    }
    enc.copyTextureToTexture({ texture: densTex }, { texture: densPrev }, [NXD, NYD, NZ]);
    const tsOn = ts3 && !ts3.pending && !ts3.armed;
    const tw = (a) => (tsOn ? { timestampWrites: { querySet: ts3.qs, beginningOfPassWriteIndex: a, endOfPassWriteIndex: a + 1 } } : {});
    const pass = enc.beginComputePass(tw(0));
    const wg = [Math.ceil(NXD / 4), Math.ceil(NYD / 4), Math.ceil(NZ / 4)];
    pass.setPipeline(pGround); pass.setBindGroup(0, bGround); pass.dispatchWorkgroups(Math.ceil(NXD / 8), Math.ceil(NYD / 8));
    pass.setPipeline(pVol); pass.setBindGroup(0, bVol); pass.dispatchWorkgroups(...wg);
    pass.end();
    const pass2 = enc.beginComputePass(tw(2));
    pass2.setPipeline(pLight); pass2.setBindGroup(0, bLight); pass2.dispatchWorkgroups(...wg);
    if (v3.newView) {
      // profil średni domeny co klatkę, tablice nieba co 16 klatek (zależą tylko od profilu aerozolu)
      pass2.setPipeline(pStats); pass2.setBindGroup(0, bStats); pass2.dispatchWorkgroups(NZ + 1);
      if ((v3.lutN = ((v3.lutN ?? -1) + 1) % 16) === 0) {
        pass2.setPipeline(pTrans); pass2.setBindGroup(0, bTrans); pass2.dispatchWorkgroups(32, 8);
        pass2.setPipeline(pMS); pass2.setBindGroup(0, bMS); pass2.dispatchWorkgroups(4, 4);
        pass2.setPipeline(pIrr); pass2.setBindGroup(0, bIrr); pass2.dispatchWorkgroups(4, 4);
      }
    }
    pass2.end();
    // kamera: orbita wokół środka domeny albo wolny lot (skala 1:1)
    const F = v3.fly;
    // nowy widok: skala 1:1, przewyższenie tylko z suwaka; stary: automatyczne (L/80 km, 1–8) × suwak
    const ex = F.on ? 1 : (v3.newView ? 1 : exagAuto) * v3.exagMul;
    const W = v.canvas.width, H = v.canvas.height;
    const tg = [LXm / 2, LYm / 2, 1200 * ex];
    const R = Math.max(LXm, LYm) * 1.3 * v3.dist;
    const cp = Math.cos(v3.pitch), sp = Math.sin(v3.pitch);
    const nrm = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };
    const pos = F.on ? F.pos.slice() : [tg[0] + R * cp * Math.sin(v3.yaw), tg[1] - R * cp * Math.cos(v3.yaw), tg[2] + R * sp];
    const fwd = F.on ? [Math.cos(F.pitch) * Math.sin(F.yaw), Math.cos(F.pitch) * Math.cos(F.yaw), Math.sin(F.pitch)]
      : nrm([tg[0] - pos[0], tg[1] - pos[1], tg[2] - pos[2]]);
    const right = nrm([fwd[1], -fwd[0], 0]);
    const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
    // kierunek wiatru na ~9 km (włókna cirrusów)
    let wu = 1, wv = 0;
    if (drv.pg0) {
      const pvc = paramAt(drv.pg0, NXV / 2, NYV / 2);
      wu = pvc[7] + pvc[9] * 9000; wv = pvc[8] + pvc[10] * 9000;
      const wl = Math.hypot(wu, wv) || 1; wu /= wl; wv /= wl;
    }
    const frame = v3.frame++ % 64;
    if (v3.newView) {
      // układ kamery: domena „owinięta” na kuli wokół kamery – kierunki ze środka domeny obrócone o kąt (odległość kamery od środka
      // domeny) / R (Rodrigues, oś ẑ × D); obrót do układu równikowego z czasu gwiazdowego i szerokości (gwiazdy)
      const ddx = pos[0] - LXm / 2, ddy = pos[1] - LYm / 2, dd = Math.hypot(ddx, ddy), th = -dd / 6.36e6;
      const kx = dd > 0 ? -ddy / dd : 0, ky = dd > 0 ? ddx / dd : 0, cth = Math.cos(th), sth = Math.sin(th);
      const rot = (a) => {
        const kv = kx * a[0] + ky * a[1];
        return [a[0] * cth + ky * a[2] * sth + kx * kv * (1 - cth), a[1] * cth - kx * a[2] * sth + ky * kv * (1 - cth), a[2] * cth + (kx * a[1] - ky * a[0]) * sth];
      };
      const phi = num('lat') * Math.PI / 180, cl = Math.cos(mo.lst), sl = Math.sin(mo.lst);
      const eq = [[-sl, -cl * Math.sin(phi), cl * Math.cos(phi)], [cl, -sl * Math.sin(phi), sl * Math.cos(phi)], [0, Math.cos(phi), Math.sin(phi)]].map(rot);
      // oświetlenie przez księżyc względem słońca: pełnia 0.26 lx (2·10⁻⁶), faza wg Allena (kąt fazowy z elongacji)
      const ph = 180 - Math.acos(Math.max(-1, Math.min(1, sun.x * mo.x + sun.y * mo.y + sun.z * mo.z))) * 180 / Math.PI;
      const eMoon = 2.0e-6 * Math.pow(10, -0.4 * (0.026 * ph + 4e-9 * ph ** 4));
      const an = new ArrayBuffer(1392), g = new Float32Array(an), gu = new Uint32Array(an);
      g.set(pos, 0); g[3] = Math.tan(0.45);
      g.set(right, 4); g[7] = W / H;
      g.set(up, 8); g[11] = ex;
      g.set(fwd, 12); g[15] = sim.time;
      g[16] = shL.x; g[17] = shL.y; g[18] = shL.z; g[19] = (moonSh || sun.z > 0) ? 1 : 0;
      g[20] = W; g[21] = H; g[22] = zTop; g[23] = Math.min(10000, Math.max(3000, 2 * CFG.DX));
      g[24] = wu; g[25] = wv; g[26] = frame; g[27] = moonSh ? 1 : 0;
      gu[28] = ($('v3frz').checked ? 1 : 0) | ($('v3cut').checked ? 2 : 0);
      g[29] = num('ys') * 1000; g[30] = cuc.ph; g[31] = cuc.nx;
      g[32] = cuc.ny; g[33] = mo.z > -0.1 ? 0.031 : 0; g[34] = 2 * Math.tan(0.45) / H;
      g.set(cuc.N, 36);
      g.set([...rot([sun.x, sun.y, sun.z]), sun.elev > -20 ? 1 : 0], 40);
      g.set([...rot([mo.x, mo.y, mo.z]), moonSh ? eMoon : 0], 44);
      g.set(eq[0], 48); g.set(eq[1], 52); g.set(eq[2], 56);
      g.set(cuc.D, 60); g.set(cuc.D2, 60 + 144);
      device.queue.writeBuffer(v3nU, 0, an);
    }
    const ab = new ArrayBuffer(160 + 2 * 576), f = new Float32Array(ab), u = new Uint32Array(ab);
    f.set(pos, 0); f[3] = Math.tan(0.45);
    f.set(right, 4); f[7] = W / H;
    f.set(up, 8); f[11] = ex;
    f.set(fwd, 12); f[15] = sim.time;
    f[16] = sun.x; f[17] = sun.y; f[18] = sun.z; f[19] = sun.z > 0 ? 1 : 0;
    f[20] = W; f[21] = H; f[22] = zTop; f[23] = Math.min(10000, Math.max(3000, 2 * CFG.DX));   // odstęp kłębów chmur kłębiastych (skupiska ~2 oczek; jak cuBlob w render.wgsl)
    f[24] = wu; f[25] = wv; f[26] = frame; f[27] = Math.max(150000, 6 * LXm);   // zasięg mgły powietrznej (przy 2.5·L domena 350 km była zamglona w ~40%)
    u[28] = ($('v3frz').checked ? 1 : 0) | ($('v3cut').checked ? 2 : 0);
    f[29] = num('ys') * 1000;                                    // przekrój tnący w miejscu przekroju pionowego
    f[30] = cuc.ph; f[31] = cuc.nx; f[32] = cuc.ny; f.set(cuc.N, 36); f.set(cuc.D, 40); f.set(cuc.D2, 40 + 144);   // zegar i przesunięcie wzoru cumulusów (cuGen)
    device.queue.writeBuffer(v3U, 0, ab);
    const hd = v3.newView ? hdrOf(W, H) : null;
    const rp = enc.beginRenderPass({
      colorAttachments: [{ view: hd ? hd.view : v.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }], ...tw(4),
    });
    rp.setPipeline(v3.newView ? p3n : p3);
    rp.setBindGroup(0, v3.newView ? b3n : b3);
    rp.draw(3);
    rp.end();
    if (hd) {
      const ep = enc.beginComputePass();
      ep.setPipeline(pExpo); ep.setBindGroup(0, hd.bExpo); ep.dispatchWorkgroups(1);
      ep.end();
      const pp = enc.beginRenderPass({
        colorAttachments: [{ view: v.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
      });
      pp.setPipeline(pPost); pp.setBindGroup(0, hd.bPost); pp.draw(3);
      pp.end();
    }
    if (tsOn) {
      enc.resolveQuerySet(ts3.qs, 0, 6, ts3.resolve, 0);
      enc.copyBufferToBuffer(ts3.resolve, 0, ts3.read, 0, 48);
      ts3.armed = true;
    }
  }

  // zrzut ekranu mapy / widoku 3D (PNG) i nagrywanie timelapse (WebM, ok. 30 kl./s)
  const stamp = () => { const ck = clock(sim.time); return `${dateFromDoy(sim.year, ck.doy).replace(/\s/g, '-')}_${String(Math.floor(ck.hour)).padStart(2, '0')}${String(Math.floor((ck.hour % 1) * 60)).padStart(2, '0')}`; };
  const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  function snapshot() { cxyEl.toBlob((b) => { if (b) { download(b, `weather3d_${stamp()}.png`); toast('PNG image saved'); } }, 'image/png'); }
  $('snapBtn').addEventListener('click', () => { sim.snapReq = true; });
  let rec = null;
  $('recBtn').addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    const chunks = [];
    rec = new MediaRecorder(cxyEl.captureStream(30), { mimeType: mime, videoBitsPerSecond: 8e6 });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => { download(new Blob(chunks, { type: 'video/webm' }), `weather3d_timelapse_${stamp()}.webm`); rec = null; $('recBtn').classList.remove('rec'); $('recBtn').textContent = '⏺ Record'; toast('Timelapse saved (WebM)'); };
    rec.start(1000);
    toast('Recording… click “Stop” to save the file');
    $('recBtn').classList.add('rec'); $('recBtn').textContent = '⏹ Stop';
  });

  function setView3D(on) {
    if (!on && v3.fly && v3.fly.on) setFly(false);     // wyjście z 3D kończy lot
    v3.on = on;
    document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', (b.dataset.v === '3d') === on));
    for (const id of ['north', 'scale', 'legXY']) $(id).style.display = on ? 'none' : '';
    $('ctl3d').style.display = on ? '' : 'none';
    $('tip').style.display = 'none';
    cxyEl.style.cursor = on ? 'grab' : 'crosshair';
    if (sim.fitMap) sim.fitMap();
    if (sim.stations) sim.stations.setVisible(!on);
    labels();
  }
  document.querySelectorAll('#viewSeg button').forEach((b) => b.addEventListener('click', () => setView3D(b.dataset.v === '3d')));
  const exagLabel = () => { $('exag3V').textContent = `×${(($('v3new').checked ? 1 : exagAuto) * v3.exagMul).toFixed(1)}`; };
  $('exag3').addEventListener('input', () => { v3.exagMul = Math.pow(2, num('exag3')); exagLabel(); });
  $('v3new').addEventListener('change', () => { v3.newView = $('v3new').checked; v3.lutN = undefined; exagLabel(); });   // tablice nieba od razu
  exagLabel();
  cxyEl.addEventListener('pointerdown', (e) => {
    if (!v3.on) return;
    cxyEl.setPointerCapture(e.pointerId);
    v3.drag = { x: e.clientX, y: e.clientY, yaw: v3.yaw, pitch: v3.pitch, fyaw: v3.fly.yaw, fpitch: v3.fly.pitch };
    cxyEl.style.cursor = 'grabbing';
  });
  cxyEl.addEventListener('pointermove', (e) => {
    if (!v3.on || !v3.drag) return;
    if (v3.fly.on) {
      // lot: przeciąganie obraca głowę (w prawo – patrzymy w prawo, w górę – w górę)
      v3.fly.yaw = v3.drag.fyaw + (e.clientX - v3.drag.x) * 0.004;
      v3.fly.pitch = Math.min(1.5, Math.max(-1.5, v3.drag.fpitch - (e.clientY - v3.drag.y) * 0.004));
      return;
    }
    v3.yaw = v3.drag.yaw - (e.clientX - v3.drag.x) * 0.006;
    v3.pitch = Math.min(1.45, Math.max(0.03, v3.drag.pitch + (e.clientY - v3.drag.y) * 0.005));
  });
  cxyEl.addEventListener('pointerup', () => { if (v3.on) { v3.drag = null; cxyEl.style.cursor = 'grab'; } });
  cxyEl.addEventListener('wheel', (e) => {
    if (!v3.on) return;
    e.preventDefault();
    if (v3.fly.on) { v3.fly.speed = Math.min(20000, Math.max(5, v3.fly.speed * Math.exp(-e.deltaY * 0.0015))); return; }
    v3.dist = Math.min(3, Math.max(0.2, v3.dist * Math.exp(e.deltaY * 0.0012)));
  }, { passive: false });
  cxyEl.addEventListener('dblclick', () => { if (v3.on && !v3.fly.on) { v3.yaw = -0.55; v3.pitch = 0.38; v3.dist = 1; } });

  // ---- wolna kamera (lot): skala 1:1 (bez przewyższenia), WASD + mysz, kółko – prędkość ----
  v3.fly = { on: false, pos: [0, 0, 2500], yaw: 0, pitch: -0.08, speed: 300, keys: new Set() };
  // wysokość terenu w punkcie (x, y) widocznej domeny [m]; poza domeną 0
  const groundAt = (x, y) => {
    const i = Math.floor(x / CFG.DX), j = Math.floor(y / CFG.DY);
    return i >= 0 && j >= 0 && i < NXD && j < NYD && sim.h ? sim.h[(j + MG) * NX + i + MG] : 0;
  };
  function setFly(on) {
    const F = v3.fly;
    F.on = on; F.keys.clear();
    if (on) {
      if (!v3.on) setView3D(true);
      // start: nad południowym brzegiem domeny, 2.5 km nad gruntem, wzrok na północ
      F.pos = [LXm / 2, 0.02 * LYm, groundAt(LXm / 2, 0.02 * LYm) + 2500]; F.yaw = 0; F.pitch = -0.08;
    }
    $('flyBtn').classList.toggle('on', on);
    $('exag3').disabled = on;
    $('flyV').textContent = '';
    toast(on ? 'Fly: WASD – move, space/E – up, C/Q – down, mouse – look around, wheel – speed, Shift ×5, Esc – end' : 'Flight ended');
  }
  $('flyBtn').addEventListener('click', () => setFly(!v3.fly.on));
  const FLY_KEYS = ['w', 'a', 's', 'd', ' ', 'e', 'q', 'c', 'shift'];
  // (faza przechwytywania na window – przed skrótami interfejsu: W, A, S, spacja itd. w locie nie przełączają paneli)
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.closest && t.closest('select, textarea, input:not([type=range]):not([type=checkbox])')) return;
    const k = e.key.toLowerCase();
    if (k === 'l' && v3.on) { setFly(!v3.fly.on); e.stopPropagation(); e.preventDefault(); return; }
    if (!v3.on || !v3.fly.on) return;
    if (k === 'escape') { setFly(false); e.stopPropagation(); e.preventDefault(); return; }
    if (FLY_KEYS.includes(k)) { v3.fly.keys.add(k); e.stopPropagation(); e.preventDefault(); }
  }, true);
  window.addEventListener('keyup', (e) => { v3.fly.keys.delete(e.key.toLowerCase()); }, true);
  window.addEventListener('blur', () => v3.fly.keys.clear());
  function flyTick(dt) {
    const F = v3.fly;
    if (!F.on || !v3.on) return;
    if (F.keys.size) {
      const sp = F.speed * (F.keys.has('shift') ? 5 : 1) * dt;
      const cp = Math.cos(F.pitch), fw = [cp * Math.sin(F.yaw), cp * Math.cos(F.yaw), Math.sin(F.pitch)], rt = [Math.cos(F.yaw), -Math.sin(F.yaw), 0];
      const m = [0, 0, 0];
      const add = (v, s) => { for (let i = 0; i < 3; i++) m[i] += v[i] * s; };
      if (F.keys.has('w')) add(fw, 1);
      if (F.keys.has('s')) add(fw, -1);
      if (F.keys.has('d')) add(rt, 1);
      if (F.keys.has('a')) add(rt, -1);
      if (F.keys.has(' ') || F.keys.has('e')) m[2] += 1;
      if (F.keys.has('c') || F.keys.has('q')) m[2] -= 1;
      for (let i = 0; i < 3; i++) F.pos[i] += m[i] * sp;
      // granice: do pół domeny poza brzegiem, do 30 km w górę, nie pod grunt
      F.pos[0] = Math.min(1.5 * LXm, Math.max(-0.5 * LXm, F.pos[0]));
      F.pos[1] = Math.min(1.5 * LYm, Math.max(-0.5 * LYm, F.pos[1]));
      F.pos[2] = Math.min(30000, Math.max(groundAt(F.pos[0], F.pos[1]) + 20, F.pos[2]));
    }
    const v = F.speed * (F.keys.has('shift') ? 5 : 1);
    $('flyV').textContent = `${isImp() ? fm(v, 'm/s') : v >= 1000 ? (v / 1000).toFixed(1) + ' km/s' : Math.round(v) + ' m/s'} · ${isImp() ? fmH(F.pos[2]) : (F.pos[2] / 1000).toFixed(2) + ' km'} a.s.l.`;
  }
  sim.fly = (on, pos, yaw, pitch) => { setFly(on); if (on && pos) { v3.fly.pos = pos.slice(); v3.fly.yaw = yaw ?? 0; v3.fly.pitch = pitch ?? 0; } };

  // ======================= Interfejs =======================
  // Domyślne pozycje „Most used” (zakładka Layers): pole na mapie (H) i na przekroju pionowym (V, ustawiane przy wyborze z tej listy)
  const MODES = [
    { name: 'Temperature 2 m', V: 0, H: 20 },
    { name: 'Precipitation rate', V: 6, H: 22 },
    { name: 'Total precipitation', V: 6, H: 23, acc: 0 },
    { name: 'Satellite', V: 5, H: 29 },
    { name: 'Wind 10 m', V: 12, H: 50 },
  ];

  // --- menu (pasek ikon po lewej): klik otwiera wysuwany panel nad mapą, ponowny klik / × / Esc go chowa ---
  const TAB_TITLES = { wx: 'Weather', atm: 'Atmosphere', ter: 'Terrain', view: 'Layers', mon: 'Climate analysis', set: 'Settings' };
  const curTab = () => { const b = document.querySelector('#tabs button.on'); return b ? b.dataset.tab : 'wx'; };
  function selectTab(name, open) {
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === name));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.panel === name));
    if (open !== undefined) document.body.classList.toggle('drawer', open);
    if (name === 'atm') requestAnimationFrame(() => drawSnd(true));
    if (name === 'wx') requestAnimationFrame(() => { wxModeUi(); drawSyn(); drawForecast(); drawPreview(); });
    if (name === 'mon') monTable(true);
    if (name === 'view') { if (layTabCur === 'most') layMostBuild(); layMark(true); }
    savePrefs();
  }
  const setDrawer = (open) => { document.body.classList.toggle('drawer', open); if (open) selectTab(curTab()); };
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => {
    const open = document.body.classList.contains('drawer');
    if (open && b.dataset.tab === curTab()) setDrawer(false);
    else selectTab(b.dataset.tab, true);
  }));
  document.querySelectorAll('.tclose').forEach((b) => { b.onclick = () => setDrawer(false); });
  // --- panel analiz (po prawej): przekrój, sonda, stacje; chowany przyciskiem „Analizy” / klawiszem A ---
  const curAna = () => { const b = document.querySelector('#anaSeg button.on'); return b ? b.dataset.a : 'xz'; };
  function selectAna(a) {
    document.querySelectorAll('#anaSeg button').forEach((x) => x.classList.toggle('on', x.dataset.a === a));
    document.querySelectorAll('.apanel').forEach((q) => q.classList.toggle('on', q.dataset.ap === a));
    savePrefs();
  }
  document.querySelectorAll('#anaSeg button').forEach((b) => b.addEventListener('click', () => selectAna(b.dataset.a)));
  function setAna(on) {
    document.body.classList.toggle('noana', !on);
    $('anaBtn').classList.toggle('on', on);
    savePrefs();
  }
  $('anaBtn').onclick = () => setAna(document.body.classList.contains('noana'));

  // --- udogodnienia: komunikaty, pomoc, pełny ekran, zwijane panele, zapamiętane ustawienia widoku ---
  let toastT = 0;
  function toast(msg, ms = 2600) {
    const el = $('toast'); el.textContent = msg; el.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), ms);
  }
  const showHelp = (on) => $('helpDlg').classList.toggle('on', on);
  $('helpBtn').onclick = () => showHelp(true);
  $('helpClose').onclick = () => showHelp(false);
  $('helpDlg').addEventListener('click', (e) => { if (e.target === $('helpDlg')) showHelp(false); });
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if ($('mapBox').requestFullscreen) $('mapBox').requestFullscreen().catch(() => toast('Full screen is not available'));
  };
  $('fsBtn').onclick = toggleFs;
  document.querySelectorAll('.view .vhead h3').forEach((h) => h.addEventListener('click', () => {
    h.closest('.view').classList.toggle('collapsed'); savePrefs();
  }));
  const PREF_CHECKS = ['tipOn', 'overlay', 'reliefShade', 'reliefIso', 'windArrows', 'cityOn', 'gridLines', 'clLow', 'clMid', 'clHigh', 'v3frz', 'v3cut', 'v3new'];
  function savePrefs() {
    try {
      const p = { tab: curTab(), layT: layTabCur, layOpen: [...document.querySelectorAll('#layGroups .lygrp.open')].map((g) => g.dataset.g), synView: $('synLevel').value, synO: syn.o, manipOpen: $('manipBox').open, ana: curAna(), anaOn: !document.body.classList.contains('noana'), profMode: sim.profModePref || 'point',
        checks: Object.fromEntries(PREF_CHECKS.map((id) => [id, $(id).checked])), cloudAlpha: $('cloudAlpha').value,
        collapsed: [...document.querySelectorAll('.view')].map((v) => v.classList.contains('collapsed')) };
      localStorage.setItem('w3d-ui', JSON.stringify(p));
    } catch (e) { /* brak pamięci przeglądarki – bez zapamiętywania */ }
  }
  function loadPrefs() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem('w3d-ui') || 'null'); } catch (e) { p = null; }
    if (!p) return;
    for (const [id, v] of Object.entries(p.checks || {})) if ($(id)) $(id).checked = !!v;
    if (p.cloudAlpha !== undefined) $('cloudAlpha').value = p.cloudAlpha;
    // (anomalia temperatury nie jest zapamiętywana – zawsze start od 0: ustawione kiedyś +6 K zostawało w kolejnych sesjach, cała
    // troposfera o 6 K cieplejsza przy tej samej wilgotności względnej – ~50% więcej pary, latem CAPE ~5000 J/kg)
    if (p.tab && TAB_TITLES[p.tab]) selectTab(p.tab);       // menu zostaje schowane – czysty ekran na starcie
    if (p.ana) selectAna(p.ana);
    if (p.layT) layTab(p.layT);
    for (const g of p.layOpen || []) document.querySelector(`.lygrp[data-g="${g}"]`)?.classList.add('open');
    if (p.synView && SYN_VIEWS[p.synView]) $('synLevel').value = p.synView;
    if (p.synO) Object.assign(syn.o, p.synO);
    if (p.manipOpen === false) $('manipBox').open = false;
    synUi();
    if (p.anaOn === false) setAna(false);
    (p.collapsed || []).forEach((c, n) => { const v = document.querySelectorAll('.view')[n]; if (v) v.classList.toggle('collapsed', !!c); });
    if (p.profMode) sim.profModePref = p.profMode;
  }
  for (const id of [...PREF_CHECKS, 'cloudAlpha']) $(id).addEventListener('change', savePrefs);

  function markMode() {
    for (const it of layMostItems) it.el.classList.toggle('on', it.L === layActive);
  }

  // --- zakładka Layers: „Most used”, wszystkie warstwy w rozwijanych grupach (wzór: Meteologix), „Model information” ---
  // wysokość poziomu ciśnienia w stanie bazowym domeny [m] (model anelastyczny: mapa „na poziomie” to mapa na tej wysokości)
  const zOfP = (hPa) => {
    const p = hPa * 100, P = (k) => grid.data[grid.off.PRS + k];
    for (let k = 1; k < NZ; k++) {
      if (P(k) <= p) return grid.zc[k - 1] + Math.log(P(k - 1) / p) / Math.log(P(k - 1) / P(k)) * (grid.zc[k] - grid.zc[k - 1]);
    }
    return grid.zc[NZ - 1];
  };
  const zsOfP = (hPa) => Math.min(12000, Math.max(50, Math.round(zOfP(hPa) / 50) * 50));
  const layEls = [];
  // gwiazdka przy warstwie: dodaje do „Most used” albo usuwa z listy
  function layStar(L) {
    const s = document.createElement('i');
    s.className = 'lystar';
    s.onclick = (e) => { e.stopPropagation(); layFavToggle(L); };
    return s;
  }
  let layActive = null, layMostItems = [], useCur = null, useSec = 0, usePts = 0;
  for (const gr of LAYER_GROUPS) {
    const g = document.createElement('div'), h = document.createElement('button'), bd = document.createElement('div');
    g.className = 'lygrp'; g.dataset.g = gr.name;
    h.className = 'lyh'; h.dataset.n = gr.name; h.textContent = lyGrName(gr.name);
    h.onclick = () => { g.classList.toggle('open'); savePrefs(); };
    bd.className = 'lyb';
    g.append(h, bd);
    $('layGroups').appendChild(g);
    for (const raw of gr.items) {
      const it = typeof raw === 'number' ? { id: raw } : raw, f = FIELDS[it.id], b = document.createElement('button');
      b.className = 'lyi';
      b.innerHTML = `<span>${it.name || f.short || f.name}</span>`;
      b.title = `${f.name}${f.unit ? ` [${unitD(f.unit)}]` : ''}`;
      const nm = it.name || f.short || f.name;
      const L = { el: b, g, id: it.id, acc: it.acc, p: gr.p, z: gr.z, label: gr.p ? `${nm} · ${gr.p} hPa` : gr.z ? `${nm} · at height` : nm,
        key: `${it.id}${it.acc !== undefined ? `~${it.acc}` : ''}${gr.p ? `@${gr.p}` : ''}${gr.z ? '@z' : ''}` };
      b.onclick = () => pickLayer(L);
      L.star = layStar(L);
      b.appendChild(L.star);
      bd.appendChild(b);
      layEls.push(L);
    }
  }
  // most – wybór z „Most used”: domyślna pozycja ustawia też pole przekroju pionowego
  function pickLayer(L, most) {
    if (L.acc !== undefined) { $('accWin').value = String(L.acc); $('accWin').dispatchEvent(new Event('change')); }
    if (L.p) $('zs').value = String(zsOfP(L.p));
    if (most && L.V !== undefined) $('fieldV').value = String(L.V);
    $('fieldH').value = String(L.id);
    $('fieldH').dispatchEvent(new Event('change'));
    labels();
  }
  // zaznaczenie bieżącej warstwy; openIt – rozwiń jej grupę (otwarcie zakładki)
  function layMark(openIt) {
    const f = num('fieldH'), acc = num('accWin'), zs = num('zs');
    const lev = layEls.find((L) => L.p && L.id === f && zsOfP(L.p) === zs);
    layActive = null;
    for (const L of layEls) {
      const on = L.id === f && (L.acc === undefined || L.acc === acc) && (L.p ? L === lev : !L.z || !lev);
      L.el.classList.toggle('on', on);
      if (on) layActive = L;
      if (on && openIt) L.g.classList.add('open');
    }
    for (const g of $('layGroups').children) g.classList.toggle('has', !!g.querySelector('.lyi.on'));
    if (layActive !== useCur) { useCur = layActive; useSec = 0; usePts = 0; }      // nowe oglądanie (punkty: niżej)
  }
  let layTabCur = 'most';
  function layTab(k) {
    layTabCur = k;
    for (const b of $('layTabs').children) b.classList.toggle('on', b.dataset.l === k);
    if (k === 'most') layMostBuild();
    $('layMost').style.display = k === 'most' ? '' : 'none';
    $('layAll').style.display = k === 'all' ? '' : 'none';
    $('layInfo').style.display = k === 'info' ? '' : 'none';
  }
  for (const b of $('layTabs').children) b.onclick = () => { layTab(b.dataset.l); savePrefs(); };
  // „Most used”: płaska lista – warstwy z gwiazdką (domyślnie MODES, w3d-layfav), pod nimi wyuczone z użycia. Punkty warstwy: 1 za wybór
  // (po 5 s oglądania – samo przeglądanie listy się nie liczy) + po 1 za każde 5 min oglądania, najwyżej 4 za jedno oglądanie (strona zostawiona
  // na noc nie przeważa), zanik o połowę co 30 dni. Na liście od 10 punktów (~10 oglądań), zostaje do spadku poniżej 5 (~miesiąc bez użycia),
  // najwyżej 5 warstw wg punktów; pamięć w3d-layuse. Lista przebudowywana przy otwarciu zakładki i gwiazdce, nie w trakcie klikania.
  const LAY_JOIN = 9.5, LAY_KEEP = 5, LAY_LEARNED = 5;     // (9.5, nie 10: zanik między wczytaniami strony nie może zabrać dziesiątego oglądania)
  for (const m of MODES) {
    const L = layEls.find((x) => x.id === m.H && !x.p && !x.z && (x.acc === undefined || x.acc === m.acc));
    L.most = m.name; L.V = m.V; L.def = true;
  }
  const layFav = (() => {
    try { const j = JSON.parse(localStorage.getItem('w3d-layfav') || 'null'); if (Array.isArray(j)) return j; } catch { /* brak pamięci przeglądarki */ }
    return layEls.filter((L) => L.def).sort((a, b) => MODES.findIndex((m) => m.H === a.id) - MODES.findIndex((m) => m.H === b.id)).map((L) => L.key);
  })();
  const layUse = { s: {}, in: new Set() };
  try {
    const j = JSON.parse(localStorage.getItem('w3d-layuse') || 'null');
    if (j && j.s) {
      const f = 0.5 ** ((Date.now() - j.t) / (30 * 864e5));
      for (const k of Object.keys(j.s)) layUse.s[k] = j.s[k] * f;
      for (const k of j.in || []) if (layUse.s[k] >= LAY_KEEP) layUse.in.add(k);
    }
  } catch { /* brak pamięci przeglądarki */ }
  const layUseSave = () => { try { localStorage.setItem('w3d-layuse', JSON.stringify({ t: Date.now(), s: layUse.s, in: [...layUse.in] })); } catch { /* brak pamięci */ } };
  const layName = (L) => L.most || L.label;
  function layFavToggle(L) {
    const i = layFav.indexOf(L.key);
    if (i >= 0) {
      // usunięta ręcznie nie wraca od razu jako wyuczona
      layFav.splice(i, 1);
      delete layUse.s[L.key]; layUse.in.delete(L.key);
      layUseSave();
      toast(`Removed from Most used: ${layName(L)}`);
    } else {
      layFav.push(L.key);
      toast(`Added to Most used: ${layName(L)}`);
    }
    try { localStorage.setItem('w3d-layfav', JSON.stringify(layFav)); } catch { /* brak pamięci */ }
    layMostBuild();
  }
  function layMostBuild() {
    const box = $('layMostList'), byKey = (k) => layEls.find((L) => L.key === k);
    const fav = layFav.map(byKey).filter(Boolean);
    const learned = layEls.filter((L) => layUse.in.has(L.key) && !layFav.includes(L.key)).sort((a, b) => layUse.s[b.key] - layUse.s[a.key]).slice(0, LAY_LEARNED);
    box.innerHTML = '';
    layMostItems = [];
    [...fav, ...learned].forEach((L, n) => {
      const b = document.createElement('button'), r = document.createElement('span');
      b.className = 'lyq';
      b.innerHTML = `<span>${layName(L)}</span>`;
      r.className = 'lyr';
      r.innerHTML = n < 10 ? `<kbd>${(n + 1) % 10}</kbd>` : '';
      const st = layStar(L), on = layFav.includes(L.key);
      st.textContent = on ? '★' : '☆';
      st.classList.toggle('on', on);
      st.title = on ? 'Remove from Most used' : 'Keep in Most used';
      r.appendChild(st);
      b.appendChild(r);
      const pick = () => pickLayer(L, true);
      b.onclick = pick;
      box.appendChild(b);
      layMostItems.push({ el: b, L, pick });
    });
    for (const L of layEls) {
      const on = layFav.includes(L.key);
      L.star.textContent = on ? '★' : '☆';
      L.star.classList.toggle('on', on);
      L.star.title = on ? 'Remove from Most used' : 'Add to Most used';
    }
    $('layMostReset').style.display = learned.length ? '' : 'none';
    markMode();
  }
  $('layMostReset').onclick = () => { layUse.s = {}; layUse.in.clear(); layUseSave(); layMostBuild(); };
  // sekundy oglądania: widoczna strona i mapa (nie widok 3D)
  setInterval(() => {
    if (!useCur || v3.on || document.hidden) return;
    useSec++;
    const want = useSec < 5 ? 0 : Math.min(4, 1 + Math.floor(useSec / 300));
    if (want > usePts) {
      const k = useCur.key;
      layUse.s[k] = (layUse.s[k] || 0) + want - usePts;
      if (layUse.s[k] >= LAY_JOIN) layUse.in.add(k);
      usePts = want;
      layUseSave();
    }
  }, 1000);
  layMostBuild();
  function layInfoBuild() {
    const km = (x) => +(x / 1000).toFixed(2);
    const rows = [
      ['Domain', `${+nD(km(NXD * CFG.DX), 'km', 2)} × ${+nD(km(NYD * CFG.DY), 'km', 2)} ${unitD('km')} (${NXD} × ${NYD} cells)`],
      ['Grid spacing', fmDx(CFG.DX)],
      ['Vertical', `${NZ} levels up to ${fmZ(km(CFG.HTOP))}`],
      ['Time step', `${DT} s`],
      ['Boundaries', CFG.OPEN ? `open: hidden margin of ${MG} cells, then a ${CFG.NE}-cell relaxation zone` : 'periodic'],
      ['Dynamics', 'anelastic, non-hydrostatic; Arakawa C grid; semi-Lagrangian advection; FFT + conjugate gradient pressure solver'],
      ['Turbulence', `3D Smagorinsky; K-profile boundary layer ${Math.round(100 * CFG.W_PBL)}%`],
      ['Convection', `deep scheme ${Math.round(100 * CFG.W_CU)}% (scale-aware), shallow ${Math.round(100 * CFG.W_SH)}%`],
      ['Microphysics', 'double-moment rain, cloud water and ice with ice nuclei, snow and graupel'],
      ['Surface', 'force-restore soil temperature, 3-layer soil water, snow, vegetation with phenology, lakes and sea'],
      ['Driving model', 'primitive equations on the GPU: channel around the latitude circle, 75 km, 12 levels up to 16 km, 450 s step'],
    ];
    $('layInfo').innerHTML = `<h4>Model information</h4><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
  }
  layInfoBuild();

  // --- prędkość, pauza, restart ---
  document.querySelectorAll('#speedSeg button').forEach((b) => b.addEventListener('click', () => {
    $('speed').value = b.dataset.speed;
    document.querySelectorAll('#speedSeg button').forEach((x) => x.classList.toggle('on', x === b));
  }));
  const setPaused = (p) => { sim.paused = p; $('pause').textContent = p ? '▶ Resume' : '⏸ Pause'; };
  $('pause').onclick = () => setPaused(!sim.paused);
  $('reset').onclick = () => reset();

  // --- scenariusze ---
  function applyScenario(key) {
    const sc = SCENARIOS[key];
    if (!sc) return;
    const nx = sc.n || NXD, ny = sc.n || NYD;
    if ((sc.dx && sc.dx !== CFG.DX) || nx !== NXD || ny !== NYD || (sc.dem && !CFG.OPEN)) {
      location.search = `?dx=${sc.dx}&nx=${nx}&ny=${ny}&scen=${key}${CFG.OPEN || sc.dem ? '' : '&bc=per'}`;
      return;
    }
    if (sc.dem) { applyDemScenario(sc); return; }
    drv.mode = 'const'; $('wxMode').value = 'const';      // scenariusz = stała masa powietrza
    $('airmass').value = sc.air;
    applyAirmassPreset();
    sim.air = airParams();
    for (const k of ['hills', 'wind', 'wdir', 'soil', 'hour', 'zt']) $(k).value = sc[k];
    $('water').value = sc.water ?? 20;
    $('shape').value = sc.shape;
    $('landuse').value = sc.land;
    $('fieldH').value = sc.fieldH;
    $('fieldV').value = sc.fieldV;
    sim.seed = 7;
    setShape(sc.shape);
    reset();
    labels();
  }

  // scenariusz z prawdziwym terenem: DEM z internetu (proxy /dem), klimat miejsca, model synoptyczny
  async function applyDemScenario(sc) {
    const d = sc.dem;
    drv.mode = 'syn'; $('wxMode').value = 'syn';
    $('date').value = `${($('date').value || '2026').slice(0, 4)}-${sc.date}`;
    $('hour').value = sc.hour;
    $('zt').value = sc.zt;
    $('fieldH').value = sc.fieldH;
    $('fieldV').value = sc.fieldV;
    $('landuse').value = 'mosaic';
    status('downloading terrain (DEM)…');
    toast('Downloading the real terrain – this takes a moment');
    try {
      const t = await fetchTerrain(d.lat, d.lon, NXV, NYV, CFG.DX, (m) => status(m));
      applyDem(t, d.lat, d.lon, { cont: d.cont, hum: d.hum, bias: 0 });
      await applyLandCover(d.lat, d.lon);
    } catch (e) {
      toast(`Could not download the terrain (${e.message || e}) – starting on flat terrain`);
    }
    sim.seed = 7;
    await reset();
    labels();
  }

  // --- własny scenariusz: zapis do pliku / linku i wczytanie ---
  const stEls = () => [...document.querySelectorAll('#side input[id], #side select[id], #fieldV')]
    .filter((el) => el.type !== 'file' && el.id !== 'paint');
  const gridQuery = () => `?dx=${CFG.DX}&nx=${NXD}&ny=${NYD}${CFG.OPEN ? '' : '&bc=per'}`;
  function getState() {
    const ui = {};
    for (const el of stEls()) ui[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    const st = { v: 1, grid: { dx: CFG.DX, nx: NXD, ny: NYD, mg: MG, bc: CFG.OPEN ? 'open' : 'per' }, ui,
      seed: sim.seed, synSeed: drv.seed, mode: drv.mode, air: sim.air };
    const sh = $('shape').value;
    if (sh === 'image' || sh === 'painted' || sh === 'dem') st.hv = Array.from(sim.hv, (h) => Math.round(h));
    if (sim.wmask) st.wmask = Array.from(sim.wmask);
    if (sim.lmask) st.lmask = Array.from(sim.lmask);
    if (sim.vmask) st.vmask = Array.from(sim.vmask);
    if (sim.lwet) st.lwet = Array.from(sim.lwet, (x) => Math.round(100 * x));
    st.stations = stations.exportList();
    st.manip = manip;
    if (sh === 'dem' && sim.demLL) st.demLL = sim.demLL;            // środek terenu z DEM (gęstszy teren do obrazu)
    return st;
  }
  // ustawienia, ziarna, masa powietrza, teren i maski ze stanu (zapis ustawień i pełny zapis przebiegu)
  function applyStateUi(st) {
    if (st.ui.location === 'custom') ensureCustom(`Custom: ${(+st.ui.lat).toFixed(2)}°, ${(+st.ui.lon).toFixed(2)}°`);
    for (const el of stEls()) {
      if (!(el.id in st.ui)) continue;
      if (el.type === 'checkbox') el.checked = st.ui[el.id]; else el.value = st.ui[el.id];
    }
    CLIM.bias = num('tbias');
    if (st.manip) Object.assign(manip, st.manip); else manipFlat();
    gridSync();
    sim.seed = st.seed;
    drv.seed = st.synSeed;
    drv.mode = st.mode;
    sim.air = st.air || airParams();
    if (st.hv && st.hv.length === NXV * NYV) sim.hv.set(st.hv);
    else setShape($('shape').value);
    sim.wmask = st.wmask && st.wmask.length === NXV * NYV ? Int8Array.from(st.wmask) : null;
    sim.lmask = st.lmask && st.lmask.length === NXV * NYV ? Int8Array.from(st.lmask) : null;
    sim.vmask = st.vmask && st.vmask.length === NXV * NYV ? Int8Array.from(st.vmask) : null;
    sim.lwet = st.lwet && st.lwet.length === NXV * NYV ? Float32Array.from(st.lwet, (x) => x / 100) : null;
  }
  function setState(st) {
    const g = st.grid || {};
    const gnx = g.nx || g.n, gny = g.ny || g.n;
    if (g.dx !== CFG.DX || gnx !== NXD || gny !== NYD || (g.mg ?? MG) !== MG || (g.bc === 'per') === CFG.OPEN) return false;   // inna siatka
    applyStateUi(st);
    if (st.stations) stations.importList(st.stations);
    applyTerrain();
    applyLand();
    if ($('shape').value === 'dem' && st.ui.location === 'custom') loadDemHi(...(st.demLL || [num('lat'), num('lon')]));
    reset();
    labels();
    drawPreview();
    return true;
  }
  async function packState(st) {
    const s = new Blob([JSON.stringify(st)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const b = new Uint8Array(await new Response(s).arrayBuffer());
    let bin = '';
    for (let i = 0; i < b.length; i += 8192) bin += String.fromCharCode(...b.subarray(i, i + 8192));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function unpackState(txt) {
    const bin = atob(txt.replace(/-/g, '+').replace(/_/g, '/'));
    const b = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    const s = new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return JSON.parse(await new Response(s).text());
  }
  // wczytanie: na innej siatce przeładowanie strony ze stanem w adresie
  async function loadState(st) {
    if (setState(st)) { $('stInfo').textContent = 'State loaded.'; return; }
    const g = st.grid;
    location.href = `${location.pathname}?dx=${g.dx}&nx=${g.nx || g.n}&ny=${g.ny || g.n}${g.mg !== undefined ? `&mg=${g.mg}` : ''}${g.bc === 'per' ? '&bc=per' : ''}#s=${await packState(st)}`;
  }
  $('stSave').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(getState())], { type: 'application/json' }));
    a.download = `weather3d_state_${$('date').value}_${CFG.DX}m.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('stLoad').onclick = () => $('stFile').click();
  $('stFile').onchange = async () => {
    const file = $('stFile').files[0];
    $('stFile').value = '';
    if (!file) return;
    try { await loadState(JSON.parse(await file.text())); } catch (e) { $('stInfo').textContent = `File error: ${e.message}`; }
  };
  $('stLink').onclick = async () => {
    const url = `${location.origin}${location.pathname}${gridQuery()}#s=${await packState(getState())}`;
    try { await navigator.clipboard.writeText(url); $('stInfo').textContent = `Link copied (${url.length} characters).`; }
    catch { $('stInfo').textContent = url; }
  };

  // --- pełny zapis przebiegu (plik .w3drun, runfile.js) ---
  // Bufory GPU i stan JS z tej samej chwili (przerwa w krokach tylko na odczyt), kompresja już przy działającej symulacji. Profile, teren, siatka parametrów i poprawki korekty
  // klimatu w buforze vg – odtwarzane z ustawień, więc po zmianie układu tego bufora w nowej wersji plik dalej się wczytuje; pola przy gruncie po nazwach (nowe pola startują od zera).
  // Kopia prognozy nie jest zapisywana: model jest deterministyczny, więc po wczytaniu kopia modelu głównego nadrabia 7 dób w tle (ok. minuty).
  const runDate = () => new Date(Date.UTC(sim.year, 0, sim.doy0 + Math.floor((sim.startHour * 3600 + sim.time) / 86400 + 1e-6))).toISOString().slice(0, 10);
  async function buildRunFile(onProgress) {
    await resetting;
    if (sim.busy) throw new Error('the simulation is still starting');
    sim.saving = true;
    const reads = [], chunks = [];
    const meta = { app: 'weather3d', v: 1, created: new Date().toISOString(), search: location.search,
      grid: { dx: CFG.DX, nx: NXD, ny: NYD, mg: MG, nz: NZ, dt: DT, bc: CFG.OPEN ? 'open' : 'per' } };
    try {
      await device.queue.onSubmittedWorkDone();
      await mon.finishing;
      await drv.ccWait;
      const syn = drv.mode === 'syn' && drv.model, m = drv.model, c = drv.ccModel;
      const enc = device.createCommandEncoder();
      const want = (name, b) => { const rb = buf(b.size, U.MAP_READ | U.COPY_DST, 'runRead'); enc.copyBufferToBuffer(b, 0, rb, 0, b.size); reads.push({ name, rb }); };
      for (const [n, b] of [['state', stateBuf], ['tmp', tmpBuf], ['work', workBuf], ['sfc', sfcBuf], ['tgt', tgtBuf], ['acc', accBuf]]) want(n, b);
      if (syn) for (const [p, x] of [['pe', m], ['cc', c]]) if (x) { want(`${p}.S`, x.S[x.p]); want(`${p}.wk`, x.wk); want(`${p}.dg`, x.dg); }
      device.queue.submit([enc.finish()]);
      Object.assign(meta, { date: runDate(), time: sim.time });
      const keepFrom = sim.time - CC_WIN - 86400;      // próbki korekty klimatu poza oknem nie są już potrzebne
      const js = { st: getState(), clim: { ...CLIM }, speed: $('speed').value, sfcNames: SFC, lens: { STATE_LEN, TG_SLOT, NF },
        sim: { time: sim.time, step: sim.step, startHour: sim.startHour, doy0: sim.doy0, year: sim.year, waterUser: !!sim.waterUser, accInfo: sim.accInfo, probe: sim.probe },
        drv: { tA: drv.tA, slot: drv.slot, startTime: syn ? drv.start.time : 0, startHalfDiur: syn ? drv.start.halfDiur : 0 },
        acc: { days: [...acc.days], last: acc.last },
        mon: { key: mon.key, t0: mon.t0, days: mon.days, dayT0: mon.dayT0, list: mon.list.map((x) => ({ key: x.key, days: x.days, secs: x.secs, avg: x.avg })) },
        cc: { off: cc.off, nodes: cc.nodes.map((nd) => ({ norm: nd.norm, hasN: nd.hasN, corr: nd.corr, fq: nd.fq, fqa: nd.fqa, fp: nd.fp, smp: nd.smp.filter((x) => x.t >= keepFrom) })) },
        cuc: { ...cuc, U: [...cuc.U], D: [...cuc.D], U2: [...cuc.U2], D2: [...cuc.D2], N: [...cuc.N], sfcT: null },
        meteo: { hist: meteo.hist, col: meteo.col },
        pe: syn ? { main: m.saveInfo(), cc: c ? c.saveInfo() : null } : null };
      const sf = stations.exportFull();
      chunks.push({ name: 'js', data: jsonPack(js) }, { name: 'stLive', data: jsonPack({ sel: sf.sel, live: sf.live }) }, { name: 'stHist', data: jsonPack(sf.hist, 4) });
      // miesiące analiz: 5 × Int16 + 3 × Uint16 na oczko widocznej części
      const nv = NXD * NYD, mb = new Uint8Array(16 * nv * mon.list.length);
      mon.list.forEach((x, i) => [...x.T, ...x.P].forEach((a, k) => mb.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), (i * 8 + k) * 2 * nv)));
      chunks.push({ name: 'mon', data: mb });
      // teren i mokradła dokładnie (w zapisie ustawień zaokrąglone – inne nachylenia i inne pola docelowe przy gruncie)
      chunks.push({ name: 'hv', data: sim.hv.slice() });
      if (sim.lwet) chunks.push({ name: 'lwet', data: sim.lwet.slice() });
      if (syn) {
        chunks.push({ name: 'land.sea', data: m.sea }, { name: 'land.encl', data: m.encl }, { name: 'land.hgt', data: m.hgt });
        if (m.lc) chunks.push({ name: 'land.Ts', data: m.lc.Ts }, { name: 'land.ha', data: m.lc.ha }, { name: 'land.ta', data: m.lc.ta });
      }
    } finally { sim.saving = false; }
    await Promise.all(reads.map((r) => r.rb.mapAsync(GPUMapMode.READ)));
    for (const r of reads) {
      chunks.push({ name: r.name, data: new Float32Array(r.rb.getMappedRange().slice(0)) });
      r.rb.unmap(); r.rb.destroy();
    }
    return { blob: await packRun(meta, chunks, onProgress), name: `weather3d_run_${meta.date}_${CFG.DX}m.w3drun` };
  }
  $('runSave').onclick = async () => {
    const el = $('runInfo'), t0 = performance.now();
    $('runSave').disabled = true;
    el.textContent = 'Saving…';
    try {
      const { blob, name } = await buildRunFile((f) => { el.textContent = `Compressing… ${Math.round(100 * f)}%`; });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 120000);
      el.textContent = `Saved ${name} (${(blob.size / 1048576).toFixed(0)} MB, ${((performance.now() - t0) / 1000).toFixed(0)} s). The run continues.`;
    } catch (e) { el.textContent = `Could not save the run: ${e.message}`; }
    $('runSave').disabled = false;
  };
  $('runLoad').onclick = () => $('runFile').click();
  $('runFile').onchange = async () => {
    const file = $('runFile').files[0], el = $('runInfo');
    $('runFile').value = '';
    if (!file) return;
    let stopped = false;
    try {
      const { meta } = await openRun(file);
      if (sim.time > 0 && !confirm(`Load the run saved at ${meta.date}? The current run will be lost unless you saved it.`)) return;
      el.textContent = 'Loading…';
      stopped = !sim.halted;
      sim.halted = true;
      await stashRun(file);
      location.href = resumeUrl(meta);
    } catch (e) {
      if (stopped) { sim.halted = false; requestAnimationFrame(frame); }
      el.textContent = `Could not load the file: ${e.message}`;
    }
  };
  // start strony z adresem ?resume: plik z pamięci przeglądarki zamiast restartu (bez rozbiegu modelu synoptycznego)
  async function resumeRun() {
    try {
      const file = await stashedRun();
      if (!file) throw new Error('the saved run was not found in this browser – load the file again');
      status('loading the saved run…');
      const { meta, read, text } = await openRun(file), g = meta.grid;
      if (g.dx !== CFG.DX || g.nx !== NXD || g.ny !== NYD || g.mg !== MG || g.nz !== NZ || g.dt !== DT || (g.bc === 'per') === CFG.OPEN) throw new Error('the file needs a different grid');
      const js = jsonUnpack(await text('js'));
      if (js.lens.STATE_LEN !== STATE_LEN) throw new Error('the file comes from an incompatible version (atmosphere layout)');
      // ustawienia, teren, pokrycie, stan bazowy
      applyStateUi(js.st);
      Object.assign(CLIM, js.clim);                // (dokładna poprawka klimatu miejsca – suwak ją zaokrągla)
      const hv = await read('hv'), lw = await read('lwet');
      if (hv && hv.length === NXV * NYV) sim.hv.set(hv);
      if (lw && lw.length === NXV * NYV) sim.lwet = lw;
      $('speed').value = js.speed;
      document.querySelectorAll('#speedSeg button').forEach((x) => x.classList.toggle('on', x.dataset.speed === js.speed));
      $('wxMode').value = drv.mode;
      sim.waterUser = js.sim.waterUser;
      rebuildBase();
      if ($('shape').value === 'dem' && js.st.ui.location === 'custom') loadDemHi(...(js.st.demLL || [num('lat'), num('lon')]));
      // korekta klimatu: normy, próbki i poprawki w węzłach
      ccGen++;
      cc.off = js.cc.off; cc.busy = false;
      js.cc.nodes.forEach((x, t) => {
        const nd = cc.nodes[t];
        Object.assign(nd, x);
        nd.free = baseClim(...ccLL(nd)).free;
      });
      ccSrc();
      ccUpload();
      if ($('location').value === 'custom' && cc.nodes.some((nd) => !nd.hasN)) ccLoad(ccGen);
      // model synoptyczny i jego kopia do korekty klimatu; kopia prognozy – od nowa z modelu głównego (nadrabia w tle)
      if (js.pe) {
        status('loading the saved run: synoptic model…');
        const Ts = await read('land.Ts');
        const land = { sea: await read('land.sea'), encl: await read('land.encl'), hgt: await read('land.hgt'), ...(Ts ? { lc: { Ts, ha: await read('land.ha'), ta: await read('land.ta') } } : {}) };
        const opts = { varAt: manipVarAt, land, nest: { vgBuf, pgOff: grid.off.PGRID, ...NODES } };
        const mk = async (p, info) => PEModel.restore(device, opts, info, { S: await read(`${p}.S`), wk: await read(`${p}.wk`), dg: await read(`${p}.dg`) });
        drv.model = await mk('pe', js.pe.main);
        drv.ccModel = js.pe.cc ? await mk('cc', js.pe.cc) : null;
        drv.start = { time: js.drv.startTime, halfDiur: js.drv.startHalfDiur, destroy() {} };   // chwila startu przebiegu; restart liczy nowy rozbieg (drv.key pusty)
        drv.key = '';
        drv.fcModel = drv.model.clone(); drv.fc = []; drv.fcBusy = false; drv.ccBusy = false;
        const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
        drv.model.encodeParams(pass);
        pass.end();
        device.queue.submit([enc.finish()]);
        refreshCenter();
      } else device.queue.writeBuffer(vgBuf, grid.off.PGRID * 4, paramGrid(sampler()));
      // bufory GPU
      status('loading the saved run: atmosphere and ground…');
      const q = device.queue, ok = (a, b) => a && a.byteLength === b.size;
      for (const [n, b] of [['state', stateBuf], ['tmp', tmpBuf]]) q.writeBuffer(b, 0, await read(n));
      const wk = await read('work');
      if (ok(wk, workBuf)) q.writeBuffer(workBuf, 0, wk);
      const sf0 = await read('sfc'), sf = new Float32Array(NSF * NXY);
      js.sfcNames.forEach((n, i) => { if (n in S) sf.set(sf0.subarray(i * NXY, (i + 1) * NXY), S[n] * NXY); });
      q.writeBuffer(sfcBuf, 0, sf);
      const tg = await read('tgt');
      if (ok(tg, tgtBuf)) q.writeBuffer(tgtBuf, 0, tg);
      else if (js.pe) { buildSlot(0); buildSlot(1); buildSlot(2); }
      const ac = await read('acc');
      if (ok(ac, accBuf)) { q.writeBuffer(accBuf, 0, ac); for (const [k, v] of js.acc.days) acc.days.set(k, v); acc.last = js.acc.last; }
      // czas, miesiące analiz, stacje, widok
      Object.assign(sim, { time: js.sim.time, step: js.sim.step, startHour: js.sim.startHour, doy0: js.sim.doy0, year: js.sim.year, debt: 0, accInfo: js.sim.accInfo, probe: js.sim.probe });
      drv.tA = js.drv.tA; drv.slot = js.drv.slot;
      const nv = NXD * NYD, mb = await read('mon');
      const arr = (T, i, k) => new T(mb.buffer.slice(mb.byteOffset + (i * 8 + k) * 2 * nv, mb.byteOffset + (i * 8 + k + 1) * 2 * nv));
      mon.list = js.mon.list.map((x, i) => ({ ...x, T: [0, 1, 2, 3, 4].map((k) => arr(Int16Array, i, k)), P: [5, 6, 7].map((k) => arr(Uint16Array, i, k)) }));
      Object.assign(mon, { key: js.mon.key, t0: js.mon.t0, days: js.mon.days, dayT0: js.mon.dayT0, pending: null });
      const stL = jsonUnpack(await text('stLive'));
      stations.importFull({ sel: stL.sel, live: stL.live, hist: jsonUnpack(await text('stHist')) });
      const cu = js.cuc;
      Object.assign(cuc, { ph: cu.ph, Te: cu.Te, rate: cu.rate, nx: cu.nx, ny: cu.ny, gen: cu.gen, gmax: cu.gmax, sfcT: null });
      for (const k of ['U', 'D', 'U2', 'D2', 'N']) cuc[k].set(cu[k]);
      meteo.hist = js.meteo.hist; meteo.col = js.meteo.col;
      const qs = new URLSearchParams(location.search);
      if (qs.has('hold')) sim.halted = true;       // testy: bez pętli klatek
      sim.stats = null; drv.synDirty = true;
      $('monSel').max = String(Math.max(0, periods().length - 1)); $('monSel').value = $('monSel').max;
      monUi(); monShow(); labels(); drawPreview(); synUi();
      sim.busy = false;
      $('loadScr').classList.remove('on');
      qs.delete('resume'); qs.delete('hold');
      history.replaceState(null, '', `${location.pathname}?${qs}`);
      await clearStash();
      toast(`Run loaded: ${meta.date}. It continues from here.`, 6000);
    } catch (e) { fail(`Could not load the run: ${e.message}`); console.error(e); }
  }

  // --- edytor masy powietrza: podgląd na żywo, zastosowanie przyciskiem ---
  function applyAirmassPreset() {
    const a = AIRMASSES[$('airmass').value];
    for (const k of AIR_KEYS) $(k).value = a[k];
  }
  const airDirty = () => AIR_KEYS.some((k) => Math.abs(num(k) - sim.air[k]) > 1e-9);
  function drawPreview() {
    if (!$('cprev').offsetParent) return;           // zakładka niewidoczna
    const pr = airParams(), s2 = makeSounding(pr), ix = soundingIndices(s2);
    const hour = num('hour');
    const T = [], Td = [];
    ix.prof.z.forEach((z, n) => {
      const dT = s2.cool(z, hour);
      T.push(ix.prof.T[n] - dT);
      const q = dT > 0 ? Math.min(s2.qv(z), 0.97 * qsat(s2.T(z) - dT, s2.pres(z))) : s2.qv(z);
      Td.push(dewpoint(q, s2.pres(z)) - 273.15);
    });
    drawProfile($('cprev'), { z: ix.prof.z, T, Td, parcel: ix.prof.parcel, top: Math.min(14000, pr.ztrop * 1000 + 1000), xmin: -60 });
    const km = (z) => (z === null ? '—' : isImp() ? fmH(z) : `${(z / 1000).toFixed(1)} km`);
    const rows = [
      ['T / Td at start', `${nD(T[0], '°C')} / ${fT(Td[0], 0)}`],
      ['T / Td in the afternoon', `${nD(ix.tSfc, '°C')} / ${fT(ix.tdSfc, 0)}`],
      ['cloud base (LCL)', km(ix.lcl)],
      ['free convection (LFC)', km(ix.lfc)],
      ['CAPE', `${Math.round(ix.cape)} J/kg`],
      ['CIN', ix.cin === null ? '— (no free convection)' : `${Math.round(ix.cin)} J/kg`],
      ['cloud tops (EL)', km(ix.el)],
      [`${isImp() ? '32 °F' : '0 °C'} isotherm`, km(ix.frz)],
      ['precipitable water', fm(ix.pw, 'mm')],
    ];
    $('sndIdx').innerHTML = rows.map(([k, v]) => `<div>${k} <b>${v}</b></div>`).join('');
    $('dirty').textContent = airDirty() ? 'Changes not applied – the model still runs the previous air mass.' : '';
  }
  $('airmass').onchange = () => { applyAirmassPreset(); labels(); drawPreview(); };
  for (const k of AIR_KEYS) $(k).addEventListener('input', drawPreview);
  $('applyAir').onclick = () => {
    sim.air = airParams();
    drv.mode = 'const'; $('wxMode').value = 'const';   // własna masa powietrza = bez modelu synoptycznego
    wxModeUi();
    reset();
  };
  for (const k of ['wind', 'wdir']) $(k).addEventListener('input', retarget);
  $('revertAir').onclick = () => { for (const k of AIR_KEYS) $(k).value = sim.air[k]; labels(); drawPreview(); };
  $('hour').addEventListener('input', drawPreview);

  // --- miejsce i klimat: roślinność zależy od szerokości, kontynentalizmu, wilgotności i wysokości ---
  for (const [k, l] of Object.entries(LOCATIONS)) $('location').add(new Option(l.name, k));
  $('location').value = 'krakow';
  $('location').onchange = () => {
    const l = LOCATIONS[$('location').value];
    if (!l) return;
    $('lat').value = l.lat; $('lon').value = l.lon; $('cont').value = l.cont; $('hum').value = l.hum;
    $('tbias').value = 0; CLIM.bias = 0;
    labels(); applyLand(); reset();
  };
  // własne miejsce (z mapy świata) jako pozycja listy
  function ensureCustom(label) {
    let o = [...$('location').options].find((x) => x.value === 'custom');
    if (!o) { o = new Option('', 'custom'); $('location').add(o); }
    if (label) o.text = label;
  }

  // --- miejsce z mapy świata: teren (DEM, linia brzegowa) i klimat ---
  // klimat miejsca od razu: normy ERA5 z pamięci przeglądarki albo klimatologia wbudowana
  function placeClimate(lat, lon) {
    const c = cachedClimate(lat, lon);
    if (c) return { ...c, src: 'ERA5' };
    const b = baseClim(lat, lon).norm;
    return { ...climateOf(b.T, b.P.map((v, k) => v * MONTH_DAYS[k]), b.elev, lat), src: 'built-in' };
  }
  const wsel = { lat: null, lon: null, reg: null, clim: null };
  const fmtLL = (lat, lon) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
  function paintDem(cv, W, h) {
    cv.width = W; cv.height = W;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(W, W);
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const k = y * W + x, hv = h[k];
        const gx = h[y * W + Math.min(W - 1, x + 1)] - h[y * W + Math.max(0, x - 1)];
        const gy = h[Math.min(W - 1, y + 1) * W + x] - h[Math.max(0, y - 1) * W + x];
        const shade = hv > 0 ? Math.min(1.25, Math.max(0.6, 1 + (gy - gx) * 0.0015)) : 1;
        img.data.set([...demColor(hv, shade), 255], 4 * k);
      }
    }
    ctx.putImageData(img, 0, 0);
    return ctx;
  }
  async function drawWorldMap() {
    let w;
    try { w = await worldDem(); } catch (e) { $('worldInfo').innerHTML = `${e.message} – check the connection and open this window again`; return; }
    const ctx = paintDem($('cworld'), w.W, w.h);
    if (wsel.lat !== null) {
      const [tx, ty] = lonLatToTile(wsel.lat, wsel.lon, w.z);
      ctx.strokeStyle = '#ff3'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(tx * 256, ty * 256, 7, 0, 2 * Math.PI); ctx.stroke();
    }
  }
  async function drawRegionMap() {
    if (wsel.lat === null) return;
    const L = Math.max(NXD * CFG.DX, NYD * CFG.DY);
    const z = Math.max(3, Math.min(11, Math.round(Math.log2(156543 * Math.cos(wsel.lat * Math.PI / 180) * 768 / Math.max(4 * L, 300e3)))));
    if (!wsel.reg || wsel.reg.z !== z || Math.abs(wsel.regLat - wsel.lat) > 0.5 * 360 / 2 ** z || Math.abs(wsel.regLon - wsel.lon) > 0.5 * 360 / 2 ** z) {
      wsel.reg = await regionDem(wsel.lat, wsel.lon, z);
      wsel.regLat = wsel.lat; wsel.regLon = wsel.lon;
    }
    const r = wsel.reg;
    const ctx = paintDem($('cregion'), r.W, r.h);
    // prostokąt domeny
    const cosl = Math.cos(wsel.lat * Math.PI / 180);
    const corner = (x, y) => {
      const [tx, ty] = lonLatToTile(wsel.lat + y / 111320, wsel.lon + x / (111320 * cosl), r.z);
      return [(tx - r.x0) * 256, (ty - r.y0) * 256];
    };
    const [ax, ay] = corner(-NXD * CFG.DX / 2, NYD * CFG.DY / 2), [bx, by] = corner(NXD * CFG.DX / 2, -NYD * CFG.DY / 2);
    ctx.strokeStyle = '#ff3'; ctx.lineWidth = 2; ctx.strokeRect(ax, ay, bx - ax, by - ay);
  }
  function selectPoint(lat, lon) {
    wsel.lat = Math.max(-80, Math.min(80, lat)); wsel.lon = ((lon + 540) % 360) - 180;
    drawWorldMap(); drawRegionMap();
    const c = placeClimate(wsel.lat, wsel.lon), mon = c.T.map((t) => nD(t, '°C')).join(' · ');
    wsel.clim = c;
    $('worldInfo').innerHTML = `<b>${fmtLL(wsel.lat, wsel.lon)}</b> · elevation ~${fmH(c.elev)} · climate <b>${c.koppen.code}</b> – ${c.koppen.name} (${c.src})<br>`
      + `annual mean <b>${fT(c.tAnn)}</b>, precipitation <b>${fm(c.Pa, 'mm')}/year</b> · monthly temperatures: ${mon} ${unitD('°C')}<br>`
      + `in the model: continentality <b>${c.cont.toFixed(2)}</b>, climate humidity <b>${c.hum.toFixed(2)}</b>, temperature correction <b>${fdT(c.bias, 1, true)}</b>`;
    $('worldApply').disabled = false;
  }
  const canvasXY = (cv, e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * cv.width, (e.clientY - r.top) / r.height * cv.height]; };
  // zoom map w oknie wyboru miejsca (przekształcenie CSS płótna w ramce; canvasXY uwzględnia je przez getBoundingClientRect):
  // kółko – zoom wokół kursora (do 8×), przeciąganie – przesuwanie (bez wyboru punktu), dwuklik – cała mapa
  function cssZoom(cv) {
    const box = cv.parentElement, z = { s: 1, x: 0, y: 0, drag: null, moved: false };
    const apply = () => {
      const W = box.clientWidth, H = box.clientHeight;
      z.x = Math.min(0, Math.max(W - W * z.s, z.x)); z.y = Math.min(0, Math.max(H - H * z.s, z.y));
      cv.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.s})`;
    };
    box.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = box.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const s2 = Math.min(8, Math.max(1, z.s * Math.exp(-e.deltaY * 0.0015)));
      z.x = px - (px - z.x) * s2 / z.s; z.y = py - (py - z.y) * s2 / z.s; z.s = s2;
      apply();
    }, { passive: false });
    box.addEventListener('pointerdown', (e) => { z.drag = { x: e.clientX, y: e.clientY, ox: z.x, oy: z.y }; z.moved = false; });
    box.addEventListener('pointermove', (e) => {
      if (!z.drag) return;
      const dx = e.clientX - z.drag.x, dy = e.clientY - z.drag.y;
      if (!z.moved && Math.abs(dx) + Math.abs(dy) > 4 && z.s > 1) { z.moved = true; box.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; }
      if (z.moved) { z.x = z.drag.ox + dx; z.y = z.drag.oy + dy; apply(); }
    });
    box.addEventListener('pointerup', () => { z.drag = null; cv.style.cursor = 'crosshair'; });
    // kliknięcie po przeciągnięciu nie wybiera punktu (faza przechwytywania – przed obsługą płótna)
    box.addEventListener('click', (e) => { if (z.moved) { e.stopPropagation(); z.moved = false; } }, true);
    box.addEventListener('dblclick', () => { z.s = 1; z.x = 0; z.y = 0; apply(); });
    return { reset() { z.s = 1; z.x = 0; z.y = 0; apply(); } };
  }
  const zWorld = cssZoom($('cworld')), zRegion = cssZoom($('cregion'));
  $('cworld').addEventListener('click', (e) => {
    const [x, y] = canvasXY($('cworld'), e);
    const [lat, lon] = tileToLonLat(x / 256, y / 256, 2);
    wsel.reg = null;
    zRegion.reset();                                    // nowy region – mapa regionu w całości
    selectPoint(lat, lon);
  });
  $('cregion').addEventListener('click', (e) => {
    if (!wsel.reg) return;
    const [x, y] = canvasXY($('cregion'), e);
    const [lat, lon] = tileToLonLat(wsel.reg.x0 + x / 256, wsel.reg.y0 + y / 256, wsel.reg.z);
    selectPoint(lat, lon);
  });
  $('worldOpen').onclick = () => {
    $('worldDlg').classList.add('on');
    if (wsel.lat === null && $('location').value === 'custom') { wsel.lat = num('lat'); wsel.lon = num('lon'); }
    drawWorldMap(); drawRegionMap();
  };
  $('worldClose').onclick = () => $('worldDlg').classList.remove('on');
  // ostatnie miejsce z mapy świata (zapisane lokalnie)
  const lastPlace = () => { try { return JSON.parse(localStorage.getItem('w3d-last-place')); } catch { return null; } };
  function updLast() {
    const st = lastPlace();
    $('worldLast').disabled = !st;
    $('worldLast').textContent = st ? `Load the last place: ${(+st.ui.lat).toFixed(2)}°, ${(+st.ui.lon).toFixed(2)}° (no download)` : 'Load the last place (none saved)';
  }
  $('worldLast').onclick = () => { const st = lastPlace(); if (st) loadState(st); };
  // teren z mapy (wynik fetchTerrain) i klimat miejsca → ustawienia (bez restartu)
  // gęstszy teren do obrazu: pobierany w tle po wczytaniu miejsca (model już liczy); ważny, dopóki teren jest z DEM tego miejsca
  // (malowanie albo inny kształt terenu – rzeźba znów z siatki modelu)
  async function loadDemHi(lat, lon) {
    sim.demLL = [lat, lon];
    sim.demHi = null;
    if (DEMF < 2) return;
    try {
      const d = await fetchTerrainHi(lat, lon, NXD, NYD, CFG.DX, DEMF);
      if (!sim.demLL || sim.demLL[0] !== lat || sim.demLL[1] !== lon) return;     // w międzyczasie inne miejsce
      device.queue.writeBuffer(demHiBuf, 0, d.h);
      sim.demHi = { lat, lon, hmax: d.hmax, h: d.h };
    } catch (e) { console.warn(`detailed terrain for the image: ${e.message}`); }
  }
  // wysokość prawdziwego terenu w punkcie (x, y – oczka siatki obliczeniowej, ułamkowo): gęstszy DEM dwuliniowo, bez niego grunt
  // modelu w oczku
  function realHxy(x, y) {
    if (demHiOk()) {
      const W = NXD * DEMF, H = NYD * DEMF, d = sim.demHi.h;
      const u = Math.min(W - 1.001, Math.max(0, (x - MG) * DEMF - 0.5)), v = Math.min(H - 1.001, Math.max(0, (y - MG) * DEMF - 0.5));
      const i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j;
      return (d[j * W + i] * (1 - fx) + d[j * W + i + 1] * fx) * (1 - fy) + (d[(j + 1) * W + i] * (1 - fx) + d[(j + 1) * W + i + 1] * fx) * fy;
    }
    return sim.h[Math.min(NY - 1, Math.max(0, Math.floor(y))) * NX + Math.min(NX - 1, Math.max(0, Math.floor(x)))];
  }
  // najwyższy punkt prawdziwego terenu w promieniu rkm od (xkm, ykm) – po punktach gęstszego DEM albo środkach oczek;
  // przy terenie z DEM wierzchołek doprecyzowany na kafelkach ~30 m (peakFine) – prawdziwa wysokość szczytu
  async function peakNear(xkm, ykm, rkm) {
    const p = peakGrid(xkm, ykm, rkm);
    if (!demHiOk()) return p;
    const [lat0, lon0] = sim.demLL, kx = 111320 * Math.cos(lat0 * Math.PI / 180);
    const xm = p.xkm * 1000 - NXD * CFG.DX / 2, ym = p.ykm * 1000 - NYD * CFG.DY / 2;
    try {
      const f = await peakFine(lat0 + ym / 111320, lon0 + xm / kx, Math.max(400, 0.75 * CFG.DX / DEMF));
      if (f.h <= p.z) return p;
      return { xkm: ((f.lon - lon0) * kx + NXD * CFG.DX / 2) / 1000, ykm: ((f.lat - lat0) * 111320 + NYD * CFG.DY / 2) / 1000, z: f.h };
    } catch { return p; }
  }
  function peakGrid(xkm, ykm, rkm) {
    const F = demHiOk() ? DEMF : 1, x0 = MG + xkm * 1000 / CFG.DX, y0 = MG + ykm * 1000 / CFG.DY, r = rkm * 1000 / CFG.DX;
    let best = { x: x0, y: y0, z: realHxy(x0, y0) };
    for (let b = Math.floor((y0 - r - MG) * F); b <= Math.ceil((y0 + r - MG) * F); b++) {
      for (let a = Math.floor((x0 - r - MG) * F); a <= Math.ceil((x0 + r - MG) * F); a++) {
        if (a < 0 || b < 0 || a >= NXD * F || b >= NYD * F) continue;
        const x = MG + (a + 0.5) / F, y = MG + (b + 0.5) / F;
        if ((x - x0) ** 2 + (y - y0) ** 2 > r * r) continue;
        const z = realHxy(x, y);
        if (z > best.z) best = { x, y, z };
      }
    }
    return { xkm: (best.x - MG) * CFG.DX / 1000, ykm: (best.y - MG) * CFG.DY / 1000, z: best.z };
  }
  function demHiOk() { return !!sim.demHi && $('shape').value === 'dem' && !!sim.demLL && sim.demHi.lat === sim.demLL[0] && sim.demHi.lon === sim.demLL[1]; }
  function applyDem(t, lat, lon, c) {
    $('lat').value = lat.toFixed(2); $('lon').value = lon.toFixed(3);
    sim.waterUser = false;                      // nowe miejsce – temperatura wody znów z klimatu
    $('cont').value = c.cont.toFixed(2); $('hum').value = c.hum.toFixed(2); $('tbias').value = (c.bias || 0).toFixed(2);
    CLIM.bias = c.bias || 0;
    ensureCustom(`Custom: ${fmtLL(lat, lon)}${c.koppen ? ` (${c.koppen.code})` : ''}`);
    $('location').value = 'custom';
    // teren: wysokości od poziomu morza, dno ≤ 0 jako woda (applyLandCover oddaje lądowi depresje); grunt modelu nie schodzi poniżej 0
    sim.wmask = new Int8Array(NXV * NYV);
    sim.lmask = null; sim.vmask = null; sim.lwet = null;          // pokrycie poprzedniego miejsca nie przechodzi na nowe (WorldCover nadpisze)
    let hmax = 0;
    for (let k = 0; k < NXV * NYV; k++) {
      sim.hv[k] = Math.max(0, t.h[k]);
      if (t.h[k] <= 0) sim.wmask[k] = 1;
      hmax = Math.max(hmax, sim.hv[k]);
    }
    $('sea').value = 0;
    $('shape').value = 'dem';
    $('hills').value = String(Math.round(hmax / 50) * 50);
    applyTerrain(); applyLand(); labels();
    loadDemHi(lat, lon);
  }
  sim.applyDem = applyDem;
  sim.applyLandCover = (...a) => applyLandCover(...a);
  // pokrycie terenu z mapy ESA WorldCover (las, zabudowa, jeziora, mokradła) → maska pokrycia (jak pędzel);
  // biom (tajga, las liściasty, step, pustynia…) dalej z klimatu i wysokości. Bez sieci zostaje mozaika.
  // maxMs > 0 – najwyżej tyle czekania (dane, które przyjdą później, nie są już używane)
  async function applyLandCover(lat, lon, onProgress = status, maxMs = 0) {
    try {
      const load = fetchLandCover(lat, lon, NXV, NYV, CFG.DX, onProgress);
      const lc = await (maxMs ? Promise.race([load, new Promise((_, no) => setTimeout(() => no(new Error('no answer')), maxMs))]) : load);
      const n = NXV * NYV;
      sim.lmask = new Int8Array(n).fill(-1);
      sim.lwet = new Float32Array(n);
      if (!sim.wmask) sim.wmask = new Int8Array(n);
      let nf = 0, nu = 0, nl = 0, nv = 0, nd = 0;
      for (let c = 0; c < n; c++) {
        if (lc.valid[c] < 0.3) continue;
        // dno ≤ 0 z kafelków to nie zawsze morze: depresje i poldery (Żuławy, Holandia, nizina nadkaspijska), a w grubych kafelkach
        // także niski brzeg (Fryzja). Rozstrzyga mapa pokrycia: morze ma tam klasę wody albo brak danych, ląd – ponad połowę oczka
        if (isWaterV(c)) {
          if (lc.valid[c] * (1 - lc.water[c]) <= 0.5) continue;
          sim.wmask[c] = 0; nd++;
        }
        nv++;
        if (lc.water[c] >= 0.5) { sim.wmask[c] = 1; nl++; continue; }                 // jezioro, duża rzeka, zbiornik
        const k = lc.built[c] >= 0.3 ? 2 : lc.tree[c] >= 0.5 ? 1 : 0;
        sim.lmask[c] = k; if (k === 1) nf++; if (k === 2) nu++;
        sim.lwet[c] = lc.wet[c];
      }
      applyTerrain(); applyLand();
      const pc = (x) => Math.round(100 * x / Math.max(nv, 1));
      window.__lcStats = { las: pc(nf), zabudowa: pc(nu), wody: pc(nl), oczek: nv, depresje: nd };
      toast(`Land cover (ESA WorldCover): forest ${pc(nf)}%, urban ${pc(nu)}%, inland water ${pc(nl)}%`);
      return true;
    } catch (e) {
      toast(`Land cover: ${e.message} – keeping the mosaic`);
      return false;
    }
  }
  updLast();
  $('worldApply').onclick = async () => {
    const c = wsel.clim;
    if (!c) return;
    $('worldApply').disabled = true;
    try {
      const t = await fetchTerrain(wsel.lat, wsel.lon, NXV, NYV, CFG.DX, (m) => { $('worldInfo').innerHTML += `<br>${m}`; });
      applyDem(t, wsel.lat, wsel.lon, c);
      await applyLandCover(wsel.lat, wsel.lon, (m) => { $('worldInfo').innerHTML += `<br>${m}`; }, 30000);
      $('worldDlg').classList.remove('on');
      reset();
      // zapamiętanie miejsca (teren, woda, klimat, ustawienia) – „Wczytaj ostatnie miejsce” bez pobierania
      try { localStorage.setItem('w3d-last-place', JSON.stringify(getState())); } catch { /* brak miejsca w pamięci */ }
      updLast();
    } catch (e) {
      $('worldInfo').innerHTML += `<br>Error: ${e.message}`;
    }
    $('worldApply').disabled = false;
  };
  for (const k of ['lat', 'cont', 'hum']) $(k).addEventListener('change', () => { applyLand(); reset(); });
  $('date').addEventListener('change', () => { sim.waterUser = false; reset(); });

  // --- podłoże i teren ---
  $('soil').addEventListener('change', setSoil);
  $('landuse').onchange = () => { applyLand(); reset(); };
  $('water').addEventListener('change', () => { sim.waterUser = true; reset(); });
  $('shape').onchange = () => {
    const k = $('shape').value;
    if (k === 'image') { $('imgFile').click(); return; }
    if (k === 'dem') { $('worldOpen').click(); return; }
    if (k !== 'flat' && num('hills') === 0) $('hills').value = 800;
    setShape(k); applyLand(); reset(); labels();
  };
  $('hills').addEventListener('change', () => {
    const k = $('shape').value, hm = num('hills');
    if (k === 'image' || k === 'painted' || k === 'dem') {
      if (sim.hmax > 0) for (let c = 0; c < NXV * NYV; c++) sim.hv[c] *= hm / sim.hmax;   // przeskalowanie mapy
      applyTerrain();
    } else {
      if (k === 'flat' && hm > 0) $('shape').value = 'perlin';
      setShape($('shape').value);
    }
    applyLand(); reset();
  });
  $('newTerrain').onclick = () => {
    sim.seed = 1 + Math.floor(Math.random() * 1e9);
    $('shape').value = 'perlin';
    if (num('hills') === 0) $('hills').value = 800;
    setShape('perlin'); applyLand(); reset(); labels();
  };
  $('loadImg').onclick = () => $('imgFile').click();
  $('imgFile').onchange = () => {
    const file = $('imgFile').files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const shape = shapeFromImage(img, CFGV, !CFG.OPEN);
      if (num('hills') === 0) $('hills').value = 1000;
      for (let c = 0; c < NXV * NYV; c++) sim.hv[c] = shape[c] * num('hills');
      $('shape').value = 'image';
      applyTerrain(); applyLand(); reset(); labels();
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
    $('imgFile').value = '';
  };
  $('saveImg').onclick = () => {
    const a = document.createElement('a');
    a.href = heightPng(sim.hv, CFGV, sim.hmax);
    a.download = `terrain_${Math.round(sim.hmax)}m.png`;
    a.click();
  };
  // pędzle: wysokość, woda, typy powierzchni; przy malowaniu mapa wysokości albo typów powierzchni
  {
    const sel = $('paintWhat');
    sel.add(new Option('Terrain height', 'terrain'));
    sel.add(new Option('Water (lake, sea)', 'water'));
    const g = document.createElement('optgroup');
    g.label = 'Surface type';
    for (const k of [VEG.GRASS, VEG.DECID, VEG.TAIGA, VEG.SCLERO, VEG.RAINFOREST, VEG.SAVANNA, VEG.STEPPE, VEG.DESERT, VEG.TUNDRA, VEG.GLACIER, VEG.URBAN]) {
      g.appendChild(new Option(VEG_NAMES[k][0].toUpperCase() + VEG_NAMES[k].slice(1), `veg:${k}`));
    }
    sel.appendChild(g);
    const paintView = () => {
      if (!$('paint').checked) return;
      $('fieldH').value = sel.value === 'terrain' ? '30' : '79';
      $('fieldH').dispatchEvent(new Event('change'));
      labels();
    };
    $('paint').onchange = paintView;
    sel.onchange = paintView;
  }
  $('accWin').addEventListener('change', () => { accBase(); labels(); });
  $('monSel').addEventListener('input', () => monPick());
  // rodzaj okresu analiz: miesiące, pory roku, lata (suwak – na najnowszy)
  for (const b of $('anaKind').children) b.addEventListener('click', () => {
    anaKind = b.dataset.k; $('monSel').value = '1e9'; monPick();
  });
  $('fieldH').addEventListener('change', () => { monUi(); monShow(); });
  $('sea').addEventListener('change', () => { applyTerrain(); applyLand(); reset(); });
  // malowanie wody na żywo: klasa podłoża, roślinność i temperatura powierzchni w zmienionych kolumnach
  function paintWater(x, y, r, add) {
    if (!sim.wmask) sim.wmask = new Int8Array(NXV * NYV);
    const changed = [];
    for (let j = Math.max(0, Math.floor(y - r)); j <= Math.min(NYV - 1, Math.ceil(y + r)); j++) {
      for (let i = Math.max(0, Math.floor(x - r)); i <= Math.min(NXV - 1, Math.ceil(x + r)); i++) {
        if (Math.hypot(i + 0.5 - x, j + 0.5 - y) > r) continue;
        const c = j * NXV + i, was = isWaterV(c);
        sim.wmask[c] = add ? 1 : -1;
        if (isWaterV(c) !== was) changed.push(j * NX + i);
      }
    }
    if (!changed.length) return;
    applyTerrain();
    applyLand();
    const tw = num('water') + 273.15;
    for (const c of changed) {
      const t = sim.land.cls[c] === 3 ? tw : (sim.sfc ? sim.sfc[S.T2 * NXY + c] + 273.15 : tw);
      for (const f of [S.TS, S.TD]) device.queue.writeBuffer(sfcBuf, (f * NXY + c) * 4, Float32Array.of(t));
      if (sim.land.cls[c] === 3) device.queue.writeBuffer(sfcBuf, (S.SWE * NXY + c) * 4, Float32Array.of(0));
    }
  }

  // pędzel powierzchni: wybrany typ powierzchni (biom) w oczku, na żywo (na wodzie nie działa – wodę usuwa pędzel „Water”);
  // veg < 0 (prawy przycisk) – z powrotem otwarty teren z biomem z klimatu i wysokości. Klasa pokrycia z typu: las, zabudowa, reszta otwarte.
  const VEG_CLS = { [VEG.DECID]: 1, [VEG.TAIGA]: 1, [VEG.RAINFOREST]: 1, [VEG.SCLERO]: 1, [VEG.URBAN]: 2 };
  function paintSurface(x, y, r, veg) {
    if (!sim.lmask) sim.lmask = new Int8Array(NXV * NYV).fill(-1);
    if (!sim.vmask) sim.vmask = new Int8Array(NXV * NYV).fill(-1);
    const cls = veg < 0 ? 0 : VEG_CLS[veg] ?? 0;
    let any = false;
    for (let j = Math.max(0, Math.floor(y - r)); j <= Math.min(NYV - 1, Math.ceil(y + r)); j++) {
      for (let i = Math.max(0, Math.floor(x - r)); i <= Math.min(NXV - 1, Math.ceil(x + r)); i++) {
        if (Math.hypot(i + 0.5 - x, j + 0.5 - y) > r) continue;
        const c = j * NXV + i, cc = j * NX + i;
        if (isWaterV(c) || sim.vmask[c] === veg) continue;
        sim.vmask[c] = veg;
        sim.lmask[c] = cls;
        sim.land.cls[cc] = cls;
        sim.veg[cc] = veg >= 0 ? veg : biome(cls, latRow(cc), num('cont'), num('hum'), sim.h[cc]);
        any = true;
      }
    }
    if (!any) return;
    device.queue.writeBuffer(vgBuf, grid.off.LAND * 4, sim.land.cls);
    device.queue.writeBuffer(vgBuf, grid.off.VEG * 4, sim.veg);
  }

  // --- mapa: malowanie, dymek z wartościami ---
  const cxy = $('cxy');
  const mapXY = (e) => {
    const r = cxy.getBoundingClientRect();
    const u = mz.x + (e.clientX - r.left) / r.width / mz.s, w = mz.y + (e.clientY - r.top) / r.height / mz.s;
    return [MG + u * NXD, MG + (1 - w) * NYD];
  };
  // zoom mapy: kółko myszy (wokół kursora, do 16×), przeciąganie przesuwa, dwuklik – cała mapa
  function setZoom(s, ax = 0.5, ay = 0.5) {
    const u = mz.x + ax / mz.s, w = mz.y + ay / mz.s;          // punkt pod kursorem zostaje na miejscu
    mz.s = Math.min(16, Math.max(1, s));
    mz.x = Math.min(1 - 1 / mz.s, Math.max(0, u - ax / mz.s));
    mz.y = Math.min(1 - 1 / mz.s, Math.max(0, w - ay / mz.s));
    onZoom();
  }
  function onZoom() {
    if (sim.fitScale) sim.fitScale();
    stations.markers();
    $('zoomTxt').textContent = mz.s > 1.01 ? `zoom ×${mz.s.toFixed(1)} · double-click – whole map` : '';
  }
  sim.setZoom = setZoom;
  cxy.addEventListener('wheel', (e) => {
    if (v3.on) return;
    e.preventDefault();
    const r = cxy.getBoundingClientRect();
    setZoom(mz.s * Math.exp(-e.deltaY * 0.0015), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  }, { passive: false });
  cxy.addEventListener('dblclick', () => { if (!v3.on) setZoom(1); });
  let pan = null;
  cxy.addEventListener('pointerdown', (e) => {
    if (v3.on || $('paint').checked || mz.s <= 1) return;
    pan = { x: e.clientX, y: e.clientY, ox: mz.x, oy: mz.y, moved: false };
    cxy.setPointerCapture(e.pointerId);
  });
  cxy.addEventListener('pointermove', (e) => {
    if (!pan) return;
    const r = cxy.getBoundingClientRect(), dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) { pan.moved = true; cxy.style.cursor = 'grabbing'; }
    if (!pan.moved) return;
    mz.x = Math.min(1 - 1 / mz.s, Math.max(0, pan.ox - dx / r.width / mz.s));
    mz.y = Math.min(1 - 1 / mz.s, Math.max(0, pan.oy - dy / r.height / mz.s));
    onZoom();
  });
  cxy.addEventListener('pointerup', () => { if (pan) { cxy.style.cursor = 'crosshair'; setTimeout(() => { pan = null; }, 0); } });
  cxy.addEventListener('contextmenu', (e) => { if ($('paint').checked) e.preventDefault(); });
  cxy.addEventListener('pointerdown', (e) => {
    if (v3.on || !$('paint').checked) return;
    cxy.setPointerCapture(e.pointerId);
    const [x, y] = mapXY(e);
    sim.paint = { x, y, sign: e.button === 2 || e.shiftKey ? -1 : 1 };
  });
  cxy.addEventListener('pointerup', () => { sim.paint = null; });
  // kliknięcie (bez malowania): sonda w tym punkcie – sondaż i meteogram
  cxy.addEventListener('click', (e) => {
    if (v3.on || $('paint').checked || (pan && pan.moved)) return;
    const [x, y] = mapXY(e);
    const i = Math.floor(x), j = Math.floor(y);
    if (i < MG || i >= MG + NXD || j < MG || j >= MG + NYD) return;
    if (stations.addMode) { stations.addAt(x, y); document.body.classList.remove('addst'); return; }
    sim.probe = { i, j };
    setProfMode('point');
  });
  // stacje meteo (panel analiz → Stacje)
  const stations = createStations({
    $, S, NX, NXY, MG, NXD, NYD, DX: CFG.DX, DY: CFG.DY,
    // czas kopii pól przy gruncie (nie bieżący czas symulacji) – inaczej próbka sprzed północy trafiała do nowej doby
    sfc: () => sim.sfc, time: () => sim.sfcT ?? sim.time, clock, toast: (m) => toast(m), mapInner: $('mapInner'),
    csvMeta: () => `Weather3D; grid ${CFG.DX / 1000} km; visible ${CFG.NXV} x ${CFG.NYV}; levels ${CFG.NZ}; centre ${num('lat').toFixed(2)} ${num('lon').toFixed(2)}; start ${$('date').value}; weather seed ${drv.seed ?? ''}; climate correction ${ccOn() ? cc.src : 'off'}; ${manipCsv()}`,
    // położenie na ekranie [%] punktu domeny (ułamki fx w prawo, fy w górę) przy bieżącym zoomie
    mapPos: (fx, fy) => [(fx - mz.x) * mz.s * 100, (1 - fy - mz.y) * mz.s * 100],
    probe: () => sim.probe,
    // godziny od północy dnia startu i data kalendarzowa chwili t
    absHour: (t) => sim.startHour + t / 3600,
    dateStr: (t) => { const ck = clock(t); return dateFromDoy(sim.year, ck.doy); },
    citiesOn: () => $('cityOn').checked,
    zoom: () => mz.s,
    // wysokość stacji z prawdziwego terenu (jak pod kursorem), szczyt w pobliżu, grunt modelu, powietrze na wysokości stacji
    realH: (xkm, ykm) => realHxy(MG + xkm * 1000 / CFG.DX, MG + ykm * 1000 / CFG.DY),
    peak: (xkm, ykm, rkm) => peakNear(xkm, ykm, rkm),
    modelH: (col) => sim.h[col],
    air: (s) => (sim.stAir && sim.stAir.get(s)) || null,
  });
  sim.stations = stations;
  // miejscowości tylko na prawdziwym terenie (z mapy świata / DEM); klasy wielkości względem rozmiaru mapy (geo.js)
  let cityKey = '';
  refreshCities = async () => {
    const LXk = NXD * CFG.DX / 1000, LYk = NYD * CFG.DY / 1000;
    const key = $('shape').value === 'dem' ? `${num('lat').toFixed(3)},${num('lon').toFixed(3)},${LXk},${LYk}` : '';
    if (key === cityKey) return;
    cityKey = key;
    if (!key) { stations.setCities([]); return; }
    try {
      const c = await fetchCities(num('lat'), num('lon'), LXk, LYk);
      if (key === cityKey) { stations.setCities(c); sim.cities = c; }
    } catch (e) {
      if (key === cityKey) { cityKey = ''; stations.setCities([]); }
      console.warn(e.message);
    }
  };
  refreshCities();
  $('cityOn').addEventListener('change', () => stations.markers());
  for (const id of ['stAdd', 'stPeak']) $(id).addEventListener('click', () => document.body.classList.toggle('addst', !!stations.addMode));
  function setProfMode(m) {
    profMode = m;
    sim.profModePref = m;
    savePrefs();
    for (const b of document.querySelectorAll('#profSeg button')) b.classList.toggle('on', b.dataset.p === m);
    $('profSub').textContent = m === 'point' ? 'probe at a point (click the map) · dots: parcel from the ground' : 'domain mean · dashed: start sounding';
    sndSrcUi();
    drawProf();
  }
  for (const b of document.querySelectorAll('#profSeg button')) b.addEventListener('click', () => setProfMode(b.dataset.p));
  cxy.addEventListener('pointerleave', () => { sim.hover = null; $('tip').style.display = 'none'; });
  cxy.addEventListener('pointermove', (e) => {
    if (v3.on) return;
    const [x, y] = mapXY(e);
    if (sim.paint) { sim.paint.x = x; sim.paint.y = y; }
    const i = Math.floor(x), j = Math.floor(y);
    const r = cxy.getBoundingClientRect();
    sim.hover = i >= 0 && i < NXV && j >= 0 && j < NYV ? { col: j * NX + i, x, y, px: e.clientX - r.left, py: e.clientY - r.top, w: r.width, h: r.height } : null;
    updateTip();
  });
  // temperatura odczuwalna: zimą wskaźnik wychłodzenia (wind chill, wiatr 10 m), latem indeks ciepła (Steadman/NWS)
  function feelsLike(t, rh, u) {
    const kmh = 3.6 * u;
    if (t <= 10 && kmh > 4.8) return 13.12 + 0.6215 * t - 11.37 * kmh ** 0.16 + 0.3965 * t * kmh ** 0.16;
    if (t >= 26) {
      const f = t * 1.8 + 32;
      const hi = -42.379 + 2.04901523 * f + 10.14333127 * rh - 0.22475541 * f * rh - 6.83783e-3 * f * f - 5.481717e-2 * rh * rh
        + 1.22874e-3 * f * f * rh + 8.5282e-4 * f * rh * rh - 1.99e-6 * f * f * rh * rh;
      return Math.max(t, (hi - 32) / 1.8);
    }
    return t;
  }
  function updateTip() {
    const tip = $('tip'), hv = sim.hover;
    if (!hv || !sim.sfc || !$('tipOn').checked) { tip.style.display = 'none'; return; }
    const col = hv.col, i = col % NX, j = Math.floor(col / NX);
    const v = (n) => sim.sfc[S[n] * NXY + col];
    const t2 = v('T2'), td2 = v('TD2');
    const es = (t) => 6.112 * Math.exp(17.67 * t / (t + 243.5));
    const rh = Math.min(100, 100 * es(td2) / es(t2));
    const lc = sim.veg ? VEG_NAMES[sim.veg[col]] : '';
    const row = (k, val) => `<span class="k">${k}</span> <b>${val}</b>`;
    tip.innerHTML = [
      row('position', `${nD((i - MG + 0.5) * CFG.DX / 1000, 'km', 1)}, ${nD((j - MG + 0.5) * CFG.DY / 1000, 'km', 1)} ${unitD('km')}`),
      // wysokość prawdziwego terenu (gęstszy DEM), a w nawiasie gruntu modelu – średniej z oczka
      row('terrain', demHiOk() ? `${fmH(realHxy(hv.x, hv.y))} a.s.l. (model ${fmH(sim.h[col])}), ${lc}` : `${fmH(sim.h[col])} a.s.l., ${lc}`),
      row('T 2 m', fT(t2)) + ' · ' + row('Td', fT(td2)) + ' · ' + row('RH', `${rh.toFixed(0)}%`),
      row('feels like', fT(feelsLike(t2, rh, v('U10')), 0)) + ' · ' + row('today', `${nD(v('TMIN'), '°C', 1)} … ${fT(v('TMAX'))}`) + ' · ' + row('sunshine', `${v('SUNH').toFixed(1)} h`),
      row('wind 10 m', fm(v('U10'), 'm/s', 1)) + ' · ' + row('gusts', fm(v('GUST'), 'm/s')),
      row('ground', fT(v('TS') - 273.15)) + ' · ' + row('solar', `${Math.round(v('SW'))} W/m²`),
      row('greenness', `${(100 * v('GRN')).toFixed(0)}%`) + ' · ' + row('snow', fm(100 * v('SND'), 'cm')),
      row('precip.', fm(v('PR'), 'mm/h', 1)) + ' · ' + row('total', fm(v('PACC'), 'mm', 1)) + (v('QOUT') > 0.05 ? ' · ' + row('discharge', `${fm(v('QOUT'), 'm³/s', v('QOUT') < 10 ? 1 : 0)}`) : ''),
      ...(monFld() ? [row('period', monTip(col))] : []),
      row('pressure (large scale)', fm(v('PSL'), 'hPa', 1)) + ' · ' + row('visibility', fmVis(v('VIS'))),
      row('CAPE', `${Math.round(v('CAPE'))} J/kg`) + (v('FLASH') > 0.01 ? ' · ' + row('lightning', `${v('FLASH').toFixed(2)} /km²/h`) : '') + (v('HAIL') > 0 ? ' · ' + row('hail', fm(v('HAIL'), 'cm', 1)) : ''),
      row('radar', v('DBZ') < 5 ? '–' : `${v('DBZ').toFixed(0)} dBZ`) + (v('PHEN') > 0.5 ? ' · ' + row('phenomenon', ['', 'hoar frost', 'rime', 'freezing rain / glaze', 'fog', 'in cloud (summits, slopes)'][Math.round(v('PHEN'))]) : ''),
      row('H', `${Math.round(v('H'))} W/m²`) + ' · ' + row('LE', `${Math.round(v('LE'))} W/m²`),
    ].join('<br>');
    tip.style.display = 'block';
    const left = hv.px + 16 + tip.offsetWidth > hv.w ? hv.px - 16 - tip.offsetWidth : hv.px + 16;
    // dymek zawsze w obrębie mapy: przy prawej krawędzi na lewo od kursora, przy dolnej – nad kursorem
    const top = hv.py - 10 + tip.offsetHeight > hv.h ? hv.py + 10 - tip.offsetHeight : hv.py - 10;
    tip.style.left = `${Math.max(4, Math.min(left, hv.w - tip.offsetWidth - 4))}px`;
    tip.style.top = `${Math.max(4, Math.min(top, hv.h - tip.offsetHeight - 4))}px`;
  }

  // --- siatka i skala ---
  // siatka: wymiary domeny w km, szczegółowość albo oczko (zmiana przeładowuje stronę)
  for (const r of RES_OPTS) $('gridRes').add(new Option(`${r}`, r));
  $('gridDx').add(new Option('automatic (from the detail)', 'auto'));
  for (const d of NICE_DX) $('gridDx').add(new Option(fmDx(d), d));
  // pola wymiarów w jednostkach na ekranie; po wczytaniu stanu i po zmianie jednostek – z faktycznej siatki
  const gridSync = () => {
    $('gridLx').value = String(+toD(NXD * CFG.DX / 1000, 'km').toFixed(2));
    $('gridLy').value = String(+toD(NYD * CFG.DY / 1000, 'km').toFixed(2));
    $('gridLxL').textContent = `Width (W–E) [${unitD('km')}]`;
    $('gridLyL').textContent = `Height (S–N) [${unitD('km')}]`;
    for (const o of $('gridDx').options) if (o.value !== 'auto' && +o.value) o.textContent = fmDx(+o.value);
  };
  $('gridRes').value = String(RES_OPTS.reduce((a, r) => (Math.abs(r - Math.max(NXD, NYD)) < Math.abs(a - Math.max(NXD, NYD)) ? r : a), 100));
  $('gridDx').value = 'auto';
  const gridPlan = () => {
    return planGrid(fromD(num('gridLx'), 'km'), fromD(num('gridLy'), 'km'), num('gridRes'), $('gridDx').value, $('gridBc').value === 'per');
  };
  const gridInfo = () => {
    const g = gridPlan(), per = $('gridBc').value === 'per', mg = g.mg, cost = g.cost, sc = g.sc;
    const notes = [];
    if (g.dx <= 400) notes.push('thermals and clouds resolved directly (LES)');
    else if (g.dx < 2000) notes.push('grey zone: convection resolved, boundary layer partly from the scheme');
    else notes.push('mesoscale: boundary layer and storms from schemes, fronts and regional systems');
    const km = (n) => { const L = toD(n * g.dx / 1000, 'km'); return L >= 10 ? L.toFixed(0) : L.toFixed(1); };
    $('gridInfo').textContent = `spacing ${fmDx(g.dx)} · ${g.nx} × ${g.ny} cells · domain ${km(g.nx)} × ${km(g.ny)} ${unitD('km')}`
      + ` · ${sc.name.toUpperCase()} (${sc.use})`
      + ` · cost of a day ≈ ${cost.toFixed(1)}× · ${notes[0]}`
      + (per ? ' · periodic boundaries' : ` · open boundaries: hidden margin of ${mg} cells (${km(mg)} ${unitD('km')}) fully computed, then a relaxation zone`);
  };
  for (const id of ['gridLx', 'gridLy', 'gridRes', 'gridDx']) { $(id).addEventListener('input', gridInfo); $(id).addEventListener('change', gridInfo); }
  gridSync();
  gridInfo();
  $('gridBc').value = CFG.OPEN ? 'open' : 'per';
  const startArg = () => `${$('location').value === 'custom' ? `${num('lat').toFixed(3)},${num('lon').toFixed(3)}` : ','},${+($('date').value || '2026-06').slice(5, 7) - 1}`;
  $('gridApply').onclick = () => { const g = gridPlan(), m = manipTarget(); location.search = `?dx=${g.dx}&nx=${g.nx}&ny=${g.ny}${$('gridBc').value === 'per' ? '&bc=per' : ''}&start=${startArg()}${manipQuery(m.T, m.R, m.V)}`; };
  for (const id of ['tanom', 'manipR', 'manipV']) $(id).addEventListener('input', manipApply);
  $('manipZero').onclick = () => { $('tanom').value = 0; $('manipR').value = MANIP_RAIN.indexOf(1); $('manipV').value = MANIP_VAR.indexOf(1); manipApply(); };
  $('manipBox').addEventListener('toggle', () => savePrefs());
  $('toTitle').onclick = () => { location.href = location.pathname; };
  $('gridBc').onchange = gridInfo;
  $('ys').max = String(LY_KM);
  $('ys').value = String(LY_KM / 2);
  $('ys').step = String(CFG.DY / 1000 / 2);
  const axLabels = () => {
    document.querySelectorAll('.xmin').forEach((e) => { e.textContent = `x = 0 ${unitD('km')}`; });
    document.querySelectorAll('.xmax').forEach((e) => { e.textContent = `x = ${Math.round(toD(L_KM, 'km'))} ${unitD('km')}`; });
  };
  axLabels();
  // podziałka km (z zoomem: krótszy odcinek)
  const fitScale = () => {
    const len = niceStep(toD(L_KM, 'km') / 5 / mz.s);   // w jednostkach na ekranie
    $('scaleTxt').textContent = `${len} ${unitD('km')}`;
    $('scaleBar').style.width = `${cxy.clientWidth * len / toD(L_KM, 'km') * mz.s}px`;
  };
  sim.fitScale = fitScale;
  // mapa wpisana w dostępne miejsce z zachowaniem proporcji domeny (widok 3D – całe pole); warstwy nad mapą
  // (sonda, stacje, dymek, skala) leżą w #mapInner o rozmiarze płótna
  function fitMap() {
    const box = $('mapBox'), W = box.clientWidth, H = box.clientHeight;
    if (!W || !H) return;
    let w = W, h = H;
    if (!v3.on) { const r = NXD / NYD; if (W / H > r) w = H * r; else h = W / r; }
    $('mapInner').style.width = `${Math.floor(w)}px`;
    $('mapInner').style.height = `${Math.floor(h)}px`;
    // mapa lekko w prawo od środka: 5% szerokości pola, najwyżej tyle, ile jest wolnego miejsca; na pełnym ekranie na środku
    $('mapInner').style.left = document.fullscreenElement ? '0' : `${Math.round(Math.min((W - Math.floor(w)) / 2, 0.05 * W))}px`;
  }
  sim.fitMap = fitMap;
  new ResizeObserver(fitMap).observe($('mapBox'));
  fitMap();
  {
    const sc = scaleClass(Math.max(L_KM, LY_KM));
    $('chipScale').textContent = sc.name.replace(' scale', '');
    $('chipScaleBox').title = `${sc.name}: ${sc.use}`;
  }               // prostokątna domena
  new ResizeObserver(fitScale).observe(cxy);
  fitScale();

  // --- skróty klawiszowe ---
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.closest && t.closest('select, textarea, input:not([type=range]):not([type=checkbox])')) return;
    if (e.key >= '0' && e.key <= '9') { const it = layMostItems[(Number(e.key) + 9) % 10]; if (it) { it.pick(); e.preventDefault(); } }
    else if (e.key === ' ') { setPaused(!sim.paused); e.preventDefault(); }
    else if (e.key === 'r' || e.key === 'R') reset();
    else if (e.key === 'f' || e.key === 'F') toggleFs();
    else if (e.key === 'p' || e.key === 'P') { sim.snapReq = true; }
    else if (e.key === 'v' || e.key === 'V') setView3D(!v3.on);
    else if (e.key === 's' || e.key === 'S') setProfMode(profMode === 'point' ? 'mean' : 'point');
    else if (e.key === 'w' || e.key === 'W') { $('windArrows').checked = !$('windArrows').checked; savePrefs(); }
    else if (e.key === 'h' || e.key === 'H' || e.key === '?') showHelp(!$('helpDlg').classList.contains('on'));
    else if (e.key === 'a' || e.key === 'A') setAna(document.body.classList.contains('noana'));
    else if (e.key === 'm' || e.key === 'M') setDrawer(!document.body.classList.contains('drawer'));
    else if (e.key === 'Escape') { if ($('sndFull').classList.contains('on')) sndFull(false); else { showHelp(false); setDrawer(false); } }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      $('zs').value = String(num('zs') + (e.key === 'ArrowUp' ? 100 : -100)); labels(); e.preventDefault();
    }
  });

  // --- legendy ---
  // skala o stałych klasach (WX Charts): podpisy [dół, góra, podziałka]. Imperialnie: temperatura i wiatr – okrągłe wartości w °F i mph ustawione na pasku wg klas, reszta – progi przeliczone
  const WX_NICE = { temp: [-20, 0, 20, 32, 50, 70, 90, 110], wind: [10, 20, 30, 40, 60, 80, 100, 130] };
  function wxLegend(i) {
    const ws = WXS[i], n = ws.t.length, top = ws.t[n - 1];
    if (!isImp()) return [`${ws.t[0]}`, `${top}+ ${ws.unit}`, wxTicks(i)];
    const lab = (x) => { const v = toD(x, ws.unit); return ws.unit === '°C' || ws.unit === 'km/h' ? Math.round(v) : rnd(v); };
    const nice = WX_NICE[ws.key];
    // położenie wartości metrycznej na pasku: klasy równej szerokości, w klasie liniowo
    const pos = (x) => { let k = 0; while (k < n - 2 && ws.t[k + 1] <= x) k++; return (k + Math.min(1, Math.max(0, (x - ws.t[k]) / (ws.t[k + 1] - ws.t[k])))) / (n - 1); };
    const ticks = nice ? nice.map((v) => [v, pos(fromD(v, ws.unit))]).filter(([, q]) => q > 0.01 && q < 0.99) : wxTicks(i).map(([t, q]) => [lab(t), q]);
    return [`${lab(ws.t[0])}`, `${lab(top)}+ ${unitD(ws.unit)}`, ticks];
  }
  function unitUi() {
    $('unitBtn').textContent = isImp() ? '°F' : '°C';
    for (const b of $('unitSeg').children) b.classList.toggle('on', (b.dataset.u === 'imperial') === isImp());
  }
  $('unitBtn').onclick = () => setImp(!isImp());
  for (const b of $('unitSeg').children) b.onclick = () => setImp(b.dataset.u === 'imperial');
  // przełącznik: wszystko, co nie odświeża się samo w pętli interfejsu
  onUnits(() => {
    unitUi();
    document.querySelectorAll('.lyh').forEach((h) => { h.textContent = lyGrName(h.dataset.n); });
    for (const sel of [$('fieldV'), $('fieldH')]) for (const o of sel.options) if (FIELDS[o.value]) o.textContent = fieldOpt(+o.value);
    gridSync(); gridInfo(); axLabels(); fitScale(); labels();
    document.querySelectorAll('.uT').forEach((e) => { e.textContent = unitD('°C'); });
    document.querySelectorAll('.uP').forEach((e) => { e.textContent = unitD('mm'); });
    if (!$('titleScr').classList.contains('on')) { synLegend(); synRedraw(); drawForecast(); drawPreview(); monTable(true); drawProf(); drawSnd(true); layInfoBuild(); }
  });
  unitUi();
  document.querySelectorAll('.uT').forEach((e) => { e.textContent = unitD('°C'); });
  document.querySelectorAll('.uP').forEach((e) => { e.textContent = unitD('mm'); });
  function updateLegends() {
    for (const [id, v] of [['legXZ', views[1]], ['legXY', views[0]]]) {
      const r = v.range || viewRange(v);
      const fd = FIELDS[r.id];
      const el = $(id);
      el.querySelector('.bar').style.background = legendCss(fd.cmap);
      // (przeliczenie liniowe: położenie na pasku się nie zmienia, podziałka i podpisy w jednostkach na ekranie)
      const dl = toD(r.lo, fd.unit), dh = toD(r.hi, fd.unit), fmt = (x) => `${+x.toFixed(Math.abs(dh - dl) < 5 ? (isImp() ? 2 : 1) : 0)}`;
      let lo = fmt(dl), hi = `${fmt(dh)} ${unitD(fd.unit)}`, note = fd.name;
      let ticks = legendTicks(dl, dh).filter((t) => t > dl + 1e-9 && t < dh - 1e-9).map((t) => [t, (t - dl) / (dh - dl)]);
      const dT = (t) => (isImp() ? rnd(toD(t, unitOf)) : t);   // próg stałej skali w jednostkach na ekranie
      let unitOf = fd.unit;
      if (fd.cmap >= WX_CMAP0 && fd.cmap < WX_CMAP0 + WXS.length) {
        // skale WX Charts: równe klasy, podpisy progów
        const ws = WXS[fd.cmap - WX_CMAP0];
        [lo, hi, ticks] = wxLegend(fd.cmap - WX_CMAP0);
        if (ws.key === 'psum') {
          // suma opadu: progi przeskalowane do okresu (podpisy zaokrąglone do 2 cyfr znaczących)
          const fa = psumF(r.id), r2 = (x) => { const v = toD(x * fa, 'mm'); return +v.toPrecision(v < 1 ? 1 : 2); };
          lo = `${Math.max(isImp() ? 0.01 : 0.1, r2(ws.t[0]))}`; hi = `${r2(ws.t[ws.t.length - 1])}+ ${unitD(ws.unit)}`;
          ticks = wxTicks(fd.cmap - WX_CMAP0).map(([t, q]) => [r2(t), q]);
        }
        if (ws.key === 'wind' && !isImp()) note += ' (scale in km/h: 10 m/s = 36 km/h)';
        if (ws.key === 'prate') note += ` · rain; snow in purples: ${nD(2, 'mm/h', 0)} … ${fm(150, 'mm/h')} of snow depth (≈ 10 × water)`;
        if (fd.cmap === WX_CMAP0 + 2 && !monFld(r.id)) note += sim.accInfo || '';
        if (monFld(r.id)) note += ` – ${$('monV').textContent}`;
      }
      if (fd.cmap === 6) {
        unitOf = 'mm/h'; lo = `${dT(0.1)}`; hi = `${dT(50)}+ ${unitD('mm/h')}`;
        ticks = RADAR_STEPS.slice(1).map((t, n) => [dT(t), (n + 1) / RADAR_STEPS.length]);
      }
      if (fd.cmap === 14) {
        unitOf = 'mm'; lo = `${dT(0.5)}`; hi = `${dT(2000)}+ ${unitD('mm')}`;
        ticks = ACC_STEPS.map((t, n) => [t, n / ACC_STEPS.length]).filter(([t], n) => n > 0 && [1, 5, 20, 50, 100, 200, 500, 1000].includes(t)).map(([t, q]) => [dT(t), q]);
        note += sim.accInfo || '';
      }
      if (fd.cmap === 15) {
        lo = '5'; hi = '75 dBZ';
        ticks = [10, 20, 30, 40, 50, 60, 70].map((t) => [t, (t - 5) / 70]);
        note += ' – ~20 dBZ drizzle / light snow, 40 downpour, > 55 hail';
      }
      if (r.id === 55) note += ' · red contours: SRH 0–3 km every 100 m²/s² (thick 200) · arrows: shear 0–6 km (full length ' + fm(30, 'm/s') + ')';
      if (fd.cmap === 21) note += ' · > 150 m²/s² favours supercells, > 300 – tornadoes (with high CAPE and shear)';
      if (r.id === 56) note += ' · > 1 supercells possible, > 4 – favourable';
      if (r.id === 51) note += ` · > ${fm(20, 'm/s')} organised storms, > ${fm(25, 'm/s')} supercells`;
      if (r.id === 42) note += ' · flickering dots: lightning (density ∝ flash rate)';
      if (fd.cmap === 20) { unitOf = 'm³/s'; lo = `${dT(0.5)}`; hi = `${dT(1000)} ${unitD('m³/s')}`; ticks = [[dT(5), 0.3], [dT(50), 0.6], [dT(500), 0.91]]; note += ' – water flowing over the terrain (log scale); floods after downpours'; }
      if (fd.cmap === 19) { unitOf = 'cm'; lo = '0'; hi = `${dT(8)} ${unitD('cm')}`; ticks = [[dT(0.5), 0.0625], [dT(2), 0.25], [dT(5), 0.625]]; note += ` – yellow < ${fm(2, 'cm')}, orange ${nD(2, 'cm')}–${fm(5, 'cm')}, purple > ${fm(5, 'cm')}`; }
      if (fd.cmap === 17) { unitOf = 'km'; lo = `0 ${unitD('km')}`; hi = `${dT(10)}+ ${unitD('km')}`; ticks = [[dT(1), 0.1], [dT(5), 0.5]]; note += ` – white: fog (< ${isImp() ? '0.6 mi' : '1 km'}), yellowish: haze`; }
      if (fd.cmap === 18) { lo = ''; hi = ''; ticks = []; note = 'Phenomena: grey – none · light grey – fog · purple-grey – summits and slopes in cloud · light blue – hoar frost · white – rime · crimson – freezing rain (glaze)'; }
      if (fd.cmap === 31) { lo = ''; hi = ''; ticks = []; note = `Surface type, left to right: ${VEG_NAMES.join(' · ')}`; }
      if (fd.cmap === 16) note += ' – dark: dry air (subsidence), light: moist upper troposphere and high clouds';
      if (fd.cmap === 30) { lo = 'stationary · warm'; hi = 'sharp cold'; ticks = [[0, 1 / 2], [1, 3 / 4]]; note = 'Surface fronts (axis from the synoptic model, sharpened in the domain and bent by the flow): purple – stationary (wind along the front), red – warm, light blue – gentle cold (wide precipitation band), navy – sharp cold (sudden temperature drop, lift line, possible squall line); background – T 2 m'; }
      if (r.id === 37) { lo = 'none'; hi = 'dense'; ticks = []; note += ` – low (< ${fmZ(2)}) orange, middle (${fmZ(2)} – ${fmZ(6)}) green, high (> ${fmZ(6)}) blue`; }
      else if (fd.cmap === 9) { lo = 'ground'; hi = 'clouds'; ticks = []; note += ' – visible light, dark at night'; }
      if (fd.cmap === 10) {
        const hd = toD(sim.hmax, 'm');
        hi = fmH(sim.hmax);
        ticks = hd > 0 ? legendTicks(0, hd).filter((t) => t > 0 && t < hd).map((t) => [t, t / hd]) : [];
      }
      const isoT = [0, 20, 21, 24, 46, 47].includes(r.id) && r.iso === 1;
      // (izolinie rysuje shader w stałych krokach w °C i hPa)
      const dIso = fd.unit === '°C' ? (isImp() ? +(r.iso * 1.8).toFixed(1) : r.iso) : fd.unit === 'hPa' ? +toD(r.iso, 'hPa').toPrecision(2) : +toD(r.iso, fd.unit).toPrecision(2);
      const zero = isImp() ? '32 °F' : '0 °C';
      if (r.iso) note += isoT ? (isImp() ? ` · isotherms: every 1.8 °F dashed, every 3.6 °F thin, every 9 °F thick, white = ${zero}` : ` · isotherms: every 1 °C dashed, every 2 °C thin, every 5 °C thick, white = ${zero}`)
        : ` · contours every ${dIso} ${unitD(fd.unit)}` + ([0, 20, 21, 24].includes(r.id) ? `, white = ${zero}` : '');
      el.querySelector('.lo').textContent = lo;
      el.querySelector('.hi').textContent = hi;
      el.querySelector('.ticks').innerHTML = ticks.map(([t, f]) => `<span style="left:${(100 * f).toFixed(2)}%">${+t.toPrecision(3)}</span>`).join('');
      el.querySelector('.note').textContent = note;
      el.title = note;
    }
  }

  const labels = () => {
    const lat = num('lat');
    $('latV').textContent = `${Math.abs(lat)}° ${lat >= 0 ? 'N' : 'S'}`;
    $('contV').textContent = num('cont').toFixed(1);
    $('humV').textContent = `${(100 * num('hum')).toFixed(0)}%`;
    const hr = num('hour');
    $('hourV').textContent = `${Math.floor(hr)}:${hr % 1 ? '30' : '00'}`;
    $('tsfcV').textContent = fT(num('tsfc'), 0);
    $('lapseV').textContent = isImp() ? `${(num('lapse') * 0.54864).toFixed(1)} °F/1000 ft` : `${num('lapse')} K/km`;
    $('rhLowV').textContent = `${num('rhLow')} %`;
    $('rhHighV').textContent = `${num('rhHigh')} %`;
    $('ztropV').textContent = fmZ(num('ztrop'));
    $('zinvV').textContent = num('zinv') > 0 ? fmZ(num('zinv')) : 'none';
    $('tnightV').textContent = num('tnight') > 0 ? `−${fdT(num('tnight'), isImp() ? 1 : 0)}` : 'none';
    $('waterV').textContent = fT(num('water'), 0);
    $('seaV').textContent = fmH(num('sea'));
    $('dinvV').textContent = `+${fdT(num('dinv'), isImp() ? 1 : 0)}`;
    $('windV').textContent = fm(num('wind'), 'm/s');
    $('wlsV').textContent = num('wls') > 0 ? fm(num('wls'), 'cm/s') : 'none';
    // ustawiona anomalia wyraźnie widoczna (pomarańczowa, z ostrzeżeniem)
    manipUi();
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    $('wdirV').textContent = `${num('wdir')}° (${dirs[Math.round(num('wdir') / 45) % 8]})`;
    $('soilV').textContent = `${num('soil')} %`;
    $('hillsV').textContent = fmH(num('hills'));
    $('brushV').textContent = `${+nD(num('brush'), 'km', 1)} ${unitD('km')}`;
    $('rangeV').textContent = `×${Math.pow(2, num('range')).toFixed(2)}`;
    $('cloudAlphaV').textContent = `${num('cloudAlpha')} %`;
    $('zsV').textContent = fmH(num('zs'));
    $('ysV').textContent = `${+nD(num('ys'), 'km', 1)} ${unitD('km')}`;
    $('ztV').textContent = fmZ(num('zt'));
    const fh = num('fieldH');
    $('xyTitle').textContent = v3.on ? '3D view' : fh >= 20 ? 'Map' : 'Horizontal section';
    $('xyInfo').textContent = v3.on ? 'clouds, terrain and sun' : fh >= 20 ? FIELDS[fh].name : `${FIELDS[fh].name} · ${fmH(num('zs'))} a.s.l.`;
    $('zsCtl').style.display = fh >= 20 || v3.on ? 'none' : '';
    for (const b of $('monBtns').children) b.classList.toggle('on', +b.dataset.f === fh);
    $('xzInfo').textContent = `${FIELDS[num('fieldV')].name} · y = ${+nD(num('ys'), 'km', 1)} ${unitD('km')}`;
    $('xzTop').textContent = `height 0 – ${fmZ(num('zt'))}`;
    layMark();
    markMode();
    wxModeUi();
    updateLegends();
  };
  document.querySelectorAll('input, select').forEach((el) => el.addEventListener('input', labels));
  document.querySelectorAll('select').forEach((el) => el.addEventListener('change', labels));

  // Dla testów automatycznych
  window.__sim = {
    async run(n) {
      await resetting;
      runSteps(n, false);
      await device.queue.onSubmittedWorkDone();
      writeParams(1);
      const enc = device.createCommandEncoder();
      encodeDiag(enc);
      device.queue.submit([enc.finish()]);
      await readDiag();
      await bgSync();
      return { simHours: sim.time / 3600, clock: clock(sim.time), stats: sim.stats };
    },
    async bench(n) {
      await resetting;
      await device.queue.onSubmittedWorkDone();
      const t0 = performance.now();
      runSteps(n, false);
      await device.queue.onSubmittedWorkDone();
      return (performance.now() - t0) / n;
    },
    // profil średni: z, T [°C], Td [°C], zachmurzenie
    profile() {
      if (!sim.means) return null;
      return grid.zc.map((z, k) => {
        const th = grid.data[grid.off.TC + k] + sim.means[4 * k];
        const T = th * grid.data[grid.off.EXC + k] - 273.15;
        const Td = dewpoint(sim.means[4 * k + 1], grid.data[grid.off.PRS + k]) - 273.15;
        return [Math.round(z), +T.toFixed(2), +Td.toFixed(2), +sim.means[4 * k + 2].toFixed(3)];
      });
    },
    sfcStats(name) {
      if (!sim.sfc) return null;
      let lo = Infinity, hi = -Infinity, m = 0;
      for (let j = MG; j < MG + NYD; j++) {
        for (let i = MG; i < MG + NXD; i++) {
          const v = sim.sfc[S[name] * NXY + j * NX + i];
          lo = Math.min(lo, v); hi = Math.max(hi, v); m += v;
        }
      }
      return { min: lo, max: hi, mean: m / (NXD * NYD) };
    },
    // wysokość terenu w widocznej domenie (wiersze S→N) – testy
    hgt() { const out = new Array(NXD * NYD); for (let j = 0; j < NYD; j++) for (let i = 0; i < NXD; i++) out[j * NXD + i] = sim.h[(j + MG) * NX + i + MG]; return out; },
    // poziom pierwszej komórki nad gruntem w widocznej domenie (wiersze S→N) – testy terenu schodkowego
    landGrid() { const out = new Array(NXD * NYD); for (let j = 0; j < NYD; j++) for (let i = 0; i < NXD; i++) out[j * NXD + i] = sim.land.cls[(j + MG) * NX + i + MG]; return out; },
    kbGrid() { const out = new Array(NXD * NYD); for (let j = 0; j < NYD; j++) for (let i = 0; i < NXD; i++) out[j * NXD + i] = sim.kb[(j + MG) * NX + i + MG]; return out; },
    // całe pole przy gruncie w widocznej domenie (wiersze S→N) – do analizy komórek w testach
    sfcGrid(name) {
      if (!sim.sfc) return null;
      const out = new Array(NXD * NYD);
      for (let j = 0; j < NYD; j++) for (let i = 0; i < NXD; i++) out[j * NXD + i] = sim.sfc[S[name] * NXY + (j + MG) * NX + i + MG];
      return { nx: NXD, ny: NYD, dx: CFG.DX, v: out };
    },
    // narysuj jedną klatkę (przy zatrzymanej pętli) – do zrzutów ekranu
    async draw() {
      writeParams(1);
      const enc = device.createCommandEncoder();
      encodeDiag(enc);
      device.queue.submit([enc.finish()]);
      await readDiag();
      drawProf();
      const enc2 = device.createCommandEncoder();
      encodeRender(enc2);
      device.queue.submit([enc2.finish()]);
      ts3Map();
      await device.queue.onSubmittedWorkDone();
      labels();
      weatherTick(true);
      updateUi(performance.now());
    },
    // całkowita woda w domenie [kg/m²]: para, chmury, deszcz, + suma opadu
    async water(which = 'state') {
      const rb = buf(STATE_LEN * 4, U.MAP_READ | U.COPY_DST, 'waterRead');
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(which === 'tmp' ? tmpBuf : stateBuf, 0, rb, 0, STATE_LEN * 4);
      device.queue.submit([enc.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const st = new Float32Array(rb.getMappedRange());
      let qv = 0, qc = 0, qr = 0;
      for (let k = 0; k < NZ; k++) {
        const m = grid.data[grid.off.RC + k] * grid.data[grid.off.DZC + k] / NXY;
        for (let c = 0; c < NXY; c++) {
          if (sim.kb && k < sim.kb[c]) continue;
          const i = k * NXY + c;
          qv += m * st[QV_OFF + i]; qc += m * (st[QV_OFF + N + i] + st[QV_OFF + 2 * N + i]); qr += m * st[QV_OFF + 3 * N + i];
        }
      }
      rb.unmap(); rb.destroy();
      return { qv, qc, qr };
    },
    // uruchom wybrane jądra jeden raz (diagnostyka)
    async kernels(names) {
      writeParams(1);
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      const all = { surface: [NXY, 64], advect: [STATE_LEN], turb_k: [N], diffuse: [9 * NXY, 64], micro: [NXY, 64],
        mass_sum: [N], mass_scale: [1, 1024], mass_apply: [4 * N], lbc_apply: [NXY, 64], lap4: [4 * N],
        cumulus: [NXY, 64], org_update: [NXY, 64], cu_spread: [NXY, 64], front_phi: [NF] };
      for (const n of names) {
        if (n === 'lbc_means') { pass.setPipeline(pipe('lbc_means')); pass.setBindGroup(0, simBG, [0]); pass.dispatchWorkgroups(4 * CFG.MEB + 2 * NZ, 1); continue; }
        const k = n === 'mass_scale' ? one(n) : K(n, ...all[n]); pass.setPipeline(k.p); pass.setBindGroup(0, simBG, [0]); pass.dispatchWorkgroups(k.g[0], k.g[1]);
      }
      pass.end();
      device.queue.submit([enc.finish()]);
      await device.queue.onSubmittedWorkDone();
    },
    // wartości przy gruncie wzdłuż wiersza j (do testów)
    row(j) {
      if (!sim.sfc) return [];
      const out = [];
      for (let i = 0; i < NXV; i++) {
        const c = j * NX + i;
        out.push({ h: sim.h[c], t2: sim.sfc[S.T2 * NXY + c], td2: sim.sfc[S.TD2 * NXY + c], pacc: sim.sfc[S.PACC * NXY + c], pr: sim.sfc[S.PR * NXY + c], cu: sim.sfc[S.PRCU * NXY + c], veg: sim.veg ? sim.veg[c] : -1, ts: sim.sfc[S.TS * NXY + c], lwp: sim.sfc[S.LWP * NXY + c], ws: sim.sfc[S.WS * NXY + c], pblh: sim.sfc[S.PBLH * NXY + c], hf: sim.sfc[S.H * NXY + c], td: sim.sfc[S.TD * NXY + c] });
      }
      return out;
    },
    scenario: applyScenario,
    reset,
    stations: () => sim.stations,
    // średni opad modelu synoptycznego w domenie [mm/h] (siatka parametrów, parametr 13)
    async pePr() { const a = await readPGrid(); const nn = (CFG.NX / CFG.GS) * (CFG.NY / CFG.GS); let s = 0; for (let n = 0; n < nn; n++) s += Math.max(a[13 * nn + n], 0); return s / nn; },
    // zoom mapy (testy): powiększenie, punkt zakotwiczenia (ułamki okna)
    zoom: (s, ax = 0.5, ay = 0.5) => sim.setZoom(s, ax, ay),
    // teren z mapy świata w punkcie (lat, lon) z klimatem podanym ręcznie (testy, bez Open-Meteo)
    async dem(lat, lon, cont = 1, hum = 0.8, flatH = 220) {
      let t;
      try { t = await fetchTerrain(lat, lon, NXV, NYV, CFG.DX, () => {}); }
      catch (e) { console.warn(`[T] ${e.message} – flat land ${flatH} m`); t = { h: new Float32Array(NXV * NYV).fill(flatH) }; }
      sim.applyDem(t, lat, lon, { cont, hum, bias: 0 });
      if (window.__lc !== false) await sim.applyLandCover(lat, lon, () => {});
      await reset();
    },
    // link do bieżącego stanu (jak przycisk „Kopiuj link”) – scenki testowe widoku 3D
    async link() { return `${location.origin}${location.pathname}${gridQuery()}#s=${await packState(getState())}`; },
    // atmosfera nowego widoku 3D (testy): profil średni domeny i tablice (przepuszczalność, Ψ, oświetlenie przez niebo)
    async atm() {
      const h2f = (h) => { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023; return e === 0 ? s * m * 2 ** -24 : e === 31 ? NaN : s * (1 + m / 1024) * 2 ** (e - 15); };
      const rd = buf((NZ + 2) * 16 + 2048 * 64 + 2 * 256 * 32, U.MAP_READ | U.COPY_DST, 'atmRead');
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(profBuf, 0, rd, 0, (NZ + 2) * 16);
      const o1 = (NZ + 2) * 16, o2 = o1 + 2048 * 64, o3 = o2 + 256 * 32;
      enc.copyTextureToBuffer({ texture: transTex }, { buffer: rd, offset: o1, bytesPerRow: 2048 }, [256, 64]);
      enc.copyTextureToBuffer({ texture: msTex }, { buffer: rd, offset: o2, bytesPerRow: 256 }, [32, 32]);
      enc.copyTextureToBuffer({ texture: irrTex }, { buffer: rd, offset: o3, bytesPerRow: 256 }, [32, 32]);
      device.queue.submit([enc.finish()]);
      await rd.mapAsync(GPUMapMode.READ);
      const ab = rd.getMappedRange().slice(0); rd.unmap(); rd.destroy();
      const pf = new Float32Array(ab, 0, (NZ + 2) * 4), hv = new Uint16Array(ab);
      const tex = (off, w, x, y) => [0, 1, 2].map((c) => h2f(hv[(off + (y * w + x) * 8) / 2 + c]));
      return { prof: Array.from({ length: NZ + 1 }, (_, k) => [grid.zc[k] ?? 0, ...pf.slice(4 * k, 4 * k + 4)]), trans: (x, y) => tex(o1, 256, x, y), ms: (x, y) => tex(o2, 32, x, y), irr: (x, y) => tex(o3, 32, x, y) };
    },
    // miejsce z mapy świata jak w oknie „Mapa świata” (klimat ERA5 z Open-Meteo, teren, WorldCover, restart) – testy
    async place(lat, lon) {
      const c = placeClimate(lat, lon);
      const t = await fetchTerrain(lat, lon, NXV, NYV, CFG.DX, () => {});
      applyDem(t, lat, lon, c);
      await applyLandCover(lat, lon, () => {});
      await reset();
      return { cont: c.cont, hum: c.hum, bias: c.bias, koppen: c.koppen && c.koppen.code };
    },
    // profile w kolumnie (i, j) i pola docelowe (do diagnostyki): z, u, u_d, v, v_d, θ', θ'_d, q_v, q_v,d [g/kg], w, θ0
    async column(i, j) {
      await device.queue.onSubmittedWorkDone();
      const rb = buf(STATE_LEN * 4, U.MAP_READ | U.COPY_DST, 'colRead');
      const rt = buf(3 * TG_SLOT * 4, U.MAP_READ | U.COPY_DST, 'colTgt');
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(stateBuf, 0, rb, 0, STATE_LEN * 4);
      enc.copyBufferToBuffer(tgtBuf, 0, rt, 0, 3 * TG_SLOT * 4);
      device.queue.submit([enc.finish()]);
      await Promise.all([rb.mapAsync(GPUMapMode.READ), rt.mapAsync(GPUMapMode.READ)]);
      const st = new Float32Array(rb.getMappedRange()), tg = new Float32Array(rt.getMappedRange());
      const w = tgW((sim.time - drv.tA) / DTQ), A = drv.slot, B = (A + 1) % 3, Pm = (A + 2) % 3;
      const T = (f, l) => w[0] * tg[Pm * TG_SLOT + f * N + l] + w[1] * tg[A * TG_SLOT + f * N + l] + w[2] * tg[B * TG_SLOT + f * N + l];
      const out = [];
      for (let k = 0; k < NZ; k++) {
        const l = k * NXY + j * NX + i;
        out.push([Math.round(grid.zc[k]), +st[l].toFixed(2), +T(2, l).toFixed(2), +st[N + l].toFixed(2), +T(3, l).toFixed(2),
          +st[T_OFF + l].toFixed(2), +T(0, l).toFixed(2), +(1000 * st[QV_OFF + l]).toFixed(2), +(1000 * T(1, l)).toFixed(2), +st[2 * N + l].toFixed(3), grid.data[grid.off.TC + k]]);
      }
      rb.unmap(); rt.unmap(); rb.destroy(); rt.destroy();
      return out;
    },
    // dryf domeny względem dużej skali (diagnostyka zimy): średnie po widocznej domenie na poziomach (z n.p.m.) –
    // T domeny i celu [°C], q_v domeny i celu [g/kg], liczba oczek nad gruntem; osobno najniższa warstwa nad gruntem (bl)
    async drift() {
      await device.queue.onSubmittedWorkDone();
      const rb = buf(STATE_LEN * 4, U.MAP_READ | U.COPY_DST, 'drRead');
      const rt = buf(3 * TG_SLOT * 4, U.MAP_READ | U.COPY_DST, 'drTgt');
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(stateBuf, 0, rb, 0, STATE_LEN * 4);
      enc.copyBufferToBuffer(tgtBuf, 0, rt, 0, 3 * TG_SLOT * 4);
      device.queue.submit([enc.finish()]);
      await Promise.all([rb.mapAsync(GPUMapMode.READ), rt.mapAsync(GPUMapMode.READ)]);
      const st = new Float32Array(rb.getMappedRange()), tg = new Float32Array(rt.getMappedRange());
      const w = tgW((sim.time - drv.tA) / DTQ), A = drv.slot, B = (A + 1) % 3, Pm = (A + 2) % 3;
      const T = (f, l) => w[0] * tg[Pm * TG_SLOT + f * N + l] + w[1] * tg[A * TG_SLOT + f * N + l] + w[2] * tg[B * TG_SLOT + f * N + l];
      const lev = [], bl = { T: 0, Tt: 0, q: 0, qt: 0, n: 0 };
      for (let k = 0; k < NZ; k++) {
        const tc = grid.data[grid.off.TC + k], ex = grid.data[grid.off.EXC + k];
        let s = 0, stt = 0, q = 0, qt = 0, n = 0;
        for (let j = MG; j < MG + NYD; j++) for (let i = MG; i < MG + NXD; i++) {
          const c = j * NX + i;
          if (k < sim.kb[c]) continue;
          const l = k * NXY + c;
          const td = (tc + st[T_OFF + l]) * ex - 273.15, tt = (tc + T(0, l)) * ex - 273.15;
          s += td; stt += tt; q += 1000 * st[QV_OFF + l]; qt += 1000 * T(1, l); n++;
          if (k === sim.kb[c]) { bl.T += td; bl.Tt += tt; bl.q += 1000 * st[QV_OFF + l]; bl.qt += 1000 * T(1, l); bl.n++; }
        }
        if (n) lev.push({ z: Math.round(grid.zc[k]), T: s / n, Tt: stt / n, q: q / n, qt: qt / n, n });
      }
      rb.unmap(); rt.unmap(); rb.destroy(); rt.destroy();
      for (const key of ['T', 'Tt', 'q', 'qt']) bl[key] /= bl.n;
      return { lev, bl };
    },
    // kolumna (i, j) w oczkach widocznej domeny: z n.p.g., T [°C], w, q_v, q_c, q_i, q_r [g/kg], θ' (diagnostyka burz)
    async colq(i, j) {
      await device.queue.onSubmittedWorkDone();
      const rb = buf(STATE_LEN * 4, U.MAP_READ | U.COPY_DST, 'colqRead');
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(stateBuf, 0, rb, 0, STATE_LEN * 4);
      device.queue.submit([enc.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const st = new Float32Array(rb.getMappedRange());
      const c = (j + MG) * NX + i + MG, out = [];
      for (let k = sim.kb[c]; k < NZ; k++) {
        const l = k * NXY + c, th = grid.data[grid.off.TC + k] + st[T_OFF + l];
        out.push([Math.round(grid.zc[k] - sim.h[c]), +(th * grid.data[grid.off.EXC + k] - 273.15).toFixed(1), +(0.5 * (st[2 * N + l] + st[2 * N + l + NXY])).toFixed(1),
          +(1000 * st[QV_OFF + l]).toFixed(2), +(1000 * st[QV_OFF + N + l]).toFixed(2), +(1000 * st[QV_OFF + 2 * N + l]).toFixed(2), +(1000 * st[QV_OFF + 3 * N + l]).toFixed(2), +st[T_OFF + l].toFixed(2), Math.round(st[QV_OFF + 4 * N + l])]);
      }
      rb.unmap(); rb.destroy();
      return out;
    },
    // wiersz j widocznej domeny (S→N) na poziomie k (diagnostyka frontów): T domeny i dużej skali [°C], q_v domeny i celu [g/kg],
    // u, v, w (ściana k) [m/s] oraz ruch pionowy dużej skali (~3 km, model synoptyczny) – tylko oczka widoczne
    async rowk(j, k) {
      await device.queue.onSubmittedWorkDone();
      // (cel w przybliżeniu liniowo między terminami A i B – diagnostyka)
      const base = k * NXY + (j + MG) * NX, A = drv.slot, B = (drv.slot + 1) % 3, a = (sim.time - drv.tA) / DTQ;
      const src = [[stateBuf, T_OFF + base], [stateBuf, QV_OFF + base], [stateBuf, base], [stateBuf, N + base], [stateBuf, 2 * N + base],
        [tgtBuf, A * TG_SLOT + base], [tgtBuf, B * TG_SLOT + base], [tgtBuf, A * TG_SLOT + N + base], [tgtBuf, B * TG_SLOT + N + base],
        [tgtBuf, A * TG_SLOT + 4 * N + 3 * NXY + (j + MG) * NX], [tgtBuf, B * TG_SLOT + 4 * N + 3 * NXY + (j + MG) * NX],
        [tgtBuf, A * TG_SLOT + 2 * N + base], [tgtBuf, B * TG_SLOT + 2 * N + base], [tgtBuf, A * TG_SLOT + 3 * N + base], [tgtBuf, B * TG_SLOT + 3 * N + base]];
      const rb = buf(src.length * NX * 4, U.MAP_READ | U.COPY_DST, 'rowRead');
      const enc = device.createCommandEncoder();
      src.forEach(([b, o], n) => enc.copyBufferToBuffer(b, o * 4, rb, n * NX * 4, NX * 4));
      device.queue.submit([enc.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const d = new Float32Array(rb.getMappedRange().slice(0));
      rb.unmap(); rb.destroy();
      const f = (n) => Array.from(d.subarray(n * NX + MG, n * NX + MG + NXD));
      const tc = grid.data[grid.off.TC + k], ex = grid.data[grid.off.EXC + k];
      const mix = (p, q) => p.map((x, i) => (1 - a) * x + a * q[i]);
      return { z: grid.zc[k], dx: CFG.DX, T: f(0).map((x) => (tc + x) * ex - 273.15), Tt: mix(f(5), f(6)).map((x) => (tc + x) * ex - 273.15),
        q: f(1).map((x) => 1000 * x), qt: mix(f(7), f(8)).map((x) => 1000 * x), u: f(2), v: f(3), w: f(4), wls: mix(f(9), f(10)),
        ut: mix(f(11), f(12)), vt: mix(f(13), f(14)) };
    },
    levels: () => grid.zc.slice(),
    // stan bazowy na poziomach (testy CAPE): z środków, ciśnienie [Pa], Exner, θ0, ρ0; MG – margines (indeksy column())
    base: () => ({ zc: grid.zc.slice(), prs: Array.from({ length: NZ }, (_, k) => grid.data[grid.off.PRS + k]),
      exc: Array.from({ length: NZ }, (_, k) => grid.data[grid.off.EXC + k]), tc: Array.from({ length: NZ }, (_, k) => grid.data[grid.off.TC + k]),
      rc: Array.from({ length: NZ }, (_, k) => grid.data[grid.off.RC + k]), dzc: Array.from({ length: NZ }, (_, k) => grid.data[grid.off.DZC + k]), mg: MG, kb: sim.kb, h: sim.h, nx: NX }),
    // geometria frontów w terminie A (widoczna domena, wiersze S→N): pola nx, ny, s, D, L, tilt, w, typ, gmax [K/100 km], fness, dT
    async frontGeo() {
      await device.queue.onSubmittedWorkDone();
      const rb = buf(11 * NXY * 4, U.MAP_READ | U.COPY_DST, 'frGeo');
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(tgtBuf, (drv.slot * TG_SLOT + 4 * N + 4 * NXY) * 4, rb, 0, 11 * NXY * 4);
      device.queue.submit([enc.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const d = new Float32Array(rb.getMappedRange().slice(0));
      rb.unmap(); rb.destroy();
      const names = ['nx', 'ny', 's', 'D', 'L', 'tilt', 'w', 'typ', 'gmax', 'fness', 'dT'], out = { nx: NXD, ny: NYD, dx: CFG.DX };
      names.forEach((n, f) => { const a = new Float32Array(NXD * NYD); for (let j = 0; j < NYD; j++) for (let i = 0; i < NXD; i++) a[j * NXD + i] = d[f * NXY + (j + MG) * NX + i + MG]; out[n] = a; });
      return out;
    },
    // położenie minimum i maksimum θ' (diagnostyka): [[i, j, k, wartość, cel], …]
    async thExt() {
      await device.queue.onSubmittedWorkDone();
      const rb = buf(STATE_LEN * 4, U.MAP_READ | U.COPY_DST, 'thRead');
      const rt = buf(TG_SLOT * 4, U.MAP_READ | U.COPY_DST, 'thTg');
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(stateBuf, 0, rb, 0, STATE_LEN * 4);
      enc.copyBufferToBuffer(tgtBuf, drv.slot * TG_SLOT * 4, rt, 0, TG_SLOT * 4);
      device.queue.submit([enc.finish()]);
      await Promise.all([rb.mapAsync(GPUMapMode.READ), rt.mapAsync(GPUMapMode.READ)]);
      const st = new Float32Array(rb.getMappedRange()), tg = new Float32Array(rt.getMappedRange());
      let lo = 0, hi = 0;
      for (let l = 0; l < N; l++) { if (st[T_OFF + l] < st[T_OFF + lo]) lo = l; if (st[T_OFF + l] > st[T_OFF + hi]) hi = l; }
      const f = (l) => [l % NX, Math.floor(l / NX) % NY, Math.floor(l / NXY), +st[T_OFF + l].toFixed(2), +tg[l].toFixed(2), Math.round(sim.h[l % NXY]), sim.kb[l % NXY]];
      const out = [f(lo), f(hi)];
      rb.unmap(); rt.unmap(); rb.destroy(); rt.destroy();
      return out;
    },
    // położenie największego |w| (diagnostyka niestabilności): [i, j, k, w, wysokość terenu]
    async wmax() {
      await device.queue.onSubmittedWorkDone();
      const rb = buf(STATE_LEN * 4, U.MAP_READ | U.COPY_DST, 'wmaxRead');
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(stateBuf, 0, rb, 0, STATE_LEN * 4);
      device.queue.submit([enc.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const st = new Float32Array(rb.getMappedRange());
      let best = 0, bi = 0;
      for (let l = 2 * N; l < 2 * N + NW; l++) if (Math.abs(st[l]) > best) { best = Math.abs(st[l]); bi = l - 2 * N; }
      const k = Math.floor(bi / NXY), c = bi % NXY, w = st[2 * N + bi];
      rb.unmap(); rb.destroy();
      return [c % NX, Math.floor(c / NX), k, w, Math.round(sim.h[c]), sim.kb[c]];
    },
    // szum skali oczka na poziomie k (test): d2/d1 ≈ 0 pole gładkie, ≈ 1.7 biały szum, 2 – szachownica
    async noise(k) {
      await device.queue.onSubmittedWorkDone();
      const rb = buf(STATE_LEN * 4, U.MAP_READ | U.COPY_DST, 'noiseRead');
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(stateBuf, 0, rb, 0, STATE_LEN * 4);
      device.queue.submit([enc.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const st = new Float32Array(rb.getMappedRange());
      const out = {};
      for (const [name, off] of [['u', 0], ['v', N], ['w', 2 * N], ['th', T_OFF], ['qv', QV_OFF], ['qc', T_OFF + 2 * N], ['qi', T_OFF + 3 * N], ['qr', T_OFF + 4 * N]]) {
        let ax = 0, ay = 0, rx = 0, ry = 0, a = 0, n = 0;
        for (let j = MG + 1; j < MG + NYD - 1; j++) for (let i = MG + 1; i < MG + NXD - 1; i++) {
          const c = off + k * NXY + j * NX + i, f = st[c];
          ax += Math.abs(st[c + 1] - 2 * f + st[c - 1]); ay += Math.abs(st[c + NX] - 2 * f + st[c - NX]);
          rx += Math.abs(st[c + 1] - f); ry += Math.abs(st[c + NX] - f); a += Math.abs(f); n++;
        }
        out[name] = `${(a / n).toExponential(1)} ${(ax / rx).toFixed(2)}/${(ay / ry).toFixed(2)}`;
      }
      rb.unmap(); rb.destroy();
      return out;
    },
    // kamera widoku 3D (testy): azymut, wysokość kątowa [rad], odległość względna
    fly: (on, pos, yaw, pitch) => sim.fly(on, pos, yaw, pitch),     // wolna kamera (testy): pozycja [m, m, m n.p.m.], kierunek
    cam3d(yaw, pitch, dist) { if (yaw !== undefined) v3.yaw = +yaw; if (pitch !== undefined) v3.pitch = +pitch; if (dist !== undefined) v3.dist = +dist; },
    // czas jąder jednego kroku na GPU (znaczniki czasu) [ms], suma po nazwie
    async kprofile(reps = 20) {
      if (!ts) return null;
      const seq = sim.flat ? seqFlat : seqTerrain, n = seq.length;
      const qs = device.createQuerySet({ type: 'timestamp', count: 2 * n });
      const res = buf(16 * n, U.QUERY_RESOLVE | U.COPY_SRC, 'kpRes'), rd = buf(16 * n, U.MAP_READ | U.COPY_DST, 'kpRead');
      const tot = {};
      writeParams(1);
      for (let r = 0; r < reps; r++) {
        const enc = device.createCommandEncoder();
        seq.forEach((k, i) => {
          const pass = enc.beginComputePass({ timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 2 * i, endOfPassWriteIndex: 2 * i + 1 } });
          pass.setPipeline(k.p); pass.setBindGroup(0, simBG, [0]); pass.dispatchWorkgroups(k.g[0], k.g[1]); pass.end();
        });
        enc.resolveQuerySet(qs, 0, 2 * n, res, 0);
        enc.copyBufferToBuffer(res, 0, rd, 0, 16 * n);
        device.queue.submit([enc.finish()]);
        await rd.mapAsync(GPUMapMode.READ);
        const t = new BigUint64Array(rd.getMappedRange());
        seq.forEach((k, i) => { tot[k.n] = (tot[k.n] || 0) + Number(t[2 * i + 1] - t[2 * i]) / 1e6 / reps; });
        rd.unmap();
      }
      qs.destroy(); res.destroy(); rd.destroy();
      return Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, +v.toFixed(3)]));
    },
    // model synoptyczny: masa powietrza, ciśnienie, prognoza; tryb dużej skali ('syn' / 'const')
    // statystyka modelu synoptycznego (kopia, bez domeny): ciśnienie w środku co 6 h i niże na mapie co dobę
    async peStats(days = 60) {
      if (!drv.model) return null;
      const m = drv.model.clone();
      const pc = [], lows = [], mins = [], tds = [], zon = [], rhs = [];
      for (let s = 0; s < days * 48; s++) {
        m.step();
        if (s % 12 === 11) { const c = await m.readCenter(); pc.push(c.psl); tds.push(c.tDay); rhs.push([c.pv[5], c.pv[6], c.pr, c.ql]); }
        if (s % 48 === 47) {
          const mp = await m.readMap();
          let mn = 9999, n990 = 0, n1000 = 0, cnt = 0;
          for (let j = 16; j < NYP - 16; j++) for (let i = 0; i < NXP; i++) {
            const v = mp.psl[j * NXP + i]; mn = Math.min(mn, v); cnt++; if (v < 990) n990++; if (v < 1000) n1000++;
          }
          mins.push(mn); lows.push([n990 / cnt, n1000 / cnt]);
          for (let j = 0; j < NYP; j++) { let a = 0; for (let i = 0; i < NXP; i++) a += mp.psl[j * NXP + i]; zon[j] = (zon[j] || 0) + a / NXP; }
        }
      }
      m.destroy();
      const mean = pc.reduce((a, b) => a + b, 0) / pc.length;
      const sd = Math.sqrt(pc.reduce((a, b) => a + (b - mean) ** 2, 0) / pc.length);
      const tm = tds.reduce((a, b) => a + b, 0) / tds.length;
      const d6 = pc.slice(4).map((v, n) => Math.abs(v - pc[n])).reduce((a, b) => a + b, 0) / (pc.length - 4);
      return { pMean: +mean.toFixed(1), pSd: +sd.toFixed(1), pMin: +Math.min(...pc).toFixed(0), pMax: +Math.max(...pc).toFixed(0),
        dp24: +d6.toFixed(1), frac1005: +(pc.filter((v) => v < 1005).length / pc.length).toFixed(2), frac1020: +(pc.filter((v) => v > 1020).length / pc.length).toFixed(2),
        mapMinMean: +(mins.reduce((a, b) => a + b, 0) / mins.length).toFixed(0), mapMin: +Math.min(...mins).toFixed(0),
        area990: +(lows.reduce((a, b) => a + b[0], 0) / lows.length * 100).toFixed(1), area1000: +(lows.reduce((a, b) => a + b[1], 0) / lows.length * 100).toFixed(1),
        tDayMean: +tm.toFixed(1), tDaySeries: tds.filter((_, n) => n % 4 === 3).map((v) => +v.toFixed(1)),
        rhLow: +(rhs.reduce((a, b) => a + b[0], 0) / rhs.length).toFixed(2), rhHigh: +(rhs.reduce((a, b) => a + b[1], 0) / rhs.length).toFixed(2),
        prDay: +(rhs.reduce((a, b) => a + b[2], 0) / rhs.length * 24).toFixed(2), ql1km: +(1000 * rhs.reduce((a, b) => a + b[3], 0) / rhs.length).toFixed(1), prFrac: +(rhs.filter((b) => b[2] > 0.1).length / rhs.length).toFixed(2),
        zonal: zon.filter((v, j) => j % 6 === 3).map((v, n) => `${(m.latC + ((n * 6 + 3.5) * DXP - LYP / 2) / 111.2e3).toFixed(0)}°:${(v / mins.length).toFixed(0)}`).join(' ') };
    },
    // model synoptyczny sam (kopia): średnie strefowe co 6 h przez `days` dób – w każdym wierszu (szerokość) ciśnienie, wiatr
    // ~1.5 i 5.6 km, T ~1.5, 3 i 5.6 km, T przy gruncie, opad; osobno pełne koło szerokości i sektor ±sec oczek wokół domeny
    // (testy: pasy, prąd strumieniowy, odchyłki od klimatologii – doy: środek okresu)
    async peZonal(days = 30, sec = 20) {
      if (!drv.model) return null;
      const m = drv.model.clone(), ic = NXP >> 1, ks = ['psl', 'u15', 'v15', 'u5', 't15', 't3', 't5', 'ts', 'pr'];
      const Z = Object.fromEntries(ks.map((k) => [k, new Float64Array(NYP)])), S = Object.fromEntries(ks.map((k) => [k, new Float64Array(NYP)]));
      let n = 0;
      for (let s = 0; s < days * 4; s++) {
        for (let q = 0; q < 12; q++) m.step();
        const mp = await m.readMap(); n++;
        for (const k of ks) for (let j = 0; j < NYP; j++) {
          let a = 0, b = 0;
          for (let i = 0; i < NXP; i++) a += mp[k][j * NXP + i];
          for (let i = ic - sec; i <= ic + sec; i++) b += mp[k][j * NXP + ((i + NXP) % NXP)];
          Z[k][j] += a / NXP; S[k][j] += b / (2 * sec + 1);
        }
      }
      m.destroy();
      const rows = [];
      for (let j = 1; j < NYP; j += 3) {
        const r = { lat: +(m.latC + ((j + 0.5) * DXP - LYP / 2) / 111.2e3).toFixed(1) };
        for (const k of ks) { r[k] = +(Z[k][j] / n).toFixed(k === 'pr' ? 3 : 1); r['s_' + k] = +(S[k][j] / n).toFixed(k === 'pr' ? 3 : 1); }
        rows.push(r);
      }
      return { latC: m.latC, yc: m.yc, doy: m.doyAt(m.time - days * 43200), rows };
    },
    // model synoptyczny sam (kopia): średnie dobowe mapy ciśnienia (z odczytów co 6 h) i mapy średnie z całego okresu (wiatr ~1.5
    // i 5.6 km, T ~1.5 km, ciśnienie) na całej siatce kanału; lat[j], lon[i] – położenie oczek (testy: tor niżów, ośrodki
    // działania i prąd strumieniowy wobec klimatologii)
    async peMap(days = 30) {
      if (!drv.model) return null;
      const m = drv.model.clone(), NP = NXP * NYP, ks = ['psl', 'u15', 'u5', 't15'];
      const mean = Object.fromEntries(ks.map((k) => [k, new Float32Array(NP)])), daily = [];
      for (let d = 0; d < days; d++) {
        const p = new Float32Array(NP);
        for (let q = 0; q < 4; q++) {
          for (let s = 0; s < 12; s++) m.step();
          const mp = await m.readMap();
          for (let c = 0; c < NP; c++) p[c] += mp.psl[c] / 4;
          for (const k of ks) for (let c = 0; c < NP; c++) mean[k][c] += mp[k][c] / (4 * days);
        }
        daily.push(p);
      }
      m.destroy();
      const lat = Array.from({ length: NYP }, (_, j) => m.latC + ((j + 0.5) * DXP - LYP / 2) / 111.2e3);
      const lon = Array.from({ length: NXP }, (_, i) => (m.geo ? m.geo.lon : 0) + 360 * ((i + 0.5) / NXP - 0.5));
      return { NXP, NYP, lat, lon, doy: m.doyAt(m.time - days * 43200), daily, mean };
    },
    // model synoptyczny sam (kopia): średnie map w miesiącach kalendarzowych (odczyty co 6 h) – T przy gruncie (średnia dobowa,
    // poziom morza), podłoża, na 1.5 / 3 / 5.6 km, opad (i konwekcyjny), zachmurzenie, strumienie z podłoża, woda w glebie, CAPE
    // i częstość konwekcji Bettsa–Millera (pada / zablokowana); co 6 h stan w środku domeny (wiatr i T ~1.5 km, T przy gruncie,
    // opad), co dobę wilgotność gleby (testy: przebieg pór roku wobec klimatologii)
    async peMonths(days = 240, ks = ['ts', 'tsfc', 't15', 't3', 't5', 'pr', 'prc', 'cloud', 'sh', 'lh', 'swSfc', 'soil', 'cape', 'bmAct', 'bmBlk']) {
      if (!drv.model) return null;
      const m = drv.model.clone(), NP = NXP * NYP, ic = NXP >> 1, jc = (NYP >> 1) + Math.round(m.yc / DXP), months = [], ctr = [];
      let cur = null;
      for (let s = 0; s < days * 4; s++) {
        for (let q = 0; q < 12; q++) m.step();
        const mp = await m.readMap(), mo = new Date(Date.UTC(2001, 0, 1) + (Math.floor(m.doyAt(m.time)) - 1) * 864e5).getUTCMonth() + 1;
        if (!cur || cur.mon !== mo) { cur = { mon: mo, n: 0, sum: Object.fromEntries(ks.map((k) => [k, new Float64Array(NP)])) }; months.push(cur); }
        cur.n++;
        for (const k of ks) { const a = cur.sum[k], f = mp[k]; for (let c = 0; c < NP; c++) a[c] += f[c]; }
        const a = { mon: mo };
        for (const k of ['u15', 'v15', 't15', 'ts', 'pr']) {
          let v = 0;
          for (let j = jc - 1; j <= jc + 1; j++) for (let i = ic - 1; i <= ic + 1; i++) v += mp[k][j * NXP + i];
          a[k] = +(v / 9).toFixed(2);
        }
        if (s % 4 === 3) a.soil = +(await m.readCenter()).soil.toFixed(3);
        ctr.push(a);
      }
      m.destroy();
      const lat = Array.from({ length: NYP }, (_, j) => m.latC + ((j + 0.5) * DXP - LYP / 2) / 111.2e3);
      const lon = Array.from({ length: NXP }, (_, i) => (m.geo ? m.geo.lon : 0) + 360 * ((i + 0.5) / NXP - 0.5));
      return { NXP, NYP, lat, lon, ctr,
        months: months.map((x) => ({ mon: x.mon, n: x.n, mean: Object.fromEntries(ks.map((k) => [k, Float32Array.from(x.sum[k], (v) => v / x.n)])) })) };
    },
    // długi przebieg samego modelu synoptycznego (kopia, bez domeny): średnie dobowe w okolicy domeny (±2 oczka ≈ ±150 km)
    // z odczytów co 6 h – T przy gruncie, na 1.5 / 3 / 5 km, opad [mm/d], zachmurzenie, OLR (diagnostyka dryfu w długich przebiegach)
    async peYear(days = 365) {
      if (!drv.model) return null;
      const m = drv.model.clone(), out = [];
      const ic = NXP >> 1, jc = (NYP >> 1) + Math.round(m.yc / DXP);
      for (let d = 0; d < days; d++) {
        const acc = { ts: 0, t15: 0, t3: 0, t5: 0, pr: 0, cloud: 0, olr: 0, asr: 0, sws: 0, lwn: 0, sh: 0, lh: 0, tsfc: 0, n: 0 };
        for (let q = 0; q < 4; q++) {
          for (let s = 0; s < 12; s++) m.step();
          const mp = await m.readMap();
          for (let j = jc - 2; j <= jc + 2; j++) for (let i = ic - 2; i <= ic + 2; i++) {
            const c = j * NXP + i;
            acc.ts += mp.ts[c]; acc.t15 += mp.t15[c]; acc.t3 += mp.t3[c]; acc.t5 += mp.t5[c]; acc.pr += mp.pr[c]; acc.cloud += mp.cloud[c]; acc.olr += mp.olr[c];
            acc.asr += mp.asr[c]; acc.sws += mp.swSfc[c]; acc.lwn += mp.lwNet[c]; acc.sh += mp.sh[c]; acc.lh += mp.lh[c]; acc.tsfc += mp.tsfc[c]; acc.n++;
          }
        }
        out.push(Object.fromEntries(Object.entries(acc).filter(([k]) => k !== 'n').map(([k, v]) => [k, v / acc.n])));
      }
      m.destroy();
      return out;
    },
    // model synoptyczny sam (kopia): co 6 h w środku domeny (średnia 3 × 3 oczka) wiatr i T ~1.5 km, T 3 i 5 km, T przy gruncie,
    // opad i jego część konwekcyjna – masy powietrza wg kierunku napływu (testy)
    async peWinds(days = 90) {
      if (!drv.model) return null;
      const m = drv.model.clone(), out = [];
      const ic = NXP >> 1, jc = (NYP >> 1) + Math.round(m.yc / DXP);
      for (let s = 0; s < days * 4; s++) {
        for (let q = 0; q < 12; q++) m.step();
        const mp = await m.readMap(), a = {};
        for (const k of ['u15', 'v15', 't15', 't3', 't5', 'ts', 'pr', 'prc', 'cloud']) {
          let v = 0;
          for (let j = jc - 1; j <= jc + 1; j++) for (let i = ic - 1; i <= ic + 1; i++) v += mp[k][j * NXP + i];
          a[k] = +(v / 9).toFixed(3);
        }
        out.push(a);
      }
      m.destroy();
      return out;
    },
    // masy powietrza nad środkiem w samym modelu synoptycznym (kopia): co 6 h klasyfikacja, liczność wg pór roku (XII–II, III–V,
    // VI–VIII, IX–XI) i średnia anomalia temperatury każdej masy (testy)
    async peMasses(days = 365) {
      if (!drv.model) return null;
      const m = drv.model.clone(), out = { DJF: {}, MAM: {}, JJA: {}, SON: {} }, anom = {};
      const seas = (doy) => { const mo = new Date(Date.UTC(2001, 0, 1) + (doy - 1) * 86400000).getUTCMonth(); return ['DJF', 'DJF', 'MAM', 'MAM', 'MAM', 'JJA', 'JJA', 'JJA', 'SON', 'SON', 'SON', 'DJF'][mo]; };
      for (let s = 0; s < days * 4; s++) {
        for (let q = 0; q < 12; q++) m.step();
        const c = await m.readCenter(), cl = classifyCenter(c), k = cl.key, se = seas(Math.floor(m.doyAt(m.time)));
        out[se][k] = (out[se][k] || 0) + 1;
        (anom[k] ||= []).push(c.tAnom);
        (out.raw ||= []).push([se, +cl.lat0.toFixed(1), +(c.open ?? 0).toFixed(2), +(c.seaO ?? 0).toFixed(2), +c.tAnom.toFixed(1), +(c.dX / 1e3).toFixed(0)]);
      }
      m.destroy();
      return { counts: out, tAnom: Object.fromEntries(Object.entries(anom).map(([k, v]) => [k, +(v.reduce((x, y) => x + y, 0) / v.length).toFixed(1)])) };
    },
    // model synoptyczny sam (kopia): w punktach przesuniętych o (di, dj) oczek (75 km) od środka domeny – średni opad,
    // jego część konwekcyjna, T powietrza i podłoża, T ~1.5 i 5 km; co 6 h przez `days` dób (testy)
    async pePoints(days = 60, pts = [[0, 0]]) {
      if (!drv.model) return null;
      const m = drv.model.clone(), ic = NXP >> 1, jc = (NYP >> 1) + Math.round(m.yc / DXP);
      const acc = pts.map(() => ({ pr: 0, prc: 0, ts: 0, tsfc: 0, t15: 0, t5: 0, psl: 0, hgt: 0, n: 0 }));
      for (let s = 0; s < days * 4; s++) {
        for (let q = 0; q < 12; q++) m.step();
        const mp = await m.readMap();
        pts.forEach(([di, dj], n) => {
          const c = (jc + dj) * NXP + ((ic + di + NXP) % NXP), a = acc[n];
          for (const k of ['pr', 'prc', 'ts', 'tsfc', 't15', 't5', 'psl']) a[k] += mp[k][c];
          a.hgt += mp.hgt ? mp.hgt[c] : 0;
          a.n++;
        });
      }
      m.destroy();
      return acc.map((a) => Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'n').map(([k, v]) => [k, +(v / a.n).toFixed(3)])));
    },
    // fronty w samym modelu synoptycznym (kopia, bez domeny): co `every` h największy gradient T na ~1.5 km [K/100 km]
    // w promieniu ±r oczek (75 km) od środka domeny, jego położenie względem środka [km] i T ~1.5 km w środku [°C]
    async peFronts(days = 6, every = 3, r = 4) {
      if (!drv.model) return null;
      const m = drv.model.clone(), out = [];
      const ic = NXP >> 1, jc = (NYP >> 1) + Math.round(m.yc / DXP), nst = Math.round(every * 2);
      for (let s = 0; s < days * 24 / every; s++) {
        for (let q = 0; q < nst; q++) m.step();
        const mp = await m.readMap(), t = mp.t15;
        let g = 0, gi = 0, gj = 0;
        for (let j = jc - r; j <= jc + r; j++) for (let i = ic - r; i <= ic + r; i++) {
          const gx = (t[j * NXP + i + 1] - t[j * NXP + i - 1]) / 2, gy = (t[(j + 1) * NXP + i] - t[(j - 1) * NXP + i]) / 2;
          const v = Math.hypot(gx, gy) / DXP * 1e5;
          if (v > g) { g = v; gi = i; gj = j; }
        }
        out.push({ h: (s + 1) * every, g: +g.toFixed(2), x: (gi - ic) * DXP / 1000, y: (gj - jc) * DXP / 1000, t15: +t[jc * NXP + ic].toFixed(1) });
      }
      m.destroy();
      return out;
    },
    async syn() {
      if (!drv.model || drv.mode !== 'syn') return { mode: drv.mode };
      const s = await drv.model.readCenter();
      return { mode: drv.mode, cls: drv.cls, p: s.psl, tAnom: s.tAnom, tDay: s.tDay, u0: s.u0, v0: s.v0, w: s.w, pr: s.pr, air: s.air, fc: drv.fc.length, tA: drv.tA, slot: drv.slot };
    },
    // okno czasu meteogramu tygodniowego [s od początku okna tygodnia] (testy)
    fcView: () => ({ a: fcv.a, span: fcv.span, week: FC_WEEK, n: drv.fc.length }),
    // manipulacja atmosfery: odcinki, historia i wartości w tej chwili (testy)
    manip: () => ({ ...JSON.parse(JSON.stringify(manip)), now: { T: mAt('T', sim.time), R: mAt('R', sim.time), V: mAt('V', sim.time) }, forcV: drv.model ? drv.model.forcV : null, fcV: drv.fcModel ? drv.fcModel.forcV : null, csv: manipCsv() }),
    // bieżący stan modelu synoptycznego w środku domeny (średnia 3 × 3 oczka): T przy gruncie, ~1.5, 3, 5 km (testy)
    async peNow() {
      if (!drv.model) return null;
      const mp = await drv.model.readMap(), ic = NXP >> 1, jc = (NYP >> 1) + Math.round(drv.model.yc / DXP), out = {};
      for (const k of ['ts', 't15', 't3', 't5']) { let v = 0; for (let j = jc - 1; j <= jc + 1; j++) for (let i = ic - 1; i <= ic + 1; i++) v += mp[k][j * NXP + i]; out[k] = v / 9; }
      return out;
    },
    async mode(m) { drv.mode = m; $('wxMode').value = m; await reset(); },
    async roll(seed) { drv.seed = seed; drv.mode = 'syn'; $('wxMode').value = 'syn'; await reset(); },
    set(id, value) { $(id).value = value; $(id).dispatchEvent(new Event('change')); labels(); },
    stop() { sim.halted = true; },
    // pełny zapis przebiegu: stan gotowy, plik, sumy kontrolne buforów (testy)
    ready() { return !sim.busy; },
    runBlob(onProgress) { return buildRunFile(onProgress); },
    stashRun, resumeUrl, openRun,
    async fingerprint() {
      const m = drv.model, c = drv.ccModel, enc = device.createCommandEncoder(), rs = [];
      const add = (n, b) => { const rb = buf(b.size, U.MAP_READ | U.COPY_DST, 'fpRead'); enc.copyBufferToBuffer(b, 0, rb, 0, b.size); rs.push({ n, rb }); };
      for (const [n, b] of [['state', stateBuf], ['tmp', tmpBuf], ['work', workBuf], ['sfc', sfcBuf], ['tgt', tgtBuf], ['acc', accBuf], ['vg', vgBuf]]) add(n, b);
      if (m) { add('pe.S', m.S[m.p]); add('pe.wk', m.wk); add('pe.dg', m.dg); add('pe.vz', m.vz); }
      if (c) { add('cc.S', c.S[c.p]); add('cc.wk', c.wk); add('cc.dg', c.dg); }
      device.queue.submit([enc.finish()]);
      const out = {};
      for (const { n, rb } of rs) {
        await rb.mapAsync(GPUMapMode.READ);
        const a = new Uint32Array(rb.getMappedRange());
        let h = 2166136261;
        for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619); }
        out[n] = h >>> 0;
        rb.unmap(); rb.destroy();
      }
      return { time: sim.time, step: sim.step, slot: drv.slot, tA: drv.tA, months: mon.list.length, ...out };
    },
    // wznowienie pętli klatek (po stop) i zegar cumulusów – test trybu MAX
    go() { if (sim.halted) { sim.halted = false; sim.paused = false; requestAnimationFrame(frame); } },
    cu() { return { ...cuc }; },
    // analizy klimatyczne: okresy rodzaju kind ('m' miesiące, 's' pory roku, 'y' lata) – średnie po widocznej domenie (testy)
    ana(kind = 'm') { return periods(kind).map((p) => ({ label: perLabel(kind, p.key), cur: p.cur, n: p.months.length, ...perAvg(p) })); },
    // widok „Miesiące”: zapisane miesiące i bieżący – średnie po widocznej domenie (testy)
    months() {
      const avg = (a, sc) => a.reduce((x, y) => x + y, 0) / a.length / sc;
      return { cur: { label: monLabel(mon.key), days: mon.days, secs: sim.time - mon.t0 },
        list: mon.list.map((m) => ({ label: monLabel(m.key), days: m.days, t: +avg(m.T[0], 100).toFixed(2), tx: +avg(m.T[1], 100).toFixed(2),
          tn: +avg(m.T[2], 100).toFixed(2), p: +avg(m.P[0], 10).toFixed(1), snow: +avg(m.P[1], 10).toFixed(1) })) };
    },
    // sondaż (zakładka Atmosphere): wynik analizy i czas analizy + rysowania – testy
    snd() { sndKey = ''; drawSnd(true); return sim.sndLast || null; },
    sndTime() { const t0 = performance.now(), pr = sndProfile(), A = analyzeSounding(pr), t1 = performance.now(); renderSounding($('csnd'), A, { parcel: sndPar, zg: pr.zg, layout: 'compact' }); return { analyzeMs: +(t1 - t0).toFixed(1), drawMs: +(performance.now() - t1).toFixed(1) }; },
    cc() { return { on: ccOn(), nodes: cc.nodes.map((nd) => ({ X: nd.X, Y: nd.Y, corr: nd.corr.map((v) => +v.toFixed(2)), fq: +nd.fq.toFixed(3), fqa: nd.fqa.map((v) => +v.toFixed(3)), fp: +nd.fp.toFixed(3), n: nd.smp.length, elev: nd.norm.elev, ref: ccRef(nd, ccDoy(sim.time)).t.map((v) => +(v - 273.15).toFixed(2)) })), src: cc.src, tsOff: drv.model ? 0.4 * drv.model.halfDiur : 0 }; },
  };


  // ======================= Pogoda: masa powietrza, mapa synoptyczna, prognoza =======================
  // klucze jak w pe.js (PAm, PPk…), na ekranie angielskie nazwy i skróty; kolory od zimnych do gorących
  const AIRMASS_INFO = {
    PAm: ['Maritime Arctic air (mA)', 'From the Arctic across the open Norwegian and Barents Seas: cold and moist, unstable; in winter moderate frost and snow showers, often heavy; in summer cool with showers.'],
    PAk: ['Continental Arctic air (cA)', 'From the Arctic ice and northern Russia: very cold, dry and clear; in winter hard frost and sunshine, very cold nights.'],
    PPm: ['Maritime polar air (mP)', 'Fresh, from the North Atlantic (W–NW): cool and moist; plenty of cumulus, showers – snow and graupel in winter.'],
    PPmc: ['Warm maritime polar air (mPw)', 'Transformed over the Atlantic, from W–SW: mild and moist; in winter thaw, low cloud, drizzle and rain; in summer humid and cloudy.'],
    PPk: ['Continental polar air (cP)', 'From over land: dry; frosty and clear in winter, warm and sunny in summer.'],
    PZm: ['Maritime tropical air (mT)', 'From the Atlantic near the Azores or from the Mediterranean: warm and moist; sultry and thundery in summer, rare in winter – strong thaw.'],
    PZk: ['Continental tropical air (cT)', 'From Africa, the Balkans or Asia Minor: hot and dry – heat, haze, light wind.'],
    PR: ['Equatorial air (E)', 'Hot and very humid; daily afternoon thunderstorms and downpours.'],
  };
  const AIRMASS_CODE = { PAm: 'mA', PAk: 'cA', PPm: 'mP', PPmc: 'mPw', PPk: 'cP', PZm: 'mT', PZk: 'cT', PR: 'E' };
  const AIRMASS_COL = { PAm: '#c4b5fd', PAk: '#8b7cf6', PPm: '#38bdf8', PPmc: '#2dd4bf', PPk: '#fbbf24', PZm: '#fb923c', PZk: '#ef4444', PR: '#ec4899' };
  $('fcLeg').innerHTML = Object.entries(AIRMASS_COL).map(([k, c]) => `<span><i style="background:${c}"></i>${AIRMASS_CODE[k]}</span>`).join('')
    + '<span><i style="background:#6f8fff"></i>pressure</span><span><i style="background:#ff6b5e"></i>mean T</span>';
  const dirName = (u, v) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360) / 45) % 8];

  $('wxMode').onchange = () => { drv.mode = $('wxMode').value; wxModeUi(); reset(); };
  $('wxRoll').onclick = () => {
    drv.seed = 1 + Math.floor(Math.random() * 1e6);
    drv.mode = 'syn'; $('wxMode').value = 'syn';
    wxModeUi();
    reset();
  };
  // przełącznik MODE: model synoptyczny (masa powietrza, mapa, prognoza) albo stała masa powietrza (edytor)
  $('wxSw').onclick = () => { $('wxMode').value = drv.mode === 'syn' ? 'const' : 'syn'; $('wxMode').onchange(); requestAnimationFrame(drawPreview); };
  let wxModeShown = null;
  function wxModeUi() {
    const m = drv.mode;
    if (m === wxModeShown) return;
    wxModeShown = m;
    const on = m === 'syn';
    $('wxSw').classList.toggle('off', !on);
    $('wxModeName').textContent = on ? 'Synoptic model' : 'Fixed air mass';
    $('wxSyn').style.display = on ? '' : 'none';
    $('wxConst').style.display = on ? 'none' : '';
    $('manipBox').style.display = on ? '' : 'none';
    if (on) drv.synDirty = true;
  }

  function fcAt(t) {
    let best = null;
    for (const r of drv.fc) if (r.t <= t + 1 && (!best || r.t > best.t)) best = r;
    return best;
  }

  function updateWxNow() {
    wxModeUi();
    if (drv.mode !== 'syn' || !drv.model) {
      $('wxNow').innerHTML = '<span class="amn">Fixed air mass</span><br><span class="k">Air mass and wind from the sliders below; the boundaries receive the same air.</span>';
      $('chipAir').textContent = 'fixed';
      $('chipAir').style.color = '';
      return;
    }
    const s = drv.model.center;
    if (!s || !drv.cls) return;
    const c = drv.cls;
    const info = AIRMASS_INFO[c.key];
    const now = fcAt(sim.time), before = fcAt(sim.time - 3 * 3600);
    const dp = now && before && now !== before ? now.p - before.p : null;
    const ws = Math.hypot(s.u0, s.v0);
    $('wxNow').innerHTML = `<span class="amn" style="color:${AIRMASS_COL[c.key]}">${info[0]}</span><br><span class="k">${info[1]}</span><br><br>`
      + `<span class="k">pressure</span> <b>${fm(s.psl, 'hPa')}</b>${dp === null ? '' : ` (${dp >= 0 ? '+' : ''}${(isImp() ? dp * 0.02953 : dp).toFixed(isImp() ? 2 : 1)} ${unitD('hPa')}/3 h)`}`
      + ` · <span class="k">wind</span> <b>${dirName(s.u0, s.v0)} ${fm(ws, 'm/s')}</b><br>`
      + `<span class="k">air-mass T anomaly</span> <b>${fdT(s.tAnom, 1, true)}</b>`
      + ` · <span class="k">vertical motion</span> <b>${fm(100 * s.w, 'cm/s', 1)}</b>`
      + (s.pr > 0.05 ? ` · <span class="k">precip. (large scale)</span> <b>${fm(s.pr, 'mm/h', 1)}</b>` : '');
    $('chipAir').textContent = AIRMASS_CODE[c.key];
    $('chipAir').style.color = AIRMASS_COL[c.key];
  }

  // Mapa synoptyczna: widoki do wyboru (tło, izolinie, wiatr, opad), zoom kółkiem wokół kursora, przesuwanie, dwuklik – widok domyślny.
  // (x, y) [m] – położenie względem środka domeny; kanał jest okresowy W–E (przesuwanie dookoła koła szerokości), poza ścianami N/S puste tło.
  const SYN_HOME = 6.0e6, SYN_MIN = 1.0e6;
  const syn = { span: SYN_HOME, x: 0, y: 0, o: { iso: true, wind: false, rain: true, fronts: true, hl: true }, drag: null, raf: 0 };
  const ISO_P = { cf: 'psl', ci: 4, thick: 1012, ciName: 'isobars every 4 hPa' };
  const SYN_VIEWS = {
    sfc: { name: 'Surface – pressure, T near the ground, precipitation', bg: 'ts', pal: 'temp', ...ISO_P, rain: true },
    prec: { name: 'Precipitation rate, pressure', bg: 'pr', pal: 'prate', ...ISO_P },
    cloud: { name: 'Cloud cover, pressure', bg: 'cloud', pal: 'cloud', ...ISO_P },
    olr: { name: 'Outgoing longwave radiation (like satellite IR)', bg: 'olr', pal: 'olr', ...ISO_P },
    850: { name: '850 hPa (~1.5 km) – temperature, wind', bg: 't15', pal: 'temp', cf: 't15', ci: 2, thick: 0, ciName: 'isotherms every 2 K', wind: ['u15', 'v15'] },
    700: { name: '700 hPa (~3 km) – temperature, wind ~1.5 km', bg: 't3', pal: 'temp', cf: 't3', ci: 2, thick: 0, ciName: 'isotherms every 2 K', wind: ['u15', 'v15'] },
    500: { name: '500 hPa (~5.6 km) – geopotential, temperature, wind', bg: 't5', pal: 'temp', cf: 'z5', ci: 4, thick: 552, ciName: 'geopotential every 4 dam', wind: ['u5', 'v5'] },
    w15: { name: 'Wind speed ~1.5 km, pressure', bgw: ['u15', 'v15'], pal: 'wind', ...ISO_P, wind: ['u15', 'v15'] },
    w5: { name: 'Wind speed ~5.6 km (jet stream), geopotential', bgw: ['u5', 'v5'], pal: 'wind', cf: 'z5', ci: 4, thick: 552, ciName: 'geopotential every 4 dam', wind: ['u5', 'v5'] },
    cape: { name: 'CAPE, pressure', bg: 'cape', pal: 'cape', ...ISO_P },
    tsfc: { name: 'Land and sea surface temperature', bg: 'tsfc', pal: 'temp', ...ISO_P },
    sh: { name: 'Sensible heat flux', bg: 'sh', pal: 'flux', ...ISO_P },
    lh: { name: 'Latent heat flux', bg: 'lh', pal: 'flux', ...ISO_P },
    sw: { name: 'Solar radiation at the ground', bg: 'swSfc', pal: 'sw', ...ISO_P },
    soil: { name: 'Soil water (bucket fill)', bg: 'soil', pal: 'soil', ...ISO_P },
  };
  for (const [k, v] of Object.entries(SYN_VIEWS)) $('synLevel').add(new Option(v.name, k));
  $('synLevel').value = 'sfc';
  const mix3 = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  const ramp = (st, v) => {                     // st: [[wartość, [r, g, b]], …] rosnąco
    if (v <= st[0][0]) return st[0][1];
    for (let n = 1; n < st.length; n++) if (v <= st[n][0]) return mix3(st[n - 1][1], st[n][1], (v - st[n - 1][0]) / (st[n][0] - st[n - 1][0]));
    return st[st.length - 1][1];
  };
  const LAND0 = [0.16, 0.17, 0.19], SEA0 = [0.07, 0.11, 0.21];
  const R_FLUX = [[-100, [0.17, 0.33, 0.8]], [0, [0.95, 0.95, 0.95]], [200, [0.98, 0.72, 0.35]], [400, [0.8, 0.13, 0.13]]];
  const R_SW = [[0, [0.05, 0.04, 0.1]], [300, [0.5, 0.12, 0.3]], [600, [0.88, 0.42, 0.1]], [1000, [1, 0.95, 0.65]]];
  const R_SOIL = [[0, [0.55, 0.38, 0.2]], [0.35, [0.82, 0.74, 0.45]], [0.65, [0.35, 0.68, 0.45]], [1, [0.15, 0.32, 0.75]]];
  const cssRamp = (st) => { const a = st[0][0], b = st[st.length - 1][0]; return `linear-gradient(90deg,${st.map(([v, c]) => `rgb(${c.map((x) => Math.round(255 * x)).join(',')}) ${(100 * (v - a) / (b - a)).toFixed(1)}%`).join(',')})`; };
  // kolor tła: pal – nazwa skali, v – wartość, sea – morze
  const synColor = (pal, v, sea) => {
    switch (pal) {
      case 'temp': { const c = tempColor(v), a = 0.25 + 0.6 * c[0], b = 0.25 + 0.6 * c[1], d = 0.25 + 0.6 * c[2]; return sea ? [a * 0.75, b * 0.8, Math.min(1, d * 0.9 + 0.12)] : [a, b, d]; }
      case 'prate': return v > 0.1 ? radarColor(v) : sea ? SEA0 : LAND0;
      case 'cloud': return mix3(sea ? SEA0 : LAND0, [0.96, 0.96, 0.97], Math.min(1, Math.max(0, v)));
      case 'olr': { const g = 0.08 + 0.87 * Math.min(1, Math.max(0, (300 - v) / 170)); return [g, g, g]; }
      case 'wind': return wxColor('wind', 3.6 * v);
      case 'cape': return wxColor('cape', v);
      case 'flux': return ramp(R_FLUX, v);
      case 'sw': return ramp(R_SW, v);
      case 'soil': return sea ? SEA0 : ramp(R_SOIL, v);
      default: return LAND0;
    }
  };
  const SYN_DARK = { prate: 1, cloud: 1, olr: 1, sw: 1 };          // ciemne tło – jasne izolinie i brzegi
  // legenda pod mapą: pasek skali widoku i objaśnienia nakładek
  // opis izolinii: rysowane w stałych krokach w hPa, K i dam
  const synCiName = (v) => {
    if (!isImp()) return v.ciName;
    if (/isobars/.test(v.ciName)) return `isobars every ${(v.ci * 0.02953).toFixed(2)} inHg`;
    if (/isotherms/.test(v.ciName)) return `isotherms every ${(v.ci * 1.8).toFixed(1)} °F`;
    if (/geopotential/.test(v.ciName)) return `geopotential every ${Math.round(v.ci * 32.8084)} ft`;
    return v.ciName;
  };
  function synLegend() {
    const v = SYN_VIEWS[$('synLevel').value] || SYN_VIEWS.sfc, wk = { temp: 'temp', prate: 'prate', wind: 'wind', cape: 'cape' }[v.pal];
    let bar, lo, hi, ticks = [];
    if (wk) {
      const i = WX_INDEX[wk], ws = WXS[i];
      bar = wxLegendCss(i); [lo, hi, ticks] = wxLegend(i);
      if (wk === 'temp' && !isImp()) ticks = ticks.filter(([t]) => t % 12 === 0 || t === 0);
    } else {
      const c = {
        cloud: ['linear-gradient(90deg, rgb(41,43,48), rgb(245,245,247))', '0', '100 %', [[50, 0.5]]],
        olr: ['linear-gradient(90deg, rgb(242,242,242), rgb(20,20,20))', '130', '300 W/m²', [[200, 0.41]]],
        flux: [cssRamp(R_FLUX), '−100', '400 W/m²', [[0, 0.2], [200, 0.6]]],
        sw: [cssRamp(R_SW), '0', '1000 W/m²', [[300, 0.3], [600, 0.6]]],
        soil: [cssRamp(R_SOIL), '0', '100 %', [[35, 0.35], [65, 0.65]]],
      }[v.pal];
      [bar, lo, hi, ticks] = c;
    }
    const items = [];
    if (syn.o.hl && v.cf === 'psl') items.push('<span><b style="color:#ff5a5a">L</b> low</span><span><b style="color:#6f9bff">H</b> high</span>');
    if (syn.o.iso) items.push(`<span>${synCiName(v)}</span>`);
    if (syn.o.rain && v.rain) items.push(`<span><i style="background:${wxLegendCss(WX_INDEX.prate)}"></i>precipitation (hatched: showers)</span>`);
    if (syn.o.fronts) items.push('<span>darker: frontal zone</span>');
    if (syn.o.wind) items.push(`<span>arrows: wind ~${fmZ(v.wind && v.wind[0] === 'u5' ? 5.6 : 1.5)}</span>`);
    items.push('<span>□ domain</span>');
    $('synLeg').innerHTML = `<div class="leg" style="margin-top:0"><span class="lo">${lo}</span><div class="bar" style="background:${bar}"></div><span class="hi">${hi}</span>`
      + `<div class="ticks">${ticks.map(([t, f]) => `<span style="left:${(100 * f).toFixed(1)}%">${t}</span>`).join('')}</div></div>`
      + `<div class="synleg" style="margin-top:3px">${items.join('')}</div>`;
  }
  // przyciski nakładek
  const SYN_OPTS = [['iso', 'Contours'], ['wind', 'Wind'], ['rain', 'Precip.'], ['fronts', 'Fronts'], ['hl', 'L / H']];
  for (const [k, t] of SYN_OPTS) {
    const b = document.createElement('button');
    b.className = 'chipb'; b.textContent = t; b.dataset.k = k;
    b.onclick = () => { syn.o[k] = !syn.o[k]; synUi(); savePrefs(); synRedraw(); };
    $('synOpts').appendChild(b);
  }
  function synUi() {
    for (const b of $('synOpts').children) b.classList.toggle('on', !!syn.o[b.dataset.k]);
    synLegend();
  }
  // zmiana widoku: strzałki wiatru jak domyślnie w tym widoku (poziomy i mapy wiatru – tak, przy gruncie – nie)
  $('synLevel').addEventListener('change', () => { syn.o.wind = !!(SYN_VIEWS[$('synLevel').value] || {}).wind; synUi(); savePrefs(); drawSyn(); });
  const synRedraw = () => { if (!syn.raf) syn.raf = requestAnimationFrame(() => { syn.raf = 0; drawSyn(); }); };
  const synWrap = (x) => { const L = LXP; return ((x + L / 2) % L + L) % L - L / 2; };
  // ograniczenia widoku: skala od 1000 km do całego koła szerokości, w pionie w obrębie kanału
  function synClamp() {
    syn.span = Math.min(LXP, Math.max(SYN_MIN, syn.span));
    syn.x = synWrap(syn.x);
    const yc = drv.model ? drv.model.yc : 0, lim = Math.max(0, (LYP - syn.span) / 2);
    syn.y = Math.min(lim, Math.max(-lim, syn.y + yc)) - yc;
  }
  function synZoom(f, ax = 0, ay = 0) {
    const s0 = syn.span, s1 = Math.min(LXP, Math.max(SYN_MIN, s0 * f));
    syn.x += ax * (s0 - s1); syn.y += ay * (s0 - s1); syn.span = s1;
    synRedraw();
  }
  {
    const cv = $('csyn');
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      synZoom(Math.exp(e.deltaY * 0.0015), (e.clientX - r.left) / r.width - 0.5, 0.5 - (e.clientY - r.top) / r.height);
    }, { passive: false });
    cv.addEventListener('pointerdown', (e) => {
      syn.drag = { x: e.clientX, y: e.clientY, ox: syn.x, oy: syn.y };
      cv.setPointerCapture(e.pointerId); cv.classList.add('drag');
    });
    cv.addEventListener('pointermove', (e) => {
      if (!syn.drag) return;
      const r = cv.getBoundingClientRect();
      syn.x = syn.drag.ox - (e.clientX - syn.drag.x) / r.width * syn.span;
      syn.y = syn.drag.oy + (e.clientY - syn.drag.y) / r.height * syn.span;
      synRedraw();
    });
    const up = () => { syn.drag = null; cv.classList.remove('drag'); };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('dblclick', () => { syn.span = SYN_HOME; syn.x = 0; syn.y = 0; synRedraw(); });
    $('synZp').onclick = () => synZoom(1 / 1.5);
    $('synZm').onclick = () => synZoom(1.5);
  }

  function drawSyn() {
    const cv = $('csyn');
    const m = drv.model, mp = m && m.map;
    if (!cv.offsetParent || !mp) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(64, Math.round(cv.clientWidth * dpr)), H = W;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d');
    synClamp();
    const span = syn.span, o = syn.o, v = SYN_VIEWS[$('synLevel').value] || SYN_VIEWS.sfc;
    const bil = (f, X, Y) => {
      const xf = Math.floor(X), fx = X - xf, Yc = Math.min(NYP - 1.001, Math.max(0, Y)), yf = Math.floor(Yc), fy = Yc - yf;
      const i0 = ((xf % NXP) + NXP) % NXP, i1 = (i0 + 1) % NXP;
      const a = f[yf * NXP + i0] + fx * (f[yf * NXP + i1] - f[yf * NXP + i0]);
      const b = f[(yf + 1) * NXP + i0] + fx * (f[(yf + 1) * NXP + i1] - f[(yf + 1) * NXP + i0]);
      return a + fy * (b - a);
    };
    // gradient temperatury ~1.5 km [K/100 km] – strefy frontowe (raz na kopię pól)
    if (syn.gradOf !== mp) {
      const grad = syn.grad || (syn.grad = new Float32Array(NXP * NYP)), t = mp.t15;
      for (let j = 1; j < NYP - 1; j++) for (let i = 0; i < NXP; i++) {
        const e = t[j * NXP + (i + 1) % NXP], w = t[j * NXP + (i + NXP - 1) % NXP];
        grad[j * NXP + i] = 1e5 * Math.hypot((e - w) / (2 * DXP), (t[(j + 1) * NXP + i] - t[(j - 1) * NXP + i]) / (2 * DXP));
      }
      syn.gradOf = mp;
    }
    const grad = syn.grad, cf = mp[v.cf], bgF = v.bg ? mp[v.bg] : null, bu = v.bgw && mp[v.bgw[0]], bv = v.bgw && mp[v.bgw[1]];
    if (!cf || !(bgF || bu)) return;
    const img = ctx.createImageData(W, H), D = img.data;
    const P = new Float32Array(W * H), SEA = new Uint8Array(W * H);
    const yc = m.yc, dark = !!SYN_DARK[v.pal];
    for (let py = 0; py < H; py++) {
      const y = syn.y + (0.5 - (py + 0.5) / H) * span, Y = (LYP / 2 + yc + y) / DXP - 0.5;
      const out = Y < -0.5 || Y > NYP - 0.5;
      for (let px = 0; px < W; px++) {
        const k = py * W + px, q = 4 * k;
        if (out) { P[k] = NaN; D[q] = 0; D[q + 1] = 0; D[q + 2] = 18; D[q + 3] = 255; continue; }
        const x = syn.x + ((px + 0.5) / W - 0.5) * span, X = (LXP / 2 + x) / DXP - 0.5;
        P[k] = bil(cf, X, Y);
        const gi = ((Math.round(X) % NXP) + NXP) % NXP, gj = Math.min(NYP - 1, Math.max(0, Math.round(Y)));
        const sea = m.sea[gj * NXP + gi];
        SEA[k] = sea;
        let c = synColor(v.pal, bgF ? bil(bgF, X, Y) : Math.hypot(bil(bu, X, Y), bil(bv, X, Y)), sea);
        if (o.fronts) {
          const gr = bil(grad, X, Y);
          if (gr > 0.6) { const a = 1 - Math.min(0.35, (gr - 0.6) * 0.5); c = [c[0] * a, c[1] * a, c[2] * a]; }   // strefa frontowa
        }
        if (o.rain && v.rain) {
          const pr = bil(mp.pr, X, Y);
          if (pr > 0.1) {
            // opad w kolorach radaru (półprzezroczysty na tle temperatury); opady przelotne (konwekcja) w kratkę
            const rc = radarColor(pr), a = Math.min(0.9, 0.55 + 0.1 * Math.log2(1 + pr));
            c = mix3(c, rc, a);
            const cvf = mp.prc ? bil(mp.prc, X, Y) / pr : 0;
            if (cvf > 0.5 && ((px + py) % 6 === 0 || (px - py + 6000) % 6 === 0)) c = [c[0] * 0.55, c[1] * 0.55, c[2] * 0.55];
          }
        }
        D[q] = 255 * c[0]; D[q + 1] = 255 * c[1]; D[q + 2] = 255 * c[2]; D[q + 3] = 255;
      }
    }
    // izolinie i linia brzegowa
    const ci = v.ci, isoT = dark ? [235, 235, 245] : [40, 40, 55], isoH = dark ? [255, 255, 255] : [20, 20, 30], coast = dark ? [120, 160, 220] : [20, 50, 120];
    const put = (q, c) => { D[q] = c[0]; D[q + 1] = c[1]; D[q + 2] = c[2]; };
    for (let py = 0; py < H - 1; py++) {
      for (let px = 0; px < W - 1; px++) {
        const k = py * W + px;
        if (!(P[k] === P[k]) || !(P[k + 1] === P[k + 1]) || !(P[k + W] === P[k + W])) continue;
        const a = Math.floor(P[k] / ci);
        if (o.iso && (a !== Math.floor(P[k + 1] / ci) || a !== Math.floor(P[k + W] / ci))) put(4 * k, Math.round(P[k] / ci) * ci === v.thick ? isoH : isoT);
        else if (SEA[k] !== SEA[k + 1] || SEA[k] !== SEA[k + W]) put(4 * k, coast);
      }
    }
    ctx.putImageData(img, 0, 0);
    const toPx = (x, y) => [(synWrap(x - syn.x) / span + 0.5) * W, (0.5 - (y - syn.y) / span) * H];
    // wiatr: strzałki co ~1/14 szerokości mapy (długość ∝ prędkość)
    const wk = v.wind || (o.wind && ['u15', 'v15']);
    if (o.wind && wk && mp[wk[0]]) {
      const st = W / 14, ink = dark ? 'rgba(245,245,250,0.85)' : 'rgba(15,18,26,0.85)', U = mp[wk[0]], V = mp[wk[1]];
      ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 1.3 * dpr;
      for (let py = st / 2; py < H; py += st) {
        const y = syn.y + (0.5 - py / H) * span, Y = (LYP / 2 + yc + y) / DXP - 0.5;
        if (Y < 0 || Y > NYP - 1) continue;
        for (let px = st / 2; px < W; px += st) {
          const x = syn.x + (px / W - 0.5) * span, X = (LXP / 2 + x) / DXP - 0.5;
          const u = bil(U, X, Y), w = bil(V, X, Y), sp = Math.hypot(u, w);
          if (sp < 1) continue;
          const len = Math.min(st * 0.9, st * 0.12 * Math.sqrt(sp) * 1.4), ux = u / sp, uy = -w / sp;
          const x1 = px - ux * len / 2, y1 = py - uy * len / 2, x2 = px + ux * len / 2, y2 = py + uy * len / 2;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - ux * 5 * dpr - uy * 3 * dpr, y2 - uy * 5 * dpr + ux * 3 * dpr);
          ctx.lineTo(x2 - ux * 5 * dpr + uy * 3 * dpr, y2 - uy * 5 * dpr - ux * 3 * dpr); ctx.fill();
        }
      }
    }
    // niże i wyże: lokalne ekstrema ciśnienia na siatce modelu w oknie mapy
    if (o.hl && v.cf === 'psl') {
      const font1 = `700 ${Math.round(15 * dpr)}px Arial, sans-serif`, font2 = `${Math.round(10 * dpr)}px Arial, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      const pg = (i, j) => mp.psl[Math.min(NYP - 1, Math.max(0, j)) * NXP + ((i % NXP) + NXP) % NXP];
      const i0 = Math.floor((LXP / 2 + syn.x - span / 2) / DXP), ni = Math.min(NXP, Math.ceil(span / DXP) + 1);
      const j0 = Math.max(2, Math.floor((LYP / 2 + yc + syn.y - span / 2) / DXP)), j1 = Math.min(NYP - 3, Math.ceil((LYP / 2 + yc + syn.y + span / 2) / DXP));
      const label = (t, x, y, col, font) => {
        ctx.font = font; ctx.lineWidth = 2.5 * dpr; ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.strokeText(t, x, y);
        ctx.fillStyle = col; ctx.fillText(t, x, y);
      };
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i < i0 + ni; i++) {
          const p0 = pg(i, j);
          let isMin = p0 < 1012, isMax = p0 > 1016;
          for (let dj = -5; dj <= 5 && (isMin || isMax); dj++) {
            for (let di = -5; di <= 5; di++) {
              if (!di && !dj) continue;
              const q = pg(i + di, j + dj);
              if (q <= p0) isMin = false;
              if (q >= p0) isMax = false;
            }
          }
          if (!isMin && !isMax) continue;
          // tylko zamknięte ośrodki: na okręgu ~450 km wszędzie co najmniej 2 hPa wyżej (niż) / niżej (wyż);
          // słabe minima wzdłuż osi zatoki (pofalowany front) nie są osobnymi niżami
          let ringLo = Infinity, ringHi = -Infinity;
          for (let a = 0; a < 24; a++) {
            const q = pg(Math.round(i + 6 * Math.cos(a * Math.PI / 12)), Math.round(j + 6 * Math.sin(a * Math.PI / 12)));
            ringLo = Math.min(ringLo, q); ringHi = Math.max(ringHi, q);
          }
          if (isMin && ringLo - p0 < 2) continue;
          if (isMax && p0 - ringHi < 2) continue;
          const [px, py] = toPx((i + 0.5) * DXP - LXP / 2, (j + 0.5) * DXP - LYP / 2 - yc);
          if (px < 8 || py < 8 || px > W - 8 || py > H - 8) continue;
          const col = isMin ? '#c62828' : '#1e4fd0';
          label(isMin ? 'L' : 'H', px, py, col, font1);
          label(nD(p0, 'hPa'), px, py + 13 * dpr, col, font2);
        }
      }
    }
    // nasza domena (min. 6 px)
    {
      const [cx, cy] = toPx(0, 0), bx = Math.max(6 * dpr, L_KM * 1000 / span * W), by = Math.max(6 * dpr, LY_KM * 1000 / span * H);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * dpr;
      ctx.strokeRect(cx - bx / 2, cy - by / 2, bx, by);
    }
    ctx.fillStyle = '#fff'; ctx.font = `${Math.round(10 * dpr)}px Arial, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 2 * dpr;
    ctx.fillText('N ▲', 6 * dpr, 10 * dpr);
    const len = niceStep(toD(span / 1000, 'km') / 6);   // w jednostkach na ekranie
    ctx.fillText(`${len} ${unitD('km')}`, 6 * dpr, H - 16 * dpr);
    ctx.fillRect(6 * dpr, H - 9 * dpr, len / toD(span / 1000, 'km') * W, 3 * dpr);
    ctx.shadowBlur = 0;
  }

  // Widok meteogramu: okno czasu w obrębie tygodnia. a – początek okna liczony od lewego końca tygodnia [s], więc okno idzie razem z zegarem
  const FC_WEEK = 7 * 86400, FC_MIN = 12 * 3600, FC_MARGIN = 30;   // marginesy wykresu po bokach [px CSS]
  const fcv = { span: FC_WEEK, a: 0, drag: null, raf: 0 };
  const fcStart = () => Math.max(0, sim.time - 86400);
  const fcRedraw = () => { if (!fcv.raf) fcv.raf = requestAnimationFrame(() => { fcv.raf = 0; drawForecast(); }); };
  const fcClamp = () => { fcv.span = Math.min(FC_WEEK, Math.max(FC_MIN, fcv.span)); fcv.a = Math.min(FC_WEEK - fcv.span, Math.max(0, fcv.a)); };
  // powiększenie wokół punktu fr wykresu (0…1); bez punktu – wokół „teraz”, a gdy „teraz” poza oknem, wokół środka
  function fcZoom(f, fr) {
    const s0 = fcv.span, s1 = Math.min(FC_WEEK, Math.max(FC_MIN, s0 * f));
    if (fr === undefined) { const n = (sim.time - fcStart() - fcv.a) / s0; fr = n >= 0 && n <= 1 ? n : 0.5; }
    fcv.a += fr * (s0 - s1); fcv.span = s1; fcClamp();
    fcRedraw();
  }
  {
    const cv = $('cfc'), plotW = () => Math.max(1, cv.clientWidth - 2 * FC_MARGIN);
    cv.addEventListener('wheel', (e) => {
      if (e.deltaY > 0 && fcv.span >= FC_WEEK) return;   // cały tydzień: kółko dalej przewija panel
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      fcZoom(Math.exp(e.deltaY * 0.0015), Math.min(1, Math.max(0, (e.clientX - r.left - FC_MARGIN) / plotW())));
    }, { passive: false });
    cv.addEventListener('pointerdown', (e) => {
      fcv.drag = { x: e.clientX, a: fcv.a };
      cv.setPointerCapture(e.pointerId); cv.classList.add('drag');
    });
    cv.addEventListener('pointermove', (e) => {
      if (!fcv.drag) return;
      fcv.a = fcv.drag.a - (e.clientX - fcv.drag.x) / plotW() * fcv.span; fcClamp();
      fcRedraw();
    });
    const up = () => { fcv.drag = null; cv.classList.remove('drag'); };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('dblclick', () => { fcv.span = FC_WEEK; fcv.a = 0; fcRedraw(); });
    $('fcZp').onclick = () => fcZoom(1 / 1.5);
    $('fcZm').onclick = () => fcZoom(1.5);
  }

  // Przebieg w środku domeny: od doby wstecz do 6 dób naprzód (model synoptyczny liczy prognozę w tle) albo wybrany wycinek tego tygodnia
  function drawForecast() {
    const cv = $('cfc');
    if (!cv.offsetParent) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    if (drv.mode !== 'syn' || !drv.fc.length) return;
    fcClamp();
    const t0 = fcStart() + fcv.a, t1 = t0 + fcv.span;
    // zakres osi z tego, co widać: po powiększeniu krzywe zajmują całą wysokość
    const rec = drv.fc.filter((r) => r.t >= t0 - 3 * 3600 && r.t <= t1 + 3 * 3600);
    if (rec.length < 2) return;
    const L = FC_MARGIN * dpr, R = FC_MARGIN * dpr, T = 8 * dpr, B = 26 * dpr;
    const X = (t) => L + (t - t0) / (t1 - t0) * (W - L - R);
    let pmin = Math.min(...rec.map((r) => r.p)), pmax = Math.max(...rec.map((r) => r.p));
    if (pmax - pmin < 12) { const c = (pmax + pmin) / 2; pmin = c - 6; pmax = c + 6; }
    let tmin = Math.min(...rec.map((r) => toD(r.T, '°C'))), tmax = Math.max(...rec.map((r) => toD(r.T, '°C')));
    const tRange = isImp() ? 14 : 8;
    if (tmax - tmin < tRange) { const c = (tmax + tmin) / 2; tmin = c - tRange / 2; tmax = c + tRange / 2; }
    const yP = (p) => T + (1 - (p - pmin) / (pmax - pmin)) * (H - T - B - 10 * dpr);
    const yT = (t) => T + (1 - (t - tmin) / (tmax - tmin)) * (H - T - B - 10 * dpr);
    ctx.font = `${Math.round(10 * dpr)}px system-ui`;
    // doby
    ctx.strokeStyle = '#22224a'; ctx.fillStyle = '#a2a7c0'; ctx.textAlign = 'center';
    const sh = sim.startHour * 3600;
    for (let d = Math.ceil((t0 + sh) / 86400); d * 86400 - sh <= t1; d++) {
      const x = X(d * 86400 - sh);
      if (x < L || x > W - R) continue;
      ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, H - B); ctx.stroke();
      const dd = new Date(Date.UTC(sim.year, 0, sim.doy0 + d));
      ctx.fillText(dd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }), x, H - 4 * dpr);
    }
    // godziny po powiększeniu: co 6 h do 2 dób w oknie, co 3 h do 1 doby (północ ma datę)
    if (fcv.span <= 2 * 86400) {
      const st = (fcv.span <= 86400 ? 3 : 6) * 3600;
      ctx.save(); ctx.globalAlpha = 0.55;
      for (let tt = Math.ceil((t0 + sh) / st) * st; tt - sh <= t1; tt += st) {
        const x = X(tt - sh), hh = (tt % 86400) / 3600;
        if (!hh || x < L || x > W - R) continue;
        ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, H - B); ctx.stroke();
        ctx.fillText(`${String(hh).padStart(2, '0')}:00`, x, H - 4 * dpr);
      }
      ctx.restore();
    }
    ctx.save(); ctx.beginPath(); ctx.rect(L, 0, W - L - R, H); ctx.clip();   // krzywe i słupki kończą się na brzegu okna
    // opad z modelu synoptycznego [mm/h] – słupki (pełna wysokość ~4 mm/h), szerokość rośnie z powiększeniem (zapis co 3 h)
    const barW = Math.max(4 * dpr, 0.7 * 3 * 3600 / fcv.span * (W - L - R));
    for (const r of rec) {
      if (r.pr > 0.05) {
        const rc = radarColor(r.pr);
        ctx.fillStyle = `rgba(${rc.map((v) => Math.round(255 * v)).join(',')},0.8)`;
        const h = Math.min(1, r.pr / 4) * (H - T - B) * 0.5;
        ctx.fillRect(X(r.t) - barW / 2, H - B - 10 * dpr - h, barW, h);
      }
    }
    // pasek mas powietrza
    for (let n = 0; n < rec.length - 1; n++) {
      ctx.fillStyle = AIRMASS_COL[rec[n].key];
      ctx.fillRect(X(rec[n].t), H - B - 8 * dpr, X(rec[n + 1].t) - X(rec[n].t) + 1, 7 * dpr);
    }
    const line = (f, y, col) => {
      ctx.strokeStyle = col; ctx.lineWidth = 1.8 * dpr; ctx.beginPath();
      rec.forEach((r, n) => (n ? ctx.lineTo(X(r.t), y(f(r))) : ctx.moveTo(X(r.t), y(f(r)))));
      ctx.stroke();
    };
    line((r) => r.p, yP, '#6f8fff');
    line((r) => toD(r.T, '°C'), yT, '#ff6b5e');
    // teraz
    const xn = X(sim.time);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * dpr; ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.beginPath(); ctx.moveTo(xn, T); ctx.lineTo(xn, H - B); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
    ctx.textAlign = 'left'; ctx.fillStyle = '#8fa6ff';
    ctx.fillText(nD(pmax, 'hPa'), 2 * dpr, T + 8 * dpr);
    ctx.fillText(unitD('hPa'), 2 * dpr, T + 20 * dpr);
    ctx.fillText(nD(pmin, 'hPa'), 2 * dpr, H - B - 14 * dpr);
    ctx.textAlign = 'right'; ctx.fillStyle = '#e88';
    ctx.fillText(`${tmax.toFixed(0)} ${unitD('°C')}`, W - 2 * dpr, T + 8 * dpr);
    ctx.fillText(`${tmin.toFixed(0)}`, W - 2 * dpr, H - B - 14 * dpr);
  }

  // co klatkę: prognoza w tle (kopia modelu synoptycznego 7 dób przed symulacją), odświeżenie mapy
  // Kopie modelu synoptycznego w tle: prognoza (7 dób przed symulacją, zapis co 3 h) i korekta klimatu (CC_WIN dób przed symulacją,
  // próbka co 12 h) – po jednym terminie, nie paczkami. Termin to ~6 ms GPU: paczki po 6 terminów na klatkę zabierały na starcie 40%
  // mocy (domena 500 km, 5 km: 5300 → 3000× przez ~40 s, zanim kopia nadrobiła 45 dób), a potem co 3 h symulacji przycinały obraz.
  // Budżet: tyle terminów, ile przybyło w symulacji (na kopię), plus BG_CATCHUP na sekundę na nadrabianie; prognoza ma pierwszeństwo.
  const BG_CATCHUP = 6;
  function bgFc(fm) {
    fm.step();
    const t = fm.time - drv.start.time;
    if (Math.round(t / DTQ) % 6) return;
    drv.fcBusy = true;
    fm.readCenter().then((c) => {
      if (fm !== drv.fcModel) return;
      drv.fc.push({ t, p: c.psl, T: c.tDay, pr: c.pr, key: classifyCenter(c).key });
      drv.synDirty = true;
    }).finally(() => { if (fm === drv.fcModel) drv.fcBusy = false; });
  }
  function bgCc(cm) {
    cm.step();
    const t = cm.time - drv.start.time, sm = cc.nodes[0].smp, last = sm.length ? sm[sm.length - 1].t : -Infinity;
    if (t < last + 12 * 3600 - 1) return;
    drv.ccBusy = true;
    drv.ccWait = pgOfLive(cm).then((pg) => {
      if (cm !== drv.ccModel) return;
      ccSample(t, pg, 0.4 * (cm.halfDiur ?? drv.start.halfDiur)); ccUpdate(sim.time);
    }).finally(() => { if (cm === drv.ccModel) drv.ccBusy = false; });
  }
  function bgTick() {
    const fm = drv.fcModel, cm = drv.ccModel, w = performance.now();
    const dw = Math.min((w - (drv.bgW ?? w)) / 1000, 0.25), ds = Math.max(sim.time - (drv.bgS ?? sim.time), 0);
    drv.bgW = w; drv.bgS = sim.time;
    if (drv.mode !== 'syn' || !fm) return;
    const behind = (m, h) => m && m.time - drv.start.time < sim.time + h;
    drv.bgB = (drv.bgB || 0) + dw * BG_CATCHUP + 2 * ds / DTQ;
    for (let n = 0; n < 4 && drv.bgB >= 1; n++) {
      if (!drv.fcBusy && behind(fm, 7 * 86400)) bgFc(fm);
      else if (!drv.ccBusy && behind(cm, CC_WIN)) bgCc(cm);
      else break;
      drv.bgB--;
    }
    drv.bgB = Math.min(drv.bgB, 1);
  }
  // API run (testy bez pętli klatek): kopia korekty klimatu nadąża za symulacją – CC_START dób przed nią
  async function bgSync() {
    const cm = drv.ccModel;
    while (cm && cm === drv.ccModel && drv.mode === 'syn' && cm.time - drv.start.time < sim.time + CC_START) {
      await drv.ccWait;
      bgCc(cm);
    }
    await drv.ccWait;
  }
  function weatherTick(full = false) {
    if (sim.busy || sim.saving) return;
    bgTick();
    const now = performance.now();
    // mapa synoptyczna: odczyt pól z GPU, gdy zakładka jest widoczna
    const wxOpen = document.body.classList.contains('drawer') && curTab() === 'wx';
    if (drv.mode === 'syn' && drv.model && wxOpen && !drv.mapBusy && now - (drv.mapT || 0) > 1500) {
      drv.mapBusy = true; drv.mapT = now;
      const m = drv.model;
      m.readMap().then(() => { if (m === drv.model) drv.synDirty = true; }).finally(() => { drv.mapBusy = false; });
    }
    if (full || (now - drv.lastDraw > 700 && (drv.synDirty || now - drv.lastDraw > 5000))) {
      drv.lastDraw = now; drv.synDirty = false;
      updateWxNow(); drawSyn(); drawForecast();
    }
  }

  const fmtClock = (t) => {
    const ck = clock(t);
    const h = Math.floor(ck.hour), m = Math.floor((ck.hour % 1) * 60);
    return `${dateFromDoy(sim.year, ck.doy)}, ${h}:${String(m).padStart(2, '0')}`;
  };

  // ---------- sonda w punkcie: sondaż i meteogram ----------
  // kolumna z sondy → profile na poziomach modelu (pod gruntem NaN) i obiekt „sondażu” dla soundingIndices
  function probeProfile() {
    const pc = sim.probeCol, col = sim.probeColAt;
    if (!pc || col < 0 || !sim.sfc) return null;
    const kb = sim.kb ? sim.kb[col] : 0, zg = grid.zw[kb];
    const g = (f, k) => pc[f * NZ + k];
    const lev = [];
    for (let k = kb; k < NZ; k++) {
      const p = grid.data[grid.off.PRS + k];
      const T = (grid.data[grid.off.TC + k] + g(2, k)) * grid.data[grid.off.EXC + k];
      lev.push({ k, z: grid.zc[k], za: grid.zc[k] - zg, p, rho: grid.data[grid.off.RC + k], T, q: Math.max(g(3, k), 1e-7),
        cl: g(4, k) + g(5, k), u: g(0, k), v: g(1, k), w: 0.5 * (pc[7 * NZ + k] + pc[7 * NZ + k + 1]) });
    }
    const v = (n) => sim.sfc[S[n] * NXY + col];
    const ps = lev[0].p * Math.exp(lev[0].za / 8000);
    const T2 = v('T2') + 273.15, q2 = qsat(v('TD2') + 273.15, ps);
    // interpolacja liniowa w wysokości nad gruntem (od 2 m: wartości z T2 i Td2)
    const at = (key, za, s0) => {
      if (za <= lev[0].za) { const f = Math.max(0, (za - 2) / Math.max(lev[0].za - 2, 1)); return s0 + f * (lev[0][key] - s0); }
      for (let n = 1; n < lev.length; n++) {
        if (lev[n].za >= za) { const f = (za - lev[n - 1].za) / (lev[n].za - lev[n - 1].za); return lev[n - 1][key] + f * (lev[n][key] - lev[n - 1][key]); }
      }
      return lev[lev.length - 1][key];
    };
    const snd2 = {
      T: (za) => at('T', za, T2), qv: (za) => at('q', za, q2), pres: (za) => at('p', za, ps), rho: (za) => at('rho', za, lev[0].rho),
      zt: snd.zt - zg,
    };
    return { col, kb, zg, lev, snd: snd2, T2, q2, ps };
  }

  // temperatura konwekcji: poziom kondensacji konwekcyjnej (linia stałej wilgotności właściwej od gruntu
  // przecina profil T) sprowadzony suchoadiabatycznie do gruntu
  function convTemp(pp) {
    for (let za = 50; za < 6000; za += 25) {
      const Te = pp.snd.T(za), p = pp.snd.pres(za);
      if (qsat(Te, p) <= pp.q2) return { zccl: za, tc: Te * Math.pow(pp.ps / p, 0.286) - 273.15 };
    }
    return null;
  }

  const meteo = { hist: [], col: -1 };
  function recordMeteo() {
    const col = sim.probeColAt;
    if (col < 0 || !sim.sfc || !sim.probeCol) return;
    if (meteo.col !== col) { meteo.col = col; meteo.hist = []; }
    const last = meteo.hist[meteo.hist.length - 1];
    const t = sim.sfcT ?? sim.time;
    if (last && t - last.t < 600 && t >= last.t) return;
    if (last && t < last.t) meteo.hist = [];      // restart
    const v = (n) => sim.sfc[S[n] * NXY + col];
    // zachmurzenie ogólne z tego samego opisu chmur co mapa i widok 3D (pole COVER)
    meteo.hist.push({ t, hour: clock(t).hour, T2: v('T2'), Td2: v('TD2'), PR: v('PR'), PSL: v('PSL'),
      cov: Math.min(1, Math.max(0, v('COVER'))), ws: v('U10'), gust: v('GUST'), sn: v('PSN') });
    if (meteo.hist.length > 432) meteo.hist.shift();         // 3 doby co 10 min
  }

  function drawProf() {
    if (profMode === 'point' && sim.probe) { drawProbe(); return; }
    if (!sim.means) return;
    const z = [], T = [], Td = [], T0 = [], Td0 = [], cloud = [];
    let base = null, top = null;
    for (let k = 0; k < NZ; k++) {
      const zz = grid.zc[k];
      if (sim.means[4 * k + 3] < 0.02) { z.push(zz); T.push(NaN); Td.push(NaN); T0.push(snd.T(zz) - 273.15); Td0.push(dewpoint(snd.qv(zz), snd.pres(zz)) - 273.15); cloud.push(0); continue; }
      const th = grid.data[grid.off.TC + k] + sim.means[4 * k];
      const p = grid.data[grid.off.PRS + k];
      z.push(zz);
      T.push(th * grid.data[grid.off.EXC + k] - 273.15);
      Td.push(dewpoint(sim.means[4 * k + 1], p) - 273.15);
      T0.push(snd.T(zz) - 273.15);
      Td0.push(dewpoint(snd.qv(zz), snd.pres(zz)) - 273.15);
      cloud.push(sim.means[4 * k + 2]);
      if (sim.means[4 * k + 2] > 0.005) { if (base === null) base = zz; top = zz; }
    }
    drawProfile($('cprof'), { z, T, Td, T0, Td0, cloud, top: num('zt') * 1000 });
    const st = sim.stats;
    const cover = st ? (100 * st[14] / (NXD * NYD)).toFixed(0) : '–';
    $('profInfo').textContent = base === null ? `No clouds. Cloud cover ${cover} %.`
      : `Cloud base ≈ ${fmH(Math.round(base / 50) * 50)}, tops ≈ ${fmH(Math.round(top / 50) * 50)} a.s.l. Cloud cover ${cover} %.`;
  }

  function drawProbe() {
    const pp = probeProfile();
    if (!pp) { $('profInfo').textContent = 'Probe: waiting for data…'; return; }
    const z = [], T = [], Td = [], cloud = [], parcel = [], wind = [];
    for (let k = 0; k < NZ; k++) { z.push(grid.zc[k]); T.push(NaN); Td.push(NaN); cloud.push(0); parcel.push(NaN); wind.push(null); }
    // cząstka z dolnych 500 m – ta sama co na mapie CAPE (sonda pokazywała CAPE cząstki z 2 m: popołudniu nad nagrzanym gruntem
    // 2–20× większe niż na mapie, np. 300 J/kg przy 15 J/kg mapy); CAPE cząstki z 2 m – obok, w nawiasie
    const ix = soundingIndices(pp.snd, CFG, 500), ixs = soundingIndices(pp.snd);
    const pz = ix.prof.z, pT = ix.prof.parcel;
    for (const L of pp.lev) {
      T[L.k] = L.T - 273.15; Td[L.k] = dewpoint(L.q, L.p) - 273.15; cloud[L.k] = 1000 * L.cl > 0.02 ? Math.min(1, 1000 * L.cl / 0.5) : 0;
      wind[L.k] = [L.u, L.v];
      // cząstka z dolnych 500 m (próbkowana co 100 m nad gruntem) na poziomach modelu
      const n = Math.floor(L.za / 100);
      if (n >= 0 && n + 1 < pz.length) parcel[L.k] = pT[n] + (pT[n + 1] - pT[n]) * (L.za - pz[n]) / 100;
    }
    // hodograf 0–9 km i ruch prawej superkomórki (Bunkers)
    const hp = pp.lev.filter((L) => L.za <= 9000).map((L) => [L.u, L.v, L.za]);
    let storm = null;
    {
      const l6 = pp.lev.filter((L) => L.za <= 6000);
      if (l6.length > 2) {
        const um = l6.reduce((a, L) => a + L.u, 0) / l6.length, vm = l6.reduce((a, L) => a + L.v, 0) / l6.length;
        const su = l6[l6.length - 1].u - l6[0].u, sv = l6[l6.length - 1].v - l6[0].v, sm = Math.max(Math.hypot(su, sv), 0.1);
        storm = [um + 7.5 * sv / sm, vm - 7.5 * su / sm];
      }
    }
    drawProfile($('cprof'), { z, T, Td, cloud, parcel, wind, top: num('zt') * 1000, ground: pp.zg, parcelLabel: 'parcel from the lowest 500 m', hodo: { pts: hp, storm } });
    const i = pp.col % NX, j = Math.floor(pp.col / NX), ct = convTemp(pp);
    const sv = (n) => sim.sfc[S[n] * NXY + pp.col];
    const f0 = (x) => (x === null || x === undefined ? '–' : fmH(Math.round(x / 10) * 10));
    const t2 = pp.T2 - 273.15;
    $('profInfo').innerHTML = [
      `<b>Probe</b> ${nD((i - MG + 0.5) * CFG.DX / 1000, 'km', 1)}, ${nD((j - MG + 0.5) * CFG.DY / 1000, 'km', 1)} ${unitD('km')} · terrain ${fmH(pp.zg)}`,
      `LCL ${f0(ix.lcl)} · LFC ${f0(ix.lfc)} · EL ${f0(ix.el)} a.g.l. · CAPE <b>${Math.round(ix.cape)}</b> J/kg (parcel from 2 m: ${Math.round(ixs.cape)}) · CIN ${ix.cin === null ? '–' : Math.round(ix.cin)} J/kg`,
      `shear 0–6 km <b>${nD(Math.hypot(sv('SHU'), sv('SHV')), 'm/s')}</b> ${unitD('m/s')} · 0–1 km ${fm(sv('SHR01'), 'm/s')} · SRH 0–3 km <b>${Math.round(sv('SRH03'))}</b> · 0–1 km ${Math.round(sv('SRH01'))} m²/s²`,
      ct ? `Convective T ≈ <b>${fT(ct.tc)}</b> (now ${fT(t2)}${t2 >= ct.tc - 0.3 ? ' – reached, thermals reach condensation' : `, ${fdT(ct.tc - t2)} short`}) · ${isImp() ? '32 °F' : '0 °C'} at ${f0(ix.frz)} · precipitable water ${fm(ix.pw, 'mm')}` : '',
    ].filter(Boolean).join('<br>');
  }

  // Start z wyborem ze strony tytułowej (?start=szerokość,długość,miesiąc 0–11): pierwszy dzień miesiąca, miejsce jak z mapy świata (klimat, teren,
  // pokrycie), jeden restart; ekran wczytywania pokazuje postęp. Bez miejsca (",,5") – płaski teren, klimat domyślny.
  async function startFromTitle(arg) {
    const [la, lo, mo] = arg.split(','), say = (m) => { $('loadMsg').textContent = m; };
    if (mo !== undefined && mo !== '') $('date').value = `${($('date').value || '2026').slice(0, 4)}-${String(+mo + 1).padStart(2, '0')}-01`;
    if (la !== '' && lo !== undefined && lo !== '') {
      const lat = +la, lon = +lo;
      try {
        const c = placeClimate(lat, lon);
        say('Downloading the terrain…');
        const t = await fetchTerrain(lat, lon, NXV, NYV, CFG.DX, say);
        applyDem(t, lat, lon, c);
        await applyLandCover(lat, lon, say, 30000);
        try { localStorage.setItem('w3d-last-place', JSON.stringify(getState())); } catch { /* brak miejsca w pamięci */ }
        updLast();
      } catch (e) { toast(`Could not download the terrain (${e.message || e}) – starting on flat terrain`); }
    }
    const poll = setInterval(() => { const t = $('wxNow').textContent; if (t && t !== '–') say(t); }, 300);
    labels();
    await reset();
    clearInterval(poll);
    $('loadScr').classList.remove('on');
    labels();
  }

  // ---------- zakładka Atmosphere: sondaż z sondy albo średniej domeny (układ jak thundeR, sounding.js) ----------
  let sndPar = 'ml', sndKey = '';
  const sndFullOn = () => $('sndFull').classList.contains('on');
  const sndVisible = () => sndFullOn() || (document.body.classList.contains('drawer') && curTab() === 'atm');
  // profil od gruntu w górę: wysokości nad gruntem, ciśnienie [Pa], T [K], q, wiatr
  function sndProfile() {
    if (!sim.sfc) return null;
    const pr = { z: [], p: [], T: [], q: [], u: [], v: [] };
    const push = (z, p, T, q, u, v) => { pr.z.push(z); pr.p.push(p); pr.T.push(T); pr.q.push(q); pr.u.push(u); pr.v.push(v); };
    if (profMode === 'point' && sim.probe) {
      const pp = probeProfile();
      if (!pp) return null;
      const v = (n) => sim.sfc[S[n] * NXY + pp.col], i = pp.col % NX, j = Math.floor(pp.col / NX), la = latRow(pp.col);
      push(0, pp.ps, pp.T2, pp.q2, v('UA'), v('VA'));
      for (const L of pp.lev) if (L.za > 5) push(L.za, L.p, L.T, L.q, L.u, L.v);
      pr.zg = pp.zg; pr.lat = la; pr.lon = num('lon') + (i - MG - NXD / 2 + 0.5) * CFG.DX / (111320 * Math.cos(la * Math.PI / 180));
      pr.label = `${nD((i - MG + 0.5) * CFG.DX / 1000, 'km', 1)}, ${nD((j - MG + 0.5) * CFG.DY / 1000, 'km', 1)} ${unitD('km')}`;
      return pr;
    }
    if (!sim.means || !sim.meanUV) return null;
    // średnia po widocznej domenie: poziomy, gdzie co najmniej połowa oczek jest nad gruntem, wysokość nad średnim gruntem
    let zg = 0, t2 = 0, d2 = 0, ua = 0, va = 0;
    for (let jj = MG; jj < MG + NYD; jj++) {
      for (let ii = MG; ii < MG + NXD; ii++) {
        const c = jj * NX + ii;
        zg += sim.h[c]; t2 += sim.sfc[S.T2 * NXY + c]; d2 += sim.sfc[S.TD2 * NXY + c]; ua += sim.sfc[S.UA * NXY + c]; va += sim.sfc[S.VA * NXY + c];
      }
    }
    const nn = NXD * NYD;
    zg /= nn; t2 /= nn; d2 /= nn; ua /= nn; va /= nn;
    let first = true;
    for (let k = 0; k < NZ; k++) {
      const za = grid.zc[k] - zg;
      if (sim.means[4 * k + 3] < 0.5 || za < 5) continue;
      const p = grid.data[grid.off.PRS + k];
      if (first) { const ps = p * Math.exp(za / 8000); push(0, ps, t2 + 273.15, qsat(d2 + 273.15, ps), ua, va); first = false; }
      const th = grid.data[grid.off.TC + k] + sim.means[4 * k];
      push(za, p, th * grid.data[grid.off.EXC + k], Math.max(sim.means[4 * k + 1], 1e-7), sim.meanUV[2 * k], sim.meanUV[2 * k + 1]);
    }
    if (pr.z.length < 3) return null;
    pr.zg = zg; pr.lat = num('lat'); pr.lon = num('lon'); pr.label = 'domain mean';
    return pr;
  }
  function sndSrcUi() {
    for (const b of document.querySelectorAll('[data-sndsrc] button')) b.classList.toggle('on', b.dataset.p === profMode);
    for (const b of document.querySelectorAll('[data-sndpar] button')) b.classList.toggle('on', b.dataset.c === sndPar);
    sndKey = '';
  }
  // rysowanie tylko przy widocznym sondażu i tylko po nowej kopii pól
  function drawSnd(force) {
    if (!sndVisible()) return;
    const key = `${sim.sfcT}|${profMode}|${sim.probeColAt}|${sndPar}`;
    if (!force && key === sndKey) return;
    const pr = sndProfile();
    if (!pr) return;
    sndKey = key;
    const A = analyzeSounding(pr);
    sim.sndLast = A;
    const ck = clock(sim.sfcT ?? sim.time), hh = Math.floor(ck.hour), mm = Math.floor((ck.hour % 1) * 60);
    const when = `${dateFromDoy(sim.year, ck.doy)} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    $('sndSub').textContent = pr.label;
    const opt = { parcel: sndPar, zg: pr.zg };
    if (sndFullOn()) {
      renderSounding($('csndF'), A, { ...opt, layout: 'full', credit: 'Weather3D – layout after thundeR (Czernecki, Taszarek, Szuster)',
        title: `W3D | lat ${pr.lat.toFixed(2)} | lon ${pr.lon.toFixed(2)} | ${when}` });
    } else renderSounding($('csnd'), A, { ...opt, layout: 'compact' });
  }
  function sndFull(on) {
    if (on === sndFullOn()) return;
    $('sndFull').classList.toggle('on', on);
    if (on) {
      const fs = $('sndFull').requestFullscreen?.();
      if (fs) fs.catch(() => {});
    } else if (document.fullscreenElement === $('sndFull')) document.exitFullscreen();
    sndKey = '';
    drawSnd(true);
  }
  document.querySelectorAll('[data-sndsrc] button').forEach((b) => b.addEventListener('click', () => setProfMode(b.dataset.p)));
  document.querySelectorAll('[data-sndpar] button').forEach((b) => b.addEventListener('click', () => { sndPar = b.dataset.c; sndSrcUi(); drawSnd(true); }));
  $('sndExpand').onclick = () => sndFull(true);
  $('sndClose').onclick = () => sndFull(false);
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && sndFullOn()) sndFull(false); else if (sndFullOn()) { sndKey = ''; requestAnimationFrame(() => drawSnd(true)); } });
  new ResizeObserver(() => { if (sndFullOn()) { sndKey = ''; drawSnd(true); } }).observe($('csndF'));

  let last = performance.now(), lastUi = 0;
  function cuWind() {
    if (!sim.sfc || sim.sfcT === cuc.sfcT) return;
    cuc.sfcT = sim.sfcT;
    const LXd = NXD * CFG.DX, LYd = NYD * CFG.DY;
    const nx = Math.max(1, Math.min(6, Math.round(LXd / 40000))), ny = Math.max(1, Math.min(6, Math.round(LYd / 40000)));
    const su = new Float64Array(nx * ny), sv = new Float64Array(nx * ny), sn = new Float64Array(nx * ny);
    const su2 = new Float64Array(nx * ny), sv2 = new Float64Array(nx * ny);
    const ou = S.CWU * NXY, ov = S.CWV * NXY, ou2 = S.MWU * NXY, ov2 = S.MWV * NXY;
    for (let j = 0; j < NYD; j++) {
      const tj = Math.min(ny - 1, Math.floor(j * ny / NYD));
      for (let i = 0; i < NXD; i++) {
        const t = tj * nx + Math.min(nx - 1, Math.floor(i * nx / NXD)), c = (j + MG) * NX + i + MG;
        su[t] += sim.sfc[ou + c]; sv[t] += sim.sfc[ov + c]; sn[t]++;
        su2[t] += sim.sfc[ou2 + c]; sv2[t] += sim.sfc[ov2 + c];
      }
    }
    if (nx !== cuc.nx || ny !== cuc.ny) { cuc.nx = nx; cuc.ny = ny; cuc.D.fill(0); cuc.D2.fill(0); }
    let g = 0;
    for (let t = 0; t < nx * ny; t++) { cuc.U[2 * t] = su[t] / sn[t]; cuc.U[2 * t + 1] = sv[t] / sn[t]; cuc.U2[2 * t] = su2[t] / sn[t]; cuc.U2[2 * t + 1] = sv2[t] / sn[t]; }
    for (let tj = 0; tj < ny; tj++) for (let ti = 0; ti < nx; ti++) {
      const t = tj * nx + ti;
      for (const U of [cuc.U, cuc.U2]) {   // oba wzory (niskie i piętro średnie)
        if (ti + 1 < nx) g = Math.max(g, Math.hypot(U[2 * t + 2] - U[2 * t], U[2 * t + 3] - U[2 * t + 1]) / (LXd / nx));
        if (tj + 1 < ny) g = Math.max(g, Math.hypot(U[2 * (t + nx)] - U[2 * t], U[2 * (t + nx) + 1] - U[2 * t + 1]) / (LYd / ny));
      }
    }
    cuc.gmax = g;
  }
  function cuTick(dS, dW) {
    if (dW > 0) cuc.rate += Math.min(1, dW / 1.5) * (dS / dW - cuc.rate);
    if (dS <= 0) return;
    cuWind();
    const want = Math.max(1800, Math.min(4 * cuc.rate, 0.8 / Math.max(cuc.gmax, 1e-9)));
    cuc.Te += Math.min(1, dW / 2) * (want - cuc.Te);
    cuc.ph += dS / cuc.Te;
    // ciągłe przesunięcie szumu brzegów chmur (3D, satelita): średni wiatr warstwy cumulusów i średni 0–6 km w domenie
    // (wcześniej szum stał w miejscu – chmury płynące z wiatrem „gotowały się” w miejscu zamiast płynąć); zawijane co 4000 km
    { const n = cuc.nx * cuc.ny; let u0 = 0, v0 = 0, u1 = 0, v1 = 0;
      for (let t = 0; t < n; t++) { u0 += cuc.U[2 * t]; v0 += cuc.U[2 * t + 1]; u1 += cuc.U2[2 * t]; v1 += cuc.U2[2 * t + 1]; }
      const W = 4e6, add = (k, v) => { cuc.N[k] = (((cuc.N[k] + v * dS / n) % W) + W) % W; };
      add(0, u0); add(1, v0); add(2, u1); add(3, v1); }
    for (let g = 0; g < 2; g++) {
      const n = Math.floor(cuc.ph + 0.5 * g);
      if (n !== cuc.gen[g]) {   // nowe pokolenie (chmury poprzedniego tego pokolenia już zgasły) – wzór od zera
        cuc.gen[g] = n;
        for (let t = 0; t < 36; t++) { cuc.D[4 * t + 2 * g] = 0; cuc.D[4 * t + 2 * g + 1] = 0; cuc.D2[4 * t + 2 * g] = 0; cuc.D2[4 * t + 2 * g + 1] = 0; }
      } else {
        for (let t = 0; t < cuc.nx * cuc.ny; t++) {
          cuc.D[4 * t + 2 * g] += cuc.U[2 * t] * dS; cuc.D[4 * t + 2 * g + 1] += cuc.U[2 * t + 1] * dS;
          cuc.D2[4 * t + 2 * g] += cuc.U2[2 * t] * dS; cuc.D2[4 * t + 2 * g + 1] += cuc.U2[2 * t + 1] * dS;
        }
      }
    }
  }
  function frame(now) {
    if (sim.halted) return;
    const realDt = Math.min((now - last) / 1000, 0.1);
    last = now;
    flyTick(realDt);

    // malowanie terenu (na żywo, bez restartu)
    const pw = $('paintWhat').value;
    if (sim.paint && pw === 'water') {
      paintWater(sim.paint.x, sim.paint.y, num('brush') * 1000 / CFG.DX, sim.paint.sign > 0);
    } else if (sim.paint && pw.startsWith('veg:')) {
      paintSurface(sim.paint.x, sim.paint.y, num('brush') * 1000 / CFG.DX, sim.paint.sign > 0 ? +pw.slice(4) : -1);
    } else if (sim.paint) {
      paintBrush(sim.hv, CFGV, sim.paint.x, sim.paint.y, num('brush') * 1000 / CFG.DX, sim.paint.sign * 600 * realDt, 8000, !CFG.OPEN);
      $('shape').value = 'painted';
      applyTerrain();
      $('hills').value = String(Math.round(sim.hmax / 50) * 50);
      $('hillsV').textContent = fmH(sim.hmax);
    }

    let n = 0;
    if (!sim.paused) {
      const mode = $('speed').value;
      if (mode === 'max') {
        // ~28 ms obliczeń na klatkę (~30 kl./s – widok płynny, karta prawie w pełni dla symulacji); co najmniej 1 krok
        n = sim.msPerStep > 0 ? Math.max(1, Math.floor(28 / sim.msPerStep)) : 2;
      } else {
        sim.debt += realDt * Number(mode) / DT;
        n = Math.floor(sim.debt);
        sim.debt -= n;
        if (sim.debt > 1) sim.debt = 0;
      }
      n = Math.max(0, Math.min(MAX_STEPS, n));
    }

    if (sim.busy || sim.saving) n = 0;
    if (n > 0) {
      runSteps(n, true);
      speedHist.push({ t: now, sim: n * DT });
    }
    cuTick(n * DT, realDt);
    const enc = device.createCommandEncoder();
    let wantDiag = false;
    if (!sim.busy && !sim.statsPending && now - sim.lastStats > 400) {
      writeParams(1);   // aktualne ustawienia widoku dla diagnostyki (także podczas pauzy)
      encodeDiag(enc);
      wantDiag = true;
      sim.lastStats = now;
    }
    encodeRender(enc);
    device.queue.submit([enc.finish()]);
    ts3Map();
    if (wantDiag) readDiag();
    if (sim.snapReq) { sim.snapReq = false; snapshot(); }
    weatherTick();

    while (speedHist.length && now - speedHist[0].t > 2000) speedHist.shift();
    if (now - lastUi > 250) { lastUi = now; updateUi(now); }
    requestAnimationFrame(frame);
  }
  // --- Start: scenariusz z adresu (po przeładowaniu na inną siatkę) albo domyślny ---
  $('airmass').value = 'cumulus';
  applyAirmassPreset();
  sim.air = airParams();
  $('shape').value = 'flat';
  $('landuse').value = 'mosaic';
  setShape('flat');
  const urlScen = new URLSearchParams(location.search).get('scen'), urlStart = new URLSearchParams(location.search).get('start');
  if (new URLSearchParams(location.search).has('resume')) resumeRun();
  else if (urlStart !== null) startFromTitle(urlStart);
  else {
    $('loadScr').classList.remove('on');
    if (urlScen && SCENARIOS[urlScen]) applyScenario(urlScen);
    else reset();
  }
  synUi();
  sndSrcUi();
  labels();
  loadPrefs();                                     // zapamiętane ustawienia widoku (zakładka, nakładki, zwinięte panele)
  if (sim.profModePref) setProfMode(sim.profModePref);
  // scenariusz z linku (#s=…)
  if (location.hash.startsWith('#s=')) {
    unpackState(location.hash.slice(3)).then(loadState).catch((e) => { $('stInfo').textContent = `Invalid link: ${e.message}`; });
  }

  requestAnimationFrame(frame);

  // przybliżanie meteogramu sondy (najkrótsze okno 1 h, zapis co 10 min)
  const cmetView = newView(3600);
  attachView($('cmet'), () => cmetView, () => drawMeteogram($('cmet'), meteo.hist, cmetView), MET_L, MET_R);

  // zegar, wskaźniki, legendy, profil i diagnostyka (co ~0.25 s; w testach z draw())
  function updateUi(now) {
      updateLegends();
      drawProf();
      drawSnd();
      drawMeteogram($('cmet'), meteo.hist, cmetView);
      manipUi();
      stations.tick(curAna() === 'st' && !document.body.classList.contains('noana'));
      const pm = $('probe');
      if (sim.probe && !v3.on) {
        const pl = ((sim.probe.i - MG + 0.5) / NXD - mz.x) * mz.s * 100, pt = (1 - (sim.probe.j - MG + 0.5) / NYD - mz.y) * mz.s * 100;
        pm.style.display = pl < 0 || pl > 100 || pt < 0 || pt > 100 ? 'none' : 'block';
        pm.style.left = `${pl}%`;
        pm.style.top = `${pt}%`;
      } else pm.style.display = 'none';
      updateTip();
      const span = speedHist.length ? Math.max(500, now - speedHist[0].t) / 1000 : 1;
      const simPerReal = speedHist.reduce((a, x) => a + x.sim, 0) / span;
      const dayMin = simPerReal > 0 ? 86400 / simPerReal / 60 : Infinity;
      const st = sim.stats;
      const ck = clock(sim.time);
      const sun = sunVector(num('lat'), ck.doy, ck.hour);
      const t2 = sim.sfc ? window.__sim.sfcStats('T2') : null;
      // zegar i wskaźniki w górnym pasku
      const hh = Math.floor(ck.hour), mm = Math.floor((ck.hour % 1) * 60);
      $('clockTime').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      $('clockDate').textContent = `${dateFromDoy(sim.year, ck.doy)} · day ${Math.floor((sim.startHour + sim.time / 3600) / 24) + 1}`;
      $('clockSun').textContent = sun.elev > 0 ? `☀ ${sun.elev.toFixed(0)}°` : '☾ night';
      $('chipT2').textContent = t2 ? `${nD(t2.min, '°C', 1)}…${fT(t2.max)}` : '–';
      $('chipCloud').textContent = st ? `${(100 * st[14] / (NXD * NYD)).toFixed(0)} %` : '–';
      $('chipRain').textContent = st ? fm(st[15], 'mm/h', 1) : '–';
      $('chipSpeed').textContent = sim.paused ? 'paused' : `${simPerReal.toFixed(0)}×`;
      $('chipGpu').textContent = sim.msPerStep ? `${sim.msPerStep.toFixed(1)} ms/step` : '–';
      $('perf').textContent = [
        `speed            ${simPerReal.toFixed(0)}×, one day = ${isFinite(dayMin) ? dayMin.toFixed(1) + ' min' : '—'}`,
        `GPU per step     ${sim.msPerStep ? sim.msPerStep.toFixed(2) + ' ms' : '—'}${ts ? '' : ' (est.)'}${sim.flat ? '' : ' (terrain)'}`,
        v3.on && ts3 ? `3D view          ${(ts3.tex + ts3.img).toFixed(2)} ms per frame (textures ${ts3.tex.toFixed(2)}, image ${ts3.img.toFixed(2)}; ${v3.newView ? 'new' : 'old'})` : '',
        `grid             ${NXD}×${NYD}×${NZ}${CFG.NE ? ` (+2×${MG} margin, +${CFG.NE} boundary zone)` : ' periodic'}, spacing ${CFG.DX} m, Δt ${DT} s`,
        `schemes          boundary layer ${(100 * CFG.W_PBL).toFixed(0)}%, deep convection ${(100 * CFG.W_CU).toFixed(0)}%, shallow ${(100 * CFG.W_SH).toFixed(0)}%`,
        st ? `w min / max      ${(-st[1]).toFixed(1)} / ${st[0].toFixed(1)} m/s` : '',
        st ? `q_c max          ${(1000 * st[12]).toFixed(2)} g/kg` : '',
        st ? `error ∇·(ρu)/ρ   ${st[4].toExponential(1)} 1/s` : '',
      ].filter(Boolean).join('\n');
  }
}

init().catch((e) => fail(String(e.stack || e)));
