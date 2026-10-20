# Affinix — UX Architecture

Written before touching any UI, per the brief's own instruction. Everything
here is designed against the real schema (`supabase/migrations/0001_init.sql`)
and the real code already in `src/` — nothing below requires inventing data
or a capability the product doesn't actually have.

## 0. Audit — what's actually wrong today

Read every page before writing this. Findings, in the brief's own terms:

- **What the user sees first**: Overview — 4 equal-weight stat tiles, then
  two equal-weight charts, then two equal-weight list cards. Eight blocks of
  identical visual weight. Nothing says "look here first."
- **Primary action**: there are *three* button-shaped CTAs on Overview alone
  (sidebar "Новое исследование", header "Новое исследование", header
  "Открыть последние результаты") plus the sidebar's own nav. No single
  dominant action.
- **Empty states**: a brand-new workspace still renders a flat-line chart
  and an empty donut ring (0/0/0/0) instead of not rendering a chart at all.
  Confirmed directly from the live screenshots in this session.
- **Navigation hierarchy**: actually already close to the brief's ask
  (Обзор/Исследования/Участники/Результаты/Инсайты/Отчёты +
  Команда/Биллинг/Профиль/Настройки) — this part doesn't need rework, just
  the rename noted in §1.
- **Experiment creation**: a 7-step linear form. Steps 1–3 and 5–7 are fine.
  Step 4 ("Add question" → type dropdown → role dropdown → raw prompt
  textbox) is exactly the generic-form-builder feel the brief objects to —
  this is the single biggest real gap, not the visual theme.
- **A/B/C/D comprehension**: variants are consistently labeled A/B/C/D with
  real upload cards in step 3 — clear in isolation, but step 4 never shows
  the variants again, so "what am I comparing" is lost exactly where it
  matters most.
- **Researcher vs. participant separation**: already correct and should be
  preserved, not rebuilt — `ParticipantRunner.js`'s `LiveRunner` is already
  a distraction-free, full-screen, one-question-at-a-time flow with no
  sidebar, no dashboard chrome. The brief asks for exactly this; it exists.
- **AI insights**: already structured as three cards (What happened / Why it
  might have happened / Recommendation with a confidence badge), not one
  prose block. Needs a reshuffle into the brief's exact labels and an
  evidence drill-down, not a rebuild.
- **Results**: no "winner" hero, no cross-metric comparison matrix — results
  are a stack of per-question cards in creation order, so "who won / why /
  how confident" takes real reading, not 10 seconds.
- **Template feel**: `Card`/`Badge`/`StatTile` are reused identically,
  unchanged, on every single page with no page-specific hierarchy — this
  reads as a generic admin template because structurally, every page *is*
  the same template right now.

Conclusion: the information architecture and the researcher/participant
split are already sound. The real work is (a) an adaptive, single-CTA
dashboard, (b) a comparison-first builder for step 4, (c) a Results page
that leads with the answer, and (d) empty states that don't render fake-
looking empty charts. That's a focused scope, not a rewrite of everything.

## 1. Mental model & sitemap

```
СОЗДАТЬ ИССЛЕДОВАНИЕ → СОБРАТЬ ОТВЕТЫ → ПОНЯТЬ РЕЗУЛЬТАТ → ПРИНЯТЬ РЕШЕНИЕ
```

```
/                          Landing (public)
/login /register /forgot-password /reset-password /onboarding
/u/:username               Public researcher profile (opt-in, public)
/research/:slug            Participant flow (public, no chrome)

/app/overview               ← adaptive dashboard (§3)
/app/experiments            ← research workspace (§4)
/app/experiments/new        ← guided creation flow (§5)
/app/experiments/:id/edit
/app/experiments/:id/results   \
/app/results                    ⟩ same page, §8
/app/experiments/:id/insights  \
/app/insights                   ⟩ same page, §9
/app/participants           ← response/panel table
/app/reports                ← downloadable summary

/app/team
/app/billing  →  rename label to "Баланс" (see §10; route path unchanged)
/profile                    ← account center, §10
/app/settings               ← org + research defaults
```

No new top-level sections. The brief's nav (§2/§6 of the brief) is what's
already shipped; the only change is the sidebar label Биллинг → **Баланс**
(§10), since that word better matches "where my money/rewards are," once
rewards exist. Until rewards exist, the page itself keeps the honest
"no payment data yet" state already in place — only the label moves.

## 2. CTA rule (applies to every page in this document)

**One filled/primary button per screen.** Everything else is `secondary`,
`ghost`, or `outline`. Concretely:

| Page | The one primary CTA |
|---|---|
| Overview | "Создать исследование" (state A) / none — the research card's own action is primary (state B/C) |
| Исследования (list) | "Создать исследование" |
| Research creation | the current step's "Продолжить" / final step's "Опубликовать" |
| Результаты | none page-level — "Открыть инсайты" is a text link, not a button |
| Профиль | "Сохранить изменения" (only on the tab with unsaved changes) |

Sidebar's own "+ Новое исследование" stays (it's chrome, always visible,
not competing with a page's in-content CTA) — but a page body never repeats
a second filled button for the same action the sidebar already offers.

## 3. Dashboard — adaptive by state, not by template

Single page, three mutually-exclusive render branches. State is a pure
function of real queries already available via `useExperiments()` /
`useOrgSessions()` — no new backend work:

```
hasAnyExperiment      = experiments.length > 0
hasCollectingResearch = experiments.some(e => e.status in [published, paused]
                                               && summary(e).participantCount > 0)
hasCompletedWithData  = experiments.some(e => e.status == completed
                                               || (summary(e).sampleSize.sufficient))
```

**State A — new workspace** (`!hasAnyExperiment`):
```
Добро пожаловать, {Имя}
Создайте исследование и получите данные о том, как люди выбирают.

[ Создать исследование ]   ← single primary CTA, large

  1 ──────── 2 ──────── 3
Создайте    Добавьте     Получите
исследование  A/B/C/D    результаты
```
No charts, no stat tiles, no "0 participants" anywhere. A dashboard with
nothing to show says so in one sentence, not in four empty widgets.

**State B — actively collecting** (`hasCollectingResearch`):
```
Добро пожаловать, {Имя}
Вот что происходит с вашими исследованиями.

[ Текущее исследование card ]        <- the most recently updated
  {name}                                published/paused experiment:
  {n} / {target} участников            name, progress bar, participant
  [progress bar]                       count, completion rate, one
  Доля завершения: {rate}              "Посмотреть результаты" link
  Открыть результаты →

Compact secondary row (not giant cards): Активные · Всего участников ·
Доля завершения — three numbers in one bar, not three StatTiles.
```

**State C — has a completed result** (`hasCompletedWithData`):
```
Добро пожаловать, {Имя}
Вот что происходит с вашими исследованиями.

[ Latest result card ]
  {experiment name} — ЗАВЕРШЕНО
  Победил: Вариант B · 48% (n=248)
  Ключевой вывод: {insights.whatHappened[0]}
  [ Открыть результаты ]            ← primary CTA here, not "new research"
```

If more than one experiment qualifies for B or C, show the single most
recently updated one plus a plain "Все исследования →" link — never a
second competing card of equal weight.

## 4. Research workspace (`/app/experiments`)

Already close to spec; target shape:

```
Исследования                              [ Создать исследование ]
Создавайте и управляйте исследованиями

[Все] [Черновики] [Активные] [Завершённые]        [ 🔍 Поиск ]

┌─────────────────────────────────────────────────────────────┐
│ Название              ЗАВЕРШЕНО   12 окт   84 участника  ▓▓▓░│
│ Тип · 4 варианта · 92% завершения      [Открыть] [···]       │
└─────────────────────────────────────────────────────────────┘
```

One row = name, status, date, participants, a compact progress bar,
variant/completion summary, two actions visible (primary: Open; secondary:
a `···` menu for Duplicate/Edit/Archive/Delete) — collapsing the current
five always-visible icon-buttons into one menu for anything other than the
single most relevant action per status (draft → Edit+Publish stay visible,
since both are equally likely next steps).

## 5. Research creation — guided flow, not a form

Reconciled against the real schema (`experiments`, `experiment_variants`,
`experiment_questions.role text` — free-form, so new dimension names need
*zero migration*):

```
Шаг 1 — Что вы исследуете?
  Реклама · Упаковка · Продукт · Логотип · Сайт · Приложение · Цена · Другое
  → sets experiments.category (existing column), not a new field

Шаг 2 — Что вы хотите узнать?
  Multi-select goal chips (Что выберут? / Что заметят первым? / Что кажется
  надёжнее? / Что выглядит дороже? / Что запоминается? / Что проще понять?
  / Что вызывает больше доверия?)
  → each selected goal maps 1:1 to a row in the §12 measurement library;
    this selection is just a pre-check in step 4, changeable there

Шаг 3 — Варианты (unchanged — already good: A/B/C/D upload cards)

Шаг 4 — Сравнение  (THE rebuild — see §6)

Шаг 5 — Участники (unchanged — target count/age/country/language/demo Qs)

Шаг 6 — Настройки (unchanged — randomization/consent/duplicates/time limit)

Шаг 7 — Превью и публикация (merge current steps 6(preview)+7 into one:
  checklist + "Предпросмотр глазами участника" + Publish, so there's one
  review screen, not two)
```

Net change from today: steps 1+2 (name/objective/category/audience) absorb
the brief's "what/why" framing without new fields; step 2 (research type)
becomes the new goal-chips step; step 4 is rebuilt (§6); everything else
keeps its current, already-working implementation.

## 6. Comparison builder (replaces today's Step 4)

Three-panel layout on desktop, single-column stepped on mobile (§13):

```
┌ ИЗМЕРЕНИЯ ───┬ ТЕКУЩЕЕ ИССЛЕДОВАНИЕ ─────────────┬ НАСТРОЙКИ ВОПРОСА ─┐
│              │                                    │                     │
│ ○ Предпочт.  │  01 Предпочтение            [✕]   │ Обязательный   [x]  │
│ ○ Доверие    │     "Какой вариант вы бы            │ Рандомизация   [x]  │
│ ● Премиальн. │      выбрали?"                       │ Лимит времени  [ ]  │
│ ○ Понятность │     [A] [B] [C] [D]                 │                     │
│ ○ Запомин.   │                                     │                     │
│ ○ Внимание   │  02 Премиальность           [✕]   │                     │
│ ○ Цена       │     "Какой вариант выглядит          │                     │
│              │      наиболее премиальным?"          │                     │
│ + Своё       │     [A] [B] [C] [D]                 │                     │
└──────────────┴────────────────────────────────────┴─────────────────────┘
```

Clicking a dimension in the left list appends a block to the center column
and auto-generates the underlying row — no manual type/role/prompt entry:

| Dimension (left list) | `experiment_questions` row created |
|---|---|
| Предпочтение | `type=single_choice, applies_to=variants, role=selection, prompt=t("builder.dims.preference.prompt")` |
| Доверие | `role=trust`, prompt "Какой вариант вызывает больше доверия?" |
| Премиальность | `role=premium` (existing role, already read by `lib/insights.js`) |
| Понятность | `role=clarity` |
| Запоминаемость | `role=recall`, `type=recall` (existing type, already supported) |
| Внимание (первое впечатление) | `role=attention` |
| Цена | `type=price_perception` (existing type) |
| Своё | opens today's manual editor, unchanged, for anything the library doesn't cover |

`role` is a free-text column today, so `trust`/`clarity`/`attention` need
no migration — only `lib/insights.js` and the results matrix (§8) need to
recognize the new role strings, same way they already special-case
`premium`/`recall`. A dimension already added shows checked/disabled in the
left list (can't add "Доверие" twice); removing a center block un-checks it.

**Recommended set** (brief §12): when variants are first added (step 3 →
4 transition) with zero questions yet, show one line above the three-panel
view: *"Рекомендуемый набор: Первое впечатление, Предпочтение, Доверие,
Понятность, Запоминаемость · ~3–5 мин"* with **"Добавить все"** (adds all
five in one click) or **"Настроить"** (dismisses the suggestion, same
three-panel view, empty). Order = first-impression framing first (matches
real survey methodology: capture gut reaction before analytical
questions), selection/trust/clarity next, recall last (recall must be
asked after exposure has had time to fade, not immediately).

## 7. Participant flow — confirm, refine, don't rebuild

Already matches the brief almost exactly. Specific refinements only:
- `ProgressBar` currently shows "2 of 6" as plain segments — add the
  numeric "Вопрос {n} из {total}" label the brief asks for explicitly.
- Large tap targets: `StimulusCard` is already a big tappable card; audit
  only for minimum 44×44px on the yes/no and rating sub-buttons inside it
  on mobile widths (§13).
- Nothing else changes — no sidebar, no dashboard chrome, one question at
  a time, is already the exact implementation.

## 8. Results — lead with the answer

Reorder from "stack of per-question cards" to:

```
Эксперимент: {name}                                   [Инсайты ИИ →]

┌─────────────────────────────────────┐
│  ПОБЕДИЛ: Вариант B                  │   ← hero, only if selQ exists
│  48% · n=248 · [Badge: достаточно]   │     and sample is sufficient;
└─────────────────────────────────────┘     otherwise an honest
                                             "Пока недостаточно данных"
                                             state, no hero

Матрица сравнения
              A      B      C      D
Предпочтение  24%    48%    18%    10%
Доверие       31%    57%    29%    —      (— = dimension not asked)
Премиальность 41%    66%    —      —
Запоминание   22%    51%    —      —

Лучший показатель по каждой метрике bolded/highlighted — grounded strictly
in this experiment's own matrix row, never phrased as a universal claim.

Ключевой вывод (1–2 sentences, pulled from lib/insights.js whatHappened[0])

[ Открыть полные инсайты → ]
```

The existing per-question detail cards (chart + CI per question) move
below the matrix as "Подробности по вопросам" — still there for a
researcher who wants to dig in, just no longer the first thing on the page.
Matrix rows = the dimension roles actually asked in *this* experiment
(§6's role vocabulary) — an experiment that only asked Preference+Trust
shows a 2-row matrix, not placeholder dashes for dimensions nobody asked.

## 9. AI insights — relabel into the brief's structure

Already three structured cards; relabel/regroup to:

```
КЛЮЧЕВОЙ ВЫВОД         (= current "Что произошло"[0])
ДОКАЗАТЕЛЬСТВО         (= the stat the finding is based on, e.g. "48% participants selected B, n=248")
ПОЧЕМУ ЭТО ВАЖНО       (= current whyMightHaveHappened, causal-disclaimer kept verbatim)
СЛЕДУЮЩИЙ ТЕСТ         (= new: one templated suggestion, e.g. "Сравните {top} с упрощённой версией")
[ Показать данные ▾ ]  ← expands to the raw numbers the card is grounded in
```

"Показать данные" is the brief's explicit anti-black-box requirement — it
expands inline to the exact `choiceStatsForQuestion` row the sentence was
generated from, not a link elsewhere. Confidence badge and the disclaimer
block stay exactly as-is (they're already correct and required).

## 10. Profile — rename tabs, don't restructure

Current 5 tabs (Личная информация/Безопасность/Уведомления/Предпочтения/
Сессии) already cover the brief's ask; mapping:

| Brief wants | Already have |
|---|---|
| Профиль | Личная информация |
| Безопасность | Безопасность (unchanged) |
| Уведомления | Уведомления (unchanged) |
| Язык | split out of "Предпочтения" (which also holds timezone) into its own visible top-level tab, since the brief calls it out specifically |
| Платежи | new tab — but it's the **same page** as `/app/billing`, just also reachable from Profile; no new balance data invented (same honest empty state as §1/§10's "Баланс" rename) |

No giant settings form either way — already row-based, already minimal.

## 11. Participant account / marketplace view — deferred, not designed yet

This needs a real payment-provider and currency decision before any UI is
worth building (a reward amount shown anywhere, even "+300 ₸" as a demo
label, is exactly the fabricated-balance problem the project has
explicitly ruled out everywhere else). Tracked, not scoped further here —
revisit once that business decision is made.

## 12. Visual language — direction, not a new token set

The existing dark surface/indigo-accent system is kept (it already reads
as "premium dark SaaS," which was never the complaint) — the complaint is
*information density and hierarchy*, which §§3/4/6/8 fix structurally.
Concretely enforced from here on, on every page in this document:
- exactly one primary button (§2);
- no chart renders with zero underlying data — an empty state renders
  instead, every time, no exceptions;
- no two cards of equal visual weight compete for first attention — one
  hero element per page, everything else visibly secondary.

## 13. Mobile

- Participant flow: already mobile-first (full-screen, no chrome) — verify
  touch targets per §7, nothing structural to change.
- Researcher app: sidebar already collapses to a slide-over below `lg:`
  (existing `Shell` behavior) — keep. Dashboard states (§3) already stack
  single-column at that width by virtue of the existing grid classes.
  The comparison builder (§6)'s three-panel layout becomes three sequential
  steps on mobile (library picker → flow → settings), not three squeezed
  columns — same data, stepped presentation only below `lg:`.

## 14. Sequencing

1. §3 dashboard states + empty-state audit (§12 rule 2) — small, high
   visible impact, no schema change.
2. §8 Results reorder + matrix — depends on nothing else, ships standalone.
3. §9 AI insight card relabel + evidence drill-down — small, after §8's
   matrix exists to pull the evidence from.
4. §6 comparison builder — the large one; §5's steps 1–2 are a thin
   wrapper around it and ship together.
5. §4 research list refinements, §10 profile tab rename — small, any time.
6. §11 — on hold pending the payment-provider decision already flagged.

Each step is independently shippable and independently testable against
the local Postgres harness this project has used throughout — no step
requires the others to be in-flight first.
