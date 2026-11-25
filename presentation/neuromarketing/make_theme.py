"""Generates theme.json: dark 'neural network' backgrounds + custom line icons."""
import json, random

def net(seed, n, x0, x1, y0, y1, color, op):
    r = random.Random(seed)
    pts = [(r.uniform(x0, x1), r.uniform(y0, y1)) for _ in range(n)]
    lines, dots = [], []
    for i, (x, y) in enumerate(pts):
        near = sorted(range(n), key=lambda j: (pts[j][0] - x) ** 2 + (pts[j][1] - y) ** 2)[1:3]
        for j in near:
            lines.append(f'<line x1="{x:.0f}" y1="{y:.0f}" x2="{pts[j][0]:.0f}" y2="{pts[j][1]:.0f}"/>')
        dots.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{r.choice([2, 3, 4]) }"/>')
    return (f'<svg style="position:absolute;left:0;top:0" width="1920" height="1080">'
            f'<g stroke="{color}" stroke-opacity="{op}" stroke-width="1.2">{"".join(lines)}</g>'
            f'<g fill="{color}" fill-opacity="{op * 2.2}">{"".join(dots)}</g></svg>')

grid = ('<div style="position:absolute;inset:0;background-image:radial-gradient(rgba(140,160,255,.10) 1.2px,transparent 1.3px);'
        'background-size:32px 32px"></div>')

theme = {
    "bg": {
        "cover": {"css": "linear-gradient(135deg,#070A1F,#111845 60%,#1C1450)",
                  "glows": [[1100, 80, 900, "rgba(62,230,208,.16)"], [1350, 500, 700, "rgba(255,90,122,.18)"]],
                  "html": net(7, 46, 960, 1900, 40, 1040, "#7FE9FF", .22)},
        "problem": {"css": "linear-gradient(160deg,#0A0C22,#1A1033 65%,#2A0F2E)",
                    "glows": [[700, 250, 600, "rgba(255,90,122,.14)"]],
                    "html": grid + net(3, 22, 0, 1920, 0, 1080, "#FF8FA6", .10)},
        "solve": {"css": "linear-gradient(150deg,#06121F,#0B1E3A 60%,#0F1B4D)",
                  "glows": [[-200, 600, 800, "rgba(62,230,208,.18)"], [1400, -300, 800, "rgba(91,75,255,.22)"]],
                  "html": grid + net(11, 24, 0, 1920, 0, 1080, "#7FE9FF", .10)},
        "offer": {"css": "linear-gradient(140deg,#0B0A24,#191348 55%,#2B1450)",
                  "glows": [[1200, 300, 900, "rgba(255,90,122,.16)"], [-100, -200, 700, "rgba(62,230,208,.14)"]],
                  "html": net(21, 26, 0, 1920, 0, 1080, "#C9B8FF", .09)},
    },
    "icon_colors": {"ink": "#0B1026", "cyan": "#3EE6D0", "coral": "#FF5A7A", "white": "#F4F6FF"},
    "icons": {
        "brain": "M58 22c-8-10-28-8-30 6-12 2-16 18-8 26-8 8-4 24 8 26 2 14 20 18 30 8z M62 22c8-10 28-8 30 6 12 2 16 18 8 26 8 8 4 24-8 26-2 14-20 18-30 8z M38 46c7 0 11 4 11 11 M82 46c-7 0-11 4-11 11 M36 76c6-5 13-3 15 3 M84 76c-6-5-13-3-15 3",
        "ab": "M14 24h40v72H14z M66 24h40v72H66z M24 78l10-36 10 36 M28 66h12 M78 42v36h12a9 9 0 0 0 0-18H78 M78 42h10a8 8 0 0 1 0 18",
        "duel": "M18 28h34v64H18z M68 28h34v64H68z M60 14v92 M74 60l14 14 20-26",
        "pulse": "M8 64h26l10-28 16 56 14-40 8 12h30",
        "verdict": "M60 12l40 14v30c0 28-18 46-40 56C38 100 20 82 20 54V26z M42 60l12 12 24-26",
    },
}
json.dump(theme, open('theme.json', 'w'), ensure_ascii=False)
