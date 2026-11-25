#!/usr/bin/env python3
"""Builds presentation/jury/jury.html (a phone-friendly reading page with a timer) from жюри_баяндама.txt.

The text file stays the single source: edit it, run  python3 presentation/jury/build.py  and the page follows.
Page: three tabs (speech / answers / do-not-say / prep), big type, one colour per speaker, a stopwatch that follows
the 7-minute schedule, a search box for the answers. Same file prints to PDF (open it with #print).
"""
import html as H
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "жюри_баяндама.txt")
OUT = os.path.join(os.path.dirname(__file__), "jury.html")

lines = open(SRC, encoding="utf-8").read().split("\n")


def esc(s):
    return H.escape(s, quote=False)


def inline(s):
    """Escaped text with the small markers turned into tags."""
    s = esc(s)
    s = re.sub(r"\[(Слайд[^\]]*)\]", r'<span class="tag slide">\1</span>', s)
    s = re.sub(r"\[([^\]]+)\]", r'<span class="fill">[\1]</span>', s)
    s = s.replace("★", '<span class="star">★</span>')
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    return s


# ---------------------------------------------------------------------------------------------- sections
def rule(l):
    return bool(l) and set(l.strip()) <= {"═"} and len(l.strip()) > 20


def thin(l):
    return bool(l) and set(l.strip()) <= {"─"} and len(l.strip()) > 20


top = {}
order = []
i = 0
while i < len(lines):
    if rule(lines[i]) and i + 2 < len(lines) and rule(lines[i + 2]):
        title = lines[i + 1].strip()
        key = title.split(".")[0]
        j = i + 3
        k = j
        while k < len(lines) and not (rule(lines[k]) and k + 2 < len(lines) and rule(lines[k + 2])):
            k += 1
        top[key] = {"title": title, "lines": lines[j:k]}
        order.append(key)
        i = k
    else:
        i += 1


def subsections(body):
    """Splits lines on  ───/title/───  blocks -> (intro_lines, [(title, lines)])."""
    intro, subs, cur = [], [], None
    i = 0
    while i < len(body):
        if thin(body[i]) and i + 2 < len(body) and thin(body[i + 2]):
            cur = [body[i + 1].strip(), []]
            subs.append(cur)
            i += 3
            continue
        (cur[1] if cur else intro).append(body[i])
        i += 1
    return intro, [(t, b) for t, b in subs]


# ---------------------------------------------------------------------------------------------- 1. speech
def parse_speech_block(body):
    blocks = []
    cur = None
    for raw in body:
        l = raw.rstrip()
        if not l.strip():
            cur = None
            continue
        who = None
        text = l
        m = re.match(r"^(НҰРЛАН|ӘМИНА):\s*(.*)$", l)
        if m:
            who = "s1" if m.group(1) == "НҰРЛАН" else "am"
            text = m.group(2)
        elif l.startswith("ЕКЕУІ БІРГЕ"):
            who = "both"
            mm = re.match(r"^ЕКЕУІ БІРГЕ\s*(\([^)]*\))?:?\s*(.*)$", l)
            text = (mm.group(1) + " " if mm and mm.group(1) else "") + (mm.group(2) if mm else "")
            if mm and mm.group(1):
                text = mm.group(2)
                blocks.append({"type": "stage", "text": mm.group(1).strip("()")})
        if who:
            cur = {"type": "say", "who": who, "lines": []}
            blocks.append(cur)
        elif cur is None:
            st = l.strip()
            if st.startswith("(") and st.endswith(")"):
                st = st[1:-1]
            blocks.append({"type": "stage", "text": st})
            continue
        if cur is not None and text.strip():
            cur["lines"].append(text.strip())
    return blocks


sp_intro, sp_subs = subsections(top["1"]["lines"])
schedule = []
catchup = []
for l in sp_intro:
    for m in re.finditer(r"(\d)\s+[^→\d]+?\s+(\d:\d\d)", l):
        schedule.append((m.group(1), m.group(2)))
    if l.strip().startswith("•"):
        catchup.append(l.strip().lstrip("• ").strip())


def mmss(t):
    m, s = t.split(":")
    return int(m) * 60 + int(s)


sections = []
prev_end = 0
for title, body in sp_subs:
    sid = title.split()[0].rstrip(":")
    end = next((mmss(e) for k, e in schedule if k == sid), None)
    mt = re.search(r"\((\d:\d\d)", title)
    dur = mt.group(1) if mt else ""
    slides = re.search(r"\[(Слайд[^\]]*)\]", title)
    name = re.sub(r"\s*\(.*?\)\s*|\s*\[.*?\]\s*", " ", title).strip()
    name = re.sub(r"^(\d)\s+", r"\1 · ", name)
    sections.append({"id": sid, "name": name, "dur": dur, "slides": slides.group(1) if slides else "", "start": prev_end, "end": end,
                     "blocks": parse_speech_block(body)})
    if end:
        prev_end = end


def render_blocks(blocks):
    out = []
    labels = {"s1": "НҰРЛАН", "am": "ӘМИНА", "both": "ЕКЕУІ БІРГЕ"}
    for b in blocks:
        if b["type"] == "stage":
            out.append(f'<p class="stage">{inline(b["text"])}</p>')
        else:
            ps = "".join(
                f'<p class="{"stage" if t.startswith("(") and t.endswith(")") else "ln"}">{inline(t[1:-1] if t.startswith("(") and t.endswith(")") else t)}</p>'
                for t in b["lines"]
            )
            out.append(f'<div class="say {b["who"]}"><span class="who">{labels[b["who"]]}</span>{ps}</div>')
    return "".join(out)


speech_html = []
for s in sections:
    meta = ""
    if s["dur"]:
        meta += f'<span class="time">{s["dur"]}</span>'
    if s["slides"]:
        meta += f'<span class="tag slide">{esc(s["slides"])}</span>'
    speech_html.append(
        f'<section class="card sec" id="sec-{re.sub(r"[^0-9A-Za-zА-Яа-я]", "-", s["id"])}" data-sid="{esc(s["id"])}" data-start="{s["start"]}" data-end="{s["end"] or 0}">'
        f'<h2><span>{esc(s["name"])}</span>{meta}</h2>{render_blocks(s["blocks"])}</section>'
    )

# ---------------------------------------------------------------------------------------------- 3. answers
qa_intro, qa_subs = subsections(top["3"]["lines"])
qa_intro_html = "".join(f"<p>{inline(l.strip())}</p>" for l in qa_intro if l.strip())

featured = {"title": "", "intro": "", "short": ("", []), "long": ("", []), "follow": [], "note": ""}
groups = []
for title, body in qa_subs:
    if title.startswith("0."):
        featured["title"] = re.sub(r"^0\.\s*", "", title)
        mode = "intro"
        cur_f = None
        paras = []
        buf = []
        i = 0
        fb = [x.rstrip() for x in body]
        # intro paragraph
        while i < len(fb) and not fb[i].startswith("★"):
            if fb[i].strip():
                featured["intro"] += (" " if featured["intro"] else "") + fb[i].strip()
            i += 1
        while i < len(fb):
            l = fb[i]
            if l.startswith("★ ҚЫСҚА"):
                head = l.lstrip("★ ").strip()
                i += 1
                txt = []
                while i < len(fb) and fb[i].strip():
                    txt.append(fb[i].strip()); i += 1
                featured["short"] = (head, txt)
            elif l.startswith("★ ТОЛЫҚ"):
                head = l.lstrip("★ ").strip()
                i += 1
                ps, cur_p = [], []
                while i < len(fb) and not fb[i].startswith("ҚОСЫМША"):
                    if fb[i].strip():
                        cur_p.append(fb[i].strip())
                    elif cur_p:
                        ps.append(cur_p); cur_p = []
                    i += 1
                if cur_p:
                    ps.append(cur_p)
                featured["long"] = (head, ps)
            elif l.startswith("ҚОСЫМША"):
                i += 1
                while i < len(fb) and not fb[i].startswith("ЕСТЕ САҚТАҢДАР"):
                    if fb[i].startswith("•"):
                        q = fb[i].lstrip("• ").strip()
                        a = []
                        i += 1
                        while i < len(fb) and fb[i].startswith("  "):
                            a.append(fb[i].strip()); i += 1
                        featured["follow"].append((q, a))
                        continue
                    i += 1
            elif l.startswith("ЕСТЕ САҚТАҢДАР"):
                featured["note"] = l.strip()
                i += 1
            else:
                i += 1
    else:
        qs = []
        cur = None
        for raw in body:
            l = raw.rstrip()
            m = re.match(r"^(\d+[а-яә]?)\.\s+(.*?)\s*\((Н|Ә|екеуі)\)\s*(?:—\s*(.*))?$", l)
            if m:
                cur = {"n": m.group(1), "q": m.group(2), "who": m.group(3), "flag": (m.group(4) or "").strip(), "a": []}
                qs.append(cur)
            elif cur is not None and l.strip():
                cur["a"].append(l.strip())
        groups.append((title, qs))

WHO_CLS = {"Н": "s1", "Ә": "am", "екеуі": "both"}
WHO_LBL = {"Н": "Нұрлан", "Ә": "Әмина", "екеуі": "Екеуі"}


def render_answer(lines):
    out, ul = [], False
    for t in lines:
        if t.startswith("[") and t.endswith("]"):
            if ul:
                out.append("</ul>"); ul = False
            out.append(f'<p class="fillbox">{inline(t)}</p>')
        else:
            if ul:
                out.append("</ul>"); ul = False
            out.append(f'<p class="ln">{inline(t)}</p>')
    if ul:
        out.append("</ul>")
    return "".join(out)


qa_html = []
# the featured answer
if featured["title"]:
    sh, st = featured["short"]
    lh, lp = featured["long"]
    follow = "".join(
        f'<details class="q"><summary><span class="qt">{inline(q)}</span></summary><div class="ans">{"".join(f"<p class=ln>{inline(x)}</p>" for x in a)}</div></details>'
        for q, a in featured["follow"]
    )
    long_html = "".join("<p class='ln big'>" + "<br>".join(inline(x) for x in p) + "</p>" for p in lp)
    qa_html.append(
        f'<section class="card feat" id="feat"><div class="flag">ЕҢ МАҢЫЗДЫ СҰРАҚ</div><h2>{inline(featured["title"])}</h2>'
        f'<p class="muted">{inline(featured["intro"])}</p>'
        f'<div class="ans-card short"><div class="ac-h"><span class="pill">15 сек</span> Қысқа жауап · кім болса да</div>'
        f'<p class="quote">{"<br>".join(inline(x) for x in st)}</p></div>'
        f'<div class="ans-card long"><div class="ac-h"><span class="pill">60 сек</span> Толық жауап · Нұрлан айтады, Әмина соңын қосады</div>{long_html}</div>'
        f'<h3>Қосымша қарсы сұрақтар</h3>{follow}'
        f'<p class="note">{inline(featured["note"])}</p></section>'
    )
for title, qs in groups:
    items = []
    for q in qs:
        flag = f'<span class="flagchip">{esc(q["flag"])}</span>' if q["flag"] else ""
        items.append(
            f'<details class="q" data-s="{esc((q["q"] + " " + " ".join(q["a"])).lower())}"><summary><span class="num">{q["n"]}</span>'
            f'<span class="qt">{inline(q["q"])}</span>{flag}<span class="who-chip {WHO_CLS[q["who"]]}">{WHO_LBL[q["who"]]}</span></summary>'
            f'<div class="ans">{render_answer(q["a"])}</div></details>'
        )
    qa_html.append(f'<section class="group"><h3>{inline(title)}</h3>{"".join(items)}</section>')

# ---------------------------------------------------------------------------------------------- 2. do not say
say_items = []
for l in top["2"]["lines"]:
    if l.strip().startswith("-"):
        t = l.strip()[1:].strip()
        m = re.match(r"^(«[^»]+»|[^—]+?)\s+—\s+(.*)$", t)
        if m:
            say_items.append((m.group(1).strip(), m.group(2).strip()))
        else:
            say_items.append((t, ""))
say_html = "".join(
    f'<div class="nope"><span class="x">✕</span><div><p class="claim">{inline(c)}</p><p class="why">{inline(w)}</p></div></div>' for c, w in say_items
)

# ---------------------------------------------------------------------------------------------- 0. prep + 4. numbers
prep_lines = top["0"]["lines"]
facts, rules_, legend, checks = [], [], [], []
mode = None
for l in prep_lines:
    t = l.rstrip()
    if t.startswith("Рөлдер:") or t.startswith("Ұзақтығы:"):
        facts.append(t)
    elif t.startswith("Белгілер:"):
        mode = "legend"
    elif t.startswith("Ережелер:"):
        mode = "rules"
    elif t.startswith("ЕРТЕҢ ДЕЙІН"):
        mode = "check"
    elif t.strip().startswith("[ ]"):
        checks.append(t.strip()[3:].strip())
    elif mode == "rules" and re.match(r"^\s+\d\)", t):
        rules_.append(re.sub(r"^\s*\d\)\s*", "", t))
    elif mode == "legend" and t.strip():
        legend.append(t.strip())

nums = []
quotes = []
for l in top["4"]["lines"]:
    if l.strip():
        quotes += re.findall(r"«[^»]+»", l)
        rest = re.sub(r"«[^»]+»", "", l)
        for chip in rest.split("·"):
            chip = chip.strip()
            if chip:
                nums.append(chip)

prep_html = (
    '<section class="card"><h2>Алдымен оқыңыздар</h2>' + "".join(f"<p>{inline(f)}</p>" for f in facts) + "</section>"
    + '<section class="card"><h2>Ертеңге дейін дайындалатындар</h2><p class="muted">Белгі қойып отырыңыз: телефон есте сақтайды.</p><div id="checks">'
    + "".join(f'<label class="chk"><input type="checkbox" data-i="{n}"><span>{inline(c)}</span></label>' for n, c in enumerate(checks))
    + "</div></section>"
    + '<section class="card"><h2>Сахнадағы ережелер</h2><ol class="rules">' + "".join(f"<li>{inline(r)}</li>" for r in rules_) + "</ol></section>"
    + '<section class="card"><h2>Белгілер</h2>' + "".join(f"<p class='ln small'>{inline(x)}</p>" for x in legend) + "</section>"
    + '<section class="card"><h2>Есте сақтайтын сандар</h2><div class="chips">' + "".join(f'<span class="chip">{inline(n)}</span>' for n in nums) + "</div>"
    + "".join(f'<p class="bigquote">{inline(q)}</p>' for q in quotes) + "</section>"
)

# ---------------------------------------------------------------------------------------------- page
sched_json = json.dumps([{"id": s["id"], "end": s["end"]} for s in sections if s["end"]], ensure_ascii=False)
catch_html = "".join(f"<li>{inline(c)}</li>" for c in catchup)
marks = "".join(
    f'<i style="left:{s["end"] / 420 * 100:.2f}%" title="{esc(s["id"])} · {s["end"] // 60}:{s["end"] % 60:02d}"></i>' for s in sections if s["end"]
)

PAGE = """<!DOCTYPE html>
<html lang="kk" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Жюриге айтатын баяндама — Affinix</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&display=swap&subset=cyrillic,cyrillic-ext">
<style>
:root { --fs: 20px; --bg:#0e0e10; --plate:#18191c; --plate2:#1f2024; --line:rgba(255,255,255,.09); --ink:#f5f5f6; --mut:#a2a5ae; --sig:#ff6a1f; --s1:#ff8438; --am:#3ee6d0; --both:#a78bfa; --ok:#34d399; --bad:#fb7185; --warn:#fbbf24; --fill:#fbbf24; --code:#26282d; }
html[data-theme="light"] { --bg:#f6f6f7; --plate:#ffffff; --plate2:#f0f0f2; --line:rgba(0,0,0,.12); --ink:#16161a; --mut:#5a5d66; --sig:#d9510a; --s1:#c8420b; --am:#0b7f70; --both:#6d4fd6; --ok:#0f8a5f; --bad:#c0263f; --warn:#9a6a00; --fill:#8a5a00; --code:#ececf0; }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin:0; background:var(--bg); color:var(--ink); font:400 var(--fs)/1.55 Rubik, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding-bottom: max(40px, env(safe-area-inset-bottom)); }
.top { position: sticky; top:0; z-index:20; background:var(--bg); border-bottom:1px solid var(--line); padding: max(8px, env(safe-area-inset-top)) 12px 8px; }
.bar { display:flex; align-items:center; gap:8px; max-width:860px; margin:0 auto; flex-wrap:wrap; }
.title { font-size:15px; font-weight:600; letter-spacing:.01em; flex:1 1 200px; min-width:0; }
@media (max-width: 560px) { .title { display:none; } .bar { justify-content:space-between; flex-wrap:nowrap; } }
.title small { display:block; font-weight:400; color:var(--mut); font-size:12px; }
.timer { display:flex; align-items:center; gap:6px; }
.clock { font:600 24px/1 ui-monospace, "JetBrains Mono", Menlo, monospace; min-width:72px; text-align:center; padding:6px 8px; border-radius:10px; background:var(--plate); border:1px solid var(--line); font-variant-numeric: tabular-nums; }
.clock[data-state="warn"] { color:var(--warn); border-color:var(--warn); }
.clock[data-state="over"] { color:var(--bad); border-color:var(--bad); }
button { font:600 15px/1 Rubik, system-ui, sans-serif; color:var(--ink); background:var(--plate2); border:1px solid var(--line); border-radius:10px; padding:10px 11px; min-height:42px; min-width:42px; cursor:pointer; }
button:active { transform: translateY(1px); }
button.go { background:var(--sig); border-color:var(--sig); color:#1d0d04; }
.tools { display:flex; gap:6px; }
.track { position:relative; height:6px; border-radius:4px; background:var(--plate2); margin:6px auto 0; max-width:860px; overflow:hidden; }
.track b { position:absolute; left:0; top:0; bottom:0; width:0; background:var(--sig); transition: width .4s linear; }
.track i { position:absolute; top:0; bottom:0; width:2px; background:var(--bg); opacity:.9; }
.now { max-width:860px; margin:4px auto 0; font-size:13px; color:var(--mut); min-height:18px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.now b { color:var(--ink); }
nav.tabs { display:flex; gap:2px; max-width:860px; margin:10px auto 0; padding:0 12px; overflow-x:auto; -webkit-overflow-scrolling:touch; scrollbar-width:none; }
nav.tabs::-webkit-scrollbar { display:none; }
nav.tabs a { flex:1 1 auto; text-align:center; padding:11px 6px; border-radius:10px; font-size:14px; white-space:nowrap; font-weight:600; color:var(--mut); text-decoration:none; border:1px solid transparent; }
nav.tabs a[aria-current="true"] { color:var(--ink); background:var(--plate); border-color:var(--line); }
main { max-width:860px; margin:0 auto; padding: 12px 12px 0; }
.view { display:none; }
.view[data-on="true"] { display:block; }
.card { background:var(--plate); border:1px solid var(--line); border-radius:16px; padding:16px 16px 12px; margin:12px 0; }
.card h2 { margin:0 0 10px; font-size:1.05em; line-height:1.3; display:flex; flex-wrap:wrap; align-items:center; gap:8px 10px; }
.card h2 > span:first-child { flex:1 1 auto; }
.time { font:600 .7em/1 ui-monospace, Menlo, monospace; padding:5px 8px; border-radius:8px; background:var(--plate2); color:var(--ink); border:1px solid var(--line); }
.tag { font-size:.62em; font-weight:600; padding:4px 8px; border-radius:999px; border:1px solid var(--line); color:var(--mut); white-space:nowrap; }
.tag.slide { color:var(--ink); background:var(--plate2); }
.sec.now-sec { outline:2px solid var(--sig); outline-offset:2px; }
.sec.past { opacity:.55; }
.say { border-left:5px solid var(--c); padding:6px 0 6px 14px; margin:12px 0; }
.say.s1 { --c:var(--s1); } .say.am { --c:var(--am); } .say.both { --c:var(--both); }
.who { display:inline-block; font-size:.6em; font-weight:700; letter-spacing:.08em; color:var(--bg); background:var(--c); padding:3px 9px; border-radius:6px; margin-bottom:4px; }
.say p { margin:0 0 6px; }
.stage { color:var(--mut); font-style:italic; font-size:.82em; margin:8px 0; padding:6px 10px; border-radius:8px; background:var(--plate2); }
.say .stage { margin:4px 0; }
.fill { color:var(--fill); font-weight:600; background:rgba(251,191,36,.12); border-radius:5px; padding:0 4px; }
.star { color:var(--warn); font-weight:700; }
code { background:var(--code); border-radius:5px; padding:1px 6px; font-size:.85em; }
.muted { color:var(--mut); font-size:.85em; }
.small { font-size:.8em; }
.catch { background:var(--plate2); border-radius:12px; padding:10px 14px; margin:12px 0; font-size:.88em; }
.catch h3 { margin:0 0 6px; font-size:.8em; letter-spacing:.06em; text-transform:uppercase; color:var(--mut); }
.catch ul { margin:0; padding-left:18px; font-size:.82em; } .catch li { margin:4px 0; }
.group h3, .feat h3 { font-size:.8em; letter-spacing:.06em; text-transform:uppercase; color:var(--mut); margin:22px 4px 8px; }
.search { width:100%; padding:12px 14px; border-radius:12px; border:1px solid var(--line); background:var(--plate); color:var(--ink); font:400 16px Rubik, system-ui, sans-serif; margin:4px 0 8px; }
details.q { background:var(--plate); border:1px solid var(--line); border-radius:14px; margin:8px 0; }
details.q > summary { list-style:none; cursor:pointer; padding:12px 14px; display:flex; flex-wrap:wrap; gap:6px 10px; align-items:center; font-weight:500; line-height:1.35; }
details.q > summary::-webkit-details-marker { display:none; }
details.q[open] > summary { border-bottom:1px solid var(--line); }
.num { font:700 .72em/1 ui-monospace, Menlo, monospace; color:var(--bg); background:var(--mut); padding:5px 7px; border-radius:7px; }
.qt { flex:1 1 220px; }
.who-chip { font-size:.62em; font-weight:700; padding:4px 9px; border-radius:999px; color:var(--bg); background:var(--c); }
.who-chip.s1 { --c:var(--s1); } .who-chip.am { --c:var(--am); } .who-chip.both { --c:var(--both); }
.flagchip { font-size:.6em; font-weight:700; padding:4px 8px; border-radius:6px; color:var(--bg); background:var(--warn); }
.ans { padding:10px 14px 6px; } .ans p { margin:0 0 8px; }
.fillbox { color:var(--fill); background:rgba(251,191,36,.1); border:1px dashed var(--fill); border-radius:10px; padding:8px 10px; font-size:.88em; }
.feat { border:2px solid var(--sig); }
.flag { display:inline-block; font-size:.6em; font-weight:700; letter-spacing:.1em; color:#1d0d04; background:var(--sig); padding:4px 9px; border-radius:6px; margin-bottom:8px; }
.ans-card { border-radius:14px; background:var(--plate2); padding:12px 14px; margin:12px 0; }
.ac-h { font-size:.78em; color:var(--mut); margin-bottom:8px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.pill { font:700 .95em/1 ui-monospace, Menlo, monospace; color:#1d0d04; background:var(--sig); padding:4px 8px; border-radius:7px; }
.quote { font-size:1.08em; font-weight:500; margin:0; }
.ln.big { margin:0 0 14px; }
.note { margin-top:14px; padding:10px 12px; border-radius:10px; background:rgba(251,191,36,.1); color:var(--ink); font-size:.88em; }
.nope { display:flex; gap:12px; padding:12px 14px; background:var(--plate); border:1px solid var(--line); border-radius:14px; margin:8px 0; }
.x { flex:none; width:30px; height:30px; border-radius:50%; background:var(--bad); color:var(--bg); display:grid; place-items:center; font-weight:700; }
.claim { margin:0; font-weight:600; } .why { margin:4px 0 0; color:var(--mut); font-size:.88em; }
.chk { display:flex; gap:12px; align-items:flex-start; padding:10px 0; border-top:1px solid var(--line); }
.chk:first-child { border-top:0; }
.chk input { width:24px; height:24px; flex:none; margin-top:3px; accent-color: var(--sig); }
.chk input:checked + span { opacity:.45; text-decoration:line-through; }
.rules { margin:0; padding-left:22px; } .rules li { margin:8px 0; }
.chips { display:flex; flex-wrap:wrap; gap:8px; }
.chip { padding:8px 12px; border-radius:10px; background:var(--plate2); border:1px solid var(--line); font:600 .85em ui-monospace, Menlo, monospace; }
.bigquote { margin:14px 0 4px; padding:12px 14px; border-left:5px solid var(--sig); background:var(--plate2); border-radius:0 12px 12px 0; font-weight:500; }
.hide { display:none !important; }
@media (min-width: 700px) { :root { --fs: 21px; } }
@media print {
  :root { --fs: 14.5px; } body { background:#fff; }
  .top .tools, .top .timer, .track, .now, .search { display:none !important; }
  .top { position:static; border:0; } nav.tabs { display:none; }
  .view { display:block !important; page-break-before:always; } .view:first-of-type { page-break-before:avoid; }
  details.q, .say, .nope { break-inside: avoid; } .card.sec, .feat { break-inside: auto; }
  .view { padding-top: 0; }
}
</style>
</head>
<body>
<header class="top">
  <div class="bar">
    <div class="title">Жюриге айтатын баяндама<small>Affinix · 7 минут · Нұрлан және Әмина</small></div>
    <div class="timer">
      <div class="clock" id="clock" data-state="idle">0:00</div>
      <button class="go" id="go" aria-label="Бастау / тоқтату">▶</button>
      <button id="reset" aria-label="Нөлге қайтару">⟲</button>
    </div>
    <div class="tools"><button id="smaller" aria-label="Әріпті кішірейту">A−</button><button id="bigger" aria-label="Әріпті үлкейту">A+</button><button id="theme" aria-label="Жарық / қараңғы"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg></button></div>
  </div>
  <div class="track" id="track"><b id="fill"></b>__MARKS__</div>
  <div class="now" id="now">Таймерді бастаңыз: қай бөлімде екеніңіз осы жерде көрінеді.</div>
</header>
<nav class="tabs" id="tabs">
  <a href="#speech" data-v="speech">Баяндама</a>
  <a href="#qa" data-v="qa">Сұрақтар</a>
  <a href="#nope" data-v="nope">Айтпаңдар</a>
  <a href="#prep" data-v="prep">Дайындық</a>
</nav>
<main>
  <div class="view" id="v-speech" data-on="true">
    <div class="catch"><h3>Артта қалсаңыз</h3><ul>__CATCH__</ul></div>
    __SPEECH__
  </div>
  <div class="view" id="v-qa">
    <input class="search" id="search" type="search" placeholder="Сұрақты іздеу: мысалы, ақша, бот, ЭЭГ…" aria-label="Іздеу">
    <div class="catch"><h3>Қиын сұрақтың қаруы</h3>__QAINTRO__</div>
    <div id="qa-body">__QA__</div>
  </div>
  <div class="view" id="v-nope">
    <section class="card"><h2>Мұны айтпаңдар: әзірге шындық емес</h2><p class="muted">Жюри осындай сөзді ұстап алады. Орнына жақтағы жауапты айтыңдар.</p></section>
    __NOPE__
  </div>
  <div class="view" id="v-prep">__PREP__</div>
</main>
<script>
(function () {
  var SCHEDULE = __SCHEDULE__;
  var LIMIT = 420, WARN = 390;
  var $ = function (s) { return document.querySelector(s); };
  var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

  /* tabs by hash */
  var views = ['speech', 'qa', 'nope', 'prep'];
  function show() {
    var h = (location.hash || '#speech').slice(1);
    if (h === 'print') { document.querySelectorAll('.view').forEach(function (v) { v.setAttribute('data-on', 'true'); }); document.querySelectorAll('details').forEach(function (d) { d.open = true; }); return; }
    if (views.indexOf(h) < 0) h = 'speech';
    views.forEach(function (v) { $('#v-' + v).setAttribute('data-on', String(v === h)); });
    document.querySelectorAll('#tabs a').forEach(function (a) { a.setAttribute('aria-current', String(a.getAttribute('data-v') === h)); });
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', show); show();

  /* type size and theme */
  var fs = parseInt(store.get('jury-fs') || '20', 10);
  function applyFs() { document.documentElement.style.setProperty('--fs', fs + 'px'); store.set('jury-fs', String(fs)); }
  applyFs();
  $('#bigger').onclick = function () { fs = Math.min(34, fs + 2); applyFs(); };
  $('#smaller').onclick = function () { fs = Math.max(15, fs - 2); applyFs(); };
  var th = store.get('jury-theme'); if (th) document.documentElement.setAttribute('data-theme', th);
  $('#theme').onclick = function () { var d = document.documentElement; var n = d.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; d.setAttribute('data-theme', n); store.set('jury-theme', n); };

  /* stopwatch that follows the schedule */
  var t0 = 0, acc = 0, run = false, timer = null, lastSid = null;
  var secs = Array.prototype.slice.call(document.querySelectorAll('.sec'));
  function fmt(s) { var m = Math.floor(s / 60), r = s % 60; return m + ':' + (r < 10 ? '0' : '') + r; }
  function elapsed() { return acc + (run ? Math.floor((Date.now() - t0) / 1000) : 0); }
  function tick() {
    var e = elapsed();
    var c = $('#clock'); c.textContent = fmt(e); c.setAttribute('data-state', e >= LIMIT ? 'over' : e >= WARN ? 'warn' : (run ? 'run' : 'idle'));
    $('#fill').style.width = Math.min(100, e / LIMIT * 100) + '%';
    var cur = null;
    for (var i = 0; i < SCHEDULE.length; i++) { if (e < SCHEDULE[i].end) { cur = SCHEDULE[i]; break; } }
    var left = cur ? cur.end - e : 0;
    $('#now').innerHTML = !run && e === 0 ? 'Таймерді бастаңыз: қай бөлімде екеніңіз осы жерде көрінеді.' :
      (cur ? 'Қазір: <b>' + cur.id + '</b> · бөлім аяқталуына <b>' + fmt(left) + '</b>' : (e >= LIMIT ? '<b>7:00 өтті: қоштасыңыз</b>' : 'Қоштасу уақыты · <b>' + fmt(LIMIT - e) + '</b> қалды'));
    var sid = cur ? cur.id : null;
    if (sid !== lastSid && run) {
      lastSid = sid;
      secs.forEach(function (s) {
        var on = s.getAttribute('data-sid') === sid;
        s.classList.toggle('now-sec', on);
        s.classList.toggle('past', !on && parseInt(s.getAttribute('data-end'), 10) <= e);
      });
      var el = secs.filter(function (s) { return s.getAttribute('data-sid') === sid; })[0];
      if (el && (location.hash || '#speech') === '#speech') el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
  $('#go').onclick = function () {
    if (run) { acc = elapsed(); run = false; clearInterval(timer); $('#go').textContent = '▶'; }
    else { t0 = Date.now(); run = true; lastSid = undefined; timer = setInterval(tick, 250); $('#go').textContent = '❚❚'; }
    tick();
  };
  $('#reset').onclick = function () { run = false; acc = 0; clearInterval(timer); lastSid = null; $('#go').textContent = '▶'; secs.forEach(function (s) { s.classList.remove('now-sec', 'past'); }); tick(); };

  /* search in the answers */
  $('#search').oninput = function () {
    var q = this.value.trim().toLowerCase();
    document.querySelectorAll('#qa-body details.q[data-s]').forEach(function (d) { d.classList.toggle('hide', !!q && d.getAttribute('data-s').indexOf(q) < 0); if (q && d.getAttribute('data-s').indexOf(q) >= 0) d.open = true; });
    document.querySelectorAll('#qa-body .group').forEach(function (g) { g.classList.toggle('hide', !!q && !g.querySelector('details.q:not(.hide)')); });
    var f = $('#feat'); if (f) f.classList.toggle('hide', !!q);
  };

  /* checklist remembers ticks */
  var saved = {}; try { saved = JSON.parse(store.get('jury-checks') || '{}'); } catch (e) {}
  document.querySelectorAll('#checks input').forEach(function (c) {
    c.checked = !!saved[c.getAttribute('data-i')];
    c.onchange = function () { saved[c.getAttribute('data-i')] = c.checked; store.set('jury-checks', JSON.stringify(saved)); };
  });
  tick();
})();
</script>
</body>
</html>
"""

page = (
    PAGE.replace("__MARKS__", marks)
    .replace("__CATCH__", catch_html)
    .replace("__SPEECH__", "".join(speech_html))
    .replace("__QAINTRO__", qa_intro_html)
    .replace("__QA__", "".join(qa_html))
    .replace("__NOPE__", say_html)
    .replace("__PREP__", prep_html)
    .replace("__SCHEDULE__", sched_json)
)
open(OUT, "w", encoding="utf-8").write(page)
print("sections", len(sections), "questions", sum(len(q) for _, q in groups), "checks", len(checks), "nope", len(say_items), "->", OUT, len(page) // 1024, "KB")
