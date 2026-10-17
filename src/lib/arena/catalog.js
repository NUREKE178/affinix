// The Arena's fixed vocabulary, kept free of the specimen generators so the app shell
// (and anything else that only needs to know what exists) doesn't pull them in.

/** Specimens per pool. A specimen index is `pool * POOL_SIZE + slot`: pool 0 is the month's "classics" (the same 32
 * for the whole month), pool N (1..31) is the DROP of the N-th day of the month, new every day. Every pool is dealt
 * the same way (balanced over its 32 slots), a drop is simply a pool nobody has seen before. */
export const POOL_SIZE = 32;
/** Highest specimen index + 1 (31 drops + the classics). The server accepts the same range (migration 0026). */
export const INDEX_LIMIT = 32 * POOL_SIZE;
export const CLASSIC_POOL = 0;

/** The first seven are the original families (their order is part of the ledger encoding and the week-theme rotation). */
export const FAMILY_IDS = ["mark", "palette", "button", "card", "pack", "poster", "appicon", "scene", "shot"];
/** The families the week theme rotated through before drops existed (an older server only knows these). */
export const LEGACY_FAMILY_COUNT = 7;

export const poolOfIndex = (index) => Math.floor(index / POOL_SIZE);
export const slotOfIndex = (index) => index % POOL_SIZE;
export const indexOf = (pool, slot) => pool * POOL_SIZE + slot;

/** The drop pool of a local day "YYYY-MM-DD": its day of the month (1..31). */
export function dropPoolForDay(day) {
  const d = Number(String(day).slice(8, 10));
  return d >= 1 && d <= 31 ? d : 1;
}

/** The measurement dimensions of the Arena. Ids match the builder's own
 * (builder.dimensions.*), so researchers and players use one vocabulary.
 * `objective` ones have a right answer that the specimens themselves decide.
 * `core` ones are the original seven (crowd tests, which the server validates separately, only offer those);
 * the rest are the "brand attribute" questions marketers ask: which one feels friendlier, more modern, ... */
export const DIMENSIONS = [
  { id: "preference", objective: false, core: true },
  { id: "attention", objective: false, core: true },
  { id: "trust", objective: false, core: true },
  { id: "quality", objective: false, core: true },
  { id: "premium", objective: false, core: true },
  { id: "clarity", objective: true, core: true },
  { id: "purchaseIntent", objective: false, core: true },
  { id: "friendly", objective: false, core: false },
  { id: "modern", objective: false, core: false },
  { id: "natural", objective: false, core: false },
  { id: "energetic", objective: false, core: false },
];
export const DIMENSION_IDS = DIMENSIONS.map((d) => d.id);
export const CORE_DIMENSION_IDS = DIMENSIONS.filter((d) => d.core).map((d) => d.id);
export const isObjective = (dimId) => DIMENSIONS.find((d) => d.id === dimId)?.objective === true;
