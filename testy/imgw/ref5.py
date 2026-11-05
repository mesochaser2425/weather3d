# Czyta dobowe pliki synoptyczne IMGW-PIB (ZIP w pamięci) dla stacji całej Polski i dokleja szeregi z poprzedniego raportu.
# Użycie: python -I -X utf8 ref5.py <katalog imgw nowych stacji> <ref_daily.json poprzedni> <wyjście json>
import csv, io, json, os, sys, zipfile, collections
D, OLD, OUT = sys.argv[1:4]
data = collections.defaultdict(dict); names = {}
def num(v, w, zero9=False):
    w = (w or '').strip()
    if w == '8': return None
    if w == '9': return 0.0 if zero9 else None
    try: return float(v)
    except ValueError: return None
n = 0
for fn in sorted(os.listdir(D)):
    if not fn.endswith('.zip'): continue
    z = zipfile.ZipFile(os.path.join(D, fn))
    for name in z.namelist():
        low = name.lower()
        txt = z.read(name).decode('cp1250', 'replace')
        for r in csv.reader(io.StringIO(txt)):
            if len(r) < 6: continue
            try: key = f'{int(r[2]):04d}-{int(r[3]):02d}-{int(r[4]):02d}'
            except ValueError: continue
            if not (1991 <= int(r[2]) <= 2020): continue
            c = r[0].strip(); names[c] = r[1].strip()
            e = data[c].setdefault(key, {})
            if low.startswith('s_d_t'):
                e.update(cl=num(r[5], r[6]), ws=num(r[7], r[8]), rh=num(r[13], r[14]), psl=num(r[17], r[18]))
            elif low.startswith('s_d'):
                e.update(tx=num(r[5], r[6]), tn=num(r[7], r[8]), tm=num(r[9], r[10]), p=num(r[13], r[14], True), sd=num(r[16], r[17], True), sun=num(r[20], r[21], True), fog=num(r[30], r[31], True), kind=r[15].strip())
    n += 1
print('plików', n)
out = json.load(open(OLD, encoding='utf-8'))
for c, d in data.items():
    ks = sorted(d)
    cnt = {v: sum(1 for k in ks if d[k].get(v) is not None) for v in ['tm', 'tx', 'tn', 'p', 'sd', 'sun', 'rh', 'ws', 'cl', 'psl']}
    print(f"{c} {names[c]:24s} dni {len(ks):6d} {ks[0]}…{ks[-1]} | " + ' '.join(f'{k}:{v}' for k, v in cnt.items()))
    out[c] = {'name': names[c], 'days': d}
# Gdańsk: Port Północny (do ~2010) + Świbno (od ~2011) – dwie stacje brzegowe, razem pełne 30 lat
if '354180140' in out and '354180155' in out:
    g = dict(out['354180140']['days']); g.update(out['354180155']['days'])
    out['GDA'] = {'name': 'GDAŃSK-P.PÓŁN./ŚWIBNO', 'days': g}
    print('Gdańsk razem', len(g), 'dni')
json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('zapisano', len(out), 'stacji,', round(os.path.getsize(OUT) / 1e6, 1), 'MB')
