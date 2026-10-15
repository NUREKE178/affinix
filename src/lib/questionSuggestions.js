// Rule-based "which measurement dimension fits this research question"
// matcher (task: "Objective-based question suggestions (honest, rule-based,
// not fake AI)"). Deliberately as dumb as it looks: a fixed per-locale
// keyword list, substring-matched against the researcher's own free text
// (draft.objective + draft.category from ExperimentBuilder step 1). No
// model call, no scoring beyond "did any keyword for this dimension appear
// at all" -- consistent with lib/insights.js's own stance that nothing in
// this app should claim certainty it doesn't have. The matched keyword is
// returned alongside the dimension id specifically so the UI can show its
// work (e.g. in a tooltip) instead of presenting the suggestion as if it
// came from nowhere.
import { DIMENSION_IDS } from "./questionTypes.js";

const KEYWORDS = {
  ru: {
    preference: ["предпочита", "выбира", "выбор", "нрав", "любим"],
    attention: ["внимание", "замеча", "заметност", "первый взгляд", "бросается в глаза"],
    trust: ["довери", "надежн", "достовер"],
    quality: ["качеств"],
    premium: ["премиальн", "премиум", "дорог", "люкс", "статусн"],
    clarity: ["понятн", "ясност", "читаем", "легко понять"],
    recall: ["запомина", "запомн", "вспомина", "память"],
    purchaseIntent: ["купит", "покупк", "готовность платить", "намерение купить"],
  },
  kk: {
    preference: ["қала", "таңда", "ұнай"],
    attention: ["назар", "байқа", "көзге түс"],
    trust: ["сенім"],
    quality: ["сапа"],
    premium: ["премиал", "қымбат", "мәртебе"],
    clarity: ["түсінік", "анық"],
    recall: ["есте сақта", "есте қал", "жады"],
    purchaseIntent: ["сатып алу", "сатып алғы", "төлеуге дайын"],
  },
  en: {
    preference: ["prefer", "choose", "choice", "like best", "favorite"],
    attention: ["attention", "notice", "eye-catch", "stand out", "catch the eye"],
    trust: ["trust", "reliable", "credib"],
    quality: ["quality"],
    premium: ["premium", "luxury", "upscale", "expensive", "high-end"],
    clarity: ["clarity", "clear", "understand", "easy to read", "legib"],
    recall: ["recall", "remember", "memorable", "memory"],
    purchaseIntent: ["purchase", "buy", "willingness to pay", "intent to buy", "likely to buy"],
  },
};

/** Returns [{ dimensionId, matchedKeyword }] for every dimension with at
 * least one keyword hit in `text`, in DIMENSION_IDS order. Pure substring
 * matching, case-insensitive; empty/whitespace-only text returns []. */
export function suggestDimensions(text, locale = "ru") {
  const lower = (text ?? "").toLowerCase().trim();
  if (!lower) return [];
  const dict = KEYWORDS[locale] ?? KEYWORDS.ru;
  const hits = [];
  for (const dimensionId of DIMENSION_IDS) {
    const words = dict[dimensionId] ?? [];
    const matchedKeyword = words.find((w) => lower.includes(w));
    if (matchedKeyword) hits.push({ dimensionId, matchedKeyword });
  }
  return hits;
}
