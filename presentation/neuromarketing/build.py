"""Нейромаркетинг және цифрлық алгоритмдер · Affinix — 6 слайд, Affinix «Instrument» стилі, нативті PPT анимациясы.
Негізгі 6 (жюри_баяндама.txt): титул, нейромаркетинг және ми, ПРОБЛЕМА, шешім (Affinix), ҚАУІПСІЗДІК, қорытынды + сайтқа QR.
Арена слайдсыз, сайтта тікелей көрсетіледі.
Түстер styles.css-тен: графит фон, күңгірт пластиналар, бір сигнал түсі (#ff6a1f), LED нүктелер, сандар mono."""
import math
from deckkit import *

SIG, SIG_INK = 'FF6A1F', '1D0D04'
G50, G300, G400, G500, G600, G700, G800 = 'F5F5F6', 'C3C5CB', 'A2A5AE', '868993', '565963', '3A3C43', '26282D'
PLATE, PLATE_LN, WELL, WELL_LN, KEY = '1A1B1E', '2B2C31', '09090B', '000000', '2C2E34'
OK, BAD, INFO, STEEL = '34D399', 'FB7185', '86A5D9', '668BC9'
MONO = 'JetBrains Mono'
N = 6       # all slides in the file
MAIN = 6
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
    if i <= MAIN:
        mono(sl.shapes, 128, 996, 900, 30, f'{i:02d} / {MAIN:02d}   {label.upper()}', 12, G500)
        for j in range(MAIN):
            led(sl.shapes, 1792 - (MAIN - j) * 26 + 14, 1002, SIG if j == i - 1 else (G600 if j < i - 1 else G800), 12)
    else:
        mono(sl.shapes, 128, 996, 900, 30, f'РЕЗЕРВ   {label.upper().replace("РЕЗЕРВ · ", "")}', 12, G500)
    return sl


def head(sl, eyebrow, title, pt=42):
    add('zoom', led(sl.shapes, 128, 132, SIG, 14), 0, 300)
    add('fade', mono(sl.shapes, 156, 124, 1500, 34, eyebrow, 15, G400), 80, 400)
    t = title if isinstance(title, list) else [(title, 'Rubik', G50)]
    add('rise', rich(sl.shapes, 126, 168, 1660, 100, t, pt), 200, 500)


# ── 1. Титул · тірек сөздер ────────────────────────────────────────────────
sl = new('cover', 'Титул', chrome=False)
g = group(sl, 'Логотип'); pic(g.shapes, 'symbol.png', 128, 104, 64); text(g.shapes, 208, 104, 400, 64, 'Affinix', 34, G50, True, anchor=MID)
add('fade', g, 0, 500)
add('fade', led(sl.shapes, 128, 330, SIG, 14), 200, 300)
add('fade', mono(sl.shapes, 156, 322, 820, 34, 'ЭКОНОМИКА ЖӘНЕ МАРКЕТИНГ СЕКЦИЯСЫ · ҒЫЛЫМИ ЖОБА', 13, G400), 250, 400)
add('rise', text(sl.shapes, 124, 370, 900, 300, 'Нейромаркетинг\nжәне цифрлық\nалгоритмдер', 46, G50, True, spacing=1.05), 300, 600)
add('rise', rich(sl.shapes, 128, 730, 840, 160, [('Әлеуметтік желілер адам ', 'Rubik', G400), ('таңдауын', 'Rubik', SIG),
                                                  (' қалай басқарады?', 'Rubik', G400)], 30, bold=False, spacing=1.2), 600, 600)
add('fade', mono(sl.shapes, 128, 980, 900, 30, 'НҰРЛАН  ·  ӘМИНА  ·  2026', 13, G600), 1300, 500)

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
add('pulse', rt, 2500, 450)
finish(sl, '<p:fade/>')

# ── 5. Жәшікті ашу: нейромаркетинг және ми ─────────────────────────────────
sl = frame('Жәшікті ашу')
head(sl, 'ЖӘШІКТІ АШУ', 'Нейромаркетинг және ми')
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

# ── Проблема ───────────────────────────────────────────────────────────────
sl = frame('Проблема')
head(sl, 'ПРОБЛЕМА · МАРКЕТОЛОГ ПЕН ДИЗАЙНЕР', 'Дизайнды кім шешеді?')
for i, (ic, h, d, col) in enumerate([('people', 'Бірнеше адамның пікірі', 'Дизайнды аз адамның талғамы шешеді.', SIG),
                                     ('ask', 'Көпшілікке ұнамауы мүмкін', 'Көпшілік не таңдайтыны белгісіз.', STEEL),
                                     ('chart', 'Сатылым төмендейді', 'Ұнамаған дизайн сатылмайды.', BAD)]):
    x = 128 + i * 572
    g = group(sl, h); plate(g.shapes, x, 316, 520, 420, rad=30)
    icon_well(g.shapes, ic, x + 36, 352, 88)
    led(g.shapes, x + 150, 382, col, 14); mono(g.shapes, x + 176, 374, 300, 30, f'0{i + 1}', 15, G500)
    text(g.shapes, x + 36, 470, 450, 120, h, 26, G50, True, spacing=1.1)
    text(g.shapes, x + 36, 610, 450, 100, d, 20, G400, spacing=1.2)
    add('rise', g, 600 + i * 400, 550)
    if i < 2: add('fade', chevron(sl.shapes, x + 530, 510), 900 + i * 400, 300)
callout(sl, 784, 'Фокус-топ, сауалнама, ЭЭГ — қымбат әрі баяу. Сондықтан шешімді дерек емес, сезім анықтайды.', 2000, h=116, color=BAD, pt=21)
finish(sl, '<p:push dir="l"/>')

# ── 9. Біздің шешім: Affinix ───────────────────────────────────────────────
sl = frame('Шешім')
head(sl, 'БІЗДІҢ ШЕШІМ · AFFINIX', 'Таңдауды ашық өлшеу')
for side, (x, lab, t, col, on) in enumerate([(128, 'АЛГОРИТМ', 'Жасырын өлшейді, ұстап қалады', BAD, False),
                                             (972, 'AFFINIX', 'Ашық өлшейді, дизайнды жақсартады', SIG, True)]):
    g = group(sl, lab)
    (plate(g.shapes, x, 316, 820, 140, rad=24, ln='7A3510') if on else well(g.shapes, x, 316, 820, 140, rad=24))
    led(g.shapes, x + 36, 346, col, 12); mono(g.shapes, x + 58, 338, 300, 30, lab, 13, col)
    text(g.shapes, x + 36, 380, 760, 56, t, 18, G50, True, spacing=1.1)
    add('left' if side == 0 else 'right', g, 500 + side * 300, 500)
for i, (ic, h, d) in enumerate([('ab', 'Нұсқалар', 'Логотип, қаптама'),
                                ('duel', 'Дуэль', 'Екеуінің бірі'),
                                ('clock', 'Уақыт', 'Қанша секундта'),
                                ('verdict', 'Үкім', 'Сенім аралығымен')]):
    x = 128 + i * 424
    g = group(sl, h); plate(g.shapes, x, 492, 392, 330, rad=28)
    icon_well(g.shapes, ic, x + 32, 524, 80)
    mono(g.shapes, x + 250, 536, 110, 50, f'0{i + 1}', 24, G600, True, R)
    text(g.shapes, x + 32, 636, 330, 56, h, 28, G50, True)
    text(g.shapes, x + 32, 708, 340, 90, d, 18, G400, spacing=1.2)
    add('rise', g, 1100 + i * 280, 500)
    if i < 3: add('fade', chevron(sl.shapes, x + 398, 646), 1300 + i * 280, 300)
add('fade', mono(sl.shapes, 128, 872, 1664, 40, 'ЖҰПТЫҚ САЛЫСТЫРУ · РЕАКЦИЯ УАҚЫТЫ · УИЛСОН СЕНІМ АРАЛЫҒЫ · n ≥ 30', 14, G500, align=C), 2400, 500)
finish(sl, '<p:wipe dir="r"/>')

# ── Қауіпсіздік ────────────────────────────────────────────────────────────
sl = frame('Қауіпсіздік')
head(sl, 'ҚАУІПСІЗДІК', 'Аз дерек, сервер есебі, ашық шектеу')
items = [('shield', 'Аз дерек', 'Камера, биометрия жоқ'),
         ('eye', 'Тек өз дерегің', 'Бөтеннің жолы жабық'),
         ('gear', 'Сервер санайды', 'Браузер жалғандай алмайды'),
         ('book', 'Есеп өзгермейді', 'Жазбаны өшіруге болмайды'),
         ('clip', 'Әкімші журналы', 'Әр әрекет жазылады'),
         ('money', 'Шот сақталмайды', 'Банкке шығару өшірулі')]
for i, (ic, h, d) in enumerate(items):
    x, y = 128 + (i % 3) * 565, 316 + (i // 3) * 222
    g = group(sl, h); plate(g.shapes, x, y, 533, 200, rad=28)
    icon_well(g.shapes, ic, x + 30, y + 30, 72)
    text(g.shapes, x + 118, y + 30, 404, 72, h, 21, G50, True, anchor=MID, spacing=1.05)
    text(g.shapes, x + 30, y + 126, 480, 50, d, 17, G400, spacing=1.2)
    add('rise', g, 500 + i * 220, 500)
callout(sl, 784, 'Ашық айтамыз: сыртқы аудит әлі жоқ. Дерекқорда 500-ден астам автоматты тексеру бар.', 2100, h=116, color=STEEL, pt=21)
finish(sl, '<p:fade/>')

# ── 6. Қорытынды + сайтқа QR ──────────────────────────────────────────────
sl = frame('Қорытынды')
add('zoom', led(sl.shapes, 128, 132, SIG, 14), 0, 300)
add('fade', mono(sl.shapes, 156, 124, 1000, 34, 'ҚОРЫТЫНДЫ · ТАҢДАУ АВТОРЫ БОЛЫП ҚАЛУ', 15, G400), 80, 400)
add('fade', rich(sl.shapes, 128, 236, 1020, 500,
                 [('Алгоритмдер бізді мәжбүрлемейді. Олар тек таңдау жасалатын кеңістіктің ', 'Rubik', G50),
                  ('архитектурасын', 'Rubik', SIG), (' құрастырады. Осыны түсінсеңіз — сіз өз таңдауыңыздың ', 'Rubik', G50),
                  ('авторы', 'Rubik', SIG), (' болып қаласыз.', 'Rubik', G50)], 30, bold=False, align=L, spacing=1.25, anchor=MID), 400, 1400)
add('wipe', hline(sl.shapes, 128, 790, 520, .12), 1700, 500)
g = group(sl, 'Рақмет'); pic(g.shapes, 'symbol.png', 128, 826, 56)
text(g.shapes, 200, 824, 420, 60, 'Рақмет!', 34, G50, True, anchor=MID)
add('rise', g, 1900, 500)
# the QR code: points a phone camera at https://affinix.space
g = group(sl, 'QR')
plate(g.shapes, 1252, 176, 540, 744, rad=32)
well(g.shapes, 1300, 224, 444, 444, rad=24)
pic(g.shapes, 'qr.png', 1322, 246, 400)
mono(g.shapes, 1252, 700, 540, 44, 'AFFINIX.SPACE', 30, SIG, True, C)
text(g.shapes, 1292, 760, 460, 130, 'Камераны бағыттаңыз — сайт ашылады. Бір дуэль ойнап көріңіз!', 19, G300, False, C, spacing=1.2)
add('zoom', g, 1000, 650)
finish(sl, '<p:fade/>')

assert S['n'] == S['total']
save('neuromarketing.pptx')
