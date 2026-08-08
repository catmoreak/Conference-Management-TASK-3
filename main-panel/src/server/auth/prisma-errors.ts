export function isPrismaMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as { code?: unknown };
  return maybeError.code === "P2021";
}
