import sys, zipfile, collections
for zp in sys.argv[1:]:
    z = zipfile.ZipFile(zp); f = z.open(z.namelist()[0])
    h = collections.Counter(); yr = collections.Counter(); lv = []
    cur = None
    for b in f:
        l = b.decode('latin-1')
        if l[0] == '#':
            y, m, hh, n = int(l[13:17]), int(l[18:20]), int(l[24:26]), int(l[32:36])
            if 1991 <= y <= 2020 and 6 <= m <= 8:
                h[hh] += 1
                if hh == 12: yr[y] += 1; lv.append(n)
    print(zp[-28:], 'godziny', sorted(h.items()))
    print('  12Z wg lat', ' '.join(f"{y%100:02d}:{yr[y]}" for y in sorted(yr)))
    lv.sort(); print('  liczba poziomow 12Z: mediana', lv[len(lv)//2], 'p10', lv[len(lv)//10])
