import { html, useState, useEffect, useRef } from "../lib/preact.js";
import { Icon } from "./icons.js";
import { useMountTransition, prefersReducedMotion } from "../lib/motion.js";
import { useLoadingHold, useIsLoading } from "../lib/loadingBar.js";

export function Card({ className = "", children, ...rest }) {
  return html`<div class=${`sk-panel rounded-xl ${className}`} ...${rest}>${children}</div>`;
}

export function SectionHeading({ title, subtitle, action }) {
  return html`
    <div class="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div>
        <h2 class="text-lg font-semibold text-graphite-100 tracking-tight">${title}</h2>
        ${subtitle && html`<p class="text-sm text-graphite-400 mt-0.5">${subtitle}</p>`}
      </div>
      ${action && html`<div class="max-w-full">${action}</div>`}
    </div>
  `;
}

const BUTTON_VARIANTS = {
  primary: "sk-btn sk-btn-primary",
  secondary: "sk-btn",
  ghost: "bg-transparent hover:bg-white/5 text-graphite-300",
  danger: "sk-btn sk-btn-danger",
  outline: "bg-transparent border border-graphite-700 hover:border-graphite-500 text-graphite-200",
};

/** `loading` = the action is in flight: the button turns busy (spinner in front
 * of its label, a sheen passing over its face) and stops taking clicks, without
 * looking disabled. Keep swapping the label text ("Saving…") as before. */
export function Button({ variant = "primary", size = "md", className = "", children, disabled, loading = false, style, ...rest }) {
  const sizes = { sm: "px-3 py-1.5 text-sm", md: "px-4 py-2 text-sm", lg: "px-5 py-2.5 text-base" };
  return html`
    <button
      class=${`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed ${BUTTON_VARIANTS[variant]} ${sizes[size]} ${className}`}
      style=${style}
      disabled=${disabled || loading}
      aria-busy=${loading ? "true" : undefined}
      data-loading=${loading ? "true" : undefined}
      ...${rest}
    >${loading && html`<${Spinner} size=${size === "lg" ? 18 : 15} />`}${children}</button>
  `;
}

/** A status LED with its label. `tone` picks the LED colour (see .sk-badge in styles.css);
 * `led={false}` leaves the dot out. */
export function Badge({ tone = "neutral", led = true, className = "", children }) {
  return html`<span class=${`sk-badge ${className}`} data-tone=${tone}>${led && html`<i class="sk-led" aria-hidden="true"></i>`}${children}</span>`;
}

export function DemoTag({ className = "" }) {
  return html`<${Badge} tone="amber" className=${className}>Demo data · illustrative<//>`;
}

/** A value set like a hardware display: digits in mono, any unit words ("min", "с", "сек")
 * small in the text face -- the mono face has no Cyrillic, and a unit should not shout anyway. */
export function Readout({ value }) {
  if (typeof value !== "string") return value;
  const parts = value.match(/[\d.,/]+%?|[^\d.,/%]+|%/g) ?? [value];
  return parts.map((p, i) => (/^[\d.,/]+%?$|^%$|^—$/.test(p) || !p.trim() ? p : html`<span key=${i} class="sk-unit">${p.trim()}</span>`));
}

/** One readout: engraved caption, mono number, a hint line. Several in a row go inside .sk-stat-strip. */
export function StatTile({ label, value, hint }) {
  return html`
    <div class="sk-stat">
      <div class="sk-stat-label">${label}</div>
      <div class="sk-stat-value"><${Readout} value=${value} /></div>
      ${hint && html`<div class="sk-stat-hint">${hint}</div>`}
    </div>
  `;
}

export function ProgressBar({ value, tone = "signal" }) {
  const colors = {
    signal: "linear-gradient(180deg,#ff8f55,#ff6a1f)",
    emerald: "linear-gradient(180deg,#4ade9f,#10b981)",
    amber: "linear-gradient(180deg,#fcd34d,#f59e0b)",
    rose: "linear-gradient(180deg,#fb7185,#e5484d)",
    teal: "linear-gradient(180deg,#5eead4,#14b8a6)",
  };
  const pctVal = Math.max(0, Math.min(1, value ?? 0)) * 100;
  return html`
    <div class="sk-display h-2 w-full rounded-full overflow-hidden">
      <div class="sk-progress-fill h-full rounded-full" style=${{ width: `${pctVal}%`, background: colors[tone] ?? colors.signal, boxShadow: "inset 0 1px 0 rgba(255,255,255,.35)", transition: "width var(--sk-dur-slow) var(--sk-ease-out)" }}></div>
    </div>
  `;
}

/** A comet-arc ring. Like every loading placeholder below it also holds the
 * thin top bar (see lib/loadingBar.js) for as long as it stays mounted. */
export function Spinner({ size = 18, className = "" }) {
  useLoadingHold();
  const thickness = size <= 16 ? 2 : size >= 36 ? 3 : 2.5;
  return html`<span class=${`sk-spinner shrink-0 ${className}`} style=${{ width: `${size}px`, height: `${size}px`, "--t": `${thickness}px` }}></span>`;
}

/** A single content-shaped placeholder block -- size/shape via className
 * (e.g. "h-4 w-32", "h-9 w-9 rounded-full"). Compose a few of these into
 * the real layout's shape for a loading list/table/card, instead of a
 * generic spinner, wherever that shape is worth mimicking. Siblings sweep
 * in a staggered wave (styles.css). */
export function Skeleton({ className = "" }) {
  useLoadingHold();
  return html`<div class=${`sk-skeleton ${className}`}></div>`;
}

/** Three dots rising in turn -- the animated "…" of a loading label. */
export function Dots() {
  return html`<span class="sk-dots" aria-hidden="true"><i></i><i></i><i></i></span>`;
}

/** A loading label ends in "…" / "..." in every locale; the text is split
 * from it so the ellipsis can be drawn as <Dots/> instead. */
function splitEllipsis(label) {
  if (typeof label !== "string") return { text: label, dots: false };
  const text = label.replace(/\s*(?:…|\.{3})\s*$/, "");
  return { text, dots: text !== label };
}

/** A loading label with its trailing "…" drawn as animated <Dots/>. */
export function LoadingLabel({ label }) {
  const { text, dots } = splitEllipsis(label);
  return html`<span>${text}${dots && html`<${Dots} />`}</span>`;
}

/** Drop-in replacement for a bare "Loading…" line, for a page/section gate
 * too short-lived or too irregularly shaped to be worth a bespoke skeleton.
 * Default: the logo mark inside a turning ring, label underneath. `compact`:
 * just a small spinner beside the label, for a thin strip inside a card (its
 * `className` replaces the default py-6 padding). `mark={false}`: a plain
 * glowing core instead of the logo (public pages that are not DecisionOS's
 * own UI). */
export function LoadingState({ label, className = "", compact = false, mark = true }) {
  useLoadingHold();
  if (compact) {
    return html`
      <div class=${`flex items-center justify-center gap-2.5 text-sm text-graphite-500 ${className || "py-6"}`} role="status" aria-live="polite">
        <${Spinner} size=${16} /><${LoadingLabel} label=${label} />
      </div>
    `;
  }
  return html`
    <div class=${`flex flex-col items-center justify-center gap-4 py-14 text-sm text-graphite-400 ${className}`} role="status" aria-live="polite">
      <span class="sk-orbit" aria-hidden="true">
        <span class="sk-spinner sk-orbit-ring"></span>
        ${mark ? html`<img src="./assets/logo/logo-mark-256.png" width="24" height="24" alt="" decoding="async" />` : html`<span class="sk-orbit-core"></span>`}
      </span>
      <${LoadingLabel} label=${label} />
    </div>
  `;
}

/** The "AI is writing" state: a pulsing spark, a label with a light sweep
 * through it and a ghost of the paragraph-to-be underneath. */
export function GeneratingState({ label }) {
  useLoadingHold();
  const { text, dots } = splitEllipsis(label);
  return html`
    <div role="status" aria-live="polite">
      <div class="flex items-center gap-3 text-sm font-medium">
        <span class="sk-ai-orb"><${Icon} name="sparkle" size=${14} /></span>
        <span><span class="sk-shimmer-text">${text}</span>${dots && html`<span class="sk-dots text-graphite-400"><i></i><i></i><i></i></span>`}</span>
      </div>
      <div class="mt-4 space-y-2.5" aria-hidden="true">
        <${Skeleton} className="h-3 w-full" /><${Skeleton} className="h-3 w-2/3" /><${Skeleton} className="h-3 w-48 max-w-full" />
      </div>
    </div>
  `;
}

/** The full-screen loader. index.html carries the same markup as static HTML
 * (the pre-boot placeholder), so Preact adopts it on mount and nothing
 * visibly swaps -- change one, change the other. */
export function BootScreen({ label }) {
  const { text, dots } = splitEllipsis(label);
  return html`
    <div class="sk-boot" role="status" aria-live="polite">
      <div class="sk-boot-stage" aria-hidden="true">
        <span class="sk-boot-tile"><img src="./assets/logo/logo-mark-256.png" width="88" height="88" alt="" /></span>
      </div>
      <div class="sk-boot-word">Decision<b>OS</b></div>
      <div class="sk-boot-track" aria-hidden="true"><span></span></div>
      <div class="sk-boot-label"><span key=${text} class="sk-boot-phase">${text}</span>${dots && html`<${Dots} />`}</div>
    </div>
  `;
}

/** The thin orange bar along the top edge of the app, on while any placeholder
 * is on screen. Debounced both ways: a fetch that settles in a blink never
 * flashes it, and it fades out instead of cutting off. */
export function LoadingBar() {
  const loading = useIsLoading();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(loading), loading ? 140 : 220);
    return () => clearTimeout(timer);
  }, [loading]);
  return html`<div class="sk-loadbar" data-active=${shown ? "true" : "false"} aria-hidden="true"></div>`;
}

export function EmptyState({ title, body, action, icon = "sparkle" }) {
  return html`
    <div class="sk-panel flex flex-col items-center justify-center text-center py-14 px-6 rounded-xl">
      <div class="sk-display mb-4 flex h-16 w-16 items-center justify-center rounded-full text-graphite-500"><${Icon} name=${icon} size=${26} strokeWidth=${1.9} /></div>
      <h3 class="text-base font-semibold text-graphite-200">${title}</h3>
      ${body && html`<p class="text-sm text-graphite-500 mt-1.5 max-w-sm">${body}</p>`}
      ${action && html`<div class="mt-5">${action}</div>`}
    </div>
  `;
}

export function Modal({ open, onClose, title, children, footer, wide = false }) {
  const { mounted, phase } = useMountTransition(open);
  if (!mounted) return null;
  return html`
    <div
      class="sk-backdrop-anim fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      data-state=${phase}
      onClick=${(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        class=${`sk-modal sk-overlay-anim sk-overlay-anim-center w-full ${wide ? "max-w-3xl" : "max-w-lg"} max-h-[85vh] overflow-y-auto rounded-2xl`}
        data-state=${phase}
      >
        <div class="flex items-center justify-between border-b border-black/40 px-5 py-4">
          <h3 class="font-semibold text-graphite-100">${title}</h3>
          <button type="button" class="sk-btn h-7 w-7 rounded-md text-graphite-400" onClick=${onClose} aria-label="Close"><${Icon} name="close" size=${14} /></button>
        </div>
        <div class="px-5 py-4">${children}</div>
        ${footer && html`<div class="flex justify-end gap-2 border-t border-black/40 px-5 py-3">${footer}</div>`}
      </div>
    </div>
  `;
}

export function Tabs({ tabs, active, onChange }) {
  return html`
    <div class="sk-tabs flex gap-1 rounded-lg p-1 w-fit max-w-full overflow-x-auto">
      ${tabs.map(
        (t) => html`
          <button
            key=${t.id}
            onClick=${() => onChange(t.id)}
            data-active=${active === t.id}
            class=${`sk-tab rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap ${
              active === t.id ? "text-white" : "text-graphite-400 hover:text-graphite-200"
            }`}
          >${t.label}</button>
        `
      )}
    </div>
  `;
}

const CONFIDENCE_TONE = { high: "emerald", moderate: "teal", "low-moderate": "amber", low: "amber", none: "neutral" };

/** `t` is the caller's useT()-bound translator. */
export function ConfidenceBadge({ confidence, t }) {
  const label = t ? t(`insights.confidence.${confidence}`) : confidence;
  return html`<${Badge} tone=${CONFIDENCE_TONE[confidence] ?? "neutral"}>${label}<//>`;
}

export function Field({ label, hint, children, required }) {
  return html`
    <label class="block mb-4">
      <span class="block text-sm font-medium text-graphite-300 mb-1.5">${label}${required && html`<span class="text-rose-400"> *</span>`}</span>
      ${children}
      ${hint && html`<span class="block text-xs text-graphite-500 mt-1">${hint}</span>`}
    </label>
  `;
}

const inputBase = "sk-input rounded-lg px-3 py-2 text-sm text-graphite-100 placeholder:text-graphite-500 disabled:opacity-40 disabled:cursor-not-allowed";

export function TextInput({ className = "", ...rest }) {
  return html`<input class=${`${inputBase} ${className}`} ...${rest} />`;
}

export function TextArea({ className = "", ...rest }) {
  return html`<textarea class=${`${inputBase} min-h-[88px] resize-y ${className}`} ...${rest}></textarea>`;
}

export function Select({ options, className = "", ...rest }) {
  return html`
    <select class=${`${inputBase} ${className}`} ...${rest}>
      ${options.map((o) => html`<option key=${o.value ?? o} value=${o.value ?? o}>${o.label ?? o}</option>`)}
    </select>
  `;
}

export function Checkbox({ label, className = "", ...rest }) {
  return html`
    <label class="flex items-center gap-2.5 text-sm text-graphite-300 cursor-pointer select-none py-1">
      <input type="checkbox" class=${`sk-checkbox h-4 w-4 rounded ${className}`} ...${rest} />
      ${label}
    </label>
  `;
}

export function Switch({ checked, onChange, label }) {
  return html`
    <label class="flex items-center justify-between gap-3 py-2 cursor-pointer select-none">
      <span class="text-sm text-graphite-300">${label}</span>
      <button
        type="button"
        onClick=${() => onChange(!checked)}
        data-on=${!!checked}
        class="sk-switch-track relative h-6 w-11 shrink-0 rounded-full"
      >
        <span class="sk-switch-knob absolute top-0.5 left-0.5 h-5 w-5 rounded-full" style=${{ transform: checked ? "translateX(20px)" : "translateX(0)" }}></span>
      </button>
    </label>
  `;
}

let toastRoot = null;
export function setToastRoot(fn) { toastRoot = fn; }
export function toast(message, tone = "neutral") { toastRoot?.(message, tone); }

const TOAST_TONE_TEXT = {
  neutral: "text-graphite-100",
  emerald: "text-emerald-300",
  rose: "text-rose-300",
  amber: "text-amber-300",
};
const TOAST_TONE_DOT = {
  neutral: "bg-graphite-400",
  emerald: "bg-emerald-400",
  rose: "bg-rose-400",
  amber: "bg-amber-400",
};

/** Mounted once, at the app root -- toast() is a no-op until this is on
 * screen to receive setToastRoot(). Without it, every toast(...) call in
 * the app (error messages, "Сохранено", etc.) silently does nothing. */
export function ToastHost() {
  const [items, setItems] = useState([]);
  const nextId = useRef(1);

  useEffect(() => {
    setToastRoot((message, tone) => {
      // Collapse repeats of the exact same message (e.g. a user clicking a
      // failing action several times in a row) into one entry instead of
      // stacking a wall of identical toasts.
      setItems((list) => {
        if (list.some((t) => t.message === message && t.tone === tone)) return list;
        const id = nextId.current++;
        // Flip to "exiting" first so it plays its exit transition, then
        // actually drop it from the array once that transition is done.
        setTimeout(() => {
          setItems((cur) => cur.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
          setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), prefersReducedMotion() ? 0 : 180);
        }, 4000);
        return [...list, { id, message, tone, leaving: false }];
      });
    });
    return () => setToastRoot(null);
  }, []);

  if (items.length === 0) return null;

  return html`
    <div class="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      ${items.map((t) => html`
        <div key=${t.id} class="sk-panel sk-toast-anim rounded-lg px-4 py-2.5 text-sm shadow-lg slide-up flex items-center gap-2.5" data-state=${t.leaving ? "exiting" : "entered"}>
          <span class=${`h-1.5 w-1.5 rounded-full shrink-0 ${TOAST_TONE_DOT[t.tone] ?? TOAST_TONE_DOT.neutral}`} style="box-shadow:0 0 6px 1px currentColor"></span>
          <span class=${TOAST_TONE_TEXT[t.tone] ?? TOAST_TONE_TEXT.neutral}>${t.message}</span>
        </div>
      `)}
    </div>
  `;
}
