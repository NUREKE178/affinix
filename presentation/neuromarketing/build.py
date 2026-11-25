"""Нейромаркетинг · Affinix — 10 слайд, Affinix «Instrument» стилі, нативті PPT анимациясы.
Түстер styles.css-тен: графит фон, күңгірт пластиналар, бір сигнал түсі (#ff6a1f), LED нүктелер, сандар mono."""
from deckkit import *

SIG, SIG_INK = 'FF6A1F', '1D0D04'
G50, G300, G400, G500, G600, G700, G800 = 'F5F5F6', 'C3C5CB', 'A2A5AE', '868993', '565963', '3A3C43', '26282D'
PLATE, PLATE_LN, WELL, WELL_LN, KEY = '1A1B1E', '2B2C31', '09090B', '000000', '2C2E34'
OK, BAD, INFO, STEEL = '34D399', 'FB7185', '86A5D9', '668BC9'
MONO = 'JetBrains Mono'
N = 10
init(dict(font='Rubik', on_bg=G50, on_bg_soft=G400, accent=SIG, accent_ink=SIG_INK,
          card=PLATE, ink=G50, mute=G400, primary=SIG, dot=SIG), total=N)


def mono(*a, **k):
    old = T['font']; T['font'] = MONO
    try: return text(*a, **k)
    finally: T['font'] = old


def rich(c, x, y, w, h, parts, pt, bold=True, align=L):
    s = c.add_textbox(e(x), e(y), e(w), e(h)); tf = s.text_frame; tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    p = tf.paragraphs[0]; p.alignment = align
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


def icon_well(c, ic, x, y, s=96, col='sig'):
    well(c, x, y, s, s, rad=22); k = s * .56
    pic(c, f'assets/{ic}_{col}.png', x + (s - k) / 2, y + (s - k) / 2, k)


def key(c, cx, cy, t, lit=False, pt=18, h=64):
    w = len(t) * pt * 1.15 + 72
    s = outline(box(c, cx - w / 2, cy - h / 2, w, h, SIG if lit else KEY, rad=16), 'C8420B' if lit else '3F4148')
    s.text_frame.vertical_anchor = MID
    style(s.text_frame, t, pt, SIG_INK if lit else G50, True, C); return s


def frame(label):
    sl = new('base', label, chrome=False)
    pic(sl.shapes, 'symbol.png', 128, 44, 34)
    text(sl.shapes, 172, 44, 300, 40, 'Affinix', 18, G50, True)
    mono(sl.shapes, 1092, 52, 700, 30, 'НЕЙРОМАРКЕТИНГ', 12, G500, align=R)
    box(sl.shapes, 128, 976, 1664, 1, 'FFFFFF', kind=MSO_SHAPE.RECTANGLE, alpha=.07)
    i = S['n']
    mono(sl.shapes, 128, 996, 900, 30, f'{i:02d} / {N:02d}   {label.upper()}', 12, G500)
    for j in range(N):
        led(sl.shapes, 1792 - (N - j) * 26 + 14, 1002, SIG if j == i - 1 else (G600 if j < i - 1 else G800), 12)
    return sl


def head(sl, eyebrow, title):
    add('zoom', led(sl.shapes, 128, 132, SIG, 14), 0, 300)
    add('fade', mono(sl.shapes, 156, 124, 1400, 34, eyebrow, 15, G400), 80, 400)
    t = title if isinstance(title, list) else [(title, 'Rubik', G50)]
    add('rise', rich(sl.shapes, 126, 168, 1660, 100, t, 42), 200, 500)


# ── 1. Тірек сөздер ────────────────────────────────────────────────────────
sl = new('cover', 'Тірек сөздер', chrome=False)
add('fade', pic(sl.shapes, 'logo.png', 128, 96, 260, 260 * 322 / 1114), 0, 500)
add('fade', led(sl.shapes, 128, 352, SIG, 14), 200, 300)
add('fade', mono(sl.shapes, 156, 344, 800, 34, 'ҒЫЛЫМИ ЖОБА · 2026', 15, G400), 250, 400)
add('rise', text(sl.shapes, 120, 392, 900, 130, 'Нейро', 76, G50, True), 300, 550)
add('rise', rich(sl.shapes, 120, 500, 900, 130, [('маркетинг', 'Rubik', G50), ('.', 'Rubik', SIG)], 76), 450, 550)
add('rise', text(sl.shapes, 128, 690, 860, 120, 'Адам не айтатынын емес —\nнені таңдайтынын өлшейміз.', 24, G400, spacing=1.25), 900, 600)
add('fade', mono(sl.shapes, 128, 980, 900, 30, '[АТЫ-ЖӨНІ]  ·  [МЕКТЕП / СЫНЫП]', 13, G600), 1300, 500)

add('fade', plate(sl.shapes, 1010, 120, 790, 840, rad=36), 300, 600)
add('fade', mono(sl.shapes, 1056, 160, 700, 30, 'ТІРЕК СӨЗДЕР', 13, G500), 500, 400)
P = {'tan': (1190, 300), 'emo': (1600, 270), 'rt': (1420, 520), 'ab': (1180, 720),
     'pair': (1500, 850), 'data': (1660, 640)}
for a, b in [('tan', 'rt'), ('emo', 'rt'), ('rt', 'ab'), ('rt', 'pair'), ('rt', 'data'),
             ('tan', 'ab'), ('pair', 'data'), ('emo', 'data'), ('tan', 'emo'), ('ab', 'pair')]:
    ln, _ = curve(sl, [P[a], P[b]], G700, 1.5, dash=False); add('fade', ln, 700, 900)
for i, (k, t) in enumerate([('rt', 'Реакция уақыты'), ('tan', 'Таңдау'), ('emo', 'Эмоция'),
                            ('data', 'Дерек'), ('ab', 'A / B тест'), ('pair', 'Жұптық салыстыру')]):
    s = key(sl.shapes, *P[k], t, lit=(k == 'rt'), pt=20 if k == 'rt' else 17)
    add('zoom', s, 900 + i * 200, 400)
    if k == 'rt': rt = s
path = 'M 0 0 ' + ' '.join(f'L {(x - P["tan"][0]) / 1920:.4f} {(y - P["tan"][1]) / 1080:.4f}' for x, y in [P['rt'], P['pair']])
dot = led(sl.shapes, P['tan'][0] - 9, P['tan'][1] - 9, SIG, 18)
add('fade', dot, 2200, 200); add('path', dot, 2200, 1800, path=path)
add('pulse', rt, 2500, 450)
finish(sl, '<p:fade/>')

# ── 2. Нейромаркетинг деген не ─────────────────────────────────────────────
sl = frame('Анықтама')
head(sl, '01 · АНЫҚТАМА', 'Нейромаркетинг деген не?')
add('rise', text(sl.shapes, 128, 340, 780, 160, 'Адам шешімді жылдам,\nсезіммен қабылдайды.', 30, G50, True, spacing=1.15), 500, 600)
add('rise', text(sl.shapes, 128, 530, 760, 200, 'Нейромаркетинг — осы сәтті өлшейтін ғылым: адам не айтады емес, не таңдайды.', 22, G400, spacing=1.3), 750, 600)
for i, (ic, h, d, tag, on) in enumerate([('brain', 'ЭЭГ', 'Ми белсенділігі', 'ЗЕРТХАНА', False),
                                         ('eye', 'Айтрекинг', 'Көз қайда қарайды', 'ЗЕРТХАНА', False),
                                         ('clock', 'Реакция уақыты', 'Таңдау жылдамдығы', 'AFFINIX', True)]):
    y = 330 + i * 200
    g = group(sl, h); plate(g.shapes, 980, y, 812, 172, rad=26, ln=('7A3510' if on else PLATE_LN))
    icon_well(g.shapes, ic, 1018, y + 38, 96, 'sig' if on else 'mut')
    text(g.shapes, 1146, y + 40, 444, 50, h, 24, G50, True)
    text(g.shapes, 1146, y + 94, 444, 40, d, 18, G400)
    led(g.shapes, 1600, y + 79, SIG if on else G600, 14)
    mono(g.shapes, 1624, y + 72, 150, 30, tag, 13, SIG if on else G500)
    add('right', g, 900 + i * 300, 550)
finish(sl, '<p:fade/>')

# ── 3. Мәселе: айтқаны ≠ таңдағаны ─────────────────────────────────────────
sl = frame('Мәселе')
head(sl, '02 · МӘСЕЛЕ', [('Айтқаны ', 'Rubik', G50), ('≠', MONO, SIG), (' таңдағаны', 'Rubik', G50)])
for side, (x, lab, big, sub, ic, on) in enumerate([(128, 'АЙТАДЫ', '«Маған B ұнайды»', 'Сауалнама, фокус-топ', 'chat', False),
                                                   (1052, 'ТАҢДАЙДЫ', 'Сатып алады — A', 'Жылдам. Эмоциямен. Ойланбай.', 'target', True)]):
    g = group(sl, lab); plate(g.shapes, x, 340, 740, 460, rad=32, ln=('7A3510' if on else PLATE_LN))
    icon_well(g.shapes, ic, x + 48, 388, 96, 'sig' if on else 'mut')
    led(g.shapes, x + 176, 428, SIG if on else INFO, 14)
    mono(g.shapes, x + 202, 420, 400, 34, lab, 16, G400)
    text(g.shapes, x + 48, 560, 660, 90, big, 32, G50, True)
    text(g.shapes, x + 48, 660, 660, 50, sub, 20, G400)
    add('left' if side == 0 else 'right', g, 600 + side * 300, 600)
g = group(sl, 'Тең емес')
outline(box(g.shapes, 885, 495, 150, 150, WELL, MSO_SHAPE.OVAL), '3F4148')
mono(g.shapes, 885, 495, 150, 150, '≠', 64, SIG, True, C, MID)
add('zoom', g, 1400, 450); add('pulse', g, 1900, 400)
add('fade', text(sl.shapes, 128, 850, 1664, 60, 'Сауалнама сөзді өлшейді. Ал сатып алуды таңдау шешеді.', 24, G400, align=C), 2200, 600)
finish(sl, '<p:push dir="l"/>')

# ── 4. Мәселе: зерттеу қымбат ──────────────────────────────────────────────
sl = frame('Мәселе')
head(sl, '02 · МӘСЕЛЕ', '«Маған ұнайды» — дерек емес')
for i, (ic, lab, big, sub) in enumerate([('money', 'ФОКУС-ТОП', 'Қымбат әрі баяу', 'Аз адамды қамтиды'),
                                         ('survey', 'САУАЛНАМА', '5 минутта кетеді', 'Дерек аз әрі сапасыз'),
                                         ('flask', 'ЭЭГ · АЙТРЕКИНГ', 'Тек зертханада', 'Арнайы құрал керек')]):
    x = 128 + i * 565
    g = group(sl, lab); well(g.shapes, x, 340, 533, 420, rad=28)
    icon_well(g.shapes, ic, x + 40, 380, 96, 'mut')
    led(g.shapes, x + 40, 532, BAD, 14); mono(g.shapes, x + 66, 524, 440, 30, lab, 14, G400)
    text(g.shapes, x + 40, 576, 470, 70, big, 25, G50, True)
    text(g.shapes, x + 40, 650, 470, 50, sub, 19, G400)
    add('rise', g, 600 + i * 300, 550)
add('wipe', box(sl.shapes, 128, 822, 1664, 1, 'FFFFFF', kind=MSO_SHAPE.RECTANGLE, alpha=.1), 1700, 500)
add('rise', text(sl.shapes, 128, 850, 1664, 70, 'Нәтижесінде шешімді дерек емес, сезім анықтайды.', 26, G50, True, C), 1900, 600)
finish(sl, '<p:fade/>')

# ── 5. Мақсат және гипотеза ────────────────────────────────────────────────
sl = frame('Мақсат')
head(sl, '03 · МАҚСАТ', 'Мақсат және гипотеза')
g = group(sl, 'Мақсат'); plate(g.shapes, 128, 340, 800, 560, rad=32)
icon_well(g.shapes, 'target', 176, 388, 96)
mono(g.shapes, 300, 420, 400, 34, 'МАҚСАТ', 16, SIG)
text(g.shapes, 176, 540, 710, 300, 'Дизайнды адамдардың нақты таңдауымен ғылыми бағалайтын платформа жасау.', 28, G50, True, spacing=1.2)
add('left', g, 600, 600)
g = group(sl, 'Гипотеза'); well(g.shapes, 992, 340, 800, 560, rad=32)
mono(g.shapes, 1040, 388, 400, 34, 'ГИПОТЕЗА', 16, G400)
for j, t in enumerate(['Ойын форматы қатысу уақытын ұзартады.', 'Жұптық таңдау дизайнды бағалауға жарайды.']):
    y = 460 + j * 160
    mono(g.shapes, 1040, y, 80, 50, f'0{j + 1}', 24, SIG, True)
    text(g.shapes, 1130, y, 630, 120, t, 24, G50, True, spacing=1.2)
led(g.shapes, 1040, 860, INFO, 12); mono(g.shapes, 1062, 852, 700, 30, 'ТЕКСЕРУ: БЕЛСЕНДІ УАҚЫТ КҮН САЙЫН ЖАЗЫЛАДЫ', 13, G500)
add('right', g, 900, 600)
finish(sl, '<p:fade/>')

# ── 6. Шешім ───────────────────────────────────────────────────────────────
sl = frame('Шешім')
head(sl, '04 · БІЗДІҢ ШЕШІМ', 'Сұрамаймыз — таңдатамыз')
for i, (ic, h, d) in enumerate([('ab', 'Нұсқалар', 'A, B, C, D:\nлоготип, қаптама,\nжарнама'),
                                ('duel', 'Дуэль', 'Екі нұсқа —\nбір жылдам\nтаңдау'),
                                ('clock', 'Уақыт', 'Не таңдады және\nқаншалық жылдам'),
                                ('verdict', 'Үкім', 'Уилсон сенім\nаралығы, n ≥ 30')]):
    x = 128 + i * 424
    g = group(sl, h); plate(g.shapes, x, 330, 392, 420, rad=28)
    icon_well(g.shapes, ic, x + 36, 366, 96)
    mono(g.shapes, x + 250, 380, 106, 50, f'0{i + 1}', 26, G600, True, R)
    text(g.shapes, x + 36, 500, 330, 60, h, 28, G50, True)
    s = text(g.shapes, x + 36, 568, 330, 170, d, 18, G400, spacing=1.2)
    add('rise', g, 600 + i * 300, 500)
    if i < 3:
        a = sl.shapes.add_shape(MSO_SHAPE.CHEVRON, e(x + 392 + 6), e(524), e(20), e(32))
        a.fill.solid(); a.fill.fore_color.rgb = rgb(SIG); a.line.fill.background(); add('fade', a, 800 + i * 300, 300)
for r in s.text_frame.paragraphs[1].runs: r.font.name = MONO   # «n ≥ 30» mono
g = group(sl, 'Осциллограф'); well(g.shapes, 128, 782, 1664, 170, rad=24)
led(g.shapes, 160, 808, SIG, 12); mono(g.shapes, 182, 800, 700, 30, 'РЕАКЦИЯ УАҚЫТЫ · МС', 13, G400)
add('fade', g, 1800, 400)
pts = [(176, 900), (620, 900), (660, 858), (710, 942), (760, 868), (790, 900), (1100, 900), (1140, 846),
       (1190, 942), (1235, 870), (1265, 900), (1744, 900)]
ln, path = curve(sl, pts, SIG, 2.5, dash=False); add('wipe', ln, 2000, 1100, dir='left')
dot = led(sl.shapes, 176 - 9, 900 - 9, G50, 18)
add('fade', dot, 2000, 200); add('path', dot, 2000, 2200, path=path)
finish(sl, '<p:wipe dir="r"/>')

# ── 7. Арена ───────────────────────────────────────────────────────────────
sl = frame('Арена')
head(sl, '05 · АРЕНА', 'Зерттеу — ойын ретінде')
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

# ── 8. Ғылыми негіз ────────────────────────────────────────────────────────
sl = frame('Әдістеме')
head(sl, '06 · ӘДІСТЕМЕ', 'Ғылыми негіз')
for i, (v, h, d) in enumerate([('1927', 'Жұптық салыстыру', 'Терстоун: екеуінен таңдау'),
                               ('Wilson', 'Сенім аралығы', 'Шағын үлгіде де адал баға'),
                               ('n ≥ 30', 'Минимум үлгі', 'Одан аз болса — «әлі ерте»'),
                               ('A ↔ B', 'Кездейсоқ рет', 'Реттің ығысуы азаяды')]):
    x = 128 + i * 424
    g = group(sl, h); plate(g.shapes, x, 340, 392, 466, rad=28)
    led(g.shapes, x + 36, 384, OK, 12)
    mono(g.shapes, x + 36, 420, 340, 90, v, 46, G50, True)
    box(g.shapes, x + 36, 540, 320, 1, 'FFFFFF', kind=MSO_SHAPE.RECTANGLE, alpha=.1)
    text(g.shapes, x + 36, 562, 330, 100, h, 22, G50, True, spacing=1.1)
    text(g.shapes, x + 36, 668, 330, 130, d, 17, G400, spacing=1.2)
    add('rise', g, 600 + i * 280, 500)
g = group(sl, 'Мінез-құлық'); well(g.shapes, 128, 840, 1664, 96, rad=24)
led(g.shapes, 168, 882, SIG, 12)
text(g.shapes, 196, 840, 1560, 96, 'Мінез-құлық дерегі: не таңдағаны және қанша уақытта таңдағаны жазылады.', 21, G50, True, anchor=MID)
add('rise', g, 1900, 500)
finish(sl, '<p:fade/>')

# ── 9. Дәлелдер ────────────────────────────────────────────────────────────
sl = frame('Дәлел')
head(sl, '07 · ДӘЛЕЛ', 'Тексерілген: сандар нақты')
for i, (v, h) in enumerate([('104', 'SQL тексеру — бәрі өтті'), ('1\u00a0598', 'JS пен SQL салыстыру · 0 алшақтық'),
                            ('109', 'браузер тексеруі · 0 қате'), ('3', 'тіл: қазақша, орысша, ағылшынша')]):
    x, y = 128 + (i % 2) * 842, 330 + (i // 2) * 270
    g = group(sl, h); plate(g.shapes, x, y, 822, 250, rad=28)
    led(g.shapes, x + 40, y + 44, OK, 12); mono(g.shapes, x + 64, y + 36, 300, 30, 'ӨТТІ' if i < 3 else 'ДАЙЫН', 13, OK)
    mono(g.shapes, x + 40, y + 84, 420, 120, v, 60, G50, True)
    text(g.shapes, x + 470, y + 84, 320, 130, h, 22, G400, anchor=MID, spacing=1.2)
    add('zoom' if i == 0 else 'rise', g, 600 + i * 250, 500)
add('fade', mono(sl.shapes, 128, 880, 1664, 40, 'АВТОМАТТЫ ТЕСТТЕР · НАҚТЫ ҚОЛДАНУШЫЛАР НӘТИЖЕСІ — КЕЛЕСІ КЕЗЕҢ', 14, G500, align=C), 1800, 500)
finish(sl, '<p:fade/>')

# ── 10. Ұсыныс ─────────────────────────────────────────────────────────────
sl = frame('Ұсыныс')
head(sl, '08 · ҰСЫНЫС', 'Нарыққа дейін — тексеріңіз')
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
add('wipe', box(sl.shapes, 128, 822, 1664, 1, 'FFFFFF', kind=MSO_SHAPE.RECTANGLE, alpha=.1), 2900, 500)
add('rise', rich(sl.shapes, 128, 846, 1664, 90, [('Сезіммен емес — дерекпен', 'Rubik', G50), ('.', 'Rubik', SIG)], 46, align=C), 3100, 600)
finish(sl, '<p:fade/>')

assert S['n'] == S['total']
save('neuromarketing.pptx')
