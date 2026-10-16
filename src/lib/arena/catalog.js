// The Arena's fixed vocabulary, kept free of the specimen generators so the app shell
// (and anything else that only needs to know what exists) doesn't pull them in.

export const POOL_SIZE = 32;
export const FAMILY_IDS = ["mark", "palette", "button", "card", "pack", "poster", "appicon"];

/** The measurement dimensions of the Arena. Ids match the builder's own
 * (builder.dimensions.*), so researchers and players use one vocabulary.
 * `objective` ones have a right answer that the specimens themselves decide. */
export const DIMENSIONS = [
  { id: "preference", objective: false },
  { id: "attention", objective: false },
  { id: "trust", objective: false },
  { id: "quality", objective: false },
  { id: "premium", objective: false },
  { id: "clarity", objective: true },
  { id: "purchaseIntent", objective: false },
];
export const DIMENSION_IDS = DIMENSIONS.map((d) => d.id);
export const isObjective = (dimId) => DIMENSIONS.find((d) => d.id === dimId)?.objective === true;
