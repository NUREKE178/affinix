// Arena progress as plain data and pure functions.
//
// A player's state is `base` (the totals as last confirmed by the server, or as
// built locally when there is no server) plus a short list of PENDING events not
// yet confirmed: votes, time slices, quest claims. What is shown is always
// fold(base, pending). When the server confirms a batch, `base` is replaced by
// its numbers and those events leave the list, so nothing is counted twice and
// nothing flickers. The shapes match what supabase/migrations/0021_arena.sql returns.
import { FAMILY_IDS } from "./catalog.js";
import {
  XP_BASE, DAILY_SET_SIZE, DAILY_SET_BONUS, DAILY_CLEAR_BONUS, DAILY_GOAL, QUEST_BY_ID,
  EXTRA_SETS, SET_SIZE, SET_BONUS, THEME_GOAL, THEME_BONUS, THEME_QUEST, setQuestId, weekStart, themeIndex,
  nextStreak, dayDiff, addDays, levelProgress, rankForLevel, evalBadges, BADGE_DEFS, badgeProgress, questMetric, questDone,
} from "./rules.js";

export function emptyProfile() {
  return {
    xp: 0, votes: 0, eyeCorrect: 0, eyeTotal: 0, crowdHits: 0, crowdTotal: 0, bestCombo: 0,
    streak: 0, bestStreak: 0, lastDay: null, activeSeconds: 0, bestDaySeconds: 0, dailySets: 0,
    families: [], badges: [], visible: true,
  };
}

export function emptyDay(day) {
  return {
    day, votes: 0, xp: 0, sec: 0, maxCombo: 0, eyeCorrect: 0, eyeTotal: 0, crowdHits: 0, crowdTotal: 0,
    dailyVotes: 0, families: [], dims: [], slate: [], claimed: [],
    setVotes: EXTRA_SETS.map(() => 0), familyVotes: {},
  };
}

export function emptyBase() {
  return { profile: emptyProfile(), days: {} };
}

const addTo = (arr, x) => (arr.includes(x) ? arr : [...arr, x]);

function cloneBase(base) {
  const days = {};
  for (const [k, d] of Object.entries(base.days)) days[k] = { ...d, families: [...d.families], dims: [...d.dims], slate: [...d.slate], claimed: [...d.claimed], setVotes: [...(d.setVotes ?? EXTRA_SETS.map(() => 0))], familyVotes: { ...(d.familyVotes ?? {}) } };
  return { profile: { ...base.profile, families: [...base.profile.families], badges: [...base.profile.badges] }, days };
}

const dayOf = (st, day) => (st.days[day] ??= emptyDay(day));

/** Applies one vote to a working copy. `v`: { day, family, dim, xp, combo, daily, eye (bool|null), crowd (bool|null) } */
function applyVote(st, v) {
  const p = st.profile;
  const d = dayOf(st, v.day);
  p.xp += v.xp;
  p.votes += 1;
  if (v.eye !== null && v.eye !== undefined) { p.eyeTotal++; if (v.eye) p.eyeCorrect++; d.eyeTotal++; if (v.eye) d.eyeCorrect++; }
  if (v.crowd !== null && v.crowd !== undefined) { p.crowdTotal++; if (v.crowd) p.crowdHits++; d.crowdTotal++; if (v.crowd) d.crowdHits++; }
  p.bestCombo = Math.max(p.bestCombo, Math.min(v.combo ?? 0, p.votes));
  p.families = addTo(p.families, v.family);
  const prevLast = p.lastDay;
  p.streak = nextStreak(p.streak, prevLast, v.day);
  if (!prevLast || dayDiff(v.day, prevLast) > 0) p.lastDay = v.day;
  p.bestStreak = Math.max(p.bestStreak, p.streak);
  d.votes += 1;
  d.xp += v.xp;
  d.maxCombo = Math.max(d.maxCombo, Math.min(v.combo ?? 0, d.votes));
  if (v.daily) d.dailyVotes += 1;
  else if (v.set >= 2 && v.set < 2 + EXTRA_SETS.length) d.setVotes[v.set - 2] += 1;
  d.familyVotes[v.family] = (d.familyVotes[v.family] ?? 0) + 1;
  d.families = addTo(d.families, v.family);
  d.dims = addTo(d.dims, v.dim);
}

function applySlice(st, s) {
  const d = dayOf(st, s.day);
  d.sec += s.sec;
  st.profile.activeSeconds += s.sec;
  st.profile.bestDaySeconds = Math.max(st.profile.bestDaySeconds, d.sec);
}

export function claimReward(questId) {
  if (questId === "daily_set") return DAILY_SET_BONUS;
  if (questId === "daily_clear") return DAILY_CLEAR_BONUS;
  if (questId === THEME_QUEST) return THEME_BONUS;
  if (/^set_[2-6]$/.test(questId)) return SET_BONUS;
  return QUEST_BY_ID[questId]?.xp ?? 0;
}

function applyClaim(st, c) {
  const d = dayOf(st, c.day);
  if (d.claimed.includes(c.quest)) return;
  const reward = claimReward(c.quest);
  d.claimed.push(c.quest);
  d.xp += reward;
  st.profile.xp += reward;
  if (c.quest === "daily_set") st.profile.dailySets += 1;
}

function badgeInput(p) {
  return {
    votes: p.votes, bestStreak: p.bestStreak, bestCombo: p.bestCombo, xp: p.xp,
    eyeCorrect: p.eyeCorrect, eyeTotal: p.eyeTotal, crowdHits: p.crowdHits, crowdTotal: p.crowdTotal,
    families: p.families.length, bestDaySeconds: p.bestDaySeconds, dailySets: p.dailySets,
  };
}

/** The state to show: base plus everything pending. Returns a fresh object; `base` is left alone. */
export function fold(base, pending = {}) {
  const st = cloneBase(base);
  for (const v of pending.votes ?? []) applyVote(st, v);
  for (const s of pending.slices ?? []) applySlice(st, s);
  if (pending.slate && !dayOf(st, pending.slate.day).slate.length) dayOf(st, pending.slate.day).slate = [...pending.slate.ids];
  for (const c of pending.claims ?? []) applyClaim(st, c);
  st.profile.badges = [...new Set([...st.profile.badges, ...evalBadges(badgeInput(st.profile))])];
  return st;
}

/** Streak as it stands on `today`: a streak that was last extended before yesterday is over. */
export function liveStreak(profile, today) {
  if (!profile.lastDay) return 0;
  return dayDiff(today, profile.lastDay) <= 1 ? profile.streak : 0;
}

export function deriveView(st, today) {
  const p = st.profile;
  const day = st.days[today] ?? emptyDay(today);
  const lp = levelProgress(p.xp);
  const bi = badgeInput(p);
  const streak = liveStreak(p, today);
  const doneToday = p.lastDay === today;

  const quests = day.slate.map((id) => {
    const def = QUEST_BY_ID[id];
    if (!def) return null;
    const progress = questMetric(day, def.kind);
    return { ...def, progress: Math.min(progress, def.target), done: questDone(day, def), claimed: day.claimed.includes(id) };
  }).filter(Boolean);
  const allClaimed = quests.length === 3 && quests.every((q) => q.claimed);

  const heat = [];
  for (let i = 83; i >= 0; i--) {
    const k = addDays(today, -i);
    const d = st.days[k];
    heat.push({ day: k, votes: d?.votes ?? 0, sec: d?.sec ?? 0 });
  }

  // Stage 3: the five extra sets of today, and the theme of this week
  const sets = EXTRA_SETS.map((n) => {
    const votes = Math.min(day.setVotes?.[n - 2] ?? 0, SET_SIZE);
    return { n, votes, size: SET_SIZE, done: votes >= SET_SIZE, claimed: day.claimed.includes(setQuestId(n)), bonus: SET_BONUS };
  });
  const monday = weekStart(today);
  const themeFamily = FAMILY_IDS[themeIndex(today, FAMILY_IDS.length)];
  let themeVotes = 0;
  let themeClaimed = false;
  for (let i = 0; i < 7; i++) {
    const d = st.days[addDays(monday, i)];
    if (!d) continue;
    themeVotes += d.familyVotes?.[themeFamily] ?? 0;
    if (d.claimed.includes(THEME_QUEST)) themeClaimed = true;
  }
  const theme = { family: themeFamily, votes: Math.min(themeVotes, THEME_GOAL), goal: THEME_GOAL, done: themeVotes >= THEME_GOAL, claimed: themeClaimed, bonus: THEME_BONUS, weekStart: monday };

  return {
    xp: p.xp,
    level: lp.level,
    rank: rankForLevel(lp.level),
    levelInto: lp.into,
    levelSpan: lp.span,
    levelRatio: lp.ratio,
    votes: p.votes,
    eye: { correct: p.eyeCorrect, total: p.eyeTotal },
    crowd: { hits: p.crowdHits, total: p.crowdTotal },
    bestCombo: p.bestCombo,
    streak,
    bestStreak: p.bestStreak,
    streakDoneToday: doneToday,
    streakAtRisk: !doneToday && streak > 0,
    activeSeconds: p.activeSeconds,
    bestDaySeconds: p.bestDaySeconds,
    dailySets: p.dailySets,
    visible: p.visible,
    today: day,
    goal: { done: Math.min(day.votes, DAILY_GOAL), target: DAILY_GOAL },
    daily: {
      done: day.dailyVotes >= DAILY_SET_SIZE,
      votes: Math.min(day.dailyVotes, DAILY_SET_SIZE),
      size: DAILY_SET_SIZE,
      claimed: day.claimed.includes("daily_set"),
      bonus: DAILY_SET_BONUS,
    },
    quests,
    sets,
    theme,
    clear: { ready: allClaimed && !day.claimed.includes("daily_clear"), claimed: day.claimed.includes("daily_clear"), bonus: DAILY_CLEAR_BONUS },
    badges: BADGE_DEFS.map((b) => ({ id: b.id, group: b.group, unlocked: p.badges.includes(b.id), progress: p.badges.includes(b.id) ? 1 : badgeProgress(b.id, bi) })),
    badgeCount: p.badges.length,
    heat,
    familiesSeen: p.families.length,
    xpBase: XP_BASE,
  };
}
