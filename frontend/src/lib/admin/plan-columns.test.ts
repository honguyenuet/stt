import { describe, expect, it } from "vitest";

import { ADMIN_PLAN_COLUMNS } from "./plan-columns";

describe("ADMIN_PLAN_COLUMNS", () => {
  it("uses stable unique keys for every CMS plan column", () => {
    const keys = ADMIN_PLAN_COLUMNS.map((column) => column.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("distinguishes quota duration from maximum file duration", () => {
    expect(ADMIN_PLAN_COLUMNS.map((column) => column.label)).toContain("Hạn mức");
    expect(ADMIN_PLAN_COLUMNS.map((column) => column.label)).toContain(
      "Tệp tối đa",
    );
  });
});
