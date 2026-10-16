// The Arena's rulebook: XP, levels, quests, badges and streaks, as pure functions.
//
// These numbers are MIRRORED in supabase/migrations/0021_arena.sql (the server
// re-derives XP, streaks, claims and badges from the same constants so the
// rankings can't be forged from the browser). If you change anything here, change
// the SQL too: when this was written, levels, vote XP, badges and quest rules were
// checked 1:1 against the SQL functions on PostgreSQL 16 (PROGRESS.md, Arena).

export const SEASON_RE = /^\d{6}$/;

export const XP_BASE = 10;            // every accepted vote
export const PIONEER_BONUS = 5;       // first vote ever on a duel
export const MAX_FLOW_BONUS = 10;     // cap of the combo bonus
export const MIN_FLOW_MS = 600;       // faster than this is a click-through, not a judgement: no combo, no bonus
export const MAX_FLOW_MS = 12000;     // slower than this breaks the combo
export const ROUND_SIZE = 10;
export const DAILY_GOAL = 30;         // duels per day the "today" readout counts towards
export const DAILY_SET_SIZE = 10;
export const DAILY_SET_BONUS = 100;   // finishing the shared daily challenge
export const DAILY_CLEAR_BONUS = 50;  // all three daily quests claimed
export const CROWD_MIN_VOTES = 5;     // a duel needs this many earlier votes before "matching the crowd" means anything
export const IDLE_CUTOFF_S = 20;      // no input for this long = not playing; the clock stops
export const MAX_VOTES_PER_SUBMIT = 100;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Combo bonus: +1 XP per consecutive quick vote beyond the second, up to +10. */
export function flowBonus(combo) {
  return clamp(combo - 2, 0, MAX_FLOW_BONUS);
}

/** Does this answer time keep a combo alive? */
export function isFlowMs(ms) {
  return ms >= MIN_FLOW_MS && ms <= MAX_FLOW_MS;
}

/** XP of one accepted vote. `bonus` is the combo bonus the client claims; it only counts for a considered (not instant) answer. */
export function voteXp({ ms = 0, bonus = 0, pioneer = false } = {}) {
  return XP_BASE + (ms >= MIN_FLOW_MS ? clamp(Math.round(bonus), 0, MAX_FLOW_BONUS) : 0) + (pioneer ? PIONEER_BONUS : 0);
}

// ---- Levels ---------------------------------------------------------------
// Reaching level L costs 50 * L * (L - 1) XP in total (L2 = 100, L3 = 300, L10 = 4 500).

export const MAX_LEVEL = 200;
export const xpForLevel = (level) => 50 * level * (level - 1);

export function levelForXp(xp) {
  if (!(xp > 0)) return 1;
  let level = Math.floor((1 + Math.sqrt(1 + xp / 12.5)) / 2);
  while (level > 1 && xpForLevel(level) > xp) level--;
  while (level < MAX_LEVEL && xpForLevel(level + 1) <= xp) level++;
  return clamp(level, 1, MAX_LEVEL);
}

/** { level, into, span, ratio }: where `xp` sits between its level and the next one. */
export function levelProgress(xp) {
  const level = levelForXp(xp);
  const floor = xpForLevel(level);
  const span = xpForLevel(level + 1) - floor;
  const into = Math.max(0, xp - floor);
  return { level, into, span, ratio: span > 0 ? clamp(into / span, 0, 1) : 1 };
}

export const RANKS = [
  { from: 1, id: "novice" },
  { from: 3, id: "apprentice" },
  { from: 6, id: "observer" },
  { from: 10, id: "sharpEye" },
  { from: 15, id: "tastemaker" },
  { from: 20, id: "artDirector" },
  { from: 30, id: "creativeDirector" },
  { from: 40, id: "maestro" },
];

export function rankForLevel(level) {
  let r = RANKS[0];
  for (const rank of RANKS) if (level >= rank.from) r = rank;
  return r.id;
}

// ---- Days and streaks --------------------------------------------------------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (s) => typeof s === "string" && DAY_RE.test(s);

function dayNumber(day) {
  const [y, m, d] = day.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}
/** Whole days from `b` to `a` (positive when a is later). */
export const dayDiff = (a, b) => dayNumber(a) - dayNumber(b);

export function addDays(day, n) {
  const d = new Date(dayNumber(day) * 86400000 + n * 86400000);
  return d.toISOString().slice(0, 10);
}

/** The local calendar day of a Date as YYYY-MM-DD (the player's own midnight, not UTC's). */
export function localDay(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** The season (a UTC month) a date falls in: "202610". */
export function seasonOf(date = new Date()) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Streak length after activity on `day`, given the streak so far and the last active day. */
export function nextStreak(prev, lastDay, day) {
  if (!lastDay) return 1;
  const diff = dayDiff(day, lastDay);
  if (diff === 0) return Math.max(prev, 1);
  if (diff === 1) return prev + 1;
  if (diff > 1) return 1;
  return Math.max(prev, 1); // a back-dated vote from offline play never breaks or extends it
}

// ---- Quests -----------------------------------------------------------------
// `kind` names the per-day counter a quest watches (see questMetric).

export const QUEST_TIERS = ["easy", "medium", "hard"];
export const QUEST_XP = { easy: 30, medium: 60, hard: 120 };

export const QUEST_DEFS = [
  { id: "votes_15", tier: "easy", kind: "votes", target: 15 },
  { id: "fam_3", tier: "easy", kind: "families", target: 3 },
  { id: "dims_3", tier: "easy", kind: "dims", target: 3 },
  { id: "time_5", tier: "easy", kind: "time", target: 300 },
  { id: "votes_40", tier: "medium", kind: "votes", target: 40 },
  { id: "fam_5", tier: "medium", kind: "families", target: 5 },
  { id: "dims_5", tier: "medium", kind: "dims", target: 5 },
  { id: "combo_6", tier: "medium", kind: "combo", target: 6 },
  { id: "eye_5", tier: "medium", kind: "eye", target: 5 },
  { id: "time_15", tier: "medium", kind: "time", target: 900 },
  { id: "votes_100", tier: "hard", kind: "votes", target: 100 },
  { id: "combo_12", tier: "hard", kind: "combo", target: 12 },
  { id: "eye_12", tier: "hard", kind: "eye", target: 12 },
  { id: "fam_7", tier: "hard", kind: "families", target: 7 },
  { id: "time_30", tier: "hard", kind: "time", target: 1800 },
  { id: "time_60", tier: "hard", kind: "time", target: 3600 },
].map((q) => ({ ...q, xp: QUEST_XP[q.tier] }));

export const QUEST_BY_ID = Object.fromEntries(QUEST_DEFS.map((q) => [q.id, q]));

/** The day's value of the counter a quest of this kind watches. `daily` is one entry of state.daily. */
export function questMetric(daily, kind) {
  if (!daily) return 0;
  switch (kind) {
    case "votes": return daily.votes;
    case "families": return daily.families.length;
    case "dims": return daily.dims.length;
    case "combo": return daily.maxCombo;
    case "eye": return daily.eyeCorrect;
    case "time": return daily.sec;
    default: return 0;
  }
}

export function questDone(daily, def) {
  return questMetric(daily, def.kind) >= def.target;
}

/** Three quests for a day -- one per tier, never two of the same kind -- picked with the supplied PRNG. */
export function pickSlate(rand) {
  const used = new Set();
  const slate = [];
  for (const tier of QUEST_TIERS) {
    const pool = QUEST_DEFS.filter((q) => q.tier === tier && !used.has(q.kind));
    const q = pool[Math.floor(rand() * pool.length)];
    used.add(q.kind);
    slate.push(q.id);
  }
  return slate;
}

// ---- Badges -------------------------------------------------------------------
// `p` = { votes, bestStreak, bestCombo, xp, eyeCorrect, eyeTotal, crowdHits, crowdTotal, families (count),
//         bestDaySeconds, dailySets }

export const BADGE_DEFS = [
  { id: "first_vote", group: "volume", test: (p) => p.votes >= 1 },
  { id: "votes_100", group: "volume", test: (p) => p.votes >= 100 },
  { id: "votes_500", group: "volume", test: (p) => p.votes >= 500 },
  { id: "votes_1000", group: "volume", test: (p) => p.votes >= 1000 },
  { id: "votes_2500", group: "volume", test: (p) => p.votes >= 2500 },
  { id: "votes_5000", group: "volume", test: (p) => p.votes >= 5000 },
  { id: "streak_3", group: "streak", test: (p) => p.bestStreak >= 3 },
  { id: "streak_7", group: "streak", test: (p) => p.bestStreak >= 7 },
  { id: "streak_14", group: "streak", test: (p) => p.bestStreak >= 14 },
  { id: "streak_30", group: "streak", test: (p) => p.bestStreak >= 30 },
  { id: "daily_7", group: "streak", test: (p) => p.dailySets >= 7 },
  { id: "daily_30", group: "streak", test: (p) => p.dailySets >= 30 },
  { id: "combo_8", group: "skill", test: (p) => p.bestCombo >= 8 },
  { id: "combo_12", group: "skill", test: (p) => p.bestCombo >= 12 },
  { id: "eye_80", group: "skill", test: (p) => p.eyeTotal >= 30 && p.eyeCorrect * 100 >= 80 * p.eyeTotal },
  { id: "crowd_70", group: "skill", test: (p) => p.crowdTotal >= 30 && p.crowdHits * 100 >= 70 * p.crowdTotal },
  { id: "explorer", group: "skill", test: (p) => p.families >= 7 },
  { id: "level_5", group: "level", test: (p) => levelForXp(p.xp) >= 5 },
  { id: "level_10", group: "level", test: (p) => levelForXp(p.xp) >= 10 },
  { id: "level_20", group: "level", test: (p) => levelForXp(p.xp) >= 20 },
  { id: "level_30", group: "level", test: (p) => levelForXp(p.xp) >= 30 },
  { id: "hour_1", group: "time", test: (p) => p.bestDaySeconds >= 3600 },
  { id: "marathon_3h", group: "time", test: (p) => p.bestDaySeconds >= 10800 },
];
export const BADGE_IDS = BADGE_DEFS.map((b) => b.id);

export function evalBadges(p) {
  return BADGE_DEFS.filter((b) => b.test(p)).map((b) => b.id);
}

/** Progress (0..1) towards a badge, for the locked tiles. Cheap approximations of the same thresholds. */
export function badgeProgress(id, p) {
  const ratio = (v, t) => clamp(v / t, 0, 1);
  const m = /^(votes|streak|level|daily)_(\d+)$/.exec(id);
  if (m) {
    const t = Number(m[2]);
    if (m[1] === "votes") return ratio(p.votes, t);
    if (m[1] === "streak") return ratio(p.bestStreak, t);
    if (m[1] === "daily") return ratio(p.dailySets, t);
    return ratio(levelForXp(p.xp), t);
  }
  switch (id) {
    case "first_vote": return ratio(p.votes, 1);
    case "combo_8": return ratio(p.bestCombo, 8);
    case "combo_12": return ratio(p.bestCombo, 12);
    case "eye_80": return p.eyeTotal < 30 ? ratio(p.eyeTotal, 30) * 0.5 : ratio(p.eyeCorrect / p.eyeTotal, 0.8) * 0.5 + 0.5;
    case "crowd_70": return p.crowdTotal < 30 ? ratio(p.crowdTotal, 30) * 0.5 : ratio(p.crowdHits / p.crowdTotal, 0.7) * 0.5 + 0.5;
    case "explorer": return ratio(p.families, 7);
    case "hour_1": return ratio(p.bestDaySeconds, 3600);
    case "marathon_3h": return ratio(p.bestDaySeconds, 10800);
    default: return 0;
  }
}
