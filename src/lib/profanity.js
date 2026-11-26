// Keeps obscene words out of the names people give themselves (full name, username, job title, bio, interests). Russian, Kazakh and English.
// The SAME rules run in the browser (instant feedback) and in the database (supabase/migrations/0033_profanity_filter.sql, the real gate): a test
// compares the two word lists, so they cannot drift apart.
//
// How a text is checked: it is split into words (spaces and punctuation); each word is normalised twice, once as a Cyrillic string and once as a
// Latin one, so the usual tricks do not work: capital letters, Latin letters that look like Cyrillic ones ("xуй"), digits for letters ("5ука", "х0й", "sh1t"),
// stretched letters ("хууууй"), Kazakh letters reduced to their Russian base (ә -> а, қ -> к ...). A word is refused if it CONTAINS an unambiguous stem
// (the SUB lists) or IS one of the words that are only offensive on their own (the EXACT lists: "Dick" is a name, "Hancock" is a surname).
// Long stems are also looked for in the whole text with the spaces removed ("f u c k").
// The lists are stems, already in normalised (collapsed, base-letter) form. They are deliberately limited to obscenities and slurs; a name such as
// "Аблязов" or "Scunthorpe" must pass, which is why short words sit in the EXACT lists.

export const CYR_SUB = ["хуй", "хуя", "хуе", "пизд", "ебан", "ебат", "ебал", "ебла", "ебуч", "ебыр", "заеб", "выеб", "долбоеб", "мудак", "мудил", "мудозв",
  "пидор", "пидар", "пидрил", "гандон", "гондон", "залуп", "шлюх", "блят", "бляд", "ублюд", "сучар", "говн", "дерьм", "дроч",
  "сиктир", "сиким", "котак", "амшык", "жезокш"];
export const CYR_EXACT = ["бля", "сука", "суки", "сучка", "сучки", "хер", "жопа", "жопу", "чмо", "лох", "член", "падла", "тварь", "мразь", "урод", "дебил", "идиот", "кретин", "гнида"];
export const LAT_SUB = ["fuck", "shit", "bitch", "whore", "fagot", "bastard", "ashole", "dickhead", "motherf", "cocksuck", "pusy", "penis", "vagina",
  "pizd", "eban", "yeban", "blyat", "siktir", "zalup", "mudak", "pidor", "pidar", "gandon", "gondon", "dolboeb"];
export const LAT_EXACT = ["dick", "cock", "tits", "cunt", "cunts", "slut", "sluts", "niga", "nigas", "niger", "nigers", "fag", "suka", "blya", "xuy", "xyu", "fuk", "jopa", "idiot", "retard"];

const SEP = /[\s.,_\-+*/\\|'"`~!?:;()[\]{}<>=#%^&]+/u;
const CYR_FROM = "ёәіңғүұқөһaeopcxykmth03456", CYR_TO = "еаингууко" + "х" + "аеорсхукмтн" + "озчсб";
const LAT_FROM = "013457@$аеорсхукмтн", LAT_TO = "oieastas" + "aeopcxykmth";

const mapChars = (s, from, to) => { let out = ""; for (const ch of s) { const i = from.indexOf(ch); out += i === -1 ? ch : to[i]; } return out; };
const collapse = (s) => s.replace(/(.)\1+/gu, "$1");
const strip = (s) => s.replace(/[\d.,_\-+*/\\|'"`~!?:;()[\]{}<>=#%^&@$\s]/gu, "");
export const normCyr = (token) => collapse(strip(mapChars(token.toLowerCase(), CYR_FROM, CYR_TO)));
export const normLat = (token) => collapse(strip(mapChars(token.toLowerCase(), LAT_FROM, LAT_TO)));

/** true when the text contains an obscene word (see the header). */
export function isProfane(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  let allC = "", allL = "";
  for (const tok of raw.toLowerCase().split(SEP)) {
    if (!tok) continue;
    const c = normCyr(tok), l = normLat(tok);
    allC += c; allL += l;
    if (c && (CYR_SUB.some((s) => c.includes(s)) || CYR_EXACT.includes(c))) return true;
    if (l && (LAT_SUB.some((s) => l.includes(s)) || LAT_EXACT.includes(l))) return true;
  }
  // spaced-out letters: only the longer stems, so two ordinary names side by side cannot make a short one by accident
  return CYR_SUB.some((s) => s.length >= 4 && allC.includes(s)) || LAT_SUB.some((s) => s.length >= 4 && allL.includes(s));
}
