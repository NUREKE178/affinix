"""Нейромаркетинг · Affinix — 4 слайд, нативті PPT анимациясы (animated-native-pptx skill)."""
from deckkit import *

CY, CO, VI = '3EE6D0', 'FF5A7A', '8C7BFF'
init(dict(font='Arial', on_bg='F4F6FF', on_bg_soft='A9B1D6', accent=CO, accent_ink='FFFFFF',
          card='F4F6FF', ink='0B1026', mute='4A5170', primary='0B1026', dot=CO),
     total=4, tag='AFFINIX · НЕЙРОМАРКЕТИНГ')


def node(c, cx, cy, t, pt=18, fill='161C4A', color=None, h=62):
    w = len(t) * pt * 1.2 + 70
    s = box(c, cx - w / 2, cy - h / 2, w, h, fill, rad=h / 2); s.text_frame.vertical_anchor = MID
    s.line.color.rgb = rgb(CY); s.line.width = Pt(1.5)
    style(s.text_frame, t, pt, color or T['on_bg'], True, C); return s


def eyebrow(sl, t, title):
    add('wipe', box(sl.shapes, 128, 96, 6, 132, CO, kind=MSO_SHAPE.RECTANGLE), 0, 400, dir='down')
    add('left', text(sl.shapes, 160, 92, 1200, 40, t, 15, CY, True), 100, 450)
    add('left', text(sl.shapes, 160, 140, 1600, 100, title, 44, bold=True), 250, 500)


# ── 1. Тірек сөздер ────────────────────────────────────────────────────────
sl = new('cover', 'Тірек сөздер', chrome=False)
add('fade', text(sl.shapes, 128, 290, 800, 36, 'AFFINIX  ·  ҒЫЛЫМИ ЖОБА', 15, CY, True), 0, 500)
add('left', text(sl.shapes, 120, 330, 960, 150, 'НЕЙРО', 70, bold=True), 150, 550)
add('left', text(sl.shapes, 120, 430, 1000, 150, 'МАРКЕТИНГ', 70, CO, bold=True), 350, 550)
add('wipe', box(sl.shapes, 128, 580, 360, 8, CY, rad=4), 750, 500)
add('rise', text(sl.shapes, 128, 620, 900, 140, 'Адам не айтатынын емес —\nнені таңдайтынын өлшейміз.', 24, T['on_bg_soft'], spacing=1.25), 950, 600)
add('fade', text(sl.shapes, 128, 960, 900, 36, '[Аты-жөні]  ·  [Мектеп / сынып]  ·  2026', 14, '6F78A8'), 1400, 500)

P = {'tan': (1300, 230), 'emo': (1650, 170), 'rt': (1500, 470), 'ab': (1290, 690),
     'pair': (1560, 820), 'data': (1740, 580)}
for a, b in [('tan', 'rt'), ('emo', 'rt'), ('rt', 'ab'), ('rt', 'pair'), ('rt', 'data'),
             ('tan', 'ab'), ('pair', 'data'), ('emo', 'data'), ('tan', 'emo'), ('ab', 'pair')]:
    ln, _ = curve(sl, [P[a], P[b]], '4B5BA8', 2, dash=False); add('fade', ln, 500, 900)
words = [('rt', 'Реакция уақыты', CO), ('tan', 'Таңдау', None), ('emo', 'Эмоция', None),
         ('data', 'Дерек', None), ('ab', 'A / B тест', None), ('pair', 'Жұптық салыстыру', None)]
for i, (k, t, f) in enumerate(words):
    s = node(sl.shapes, *P[k], t, 22 if f else 18, fill=f or '161C4A')
    add('zoom', s, 700 + i * 220, 450)
    if k == 'rt': rt = s
path = 'M 0 0 ' + ' '.join(f'L {(x - P["tan"][0]) / 1920:.4f} {(y - P["tan"][1]) / 1080:.4f}' for x, y in [P['rt'], P['pair']])
dot = box(sl.shapes, P['tan'][0] - 11, P['tan'][1] - 11, 22, 22, CY, MSO_SHAPE.OVAL)
add('fade', dot, 2200, 200); add('path', dot, 2200, 1800, path=path)
add('pulse', rt, 2600, 450)
finish(sl, '<p:fade/>')

# ── 2. Мәселе ──────────────────────────────────────────────────────────────
sl = new('problem', 'Мәселе')
eyebrow(sl, '01 · МӘСЕЛЕ', 'Айтқаны ≠ таңдағаны')

g = group(sl, 'Айтады')
box(g.shapes, 128, 330, 740, 380, 'F4F6FF', alpha=.95)
badge(g.shapes, 'chat', 176, 378, 96, '0B1026', 'white')
text(g.shapes, 300, 400, 520, 50, 'АЙТАДЫ', 18, T['mute'], True)
text(g.shapes, 176, 500, 660, 80, '«Маған B ұнайды»', 32, T['ink'], True)
text(g.shapes, 176, 610, 660, 50, 'Сауалнама, фокус-топ', 20, T['mute'])
add('left', g, 600, 600)

g = group(sl, 'Таңдайды')
box(g.shapes, 1052, 330, 740, 380, CO, alpha=.95)
badge(g.shapes, 'target', 1100, 378, 96, 'FFFFFF', 'coral')
text(g.shapes, 1224, 400, 520, 50, 'ТАҢДАЙДЫ', 18, 'FFE3E9', True)
text(g.shapes, 1100, 500, 660, 80, 'Сатып алады — A', 32, 'FFFFFF', True)
text(g.shapes, 1100, 610, 660, 50, 'Жылдам. Эмоциямен. Ойланбай.', 20, 'FFE3E9')
add('right', g, 900, 600)

g = group(sl, 'Тең емес')
box(g.shapes, 885, 445, 150, 150, '0B1026', MSO_SHAPE.OVAL).line.color.rgb = rgb(CY)
text(g.shapes, 885, 445, 150, 150, '≠', 72, CY, True, C, MID)
add('zoom', g, 1500, 450); add('pulse', g, 2000, 400)

for i, t in enumerate(['Қымбат әрі баяу', 'Сауалнаманы 5 минутта тастайды', 'ЭЭГ, айтрекинг — тек зертханада']):
    x = 128 + i * 565
    add('wipe', box(sl.shapes, x, 780, 533, 4, CO, kind=MSO_SHAPE.RECTANGLE), 2300 + i * 300, 400)
    add('rise', text(sl.shapes, x, 805, 533, 110, t, 22, T['on_bg'], True, spacing=1.2), 2400 + i * 300, 500)
finish(sl, '<p:push dir="l"/>')

# ── 3. Шешім ───────────────────────────────────────────────────────────────
sl = new('solve', 'Шешім')
eyebrow(sl, '02 · БІЗДІҢ ШЕШІМ · AFFINIX', 'Сұрамаймыз — таңдатамыз')
steps = [('ab', 'Нұсқалар', 'A, B, C, D:\nлоготип, қаптама,\nжарнама'),
         ('duel', 'Дуэль', 'Арена ойынында\nекі нұсқа —\nбір жылдам таңдау'),
         ('clock', 'Уақыт', 'Не таңдады және\nқаншалық жылдам'),
         ('verdict', 'Үкім', 'Уилсон сенім\nаралығы,\nn ≥ 30')]
for i, (ic, h, d) in enumerate(steps):
    x = 128 + i * 424
    g = group(sl, h); box(g.shapes, x, 330, 392, 430, 'F4F6FF', alpha=.95)
    badge(g.shapes, ic, x + 36, 366, 110, '0B1026', 'cyan')
    text(g.shapes, x + 250, 372, 110, 60, f'0{i + 1}', 30, CO, True, R)
    text(g.shapes, x + 36, 500, 330, 60, h, 28, T['ink'], True)
    text(g.shapes, x + 36, 570, 330, 180, d, 17, T['mute'], spacing=1.2)
    add('rise', g, 600 + i * 350, 550)
    if i < 3:
        a = sl.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, e(x + 392 - 8), e(520), e(48), e(40))
        a.fill.solid(); a.fill.fore_color.rgb = rgb(CO); a.line.fill.background()
        add('wipe', a, 850 + i * 350, 300)

pts = [(128, 885), (600, 885), (640, 845), (690, 945), (740, 855), (770, 885), (1090, 885), (1130, 830),
       (1180, 950), (1225, 860), (1255, 885), (1792, 885)]
ln, path = curve(sl, pts, CY, 3, dash=False); add('wipe', ln, 2100, 1100, dir='left')
dot = box(sl.shapes, 128 - 12, 885 - 12, 24, 24, CO, MSO_SHAPE.OVAL)
add('fade', dot, 2100, 200); add('path', dot, 2100, 2200, path=path)
add('fade', text(sl.shapes, 128, 800, 1200, 40, 'Әр таңдаудың реакция уақыты жазылады', 17, T['on_bg_soft'], True), 2500, 500)
finish(sl, '<p:wipe dir="r"/>')

# ── 4. Ұсыныс ──────────────────────────────────────────────────────────────
sl = new('offer', 'Ұсыныс')
eyebrow(sl, '03 · ҰСЫНЫС', 'Нарыққа дейін — тексеріңіз')
for i, (h, d) in enumerate([('Нұсқаңызды жүктеңіз', '2–4 логотип, постер, ат немесе ұран'),
                            ('Көпшілік таңдайды', 'Арена ойыншылары — миссия ретінде'),
                            ('Үкім аласыз', 'Жеңімпаз + сенім аралығы')]):
    y = 340 + i * 150
    g = group(sl, h)
    text(g.shapes, 128, y - 8, 90, 110, str(i + 1), 64, CO, True)
    text(g.shapes, 230, y + 4, 700, 50, h, 28, T['on_bg'], True)
    text(g.shapes, 230, y + 68, 760, 40, d, 18, T['on_bg_soft'])
    add('left', g, 600 + i * 350, 550)

g = group(sl, 'Үлгі')
box(g.shapes, 1040, 330, 752, 430, 'F4F6FF', alpha=.96)
pill(g.shapes, 1084, 370, 'ҮЛГІ КӨРІНІС', 12, '0B1026', CY, w=200, h=40)
text(g.shapes, 1084, 430, 660, 50, 'Қай логотип жақсы?', 26, T['ink'], True)
for j, (lab, col) in enumerate([('A', CO), ('B', 'B5BAD3')]):
    yy = 520 + j * 110
    text(g.shapes, 1084, yy, 60, 64, lab, 32, T['ink'], True, anchor=MID)
    box(g.shapes, 1150, yy + 12, 520, 40, 'E3E6F3', rad=20)
add('rise', g, 900, 600)
for j, (w, col) in enumerate([(470, CO), (250, 'B5BAD3')]):
    add('wipe', box(sl.shapes, 1150, 532 + j * 110, w, 40, col, rad=20), 1700 + j * 250, 700)
g = group(sl, 'Жеңімпаз'); badge(g.shapes, 'check', 1690, 520, 64, CO, 'white')
add('zoom', g, 2500, 400); add('pulse', g, 2950, 400)

add('wipe', box(sl.shapes, 128, 815, 1664, 2, '4B5BA8', kind=MSO_SHAPE.RECTANGLE), 3000, 500)
add('rise', text(sl.shapes, 128, 835, 1664, 90, 'Сезіммен емес — дерекпен.', 46, T['on_bg'], True, C), 3200, 600)
finish(sl, '<p:fade/>')

assert S['n'] == S['total']
save('neuromarketing.pptx')
