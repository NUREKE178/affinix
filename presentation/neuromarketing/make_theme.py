"""theme.json in the Affinix "Instrument" look: graphite canvas, one light from above, hairline grid, no glow."""
import json

grid = ('<div style="position:absolute;inset:0;background-image:'
        'linear-gradient(rgba(255,255,255,.022) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.022) 1px,transparent 1px);'
        'background-size:80px 80px;background-position:48px 20px"></div>')
top = 'linear-gradient(180deg,#17171a 0%,#0e0e10 42%,#0e0e10 100%)'
theme = {
    "bg": {"base": {"css": top, "html": grid},
           "cover": {"css": 'linear-gradient(180deg,#18181b 0%,#0e0e10 55%)', "html": grid}},
    "icon_colors": {"sig": "#ff6a1f", "ink": "#f5f5f6", "mut": "#a2a5ae", "dark": "#1d0d04"},
    "icons": {
        "brain": "M58 22c-8-10-28-8-30 6-12 2-16 18-8 26-8 8-4 24 8 26 2 14 20 18 30 8z M62 22c8-10 28-8 30 6 12 2 16 18 8 26 8 8 4 24-8 26-2 14-20 18-30 8z M38 46c7 0 11 4 11 11 M82 46c-7 0-11 4-11 11 M36 76c6-5 13-3 15 3 M84 76c-6-5-13-3-15 3",
        "ab": "M14 24h40v72H14z M66 24h40v72H66z M24 78l10-36 10 36 M28 66h12 M78 42v36h12a9 9 0 0 0 0-18H78 M78 42h10a8 8 0 0 1 0 18",
        "duel": "M18 28h34v64H18z M68 28h34v64H68z M60 14v92 M74 60l14 14 20-26",
        "verdict": "M60 12l40 14v30c0 28-18 46-40 56C38 100 20 82 20 54V26z M42 60l12 12 24-26",
        "dna": "M36 12c0 32 48 40 48 64s-48 32-48 32 M84 12c0 32-48 40-48 64s48 32 48 32 M44 30h32 M42 60h36 M44 90h32",
        "flask": "M46 12h28 M50 12v30L22 96a8 8 0 0 0 7 12h62a8 8 0 0 0 7-12L70 42V12 M34 74h52",
        "money": "M60 10a50 50 0 1 0 .1 0z M74 40c-4-6-24-8-26 4-2 14 26 8 26 22 0 12-22 12-28 4 M60 28v64",
        "survey": "M26 14h68v92H26z M40 38h40 M40 58h40 M40 78h24",
    },
}
json.dump(theme, open('theme.json', 'w'), ensure_ascii=False)
