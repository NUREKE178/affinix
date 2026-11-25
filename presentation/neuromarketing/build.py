"""Нейромаркетинг және цифрлық алгоритмдер · Affinix — 12 слайд, Affinix «Instrument» стилі, нативті PPT анимациясы.
1–5 слайдтың құрылымы пайдаланушының PDF-інен; 6–8 мәселені ашады; 9–12 Affinix шешімі, ұсыныс, қорытынды.
Түстер styles.css-тен: графит фон, күңгірт пластиналар, бір сигнал түсі (#ff6a1f), LED нүктелер, сандар mono."""
import math
from deckkit import *

SIG, SIG_INK = 'FF6A1F', '1D0D04'
G50, G300, G400, G500, G600, G700, G800 = 'F5F5F6', 'C3C5CB', 'A2A5AE', '868993', '565963', '3A3C43', '26282D'
PLATE, PLATE_LN, WELL, WELL_LN, KEY = '1A1B1E', '2B2C31', '09090B', '000000', '2C2E34'
OK, BAD, INFO, STEEL = '34D399', 'FB7185', '86A5D9', '668BC9'
MONO = 'JetBrains Mono'
N = 12
init(dict(font='Rubik', on_bg=G50, on_bg_soft=G400, accent=SIG, accent_ink=SIG_INK,
          card=PLATE, ink=G50, mute=G400, primary=SIG, dot=SIG), total=N)


def mono(*a, **k):
    old = T['font']; T['font'] = MONO
    try: return text(*a, **k)
    finally: T['font'] = old


def rich(c, x, y, w, h, parts, pt, bold=True, align=L, spacing=None, anchor=None):
    s = c.add_textbox(e(x), e(y), e(w), e(h)); tf = s.text_frame; tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    if anchor is not None: tf.vertical_anchor = anchor
    p = tf.paragraphs[0]; p.alignment = align
    if spacing: p.line_spacing = spacing
    for t, font, color in parts:
        r = p.add_run(); r.text = t; r.font.size = Pt(pt); r.font.bold = bold; r.font.color.rgb = rgb(color); r.font.name = font
        etree.SubElement(r._r.get_or_add_rPr(), qn('a:ea')).set('typeface', font)
    return s


def outline(s, color, w=1):
    s.line.color.rgb = rgb(color); s.line.width = Pt(w); return s


def plate(c, x, y, w, h, rad=28, fill=PLATE, ln=PLATE_LN):
    s = outline(box(c, x, y, w, h, fill, rad=rad), ln)
    box(c, x + rad * .6, y, w - rad * 1.2, 2, 'FFFFFF', kind=MSO_SHAPE.RECTANGLE, alpha=.05)  # light from above
    return s


def well(c, x, y, w, h, rad=20):
    return outline(box(c, x, y, w, h, WELL, rad=rad), WELL_LN)


def led(c, x, y, color=SIG, s=14):
    return box(c, x, y, s, s, color, MSO_SHAPE.OVAL)


def ring(c, cx, cy, r, color, w=1.5, fill=None):
    s = box(c, cx - r, cy - r, 2 * r, 2 * r, fill or '000000', MSO_SHAPE.OVAL)
    if fill is None: s.fill.background()
    return outline(s, color, w)


def hline(c, x, y, w, alpha=.1):
    return box(c, x, y, w, 1, 'FFFFFF', kind=MSO_SHAPE.RECTANGLE, alpha=alpha)


def icon_well(c, ic, x, y, s=96, col='sig'):
    well(c, x, y, s, s, rad=22); k = s * .56
    pic(c, f'assets/{ic}_{col}.png', x + (s - k) / 2, y + (s - k) / 2, k)


def key(c, cx, cy, t, lit=False, pt=18, h=64, w=None):
    w = w or len(t) * pt * 1.15 + 72
    s = outline(box(c, cx - w / 2, cy - h / 2, w, h, SIG if lit else KEY, rad=16), 'C8420B' if lit else '3F4148')
    s.text_frame.vertical_anchor = MID
    style(s.text_frame, t, pt, SIG_INK if lit else G50, True, C); return s


def chevron(c, x, y, w=20, h=32, color=SIG):
    a = c.add_shape(MSO_SHAPE.CHEVRON, e(x), e(y), e(w), e(h))
    a.fill.solid(); a.fill.fore_color.rgb = rgb(color); a.line.fill.background(); return a


def callout(sl, y, t, delay, h=104, color=SIG, pt=21):
    g = group(sl, 'Қорытынды'); well(g.shapes, 128, y, 1664, h, rad=24)
    led(g.shapes, 168, y + h / 2 - 6, color, 12)
    text(g.shapes, 200, y, 1556, h, t, pt, G50, True, anchor=MID, spacing=1.15)
    add('rise', g, delay, 500); return g


def frame(label):
    sl = new('base', label, chrome=False)
    pic(sl.shapes, 'symbol.png', 128, 44, 34)
    text(sl.shapes, 172, 44, 300, 40, 'Affinix', 18, G50, True)
    mono(sl.shapes, 1092, 52, 700, 30, 'НЕЙРОМАРКЕТИНГ ЖӘНЕ АЛГОРИТМДЕР', 12, G500, align=R)
    hline(sl.shapes, 128, 976, 1664, .07)
    i = S['n']
    mono(sl.shapes, 128, 996, 900, 30, f'{i:02d} / {N:02d}   {label.upper()}', 12, G500)
    for j in range(N):
        led(sl.shapes, 1792 - (N - j) * 26 + 14, 1002, SIG if j == i - 1 else (G600 if j < i - 1 else G800), 12)
    return sl


def head(sl, eyebrow, title, pt=42):
    add('zoom', led(sl.shapes, 128, 132, SIG, 14), 0, 300)
    add('fade', mono(sl.shapes, 156, 124, 1500, 34, eyebrow, 15, G400), 80, 400)
    t = title if isinstance(title, list) else [(title, 'Rubik', G50)]
    add('rise', rich(sl.shapes, 126, 168, 1660, 100, t, pt), 200, 500)


# ── 1. Титул · тірек сөздер ────────────────────────────────────────────────
sl = new('cover', 'Титул', chrome=False)
add('fade', pic(sl.shapes, 'logo.png', 128, 96, 240, 240 * 322 / 1114), 0, 500)
add('fade', led(sl.shapes, 128, 330, SIG, 14), 200, 300)
add('fade', mono(sl.shapes, 156, 322, 820, 34, 'ЭКОНОМИКА ЖӘНЕ МАРКЕТИНГ СЕКЦИЯСЫ · ҒЫЛЫМИ ЖОБА', 13, G400), 250, 400)
add('rise', text(sl.shapes, 124, 370, 900, 300, 'Нейромаркетинг\nжәне цифрлық\nалгоритмдер', 46, G50, True, spacing=1.05), 300, 600)
add('rise', rich(sl.shapes, 128, 730, 840, 160, [('Әлеуметтік желілер адам ', 'Rubik', G400), ('таңдауын', 'Rubik', SIG),
                                                  (' қалай басқарады?', 'Rubik', G400)], 30, bold=False, spacing=1.2), 600, 600)
add('fade', mono(sl.shapes, 128, 980, 900, 30, '[АТЫ-ЖӨНІ]  ·  [МЕКТЕП / СЫНЫП]  ·  2026', 13, G600), 1300, 500)

add('fade', plate(sl.shapes, 1040, 120, 760, 840, rad=36), 300, 600)
add('fade', mono(sl.shapes, 1086, 160, 700, 30, 'ТІРЕК СӨЗДЕР', 13, G500), 500, 400)
P = {'alg': (1230, 300), 'mi': (1620, 280), 'rt': (1430, 520), 'lenta': (1210, 720),
     'dof': (1520, 850), 'tan': (1660, 640)}
for a, b in [('alg', 'rt'), ('mi', 'rt'), ('rt', 'lenta'), ('rt', 'dof'), ('rt', 'tan'),
             ('alg', 'lenta'), ('dof', 'tan'), ('mi', 'tan'), ('alg', 'mi'), ('lenta', 'dof')]:
    ln, _ = curve(sl, [P[a], P[b]], G700, 1.5, dash=False); add('fade', ln, 700, 900)
for i, (k, t) in enumerate([('rt', 'Таңдау'), ('alg', 'Алгоритм'), ('mi', 'Ми'),
                            ('tan', 'Реакция'), ('lenta', 'Лента'), ('dof', 'Дофамин')]):
    s = key(sl.shapes, *P[k], t, lit=(k == 'rt'), pt=22 if k == 'rt' else 18)
    add('zoom', s, 900 + i * 200, 400)
    if k == 'rt': rt = s
path = 'M 0 0 ' + ' '.join(f'L {(x - P["alg"][0]) / 1920:.4f} {(y - P["alg"][1]) / 1080:.4f}' for x, y in [P['rt'], P['dof']])
dot = led(sl.shapes, P['alg'][0] - 9, P['alg'][1] - 9, SIG, 18)
add('fade', dot, 2200, 200); add('path', dot, 2200, 1800, path=path)
add('pulse', rt, 2500, 450)
finish(sl, '<p:fade/>')

# ── 2. Қазақстанның цифрлық шындығы ────────────────────────────────────────
sl = frame('Цифрлық шындық')
head(sl, '01 · КОНТЕКСТ', 'Қазақстанның цифрлық шындығы')
for i, (v, lab) in enumerate([('93,4%', 'Интернетпен қамту\n19,5 млн адам'),
                              ('80,8%', 'Әлеуметтік желіде\n16,9 млн аккаунт'),
                              ('6,25 трлн', 'Электронды сауда\n2025 ж., теңге')]):
    y = 326 + i * 160
    g = group(sl, v)
    mono(g.shapes, 128, y, 640, 110, v, 52, G50, True, anchor=MID)
    text(g.shapes, 730, y + 10, 560, 90, lab, 20, G400, anchor=MID, spacing=1.2)
    if i < 2: hline(g.shapes, 128, y + 136, 1132, .07)
    add('left', g, 600 + i * 300, 550)
g = group(sl, '84'); plate(g.shapes, 1320, 330, 472, 476, rad=32, ln='7A3510')
led(g.shapes, 1364, 380, SIG, 12); mono(g.shapes, 1388, 372, 380, 30, 'МАРКЕТПЛЕЙСТЕР', 13, SIG)
mono(g.shapes, 1362, 410, 400, 130, '84%', 76, G50, True)
text(g.shapes, 1364, 570, 404, 140, '6,25 трлн теңгенің ұсыныс алгоритмдері арқылы өтетін үлесі', 17, G400, spacing=1.2)
well(g.shapes, 1364, 742, 384, 32, rad=16)
add('rise', g, 1500, 600)
add('wipe', box(sl.shapes, 1372, 750, 368 * .84, 16, SIG, rad=8), 2100, 900)
callout(sl, 846, 'Таңдау жасау процесі математикаға көшті.', 2600, h=96, pt=24)
finish(sl, '<p:fade/>')

# ── 3. Негізгі мәселе: сезіну мен түсіну ───────────────────────────────────
sl = frame('Негізгі мәселе')
head(sl, '02 · НЕГІЗГІ МӘСЕЛЕ', 'Сезіну мен түсіну алшақтығы')
cx = 560
g = group(sl, 'Шеңберлер')
ring(g.shapes, cx, 600, 270, G600, 1.5)
mono(g.shapes, cx - 150, 362, 300, 70, '83%', 44, G50, True, C)
add('zoom', g, 600, 600)
g = group(sl, '46'); ring(g.shapes, cx, 700, 170, '3F4148', 1, fill=G800)
mono(g.shapes, cx - 120, 572, 240, 60, '46%', 38, G50, True, C)
add('zoom', g, 1100, 550)
g = group(sl, '9'); ring(g.shapes, cx, 800, 70, 'C8420B', 1, fill=SIG)
mono(g.shapes, cx - 60, 770, 120, 60, '9%', 28, SIG_INK, True, C, MID)
add('zoom', g, 1600, 500); add('pulse', g, 2000, 400)
for i, (v, lab, d, col) in enumerate([('83%', 'СЕЗІНЕДІ', 'Желіде жоспарлағаннан ұзақ отырып қалатынын мойындайды.', G500),
                                      ('46%', 'ТҮСІНЕДІ', 'Лентасын арнайы алгоритм іріктейтінін біледі.', STEEL),
                                      ('9%', 'ӘРЕКЕТ ЕТЕДІ', 'Алгоритм параметрлерін өзгертіп көрген.', SIG)]):
    y = 316 + i * 156
    g = group(sl, lab)
    led(g.shapes, 1000, y + 14, col, 14); mono(g.shapes, 1028, y + 6, 600, 30, f'{v} · {lab}', 15, G400, True)
    text(g.shapes, 1000, y + 44, 792, 96, d, 19, G50, spacing=1.2)
    add('right', g, 800 + i * 500, 500)
g = group(sl, 'Қорытынды'); well(g.shapes, 1000, 800, 792, 130, rad=24)
led(g.shapes, 1036, 859, SIG, 12)
text(g.shapes, 1066, 800, 700, 130, 'Цифрлық қамту цифрлық сауаттылықтан қауіпті түрде озып кетті.', 21, G50, True, anchor=MID, spacing=1.2)
add('rise', g, 2400, 500)
finish(sl, '<p:push dir="l"/>')

# ── 4. Котлердің «қара жәшігі» ─────────────────────────────────────────────
sl = frame('Классикалық модель')
head(sl, '03 · КЛАССИКАЛЫҚ МОДЕЛЬ', 'Ф. Котлердің «қара жәшігі»')
for i, t in enumerate(['Тауар', 'Баға', 'Жылжыту']):
    y = 380 + i * 92
    add('left', key(sl.shapes, 330, y, t, w=240), 500 + i * 150, 450)
    add('fade', chevron(sl.shapes, 500, y - 16, color=G600), 800 + i * 150, 300)
add('fade', mono(sl.shapes, 210, 622, 240, 30, 'СТИМУЛДАР', 13, G500, align=C), 900, 400)
g = group(sl, 'Жәшік'); well(g.shapes, 580, 330, 560, 320, rad=28)
mono(g.shapes, 580, 360, 560, 200, '?', 110, G700, True, C, MID)
mono(g.shapes, 580, 590, 560, 30, 'ТҰТЫНУШЫ САНАСЫ', 13, G500, align=C)
add('zoom', g, 1100, 600)
for j, y in enumerate([440, 520]):
    add('fade', chevron(sl.shapes, 1180, y - 16), 1600 + j * 150, 300)
add('right', text(sl.shapes, 1250, 410, 540, 110, 'Таңдау,\nсатып алу', 30, G50, True, spacing=1.1), 1800, 500)
add('right', mono(sl.shapes, 1252, 566, 400, 30, 'РЕАКЦИЯ', 13, SIG), 1900, 400)
for i, t in enumerate(['Мұқтаждық', 'Іздеу', 'Бағалау', 'Шешім', 'Реакция']):
    a = outline(sl.shapes.add_shape(MSO_SHAPE.CHEVRON, e(128 + i * 330), e(690), e(344), e(84)), '3F4148' if i < 4 else 'C8420B')
    a.fill.solid(); a.fill.fore_color.rgb = rgb(KEY if i < 4 else SIG); a.adjustments[0] = .32
    a.text_frame.vertical_anchor = MID
    style(a.text_frame, t, 18, G50 if i < 4 else SIG_INK, True, C)
    add('left', a, 2200 + i * 150, 350)
callout(sl, 820, 'Парадокс: жәшіктің ішінде не болатыны белгісіз еді. Бүгін оны екі күш ашып жатыр: нейромаркетинг (ми) және алгоритмдер (мінез-құлық).', 3100, h=120, pt=19)
finish(sl, '<p:fade/>')

# ── 5. Жәшікті ашу: нейромаркетинг және ми ─────────────────────────────────
sl = frame('Жәшікті ашу')
head(sl, '04 · ЖӘШІКТІ АШУ', 'Нейромаркетинг және ми')
g = group(sl, 'Льюис'); plate(g.shapes, 128, 330, 780, 300, rad=28)
mono(g.shapes, 168, 366, 600, 30, 'Д. ЛЬЮИС · ЕКІ ЖҮЙЕ', 14, G400)
for j, (k, t, lit) in enumerate([('Р', 'Рефлективті: баяу, саналы.', False), ('И', 'Импульсивті: жылдам, автоматты.', True)]):
    y = 430 + j * 92
    kk = outline(box(g.shapes, 168, y, 64, 64, SIG if lit else KEY, rad=14), 'C8420B' if lit else '3F4148')
    kk.text_frame.vertical_anchor = MID; style(kk.text_frame, k, 24, SIG_INK if lit else G50, True, C)
    text(g.shapes, 256, y, 630, 64, t, 20, G50, True, anchor=MID)
add('left', g, 500, 600)
g = group(sl, 'Knutson'); well(g.shapes, 128, 660, 780, 270, rad=28)
led(g.shapes, 168, 702, SIG, 12); mono(g.shapes, 192, 694, 600, 30, 'fMRI · KNUTSON, 2007', 14, SIG)
text(g.shapes, 168, 740, 740, 170, 'Ми «аламын» деген саналы ойдан бұрын нақты шешімді болжайды. Алгоритмдер И жүйесін нысанаға алады.', 18, G50, spacing=1.15)
add('left', g, 900, 600)
add('fade', pic(sl.shapes, 'brain_big.png', 960, 340, 440, 440), 1200, 900)
for (lx, ly, col), (tx, ty, lab, d), dl in [((1253, 526, BAD), (1440, 400, 'INSULA', 'Баға тым қымбат көрінгенде белсенеді — ауырсыну орталығы'), 1900),
                                             ((1136, 607, OK), (960, 830, 'NUCLEUS ACCUMBENS', 'Тауар ұнағанда белсенеді — рахат орталығы'), 2500)]:
    s = led(sl.shapes, lx - 14, ly - 14, col, 28); add('zoom', s, dl, 400); add('pulse', s, dl + 450, 400)
    end = (tx - 12, ty + 16) if tx > lx else (lx - 40, ty - 6)
    ln, _ = curve(sl, [(lx, ly), end], G500, 1.2, dash=False); add('wipe', ln, dl + 200, 400, dir='left' if tx > lx else 'down')
    g = group(sl, lab)
    mono(g.shapes, tx, ty, 300, 30, lab, 14, col, True)
    text(g.shapes, tx, ty + 34, 830 if tx < 1200 else 352, 110, d, 17, G400, spacing=1.2)
    add('fade', g, dl + 400, 500)
finish(sl, '<p:fade/>')

# ── 6. Мәселені ашу: ұсыныс жүйелері ───────────────────────────────────────
sl = frame('Ұсыныс жүйелері')
head(sl, '05 · МӘСЕЛЕНІ АШУ · ЦИФРЛЫҚ ҚОЗҒАЛТҚЫШ', 'Ұсыныс жүйелері қалай істейді?')
for i, (h, q, minus) in enumerate([('Бірлескен сүзгілеу', '«Саған ұқсас адамдарға ұнағанды ұсынамын».', 'Жаңа қолданушыға жұмыс істемейді.'),
                                   ('Мазмұндық сүзгі', '«Сен көрген бейнеге ұқсастарды ұсынамын».', 'Бір шеңберде ұстап қалады.'),
                                   ('Терең оқыту', 'Жүздеген сигналды бір мезгілде өлшейді: TikTok, Instagram.', 'Күрделі қара жәшік.')]):
    x = 128 + i * 565
    g = group(sl, h); plate(g.shapes, x, 326, 533, 474, rad=28)
    mono(g.shapes, x + 40, 366, 100, 30, f'0{i + 1}', 16, G600, True)
    text(g.shapes, x + 40, 404, 470, 50, h, 23, G50, True)
    text(g.shapes, x + 40, 462, 460, 150, q, 19, G300, spacing=1.2)
    hline(g.shapes, x + 40, 626, 453, .08)
    led(g.shapes, x + 40, 650, BAD, 12); mono(g.shapes, x + 62, 642, 300, 30, 'КЕМШІЛІГІ', 13, BAD)
    text(g.shapes, x + 40, 682, 460, 100, minus, 18, G50, True, spacing=1.15)
    add('rise', g, 600 + i * 300, 550)
callout(sl, 832, 'Басты алгоритмдік валюта — лайк (саналы Р жүйесі) емес, экрандағы кідіріс пен көру уақыты (бақыланбайтын И жүйесі).', 1800, h=104, pt=20)
finish(sl, '<p:push dir="l"/>')

# ── 7. Таңдау эволюциясы ───────────────────────────────────────────────────
sl = frame('Таңдау эволюциясы')
head(sl, '06 · МӘСЕЛЕНІ АШУ · ТАҢДАУ ЭВОЛЮЦИЯСЫ', 'Классика мен алгоритм')
add('fade', mono(sl.shapes, 160, 320, 300, 30, 'КЕЗЕҢ', 13, G500), 400, 400)
add('fade', mono(sl.shapes, 460, 320, 500, 30, 'КЛАССИКАЛЫҚ МАРКЕТИНГ', 13, G500), 400, 400)
add('fade', led(sl.shapes, 1080, 328, SIG, 12), 400, 300)
add('fade', mono(sl.shapes, 1104, 320, 500, 30, 'АЛГОРИТМДІК ОРТА', 13, SIG), 400, 400)
for i, (st, cl, al) in enumerate([('Іздеу', 'Өзің іздейсің', 'Ұсынысты қабылдау: Netflix — 80%, YouTube — 70% контент'),
                                  ('Бағалау', 'Жиынтықты өзің құрайсың', 'Платформа іріктеген тар шеңбер (filter bubble)'),
                                  ('Шешім', 'Сыртқы кездейсоқтықтар', 'Басқарылатын жасанды стимул: «қорда 2 дана қалды»')]):
    y = 366 + i * 140
    g = group(sl, st); plate(g.shapes, 128, y, 1664, 124, rad=24)
    text(g.shapes, 160, y, 280, 124, st, 25, G50, True, anchor=MID)
    text(g.shapes, 460, y, 460, 124, cl, 20, G400, anchor=MID)
    text(g.shapes, 1080, y, 680, 124, al, 20, G50, True, anchor=MID, spacing=1.15)
    add('left', g, 700 + i * 350, 500)
    add('fade', chevron(sl.shapes, 990, y + 46), 1000 + i * 350, 300)
callout(sl, 820, 'Қорытынды: алгоритм таңдауды жеңілдетпейді — ол таңдау кеңістігінің архитектурасын толық ауыстырады.', 2000, h=110, pt=21)
finish(sl, '<p:fade/>')

# ── 8. Цифрлық ілмек ───────────────────────────────────────────────────────
sl = frame('Цифрлық ілмек')
head(sl, '07 · МӘСЕЛЕНІ АШУ · НЕГІЗГІ МОДЕЛЬ', '«Цифрлық ілмек» (The Digital Loop)')
CX, CY, RR = 960, 610, 250
add('fade', ring(sl.shapes, CX, CY, RR, G700, 2), 400, 600)
labels = ['1. Дерек жинау (кідіріс, скролл)', '2. Профиль құру (85% дәлдікпен болжау)', '3. Іріктеу (лентаға шығару)',
          '4. Эмоциялық түрткі (айнымалы сыйақы)', '5. Дофаминдік жауап', '6. Жаңа дерек']
for i, lab in enumerate(labels):
    a = math.radians(-90 + i * 60); nx, ny = CX + RR * math.cos(a), CY + RR * math.sin(a)
    lit = i == 4
    g = group(sl, lab)
    outline(box(g.shapes, nx - 30, ny - 30, 60, 60, SIG if lit else WELL, MSO_SHAPE.OVAL), 'C8420B' if lit else '3F4148')
    if not lit: led(g.shapes, nx - 7, ny - 7, G500, 14)
    if i == 0: text(g.shapes, CX - 400, ny - 82, 800, 40, lab, 19, G50, True, C)
    elif i == 3: text(g.shapes, CX - 500, ny + 40, 1000, 40, lab, 19, G50, True, C)
    elif nx > CX: text(g.shapes, nx + 50, ny - 30, 520, 60, lab, 19, SIG if lit else G50, True)
    else: text(g.shapes, nx - 570, ny - 30, 520, 60, lab, 19, SIG if lit else G50, True, R)
    add('zoom', g, 700 + i * 300, 400)
pts = [(CX + RR * math.cos(math.radians(-90 + k * 10)), CY + RR * math.sin(math.radians(-90 + k * 10))) for k in range(37)]
path = 'M 0 0 ' + ' '.join(f'L {(x - pts[0][0]) / 1920:.4f} {(y - pts[0][1]) / 1080:.4f}' for x, y in pts[1:])
dot = led(sl.shapes, pts[0][0] - 9, pts[0][1] - 9, SIG, 18)
add('fade', dot, 2600, 200); add('path', dot, 2600, 3000, path=path)
add('fade', text(sl.shapes, CX - 200, CY - 150, 400, 300, 'Түзу сызық өлді.\nБұл — дофаминмен қоректенетін жабық цикл.',
                 21, G400, True, C, MID, spacing=1.2), 2400, 700)
finish(sl, '<p:fade/>')

# ── 9. Біздің шешім: Affinix ───────────────────────────────────────────────
sl = frame('Шешім')
head(sl, '08 · БІЗДІҢ ШЕШІМ · AFFINIX', 'Таңдауды ашық өлшеу')
for side, (x, lab, t, col, on) in enumerate([(128, 'АЛГОРИТМ', 'Таңдауды жасырын өлшейді — сізді ұстап қалу үшін.', BAD, False),
                                             (972, 'AFFINIX', 'Таңдауды ашық өлшейді — дизайнды жақсарту үшін.', SIG, True)]):
    g = group(sl, lab)
    (plate(g.shapes, x, 316, 820, 150, rad=24, ln='7A3510') if on else well(g.shapes, x, 316, 820, 150, rad=24))
    led(g.shapes, x + 36, 344, col, 12); mono(g.shapes, x + 58, 336, 300, 30, lab, 13, col)
    text(g.shapes, x + 36, 370, 760, 84, t, 19, G50, True, spacing=1.15)
    add('left' if side == 0 else 'right', g, 500 + side * 300, 500)
for i, (ic, h, d) in enumerate([('ab', 'Нұсқалар', 'A, B, C, D: логотип, қаптама, жарнама'),
                                ('duel', 'Дуэль', 'Екі нұсқа — бір жылдам таңдау'),
                                ('clock', 'Уақыт', 'Не таңдады және қаншалық жылдам'),
                                ('verdict', 'Үкім', 'Жеңімпаз тек сенім аралығымен')]):
    x = 128 + i * 424
    g = group(sl, h); plate(g.shapes, x, 500, 392, 326, rad=28)
    icon_well(g.shapes, ic, x + 32, 528, 80)
    mono(g.shapes, x + 250, 540, 110, 50, f'0{i + 1}', 24, G600, True, R)
    text(g.shapes, x + 32, 634, 330, 50, h, 26, G50, True)
    text(g.shapes, x + 32, 692, 330, 120, d, 18, G400, spacing=1.2)
    add('rise', g, 1100 + i * 280, 500)
    if i < 3: add('fade', chevron(sl.shapes, x + 398, 646), 1300 + i * 280, 300)
add('fade', mono(sl.shapes, 128, 870, 1664, 40, 'ЖҰПТЫҚ САЛЫСТЫРУ · РЕАКЦИЯ УАҚЫТЫ · УИЛСОН СЕНІМ АРАЛЫҒЫ · n ≥ 30', 14, G500, align=C), 2400, 500)
finish(sl, '<p:wipe dir="r"/>')

# ── 10. Арена ──────────────────────────────────────────────────────────────
sl = frame('Арена')
head(sl, '09 · АРЕНА', 'Зерттеу — ойын ретінде')
add('rise', pic(sl.shapes, 'phone-arena.kk.png', 170, 290, 330, 330 * 1748 / 864), 500, 700)
for i, (ic, h, d) in enumerate([('duel', 'Дуэль A / B', 'XP, деңгей, күнделікті серия'),
                                ('dna', 'Талғам ДНК-сы', '7 ось бойынша талғам бейіні'),
                                ('eye', 'Көз тесті', 'Дұрыс жауап — WCAG контраст есебі'),
                                ('clock', 'Адал сағат', 'Уақыт тек күн сынағында жүреді')]):
    x, y = 600 + (i % 2) * 604, 330 + (i // 2) * 310
    g = group(sl, h); plate(g.shapes, x, y, 584, 286, rad=28)
    icon_well(g.shapes, ic, x + 36, y + 36, 88)
    text(g.shapes, x + 36, y + 150, 520, 50, h, 26, G50, True)
    text(g.shapes, x + 36, y + 204, 520, 60, d, 18, G400)
    add('rise', g, 800 + i * 250, 500)
finish(sl, '<p:push dir="l"/>')

# ── 11. Ұсыныс ─────────────────────────────────────────────────────────────
sl = frame('Ұсыныс')
head(sl, '10 · ҰСЫНЫС', 'Нарыққа дейін — тексеріңіз')
for i, (h, d) in enumerate([('Нұсқаңызды жүктеңіз', '2–4 логотип, постер, ат немесе ұран'),
                            ('Көпшілік таңдайды', 'Арена ойыншылары — миссия ретінде'),
                            ('Үкім аласыз', 'Жеңімпаз + сенім аралығы')]):
    y = 340 + i * 150
    g = group(sl, h)
    mono(g.shapes, 128, y, 120, 70, f'0{i + 1}', 40, SIG, True)
    text(g.shapes, 262, y + 2, 700, 50, h, 28, G50, True)
    text(g.shapes, 262, y + 60, 740, 40, d, 19, G400)
    add('left', g, 600 + i * 300, 500)
g = group(sl, 'Үлгі'); plate(g.shapes, 1040, 330, 752, 440, rad=32)
led(g.shapes, 1084, 382, 'FBBF24', 12); mono(g.shapes, 1106, 374, 400, 30, 'ҮЛГІ КӨРІНІС', 13, G400)
text(g.shapes, 1084, 430, 660, 50, 'Қай логотип жақсы?', 26, G50, True)
for j in range(2):
    yy = 520 + j * 110
    k = outline(box(g.shapes, 1084, yy, 64, 64, KEY, rad=14), '3F4148'); k.text_frame.vertical_anchor = MID
    style(k.text_frame, 'AB'[j], 22, G50, True, C)
    well(g.shapes, 1170, yy + 12, 520, 40, rad=20)
add('rise', g, 800, 600)
for j, (w, col) in enumerate([(500, SIG), (270, STEEL)]):
    add('wipe', box(sl.shapes, 1180, 532 + 10 + j * 110, w, 20, col, rad=10), 1500 + j * 250, 700)
g = group(sl, 'Жеңімпаз'); led(g.shapes, 1710, 540, OK, 28)
add('zoom', g, 2300, 400); add('pulse', g, 2750, 400)
add('wipe', hline(sl.shapes, 128, 822, 1664), 2900, 500)
add('rise', rich(sl.shapes, 128, 846, 1664, 90, [('Сезіммен емес — дерекпен', 'Rubik', G50), ('.', 'Rubik', SIG)], 46, align=C), 3100, 600)
finish(sl, '<p:fade/>')

# ── 12. Қорытынды ──────────────────────────────────────────────────────────
sl = frame('Қорытынды')
add('zoom', led(sl.shapes, 128, 132, SIG, 14), 0, 300)
add('fade', mono(sl.shapes, 156, 124, 1500, 34, '11 · ҚОРЫТЫНДЫ · ТАҢДАУ АВТОРЫ БОЛЫП ҚАЛУ', 15, G400), 80, 400)
add('fade', rich(sl.shapes, 200, 250, 1520, 520,
                 [('Алгоритмдер бізді мәжбүрлемейді. Олар тек таңдау жасалатын кеңістіктің ', 'Rubik', G50),
                  ('архитектурасын', 'Rubik', SIG), (' құрастырады. Осыны түсінсеңіз — сіз өз таңдауыңыздың ', 'Rubik', G50),
                  ('авторы', 'Rubik', SIG), (' болып қаласыз.', 'Rubik', G50)], 38, bold=False, align=C, spacing=1.25, anchor=MID), 400, 1400)
add('wipe', hline(sl.shapes, 760, 820, 400, .12), 1900, 500)
g = group(sl, 'Рақмет'); pic(g.shapes, 'symbol.png', 838, 852, 56)
text(g.shapes, 912, 850, 300, 60, 'Рақмет!', 34, G50, True, anchor=MID)
add('rise', g, 2200, 500)
finish(sl, '<p:fade/>')

assert S['n'] == S['total']
save('neuromarketing.pptx')
