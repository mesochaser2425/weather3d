// Manipulacja atmosfery: wartości suwaków i podpisy (wspólne dla strony tytułowej i zakładki Weather).
// Strona tytułowa nie może importować main.js ani grid.js (czytają adres przy wczytaniu), więc to osobny plik bez stanu.
import { fdT } from './units.js';
export const MANIP_RAIN = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
export const MANIP_VAR = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
export const fmtT = (v) => (v === 0 ? fdT(0, 0) : `${v > 0 ? '+' : '−'}${fdT(Math.abs(v), 1)}`);
export const fmtX = (v) => `×${+v.toFixed(2)}`;
// indeks suwaka najbliższy podanej wartości
export const nearest = (list, v) => list.reduce((b, x, i) => (Math.abs(x - v) < Math.abs(list[b] - v) ? i : b), 0);
// parametry adresu (start ze strony tytułowej, zmiana siatki w Settings)
export const manipQuery = (T, R, V) => (T ? `&tan=${T}` : '') + (R !== 1 ? `&rnf=${R}` : '') + (V !== 1 ? `&vrf=${V}` : '');
// odcinek zmiany w czasie: od wartości from w chwili t0 liniowo do to w chwili t1 [s czasu symulacji]
export const seg = (v) => ({ from: v, to: v, t0: 0, t1: 0 });
export const segAt = (s, t) => (t >= s.t1 ? s.to : t <= s.t0 ? s.from : s.from + (s.to - s.from) * (t - s.t0) / (s.t1 - s.t0));
