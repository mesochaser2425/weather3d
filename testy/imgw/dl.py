# Pobiera dobowe dane synoptyczne IMGW-PIB 1991–2020 (otwarte dane, danepubliczne.imgw.pl) dla stacji spoza poprzedniego raportu.
# Użycie: python -I dl.py <katalog wyjściowy>
import os, subprocess, sys, time
OUT = sys.argv[1]
B = 'https://danepubliczne.imgw.pl/data/dane_pomiarowo_obserwacyjne/dane_meteorologiczne'
HAVE = {566, 560, 575, 580, 600, 625, 650, 660, 690, 540}
SYNOP = [155, 150, 135, 120, 115, 105, 205, 125, 160, 272, 295, 195, 399, 375, 385, 495, 497, 485, 488, 570, 465, 240, 250, 330, 424, 550, 435, 418, 415, 520, 500, 400, 300, 200, 100, 235, 210, 215, 225, 230, 345, 530, 270, 285, 360, 585, 695, 595, 280, 185, 310, 455, 469, 670, 577]
SYNOP = [c for c in SYNOP if c not in HAVE]
files = []
for c in SYNOP:
    for p in ('1991_1995', '1996_2000'): files.append(f'dobowe/synop/{p}/{p}_{c}_s.zip')
    for y in range(2001, 2021): files.append(f'dobowe/synop/{y}/{y}_{c}_s.zip')
print(len(files), 'plików', flush=True)
done = fail = 0
t0 = time.time()
for rel in files:
    fn = os.path.join(OUT, rel.replace('/', '_'))
    if os.path.exists(fn) and os.path.getsize(fn) > 200:
        done += 1
        continue
    r = subprocess.run(['curl', '-s', '-m', '120', '--retry', '2', '-o', fn, '-w', '%{http_code}', f'{B}/{rel}'], capture_output=True, text=True)
    if r.stdout.strip() != '200':
        fail += 1
        print('BRAK', rel, r.stdout.strip(), flush=True)
        if os.path.exists(fn): os.remove(fn)
    else:
        done += 1
    if (done + fail) % 200 == 0: print(done + fail, 'z', len(files), f'{time.time() - t0:.0f} s', flush=True)
    time.sleep(0.05)
total = sum(os.path.getsize(os.path.join(OUT, x)) for x in os.listdir(OUT) if x.endswith('.zip'))
print('koniec', done, 'ok,', fail, 'brak,', f'{total / 1e6:.1f} MB, {time.time() - t0:.0f} s', flush=True)
