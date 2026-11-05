# Normy 1991–2020 z dobowych danych IMGW-PIB: miesiące, σ, liczby dni, rekordy okresu, serie, klimatologia dobowa.
# Użycie: python -I -X utf8 norms.py <ref_daily.json> <norms.json>
import calendar, collections, json, math, statistics as SS, sys, datetime
R = json.load(open(sys.argv[1], encoding='utf-8'))
Y0, Y1 = 1991, 2020
def ms(v): return SS.mean(v) if v else None
THR = {'d30': ('tx', lambda x: x >= 30), 'd25': ('tx', lambda x: x >= 25), 'mroz': ('tx', lambda x: x < 0), 'zmroz': ('tn', lambda x: x < 0), 'trop': ('tn', lambda x: x >= 20),
       'tn18': ('tn', lambda x: x >= 18), 'd1': ('p', lambda x: x >= 1), 'd10': ('p', lambda x: x >= 10), 'd20': ('p', lambda x: x >= 20), 'd50': ('p', lambda x: x >= 50), 'covd': ('sd', lambda x: x >= 1),
       'fogd': ('fog', lambda x: x >= 1)}
out = {}
for code, rec in R.items():
    days = rec['days']
    by = collections.defaultdict(list)
    for k, e in days.items(): by[(int(k[:4]), int(k[5:7]))].append((int(k[8:]), e))
    ser = collections.defaultdict(dict)
    for (y, m), L in by.items():
        nd = calendar.monthrange(y, m)[1]
        es = [e for _, e in L]
        def vals(v): return [e[v] for e in es if e.get(v) is not None]
        def nmiss(v): return sum(1 for e in es if v in e and e[v] is None)
        def complete(v): return len(vals(v)) >= nd - 3
        for v, nm in (('tm', 'T'), ('tx', 'Tx'), ('tn', 'Tn'), ('rh', 'RH'), ('ws', 'WS'), ('cl', 'CL'), ('psl', 'PSL')):
            if complete(v): ser[nm][(y, m)] = SS.mean(vals(v))
        if complete('tx'): ser['TxA'][(y, m)] = max(vals('tx'))
        if complete('tn'): ser['TnA'][(y, m)] = min(vals('tn'))
        if complete('sun'): ser['S'][(y, m)] = sum(vals('sun'))
        # opad i śnieg: na posterunkach brak dnia w pliku = brak zjawiska; brak pomiaru tylko przy statusie 8
        if vals('p') and nmiss('p') <= 3:
            ser['P'][(y, m)] = sum(vals('p')); ser['Pmax'][(y, m)] = max(vals('p'))
        if vals('sd') and nmiss('sd') <= 3: ser['SDX'][(y, m)] = max(vals('sd'))
        for nm, (v, cond) in THR.items():
            if v in ('p', 'sd'):
                if vals(v) and nmiss(v) <= 3: ser[nm][(y, m)] = sum(1 for x in vals(v) if cond(x))
            elif complete(v):
                ser[nm][(y, m)] = sum(1 for x in vals(v) if cond(x))
    o = {'name': rec['name'], 'nd': len(days)}
    M = {}
    for nm, s in ser.items():
        M[nm] = []
        for m in range(1, 13):
            v = [s[(y, m)] for y in range(Y0, Y1 + 1) if (y, m) in s]
            M[nm].append({'mean': SS.mean(v), 'sd': SS.pstdev(v), 'n': len(v), 'max': max(v), 'min': min(v), 'vals': v} if len(v) >= 10 else None)
    o['m'] = M
    # średnie roczne i σ średniej rocznej; suma roczna opadu
    for nm, how in (('T', 'mean'), ('P', 'sum'), ('S', 'sum')):
        s = ser.get(nm, {})
        ann = [(y, (SS.mean if how == 'mean' else sum)([s[(y, m)] for m in range(1, 13)])) for y in range(Y0, Y1 + 1) if all((y, m) in s for m in range(1, 13))]
        o[f'ann{nm}'] = {'n': len(ann), 'mean': SS.mean(a for _, a in ann) if ann else None, 'sd': SS.pstdev(a for _, a in ann) if len(ann) > 1 else None,
                         'max': max(ann, key=lambda a: a[1]) if ann else None, 'min': min(ann, key=lambda a: a[1]) if ann else None}
    # zima (XII–II) i lato: σ pory roku
    # rekordy dobowe okresu z datą
    rec_ = {}
    for nm, v, pick in (('Txx', 'tx', max), ('Tnn', 'tn', min), ('Pxx', 'p', max), ('SDx', 'sd', max), ('Tnx', 'tn', max), ('Tmx', 'tm', max)):
        c = [(e[v], k) for k, e in days.items() if e.get(v) is not None]
        if c: rec_[nm] = pick(c, key=lambda a: a[0])
    o['rec'] = rec_
    # klimatologia dzień roku (średnia krocząca 31 dni) i rozkład odchyleń dobowych
    if sum(1 for e in days.values() if e.get('tm') is not None) > 5000:
        acc = collections.defaultdict(list)
        for k, e in days.items():
            if e.get('tm') is not None:
                acc[(int(k[5:7]), int(k[8:]))].append(e['tm'])
        base = datetime.date(2000, 1, 1)
        clim = []
        for j in range(366):
            d = base + datetime.timedelta(days=j)
            clim.append(SS.mean(acc[(d.month, d.day)]) if acc[(d.month, d.day)] else float('nan'))
        sm = []
        for j in range(366):
            w = [clim[(j + q) % 366] for q in range(-15, 16)]
            w = [x for x in w if not math.isnan(x)]
            sm.append(SS.mean(w))
        # drugie wygładzenie, bez ząbków
        sm2 = [SS.mean(sm[(j + q) % 366] for q in range(-7, 8)) for j in range(366)]
        o['clim'] = sm2
        an = collections.defaultdict(list)
        for k, e in days.items():
            if e.get('tm') is None: continue
            m = int(k[5:7]); j = (datetime.date(2000, m, int(k[8:])) - base).days
            an[m].append(e['tm'] - sm2[j])
        o['anom'] = {str(m): an[m] for m in range(1, 13)}
        # serie: najdłuższy ciąg dni Tx ≥ 25, ≥ 30 i Tmax < 0, Tmin < -10 w każdym roku
        spells = collections.defaultdict(list)
        for y in range(Y0, Y1 + 1):
            ks = [f'{d.isoformat()}' for d in (datetime.date(y, 1, 1) + datetime.timedelta(days=i) for i in range(366 if calendar.isleap(y) else 365))]
            for nm, v, cond in (('sp30', 'tx', lambda x: x >= 30), ('sp25', 'tx', lambda x: x >= 25), ('sp0', 'tx', lambda x: x < 0), ('spdry', 'p', lambda x: x < 1)):
                best = cur = 0
                for k in ks:
                    x = days.get(k, {}).get(v, 0.0 if v == 'p' else None)
                    if x is not None and cond(x): cur += 1; best = max(best, cur)
                    else: cur = 0
                spells[nm].append(best)
        o['spells'] = {k: {'mean': SS.mean(v), 'max': max(v)} for k, v in spells.items()}
    out[code] = o
    t = M.get('T'); p = M.get('P')
    print(f"{code} {rec['name']:26s} T n={t[0]['n'] if t and t[0] else '-':>3} P n={p[0]['n'] if p and p[0] else '-':>3}"
          f" S n={(M.get('S') or [None])[0]['n'] if (M.get('S') or [None])[0] else '-':>3}"
          f" | Trok {o['annT']['mean'] if o['annT']['mean'] is None else round(o['annT']['mean'], 1)} σ {o['annT']['sd'] if o['annT']['sd'] is None else round(o['annT']['sd'], 2)}"
          f" | Prok {o['annP']['mean'] if o['annP']['mean'] is None else round(o['annP']['mean'])}"
          f" | S {o['annS']['mean'] if o['annS']['mean'] is None else round(o['annS']['mean'])} | rec {rec_.get('Txx')} {rec_.get('Tnn')} {rec_.get('Pxx')}")
json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('zapisano')
