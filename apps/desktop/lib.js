// Pure helpers of the desktop app (no Electron here, so they can be tested with plain node: scripts/check-apps.mjs).
const SITE = "https://affinix.space";

// Pages that stay inside the app window: the site, its sign-in (Supabase, Google) and the assets those pages load. Everything else opens in the browser.
const IN_APP = [/(^|\.)affinix\.space$/, /(^|\.)supabase\.co$/, /(^|\.)google\.com$/, /(^|\.)gstatic\.com$/, /(^|\.)googleusercontent\.com$/];

function isInApp(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && u.hostname === "localhost")) return false;
    return u.hostname === "localhost" || IN_APP.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/** Only these schemes may be handed to the operating system (a link inside a page must never launch a program). */
function isSafeExternal(url) {
  try {
    return ["https:", "http:", "mailto:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** affinix://app/arena  ->  https://affinix.space/#/app/arena   (null for anything that is not an Affinix link). */
function fromDeepLink(link, site = SITE) {
  if (typeof link !== "string" || !/^affinix:/i.test(link)) return null;
  const rest = link.replace(/^affinix:(\/\/)?/i, "").replace(/^\/+/, "");
  if (!/^[A-Za-z0-9\-._~!$&'()*+,;=:@/%?#]*$/.test(rest) || rest.includes("..")) return null;
  const path = rest.split("#")[0];
  return `${site}/#/${path || "app/arena"}`;
}

const STRINGS = {
  en: { file: "File", reload: "Reload", openBrowser: "Open in browser", quit: "Quit", edit: "Edit", view: "View", fullscreen: "Full screen", zoomIn: "Zoom in", zoomOut: "Zoom out", zoomReset: "Actual size", go: "Go", arena: "Arena", styles: "What people love", feed: "Feed", messages: "Messages", settings: "Settings", help: "Help", website: "Website", download: "Downloads", about: "About Affinix", tray: "Keep running in the tray when the window is closed", login: "Start with the system", show: "Show Affinix", updateReady: "Restart to update", updated: "A new version of Affinix is ready: it installs when you close the app.", back: "Back", forward: "Forward", copyLink: "Copy link address", openLink: "Open link in browser", copy: "Copy", cut: "Cut", paste: "Paste", selectAll: "Select all" },
  ru: { file: "Файл", reload: "Обновить", openBrowser: "Открыть в браузере", quit: "Выйти", edit: "Правка", view: "Вид", fullscreen: "Во весь экран", zoomIn: "Увеличить", zoomOut: "Уменьшить", zoomReset: "Обычный размер", go: "Перейти", arena: "Арена", styles: "Что любят люди", feed: "Лента", messages: "Сообщения", settings: "Настройки", help: "Справка", website: "Сайт", download: "Скачать", about: "Об Affinix", tray: "Оставаться в трее при закрытии окна", login: "Запускать вместе с системой", show: "Показать Affinix", updateReady: "Перезапустить для обновления", updated: "Новая версия Affinix готова: она установится, когда вы закроете приложение.", back: "Назад", forward: "Вперёд", copyLink: "Копировать адрес ссылки", openLink: "Открыть ссылку в браузере", copy: "Копировать", cut: "Вырезать", paste: "Вставить", selectAll: "Выделить всё" },
  kk: { file: "Файл", reload: "Жаңарту", openBrowser: "Браузерде ашу", quit: "Шығу", edit: "Өңдеу", view: "Көрініс", fullscreen: "Толық экран", zoomIn: "Үлкейту", zoomOut: "Кішірейту", zoomReset: "Қалыпты өлшем", go: "Өту", arena: "Арена", styles: "Адамдар нені ұнатады", feed: "Лента", messages: "Хабарламалар", settings: "Баптаулар", help: "Анықтама", website: "Сайт", download: "Жүктеу", about: "Affinix туралы", tray: "Терезе жабылғанда трейде қалу", login: "Жүйемен бірге іске қосу", show: "Affinix көрсету", updateReady: "Жаңарту үшін қайта іске қосу", updated: "Affinix-тің жаңа нұсқасы дайын: қолданбаны жапқанда орнатылады.", back: "Артқа", forward: "Алға", copyLink: "Сілтеме мекенжайын көшіру", openLink: "Сілтемені браузерде ашу", copy: "Көшіру", cut: "Қиып алу", paste: "Қою", selectAll: "Барлығын белгілеу" },
};

/** "ru-RU" -> "ru", "kk-KZ" -> "kk"; anything else -> "en". */
function pickLocale(appLocale) {
  const l = String(appLocale || "").toLowerCase().slice(0, 2);
  return STRINGS[l] ? l : "en";
}

const t = (locale) => STRINGS[pickLocale(locale)];

/** Is the saved window rectangle still on one of the screens (a monitor may have been unplugged)? */
function boundsVisible(b, displays) {
  if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width < 300 || b.height < 300) return false;
  return displays.some((d) => {
    const a = d.workArea ?? d.bounds;
    return b.x + 80 < a.x + a.width && b.x + b.width - 80 > a.x && b.y + 40 < a.y + a.height && b.y > a.y - 40;
  });
}

module.exports = { SITE, IN_APP, isInApp, isSafeExternal, fromDeepLink, STRINGS, pickLocale, t, boundsVisible };
