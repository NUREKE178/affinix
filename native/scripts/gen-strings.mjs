// Generates composeApp/src/commonMain/kotlin/space/affinix/app/i18n/Strings.kt from the website's locale files, so the apps
// say exactly what the site says, in ru / kk / en. Run from the repo root:  node native/scripts/gen-strings.mjs
import { writeFileSync } from "node:fs";
import ru from "../../src/lib/locales/ru.js";
import kk from "../../src/lib/locales/kk.js";
import en from "../../src/lib/locales/en.js";

const DIMS = ["preference", "attention", "trust", "quality", "premium", "clarity", "purchaseIntent", "friendly", "modern", "natural", "energetic"];
const FAMILIES = ["mark", "palette", "button", "card", "pack", "poster", "appicon", "scene", "shot"];
const RANKS = ["novice", "apprentice", "observer", "sharpEye", "tastemaker", "artDirector", "creativeDirector", "maestro"];

const NAMED_BADGES = Object.keys(ru.arena.badge);

const get = (o, path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);

const KEYS = [
  "shell.notifications.title", "shell.notifications.empty", "shell.notifications.commentOn", "shell.notifications.friendRequest", "shell.notifications.friendAccepted",
  "arena.tabs.quests", "arena.quests.today", "arena.quests.resetNote", "arena.quests.claim", "arena.quests.claimed", "arena.quests.clearTitle", "arena.quests.clearBody",
  "arena.quest.votes", "arena.quest.families", "arena.quest.dims", "arena.quest.combo", "arena.quest.eye", "arena.quest.time",
  "arena.tier.easy", "arena.tier.medium", "arena.tier.hard", "arena.toast.claimed", "arena.toast.claimRefused", "arena.lobby.dailyClaim",
  "arena.badgeName.votes", "arena.badgeName.streak", "arena.badgeName.daily", "arena.badgeName.level",
  ...NAMED_BADGES.flatMap((b) => [`arena.badge.${b}.name`, `arena.badge.${b}.desc`]),
  "arena.profile.badges", "arena.rankings.visible", "arena.rankings.visibleHint", "arena.rankings.saveFailed", "arena.rankings.serverPending",
  "profile.personal.fullNameLabel", "profile.personal.usernameLabel", "profile.personal.usernamePlaceholder", "profile.personal.usernameHint", "profile.personal.usernameHintInvalid",
  "profile.personal.roleTitleLabel", "profile.personal.bioLabel", "profile.personal.saveButton", "profile.personal.profileSaved", "profile.personal.usernameTaken", "profile.personal.usernameInvalid",
  "common.save", "common.saving", "favorites.title", "favorites.emptyTitle", "favorites.emptyBody",
  "common.loading", "common.retry", "common.back", "common.continue", "common.cancel",
  "shell.userMenu.logout",
  "arena.title", "arena.subtitle", "arena.level",
  "arena.tabs.play", "arena.tabs.rankings", "arena.tabs.profile",
  ...RANKS.map((r) => `arena.rank.${r}`),
  ...DIMS.map((d) => `arena.q.${d}`),
  ...FAMILIES.map((f) => `arena.family.${f}`),
  "arena.console.progress", "arena.console.option", "arena.console.pick", "arena.console.skip", "arena.console.next", "arena.console.leave",
  "arena.console.flowBonus", "arena.console.pioneer", "arena.console.votes", "arena.console.stimWin", "arena.console.contrast", "arena.console.repeat",
  "arena.console.eyeTag", "arena.console.dailyTag", "arena.console.eyeRight", "arena.console.eyeWrong", "arena.console.withCrowd", "arena.console.againstCrowd",
  "arena.console.communityEmpty", "arena.console.communityOff",
  "arena.summary.title", "arena.summary.dailyTitle", "arena.summary.answers", "arena.summary.answersHint", "arena.summary.combo", "arena.summary.comboHint",
  "arena.summary.eye", "arena.summary.eyeHint", "arena.summary.speed", "arena.summary.speedHint", "arena.summary.again", "arena.summary.done",
  "arena.rankings.week", "arena.rankings.all", "arena.rankings.everyone", "arena.rankings.friends", "arena.rankings.you", "arena.rankings.emptyTitle",
  "arena.rankings.emptyBody", "arena.rankings.offlineTitle", "arena.rankings.offlineBody", "arena.rankings.retry",
  "arena.sync.ready", "arena.sync.pending", "arena.sync.offline",
  "arena.lobby.dailyTitle", "arena.lobby.dailyBody", "arena.lobby.dailyStart", "arena.lobby.dailyContinue", "arena.lobby.dailyDone",
  "arena.lobby.freeTitle", "arena.lobby.freeBody", "arena.lobby.freeStart", "arena.lobby.statDuels", "arena.lobby.statDuelsHint",
  "arena.lobby.statStreak", "arena.lobby.streakRisk", "arena.lobby.streakSafe", "arena.lobby.streakStart", "arena.lobby.statEye", "arena.lobby.statEyeHint",
  "auth.fields.email", "auth.fields.password", "auth.fields.passwordHint",
  "auth.login.title", "auth.login.subtitle", "auth.login.noAccount", "auth.login.register", "auth.login.forgotPassword", "auth.login.submit", "auth.login.submitting",
  "auth.register.title", "auth.register.subtitle", "auth.register.haveAccount", "auth.register.login", "auth.register.submit", "auth.register.submitting",
  "auth.register.checkEmailTitle", "auth.register.checkEmailSent",
  "feed.title", "feed.subtitle", "feed.composerPlaceholder", "feed.posting", "feed.publish", "feed.posted", "feed.postedCensored", "feed.deletePost", "feed.postDeleted",
  "feed.confirmDeleteTitle", "feed.confirmDeleteBody", "feed.unknownAuthor", "feed.loadErrorTitle", "feed.loadErrorBody", "feed.emptyTitle", "feed.emptyBody",
  "feed.profanityBlocked", "feed.like", "feed.comment", "feed.save", "feed.noComments", "feed.commentPlaceholder", "feed.commentSubmit", "feed.commentPostedCensored",
  "feed.deleteComment", "feed.tabAll", "feed.tabMine", "feed.mineEmptyTitle", "feed.mineEmptyBody", "feed.loadMore", "feed.loadMoreFailed", "feed.edited",
  "friends.message", "friends.title", "friends.incomingTitle", "friends.outgoingTitle", "friends.friendsTitle", "friends.accept", "friends.decline", "friends.cancel",
  "friends.remove", "friends.addFriend", "friends.requestSent", "friends.requestAccepted", "friends.emptyTitle", "friends.emptyBody", "friends.loadErrorTitle", "friends.loadErrorBody",
  "people.searchPlaceholder", "people.searchHint", "people.noResultsTitle", "people.noResultsBody", "people.errorTitle", "people.errorBody", "people.retry", "people.you",
  "messages.title", "messages.you", "messages.placeholder", "messages.send", "messages.back", "messages.noMessagesYet", "messages.failedRetry", "messages.noFriendsBody",
  "messages.goToFriends", "messages.photo", "messages.deletedMine", "messages.deletedTheirs", "messages.edited", "messages.startChat",
  "auth.forgot.title", "auth.forgot.subtitle", "auth.forgot.back", "auth.forgot.submit", "auth.forgot.submitting", "auth.forgot.sentMessage",
];

// whole subtrees of the site's locale (every string under the prefix), for screens that use most of a section
const PREFIXES = ["messages"];
const leaves = (o, base) => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [`${base}.${k}`] : v && typeof v === "object" ? leaves(v, `${base}.${k}`) : []));
for (const p of PREFIXES) for (const k of leaves(get(ru, p), p)) if (!KEYS.includes(k)) KEYS.push(k);

// only the apps have these
const EXTRA = {
  "app.name": { ru: "Affinix", kk: "Affinix", en: "Affinix" },
  "app.language": { ru: "Язык", kk: "Тіл", en: "Language" },
  "app.profileTitle": { ru: "Мой профиль", kk: "Менің профилім", en: "My profile" },
  "app.markRead": { ru: "Прочитано", kk: "Оқылды", en: "Mark read" },
  "app.dealFailed": { ru: "Сервер дуэлей ответил ошибкой", kk: "Дуэль серверінен қате келді", en: "The duel server answered with an error" },
  "app.noNetwork": { ru: "Нет связи с сервером. Проверьте интернет и повторите.", kk: "Серверге қосылу мүмкін болмады. Интернетті тексеріп, қайталаңыз.", en: "Can't reach the server. Check your connection and try again." },
  "app.imageFailed": { ru: "Не удалось загрузить картинку", kk: "Сурет жүктелмеді", en: "Couldn't load the picture" },
  "app.signedInAs": { ru: "Вы вошли как {email}", kk: "{email} ретінде кірдіңіз", en: "Signed in as {email}" },
  "app.xp": { ru: "XP", kk: "XP", en: "XP" },
  "app.streakDays": { ru: "дней подряд: {n}", kk: "қатарынан {n} күн", en: "{n}-day streak" },
  "app.ago.now": { ru: "только что", kk: "жаңа ғана", en: "just now" },
  "app.ago.min": { ru: "{n} мин назад", kk: "{n} мин бұрын", en: "{n} min ago" },
  "app.ago.hour": { ru: "{n} ч назад", kk: "{n} сағ бұрын", en: "{n} h ago" },
  "app.ago.day": { ru: "{n} дн назад", kk: "{n} күн бұрын", en: "{n} d ago" },
  "app.votes": { ru: "Дуэлей: {n}", kk: "Дуэль: {n}", en: "Duels: {n}" },
};

const lit = (s) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/\n/g, "\\n") + '"';

let out = `// GENERATED by native/scripts/gen-strings.mjs from src/lib/locales/{ru,kk,en}.js. Do not edit by hand.\npackage space.affinix.app.i18n\n\n`;
const missing = [];
for (const [id, loc] of [["ru", ru], ["kk", kk], ["en", en]]) {
  out += `internal val STRINGS_${id.toUpperCase()}: Map<String, String> = mapOf(\n`;
  for (const k of KEYS) {
    const v = get(loc, k);
    if (typeof v !== "string") { missing.push(`${id}:${k}`); continue; }
    out += `    ${lit(k)} to ${lit(v)},\n`;
  }
  for (const [k, v] of Object.entries(EXTRA)) out += `    ${lit(k)} to ${lit(v[id])},\n`;
  out += `)\n\n`;
}
if (missing.length) { console.error("missing keys:\n" + missing.join("\n")); process.exit(1); }
writeFileSync(new URL("../composeApp/src/commonMain/kotlin/space/affinix/app/i18n/Strings.kt", import.meta.url), out);
console.log(`ok: ${KEYS.length + Object.keys(EXTRA).length} keys x 3 languages`);
