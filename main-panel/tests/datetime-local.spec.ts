import { describe, expect, it } from "vitest";

function formatForDateTimeLocal(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

describe("formatForDateTimeLocal", () => {
  it("formats Date object to local YYYY-MM-DDTHH:mm string without timezone shift", () => {
    const testDate = new Date(2026, 7, 21, 16, 20, 0); // 21 Aug 2026 16:20 local
    const formatted = formatForDateTimeLocal(testDate);
    expect(formatted).toBe("2026-08-21T16:20");
  });

  it("handles null, undefined, and invalid inputs gracefully", () => {
    expect(formatForDateTimeLocal(null)).toBe("");
    expect(formatForDateTimeLocal(undefined)).toBe("");
    expect(formatForDateTimeLocal("invalid-date")).toBe("");
  });
});
