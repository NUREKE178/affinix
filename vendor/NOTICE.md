# Vendored third-party code

These files are vendored (not CDN-loaded) so the app has no runtime dependency
on third-party CDNs and works offline / behind restrictive network policies.

| File | Project | Version | License |
|---|---|---|---|
| `preact.module.js` | [Preact](https://preactjs.com/) | 10.19.6 | MIT |
| `hooks.module.js` | Preact hooks | 10.19.6 | MIT |
| `htm.module.js` | [htm](https://github.com/developit/htm) | 3.1.1 | Apache-2.0 |
| `chart.umd.js` | [Chart.js](https://www.chartjs.org/) | 4.4.4 | MIT |
| `supabase.umd.js` | [@supabase/supabase-js](https://github.com/supabase/supabase-js) | 2.117.2 | MIT |
| `fonts/inter-*.woff2` | [Inter](https://rsms.me/inter/) (variable, 400-700) | Google Fonts v20 subsets: latin, cyrillic, cyrillic-ext | SIL OFL 1.1 |

The JS files are unmodified builds taken from each package's published npm `dist/` output. The Inter font files are the
unmodified woff2 subsets served by Google Fonts; they are used only by the landing page (`landing.css`, family
"Inter Landing"), so the rest of the app's typography is unchanged.
