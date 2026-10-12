import { html, useState, useEffect, useRef } from "../lib/preact.js";
import { Icon } from "./icons.js";
import { useMountTransition, prefersReducedMotion } from "../lib/motion.js";

export function Card({ className = "", children, ...rest }) {
  return html`<div class=${`sk-panel rounded-xl ${className}`} ...${rest}>${children}</div>`;
}

export function SectionHeading({ title, subtitle, action }) {
  return html`
    <div class="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div>
        <h2 class="text-lg font-semibold text-slate-100 tracking-tight">${title}</h2>
        ${subtitle && html`<p class="text-sm text-slate-400 mt-0.5">${subtitle}</p>`}
      </div>
      ${action && html`<div class="shrink-0">${action}</div>`}
    </div>
  `;
}

const BUTTON_VARIANTS = {
  primary: "sk-btn sk-btn-primary",
  secondary: "sk-btn text-slate-100",
  ghost: "bg-transparent hover:bg-white/5 text-slate-300",
  danger: "sk-btn text-white",
  outline: "bg-transparent border border-slate-700 hover:border-slate-500 text-slate-200",
};

const DANGER_STYLE = "background:linear-gradient(180deg,#fb7185 0%,#f43f5e 55%,#e11d48 100%);border:1px solid rgba(255,255,255,.15);box-shadow:inset 0 1px 0 rgba(255,255,255,.3),inset 0 -1px 0 rgba(136,19,55,.5),0 4px 14px -4px rgba(225,29,72,.5)";

export function Button({ variant = "primary", size = "md", className = "", children, disabled, style, ...rest }) {
  const sizes = { sm: "px-3 py-1.5 text-sm", md: "px-4 py-2 text-sm", lg: "px-5 py-2.5 text-base" };
  const extraStyle = variant === "danger" ? `${DANGER_STYLE};${style ?? ""}` : style;
  return html`
    <button
      class=${`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed ${BUTTON_VARIANTS[variant]} ${sizes[size]} ${className}`}
      style=${extraStyle}
      disabled=${disabled}
      ...${rest}
    >${children}</button>
  `;
}

const BADGE_TONES = {
  slate: "bg-slate-800 text-slate-300 border-slate-700",
  indigo: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  amber: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  rose: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  teal: "bg-teal-500/15 text-teal-300 border-teal-500/30",
};

export function Badge({ tone = "slate", className = "", children }) {
  return html`<span class=${`sk-badge inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${BADGE_TONES[tone]} ${className}`}>${children}</span>`;
}

export function DemoTag({ className = "" }) {
  return html`<${Badge} tone="amber" className=${className}>Demo data · illustrative<//>`;
}

export function StatTile({ label, value, hint, tone = "slate" }) {
  return html`
    <div class="sk-panel-flat rounded-xl p-4">
      <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">${label}</div>
      <div class="sk-display rounded-lg mt-2 px-3 py-2.5">
        <div class="text-2xl font-semibold text-slate-50" style="font-variant-numeric:tabular-nums; letter-spacing:.01em">${value}</div>
      </div>
      ${hint && html`<div class="mt-1.5 text-xs text-slate-500">${hint}</div>`}
    </div>
  `;
}

export function ProgressBar({ value, tone = "indigo" }) {
  const colors = {
    indigo: "linear-gradient(180deg,#818cf8,#6366f1)",
    emerald: "linear-gradient(180deg,#34d399,#10b981)",
    amber: "linear-gradient(180deg,#fbbf24,#f59e0b)",
    rose: "linear-gradient(180deg,#fb7185,#f43f5e)",
    teal: "linear-gradient(180deg,#2dd4bf,#14b8a6)",
  };
  const pctVal = Math.max(0, Math.min(1, value ?? 0)) * 100;
  return html`
    <div class="sk-display h-2.5 w-full rounded-full overflow-hidden">
      <div class="sk-progress-fill h-full rounded-full" style=${{ width: `${pctVal}%`, background: colors[tone] ?? colors.indigo, boxShadow: "0 0 8px -1px rgba(99,102,241,.6), inset 0 1px 0 rgba(255,255,255,.3)", transition: "width var(--sk-dur-slow) var(--sk-ease-out)" }}></div>
    </div>
  `;
}

export function Spinner({ size = 18, className = "" }) {
  return html`<span class=${`sk-spinner shrink-0 ${className}`} style=${{ width: `${size}px`, height: `${size}px` }}></span>`;
}

/** A single content-shaped placeholder block -- size/shape via className
 * (e.g. "h-4 w-32", "h-9 w-9 rounded-full"). Compose a few of these into
 * the real layout's shape for a loading list/table/card, instead of a
 * generic spinner, wherever that shape is worth mimicking. */
export function Skeleton({ className = "" }) {
  return html`<div class=${`sk-skeleton ${className}`}></div>`;
}

/** Drop-in replacement for a bare "Loading…" line -- a small centered
 * spinner with an optional label, for a page/section gate too short-lived
 * or too irregularly shaped to be worth a bespoke skeleton. */
export function LoadingState({ label, className = "" }) {
  return html`
    <div class=${`flex items-center justify-center gap-2.5 py-10 text-sm text-slate-500 ${className}`}>
      <${Spinner} size=${16} />
      ${label}
    </div>
  `;
}

export function EmptyState({ title, body, action, icon = "sparkle" }) {
  return html`
    <div class="sk-panel flex flex-col items-center justify-center text-center py-14 px-6 rounded-xl">
      <div class="sk-display mb-4 flex h-16 w-16 items-center justify-center rounded-full text-slate-600"><${Icon} name=${icon} size=${26} strokeWidth=${1.4} /></div>
      <h3 class="text-base font-semibold text-slate-200">${title}</h3>
      ${body && html`<p class="text-sm text-slate-500 mt-1.5 max-w-sm">${body}</p>`}
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
          <h3 class="font-semibold text-slate-100">${title}</h3>
          <button class="sk-btn h-7 w-7 rounded-md text-slate-400 hover:text-slate-100 text-sm" onClick=${onClose}>✕</button>
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
              active === t.id ? "text-white" : "text-slate-400 hover:text-slate-200"
            }`}
          >${t.label}</button>
        `
      )}
    </div>
  `;
}

const CONFIDENCE_TONE = { high: "emerald", moderate: "teal", "low-moderate": "amber", low: "amber", none: "slate" };

/** `t` is the caller's useT()-bound translator. */
export function ConfidenceBadge({ confidence, t }) {
  const label = t ? t(`insights.confidence.${confidence}`) : confidence;
  return html`<${Badge} tone=${CONFIDENCE_TONE[confidence] ?? "slate"}>${label}<//>`;
}

export function Field({ label, hint, children, required }) {
  return html`
    <label class="block mb-4">
      <span class="block text-sm font-medium text-slate-300 mb-1.5">${label}${required && html`<span class="text-rose-400"> *</span>`}</span>
      ${children}
      ${hint && html`<span class="block text-xs text-slate-500 mt-1">${hint}</span>`}
    </label>
  `;
}

const inputBase = "sk-input w-full rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 disabled:opacity-40 disabled:cursor-not-allowed";

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
    <label class="flex items-center gap-2.5 text-sm text-slate-300 cursor-pointer select-none py-1">
      <input type="checkbox" class=${`sk-checkbox h-4 w-4 rounded ${className}`} ...${rest} />
      ${label}
    </label>
  `;
}

export function Switch({ checked, onChange, label }) {
  return html`
    <label class="flex items-center justify-between gap-3 py-2 cursor-pointer select-none">
      <span class="text-sm text-slate-300">${label}</span>
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
export function toast(message, tone = "slate") { toastRoot?.(message, tone); }

const TOAST_TONE_TEXT = {
  slate: "text-slate-100",
  emerald: "text-emerald-300",
  rose: "text-rose-300",
  amber: "text-amber-300",
};
const TOAST_TONE_DOT = {
  slate: "bg-slate-400",
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
          <span class=${`h-1.5 w-1.5 rounded-full shrink-0 ${TOAST_TONE_DOT[t.tone] ?? TOAST_TONE_DOT.slate}`} style="box-shadow:0 0 6px 1px currentColor"></span>
          <span class=${TOAST_TONE_TEXT[t.tone] ?? TOAST_TONE_TEXT.slate}>${t.message}</span>
        </div>
      `)}
    </div>
  `;
}
