// Wejście strony: strona tytułowa (adres bez parametrów) albo od razu symulacja (linki, testy, przeładowanie po zmianie siatki).
// Główny moduł wczytywany dopiero po wyborze – grid.js czyta siatkę z adresu przy wczytaniu, więc wybór ze strony tytułowej nie wymaga przeładowania.
window.__started = true;
// komunikat o niewczytanym skrypcie (index.html) mógł się pojawić przy wolnym łączu; bez WebGPU (telefon, stara przeglądarka) – od razu, nie dopiero po wyborze miejsca
document.getElementById('err').textContent = navigator.gpu ? '' : 'This browser does not support WebGPU. Use a current Chrome or Edge on a computer.';
const q = new URLSearchParams(location.search);
const direct = !q.has('title') && ([...q.keys()].length > 0 || location.hash.startsWith('#s=') || navigator.webdriver);
import(direct ? './main.js' : './title.js');
