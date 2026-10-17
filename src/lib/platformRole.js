// The platform role of a person: "owner" (the one person who runs DecisionOS), "admin" (a moderator) or none.
// It is NOT the role in a company (owner / admin / researcher / viewer): every person who signs up founds their own
// company, so that "owner" is everywhere; this one is rare and is shown as a badge (components/platformBadge.js).
//
// The column exists once migration 0025 is applied. Until then reads that ask for it fall back to the old columns.

let supported = true;

/** `base` columns, plus platform_role while the database is known to have it. */
export const withPlatformRole = (base) => (supported ? `${base}, platform_role` : base);

/** Call with a failed query's error: true when it was the missing column (the caller should retry once). */
export function platformColumnMissing(error) {
  if (supported && /platform_role|is_owner/.test(error?.message ?? "")) {
    supported = false;
    return true;
  }
  return false;
}

/** "owner" | "admin" | null from a profiles row (is_owner / is_admin) or a profiles_public row (platform_role). */
export function platformRoleOf(row) {
  if (!row) return null;
  const role = row.platform_role ?? row.platformRole;
  if (role === "owner" || row.is_owner) return "owner";
  if (role === "admin" || row.is_admin) return "admin";
  return null;
}
