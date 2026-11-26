# Porównanie wariantów przy tej samej pogodzie: profile wg binów T850 domeny WARIANTU, średnie dobowe (T2, Tx, Tn, Td, opad, słońce), mapa CAPE 15:00, regulator pary
# Argumenty: katalog bazowy capeout, site-packages, katalog zipów IGRA, nazwy wariantów...
import sys, json, os, collections
sys.path.insert(0, sys.argv[2])
import numpy as np, importlib.util
out, igra = sys.argv[1], sys.argv[3]
sys.argv_saved = sys.argv
# funkcje z capeigra.py (bez uruchamiania main)
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'capeigra.py'), encoding='utf-8').read().rsplit('main()', 1)[0]
_a = sys.argv; sys.argv = ['x', '', '', sys.argv[2]]
G = {}
exec(compile(src, 'capeigra', 'exec'), G)
sys.argv = _a
Y0 = 2005
obs = []
import glob
for z in sorted(glob.glob(os.path.join(igra, '*.zip'))): obs += [x['g'] for x in G['load_igra'](z, y0=Y0)]
OB = G['compute'](obs)
BINS, NAM = G['BINS'], G['NAM']
def line(D, m):
    if m.sum() == 0: return '   -'
    return f'n {m.sum():4d} CAPE {D["c"][m].mean():5.0f} p90 {np.percentile(D["c"][m],90):5.0f} p99 {np.percentile(D["c"][m],99):5.0f} >=2000 {100*(D["c"][m]>=2000).mean():4.1f}% r0-500 {D["rm"][m].mean()*1000:5.2f} th {D["tm"][m].mean():5.1f}'
print('SONDAZE:')
for b, nm in zip(BINS, NAM):
    print(f'  {nm:9s}', line(OB, (OB['t8'] >= b[0]) & (OB['t8'] < b[1])))
def rd(l, tag): return json.loads(l.split(tag + ' ', 1)[1])
for v in sys.argv[4:]:
    d = os.path.join(out, v)
    base, cols = G['load_model'](d)
    MD = G['compute']([G['prof_model'](base, a, 'thD', 'qD') for a in cols])
    MT = G['compute']([G['prof_model'](base, a, 'thT', 'qT') for a in cols])
    print(f'\n=== {v}: {len(cols)} kolumn')
    for b, nm in zip(BINS, NAM):
        print(f'  DOM {nm:9s}', line(MD, (MD['t8'] >= b[0]) & (MD['t8'] < b[1])), ' | CEL', line(MT, (MT['t8'] >= b[0]) & (MT['t8'] < b[1])))
    print('  T12 km domena wg binow:', ' '.join(f'{(MD["T"][(MD["t8"]>=b[0])&(MD["t8"]<b[1])].mean(0)[240]-273.15 if ((MD["t8"]>=b[0])&(MD["t8"]<b[1])).sum() else float("nan")):6.1f}' for b in BINS), ' (sond.', ' '.join(f'{OB["T"][(OB["t8"]>=b[0])&(OB["t8"]<b[1])].mean(0)[240]-273.15:6.1f}' for b in BINS), ')')
    rows = collections.defaultdict(dict); m15 = {}; fq = []
    for f in sorted(glob.glob(os.path.join(d, 's*.txt'))):
        for l in open(f, encoding='utf-8', errors='replace'):
            h = l[:20]
            for t in ('DAY', 'EX', 'EX2', 'BUD', 'M15', 'CC', 'DR'):
                if f' {t} ' in h:
                    a = rd(l, t)
                    if t == 'CC': fq.append([round(x['fq'], 2) for x in a['nodes']])
                    elif t == 'M15': m15[a['d']] = a
                    elif t == 'DR': rows[a['d']].setdefault('dr', []).append(a)
                    else: rows[a['d']].update({k: v_ for k, v_ in a.items() if k != 'd'})
                    break
    dd = [k for k in rows if k >= 3 and 'tx' in rows[k] and 'tn' in rows[k] and 'p' in rows[k]]
    mean = lambda k: sum(rows[x][k] for x in dd if k in rows[x]) / len(dd)
    print(f'  doby {len(dd)}: T2(13:18) {mean("t2"):.2f} Td2(13:18) {mean("td2"):.2f} Tx {mean("tx"):.2f} Tn {mean("tn"):.2f} Td(21) {mean("td21"):.2f} Td(9) {mean("td9"):.2f} opad {mean("p"):.2f} mm/d, slonce {mean("sun"):.2f} h, LE(13) {mean("le"):.0f} W/m2')
    C = [m15[k]['map'] for k in m15 if k >= 3]
    n = len(C); m = lambda x: sum(c[x] for c in C) / n
    print(f'  mapa CAPE 15:00: sr {m("mean"):.0f} p50 {m("p50"):.0f} p90 {m("p90"):.0f} p99 {m("p99"):.0f} sr.maks {m("max"):.0f} maks.maks {max(c["max"] for c in C):.0f} %>=2000 {m("f2k"):.2f} %>=3000 {m("f3k"):.3f}')
    print('  wykladniki fq:', fq[-1] if fq else '-', ' (start', fq[0] if fq else '-', ')')
