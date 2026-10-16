// Curated palettes for the Arena's procedural specimens. Hand-picked rather than
// random-hue soup: a generated logo or button only looks like a designer made it
// if the colours were chosen by one. Roles:
//   bg      page / canvas colour
//   surface a card or panel sitting on it
//   a       the brand colour
//   b       a supporting / accent colour
//   ink     text colour
// A few "Low" palettes carry deliberately weak ink so the legibility duels have
// something poor to compare against.

export const PALETTES = [
  // light, warm
  { id: "terracotta", bg: "#f6efe6", surface: "#fffaf3", a: "#c8553d", b: "#f2a65a", ink: "#2b2118" },
  { id: "peach", bg: "#fff4ec", surface: "#ffffff", a: "#ff7a59", b: "#ffc857", ink: "#3a2a25" },
  { id: "sandOlive", bg: "#f3efe3", surface: "#fbf8ef", a: "#6b7a3a", b: "#c9a227", ink: "#26291a" },
  { id: "roseClay", bg: "#f8ece9", surface: "#fff7f5", a: "#b5524a", b: "#e8a598", ink: "#35201e" },
  { id: "saffron", bg: "#fff8e6", surface: "#ffffff", a: "#e8a317", b: "#d4452a", ink: "#2d2410" },
  { id: "cocoa", bg: "#f1e7dc", surface: "#faf4ec", a: "#6f4a36", b: "#d9a066", ink: "#2a1c14" },
  // light, cool
  { id: "nordic", bg: "#eef3f7", surface: "#ffffff", a: "#2f5d8a", b: "#7fb2d9", ink: "#14212e" },
  { id: "mint", bg: "#eaf6f1", surface: "#ffffff", a: "#1f8a70", b: "#7bd3b0", ink: "#12302a" },
  { id: "lilac", bg: "#f1eefa", surface: "#ffffff", a: "#6c4fd1", b: "#b9a6f2", ink: "#1f1a38" },
  { id: "skyPop", bg: "#eaf6ff", surface: "#ffffff", a: "#1e88e5", b: "#ffb300", ink: "#0f2740" },
  { id: "glacier", bg: "#f0f5f7", surface: "#fcfeff", a: "#3a8fa3", b: "#b6dce6", ink: "#16303a" },
  { id: "sage", bg: "#eef0e6", surface: "#f9faf3", a: "#7e957a", b: "#d8c7a1", ink: "#232a21" },
  // dark
  { id: "midnightCitrus", bg: "#0f1220", surface: "#181c30", a: "#ffb020", b: "#ff6a3d", ink: "#f4f1ea" },
  { id: "graphiteEmerald", bg: "#101412", surface: "#181f1b", a: "#2ecc8f", b: "#9be7c4", ink: "#e8f1ec" },
  { id: "noirGold", bg: "#0d0d0f", surface: "#17171a", a: "#c9a14a", b: "#f1d98b", ink: "#f2ede2" },
  { id: "deepPlum", bg: "#1a1024", surface: "#261836", a: "#c96bff", b: "#ff7ab6", ink: "#f6ecff" },
  { id: "oceanNight", bg: "#07182a", surface: "#0d2742", a: "#29b6f6", b: "#80deea", ink: "#e8f6ff" },
  { id: "ember", bg: "#1c1210", surface: "#2a1b17", a: "#ff5a36", b: "#ffc08a", ink: "#fbece4" },
  // vivid
  { id: "electricBerry", bg: "#fff0f6", surface: "#ffffff", a: "#e0115f", b: "#5b2eff", ink: "#240a1a" },
  { id: "limeVolt", bg: "#f6ffe0", surface: "#ffffff", a: "#7ed321", b: "#111111", ink: "#111111" },
  { id: "tangerine", bg: "#fff3e0", surface: "#ffffff", a: "#ff6d00", b: "#00b8d4", ink: "#1c1206" },
  { id: "cobaltPink", bg: "#f1f4ff", surface: "#ffffff", a: "#2540ff", b: "#ff6fb5", ink: "#0b1233" },
  { id: "sunnyTeal", bg: "#fffbe6", surface: "#ffffff", a: "#00a6a6", b: "#ffcf33", ink: "#09302f" },
  { id: "hotCoral", bg: "#fff1ef", surface: "#ffffff", a: "#ff4d4d", b: "#4d79ff", ink: "#2a0f10" },
  // muted, calm
  { id: "dustyRose", bg: "#f2e6e6", surface: "#faf3f2", a: "#a7727d", b: "#d8b4a0", ink: "#2e2024" },
  { id: "slateMist", bg: "#e9ecef", surface: "#f6f7f9", a: "#5c6b7a", b: "#a9b7c4", ink: "#1d252e" },
  { id: "moss", bg: "#e8ebe0", surface: "#f4f6ee", a: "#566b46", b: "#a3b18a", ink: "#1e261a" },
  { id: "taupe", bg: "#ece6df", surface: "#f7f3ee", a: "#8a7968", b: "#c8b8a6", ink: "#2a241e" },
  { id: "fogLavender", bg: "#ece9f2", surface: "#f7f5fb", a: "#8b80a6", b: "#c6bfd9", ink: "#231f2e" },
  { id: "dune", bg: "#f0e7d8", surface: "#faf4e8", a: "#b08968", b: "#7f5539", ink: "#2b2015" },
  // contrasty, graphic
  { id: "inkPaper", bg: "#f5f3ef", surface: "#ffffff", a: "#111111", b: "#e63946", ink: "#111111" },
  { id: "paperBlue", bg: "#f7f7f2", surface: "#ffffff", a: "#1d3557", b: "#e63946", ink: "#1d3557" },
  { id: "chalk", bg: "#1f1f1f", surface: "#2a2a2a", a: "#f5f5f5", b: "#ffd166", ink: "#f5f5f5" },
  { id: "boneBlack", bg: "#efe9dd", surface: "#f8f4ea", a: "#1a1a1a", b: "#8c7a5b", ink: "#1a1a1a" },
  // low contrast ink (poor legibility on purpose)
  { id: "pastelHaze", bg: "#f4e9f5", surface: "#fbf4fc", a: "#c8a2d6", b: "#f0c3d8", ink: "#b9a0c4" },
  { id: "peachLow", bg: "#fde8dc", surface: "#fff3ec", a: "#f3b79a", b: "#f6d2a2", ink: "#c28b6d" },
  { id: "mintLow", bg: "#e4efe9", surface: "#f0f6f2", a: "#9cc5b1", b: "#cfe3d8", ink: "#86ad9a" },
  { id: "nightLow", bg: "#15171d", surface: "#1d2028", a: "#4b5568", b: "#6b7a90", ink: "#6a7488" },
  { id: "sandLow", bg: "#efe6d2", surface: "#f6efde", a: "#cdb88a", b: "#e0d1ac", ink: "#a8946a" },
  { id: "skyLow", bg: "#e6f0f7", surface: "#f1f7fb", a: "#9bbad0", b: "#c4d8e6", ink: "#86a5bd" },
];

/** Invented brand names (Latin script, a few with a Kazakh flavour) for logos, packs and posters. */
export const BRAND_NAMES = [
  "Lumen", "Kora", "Veyra", "Orbis", "Nimbus", "Tavo", "Halo", "Brisa", "Onyx", "Mira",
  "Solis", "Verde", "Altyn", "Nura", "Dala", "Samal", "Tulpar", "Zere", "Arman", "Aqbota",
  "Jibek", "Sana", "Qazyna", "Nurly", "Aster", "Fenix", "Mosaic", "Kite", "Oasis", "Pulse",
  "Roam", "Tidal", "Vanta", "Wisp", "Yuna", "Zenit", "Bolat", "Ayla", "Dastan", "Laika",
];

/** Short headlines for posters, buttons and cards (Latin, Russian and Kazakh). */
export const HEADLINES = [
  "Fresh start", "Less is more", "Open now", "Slow morning", "Taste of home", "Made to last", "New season",
  "Новый вкус", "Лето рядом", "Просто и чисто", "Время для себя", "Только своё",
  "Жаңа дәм", "Таза ауа", "Өз қолыңмен", "Тыныштық", "Бүгін бастаймыз",
];

export const CTA_LABELS = [
  "Get started", "Try free", "Buy now", "Subscribe", "Learn more", "Order today",
  "Начать", "Попробовать", "Купить", "Подписаться",
  "Бастау", "Көру", "Сатып алу", "Тапсырыс беру",
];
