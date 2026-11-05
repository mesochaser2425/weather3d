// Pełny zapis przebiegu – plik .w3drun: znacznik, nagłówek JSON, bloki deflate-raw. Bajty liczb f32 rozdzielone na 4 płaszczyzny (jak filtr „shuffle”
// w HDF5) – pola zmiennoprzecinkowe kurczą się wtedy wyraźnie lepiej. Wczytanie zawsze przez przeładowanie strony: plik do IndexedDB, adres z siatką
// przebiegu i ?resume (main.js startuje wtedy od razu z pliku, bez rozbiegu). Moduł bez zależności od grid.js – używa go też strona tytułowa.
const MAGIC = 'W3DRUN1\n';
const TYPES = { Float32Array, Float64Array, Int8Array, Uint8Array, Int16Array, Uint16Array };

function shuffle4(b) {
  const n = b.length >> 2, o = new Uint8Array(b.length), n2 = 2 * n, n3 = 3 * n;
  for (let i = 0, k = 0; i < n; i++, k += 4) { o[i] = b[k]; o[n + i] = b[k + 1]; o[n2 + i] = b[k + 2]; o[n3 + i] = b[k + 3]; }
  return o;
}
function unshuffle4(b) {
  const n = b.length >> 2, o = new Uint8Array(b.length), n2 = 2 * n, n3 = 3 * n;
  for (let i = 0, k = 0; i < n; i++, k += 4) { o[k] = b[i]; o[k + 1] = b[n + i]; o[k + 2] = b[n2 + i]; o[k + 3] = b[n3 + i]; }
  return o;
}
const deflate = (u8) => new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'))).blob();

// chunks: [{ name, data: tablica typowana }] → Blob pliku
export async function packRun(meta, chunks, onProgress) {
  const parts = [], idx = [];
  let off = 0;
  for (let i = 0; i < chunks.length; i++) {
    const { name, data } = chunks[i], raw = new Uint8Array(data.buffer, data.byteOffset, data.byteLength), sh = data instanceof Float32Array;
    const z = await deflate(sh ? shuffle4(raw) : raw);
    idx.push({ name, type: data.constructor.name, bytes: raw.length, off, len: z.size, sh: sh ? 1 : 0 });
    parts.push(z); off += z.size;
    if (onProgress) onProgress((i + 1) / chunks.length);
  }
  const head = new TextEncoder().encode(JSON.stringify({ ...meta, chunks: idx }));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, head.length, true);
  return new Blob([MAGIC, len, head, ...parts], { type: 'application/octet-stream' });
}

// { meta, read(name) → tablica typowana albo null, text(name) → tekst bloku JSON albo null }
export async function openRun(blob) {
  const h = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (h.length < 12 || new TextDecoder().decode(h.subarray(0, 8)) !== MAGIC) throw new Error('this is not a Weather3D run file');
  const n = new DataView(h.buffer).getUint32(8, true), base = 12 + n;
  const meta = JSON.parse(await blob.slice(12, base).text());
  const index = new Map(meta.chunks.map((c) => [c.name, c]));
  const bytes = async (c) => {
    const s = blob.slice(base + c.off, base + c.off + c.len).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const u = new Uint8Array(await new Response(s).arrayBuffer());
    return c.sh ? unshuffle4(u) : u;
  };
  const read = async (name) => {
    const c = index.get(name);
    if (!c) return null;
    const u = await bytes(c), T = TYPES[c.type];
    return new T(u.buffer, u.byteOffset, u.byteLength / T.BYTES_PER_ELEMENT);
  };
  const text = async (name) => { const c = index.get(name); return c ? new TextDecoder().decode(await bytes(c)) : null; };
  return { meta, read, text };
}

// JSON z liczbami niesk. i NaN (liczniki stacji startują od ±Infinity, odczyty stacji bywają NaN); digits – zaokrąglenie (historia stacji)
const numOut = (v) => (v !== v ? '§n' : v > 0 ? '§+' : '§-');
export function jsonPack(x, digits = 0) {
  const sc = digits ? 10 ** digits : 0;
  return new TextEncoder().encode(JSON.stringify(x, (k, v) => {
    if (typeof v !== 'number') return v;
    if (!Number.isFinite(v)) return numOut(v);
    return sc ? Math.round(v * sc) / sc : v;
  }));
}
export const jsonUnpack = (t) => JSON.parse(t, (k, v) => (v === '§n' ? NaN : v === '§+' ? Infinity : v === '§-' ? -Infinity : v));

// plik czekający na wczytanie po przeładowaniu strony
const dbOpen = () => new Promise((ok, no) => {
  const r = indexedDB.open('w3d-run', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('run');
  r.onsuccess = () => ok(r.result);
  r.onerror = () => no(r.error);
});
async function dbDo(mode, fn) {
  const d = await dbOpen();
  try {
    return await new Promise((ok, no) => {
      const t = d.transaction('run', mode), q = fn(t.objectStore('run'));
      t.oncomplete = () => ok(q.result);
      t.onerror = () => no(t.error);
      t.onabort = () => no(t.error);
    });
  } finally { d.close(); }
}
export const stashRun = (file) => dbDo('readwrite', (s) => s.put(file, 'pending'));
export const stashedRun = () => dbDo('readonly', (s) => s.get('pending'));
export const clearStash = () => dbDo('readwrite', (s) => s.delete('pending'));

// adres, pod którym strona otworzy siatkę przebiegu i wczyta plik z IndexedDB (parametry doświadczalne jak w chwili zapisu)
export function resumeUrl(meta, extra = {}) {
  const q = new URLSearchParams(meta.search || '');
  for (const k of ['start', 'scen', 'title', 'lx', 'ly', 'res', 'n', 'resume', 'hold']) q.delete(k);
  const g = meta.grid;
  q.set('dx', g.dx); q.set('nx', g.nx); q.set('ny', g.ny); q.set('mg', g.mg); q.set('nz', g.nz); q.set('dt', g.dt);
  if (g.bc === 'per') q.set('bc', 'per'); else q.delete('bc');
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  q.set('resume', '1');
  return `${location.pathname}?${q}`;
}
