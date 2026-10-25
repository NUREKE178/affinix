/** Source config for the vendored, pre-built vendor/tailwind.css.
 * Rebuild after editing markup/classes with:
 *   npx tailwindcss -i ./src/tailwind-input.css -o ./vendor/tailwind.css --config ./tailwind.config.js --minify
 *
 * Palette ("Instrument"): warm graphite neutrals and ONE signal colour. The
 * semantic colours (emerald / amber / rose / teal) are Tailwind's own; `steel`
 * is the muted blue used for "completed" and the second chart series.
 */
const graphite = {
  50: "#f5f5f6", 100: "#ececee", 200: "#dcdde1", 300: "#c3c5cb", 400: "#a2a5ae", 500: "#868993",
  600: "#565963", 700: "#3a3c43", 800: "#26282d", 900: "#18191c", 950: "#0e0e10",
};
const signal = {
  50: "#fff4ec", 100: "#ffe5d3", 200: "#ffc8a3", 300: "#ffa56b", 400: "#ff8438", 500: "#ff6a1f",
  600: "#f0550f", 700: "#c8420b", 800: "#9e350e", 900: "#7e2f10", 950: "#451507",
};
const steel = {
  50: "#f1f5fb", 100: "#dfe8f6", 200: "#c4d4ee", 300: "#a3bce4", 400: "#86a5d9", 500: "#668bc9",
  600: "#4d70ab", 700: "#3e5987", 800: "#34496c", 900: "#2c3c58", 950: "#1b2538",
};

module.exports = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.js"],
  theme: {
    extend: {
      colors: { graphite, signal, steel },
      fontFamily: {
        sans: ["Rubik", "Inter", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      animation: { "fade-in": "fadeIn .25s ease-out", "slide-up": "slideUp .3s ease-out" },
      keyframes: {
        fadeIn: { "0%": { opacity: 0 }, "100%": { opacity: 1 } },
        slideUp: { "0%": { opacity: 0, transform: "translateY(8px)" }, "100%": { opacity: 1, transform: "translateY(0)" } },
      },
    },
  },
  plugins: [],
};
