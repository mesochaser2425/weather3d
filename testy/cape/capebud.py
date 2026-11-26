# Bilans pary domeny (Polska): dobowa odchyłka domena − cel na poziomach → sztuczny dopływ pary z regulatora dryfu (tak jak w lbc_apply), opad, CAPE wg drogi od brzegu napływu
# Argumenty: pliki s*.txt
import sys, json, collections
G = 9.81
def rd(l, tag): return json.loads(l.split(tag + ' ', 1)[1])
tot = []
for f in sys.argv[1:]:
    base = None; dr = collections.defaultdict(list); bud = {}; m15 = {}; day = {}
    for l in open(f, encoding='utf-8', errors='replace'):
        h = l[:20]
        if ' BASE ' in h: base = rd(l, 'BASE')
        elif ' DR ' in h: a = rd(l, 'DR'); dr[a['d']].append(a)
        elif ' BUD ' in h: a = rd(l, 'BUD'); bud[a['d']] = a['p']
        elif ' M15 ' in h: a = rd(l, 'M15'); m15[a['d']] = a
        elif ' DAY ' in h: a = rd(l, 'DAY'); day[a['d']] = a
    zc = base['zc']; rc = base['rc']; dzc = base['dzc']
    # pb (waga warstwy granicznej) – przybliżenie: 1 do ~1.3 km, 16 poziomów nad gruntem (MEB) – do z ~1.8 km; tu liczone do 16. poziomu
    MEB = 16
    E = None
    wyn = []
    for d in sorted(dr):
        if d < 3 or len(dr[d]) < 5: continue
        v = dr[d]; n = len(v[0]['dq'])
        dq = [sum(x['dq'][k] for x in v) / len(v) for k in range(n)]      # g/kg, średnia z 5 terminów doby
        z = v[0]['z']
        # regulator: qexc = max(E − 0.5, 0) + min(E + 0.4, 0) [g/kg] (próg dla ciepłego powietrza, sq = 1), tempo 2/doba, pb ~ 1 (dolne 16 poziomów)
        add = 0.0; mas = 0.0
        for k in range(min(MEB, n)):
            e = dq[k]; q = max(e - 0.5, 0.0) + min(e + 0.4 if z[k] < 900 else e + 0.3, 0.0)
            m = rc[k] * dzc[k]
            add += -2.0 * q * m / 1000.0   # [mm/dobę]: dodatnie – sztuczne nawilżanie
            mas += m
        wyn.append((d, add, bud.get(d, 0.0), sum(dq[:6]) / 6, sum(dq[6:16]) / max(1, len(dq[6:16])), day[d]['mass'] if d in day else '?'))
    n = len(wyn); import statistics as st
    print(f'\n{f[-20:]}: dob {n}')
    print(f"  srednio: sztuczny doplyw pary z regulatora {sum(x[1] for x in wyn)/n:+.2f} mm/d (dodatni – nawilzanie), opad domeny {sum(x[2] for x in wyn)/n:.2f} mm/d; odchylka dom−cel 0–540 m {sum(x[3] for x in wyn)/n:+.2f}, 680–1800 m {sum(x[4] for x in wyn)/n:+.2f} g/kg")
    gr = collections.defaultdict(list)
    for x in wyn: gr[x[5]].append(x)
    for k, v in sorted(gr.items()):
        print(f'   {k:5s} dob {len(v):3d}  regulator {sum(x[1] for x in v)/len(v):+.2f} mm/d  opad {sum(x[2] for x in v)/len(v):5.2f} mm/d  dq 0–540 m {sum(x[3] for x in v)/len(v):+.2f}  680–1800 m {sum(x[4] for x in v)/len(v):+.2f}')
    # CAPE wg drogi od brzegu napływu, 15:00 – przy wietrze ≥ 5 m/s
    NB = 6; S = [0.0] * NB; H = [0.0] * NB; T = [0.0] * NB; c = 0
    for d, a in m15.items():
        if d < 3 or a['sp'] < 5: continue
        c += 1
        for k in range(NB): S[k] += a['band'][k]; H[k] += a['bHi'][k]; T[k] += a['bTd'][k]
    if c:
        print(f"  CAPE 15:00 wg odleglosci od brzegu napływu (0 – najblizej, {NB} pasm, wiatr >=5 m/s, {c} dob):", ' '.join(f'{x/c:5.0f}' for x in S))
        print('     Td2:', ' '.join(f'{x/c:5.1f}' for x in T), ' | %>=2000:', ' '.join(f'{x/c:4.1f}' for x in H))
    # mapa 15:00 wg masy
    R = collections.defaultdict(list)
    for d, a in m15.items():
        if d >= 3 and d in day: R[day[d]['mass']].append(a['map'])
    print('  mapa CAPE 15:00 wg masy: dob, p50, p90, p99, srednie maks., maks.maks., %>=2000, %>=3000')
    for k, v in sorted(R.items()):
        m = lambda x: sum(u[x] for u in v) / len(v)
        print(f"   {k:5s} {len(v):3d}  {m('p50'):5.0f} {m('p90'):5.0f} {m('p99'):5.0f} {m('max'):5.0f} {max(u['max'] for u in v):5.0f}  {m('f2k'):5.1f} {m('f3k'):5.2f}")
