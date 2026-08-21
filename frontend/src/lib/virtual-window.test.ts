import { describe, expect, it } from "vitest";
import { getVirtualLayout, getVirtualWindow } from "./virtual-window";

function createLayout(
  itemCount: number,
  estimatedItemSize: number,
  measuredItemSizes?: ReadonlyMap<number, number>,
) {
  return getVirtualLayout({
    itemCount,
    estimatedItemSize,
    measuredItemSizes,
  });
}

describe("getVirtualWindow", () => {
  it("renders only a small window for a long transcript", () => {
    const result = getVirtualWindow({
      layout: createLayout(2_000, 120),
      scrollOffset: 0,
      viewportSize: 600,
      overscan: 2,
    });

    expect(result.items.map((item) => item.index)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    expect(result.items.length).toBeLessThan(20);
    expect(result.totalSize).toBe(240_000);
  });

  it("moves the window to the visible middle segments", () => {
    const result = getVirtualWindow({
      layout: createLayout(2_000, 120),
      scrollOffset: 60_000,
      viewportSize: 600,
      overscan: 2,
    });

    expect(result.items[0].index).toBe(498);
    expect(result.items.at(-1)?.index).toBe(506);
    expect(result.items.some((item) => item.index === 500)).toBe(true);
  });

  it("uses measured segment heights for offsets and total size", () => {
    const layout = createLayout(3, 100, new Map([[0, 180]]));
    const result = getVirtualWindow({
      layout,
      scrollOffset: 0,
      viewportSize: 500,
    });

    expect(result.offsets).toEqual([0, 180, 280]);
    expect(result.totalSize).toBe(380);
  });

  it("reuses the precomputed layout while the viewport scrolls", () => {
    const layout = createLayout(100_000, 100);
    const top = getVirtualWindow({
      layout,
      scrollOffset: 0,
      viewportSize: 500,
      overscan: 2,
    });
    const bottom = getVirtualWindow({
      layout,
      scrollOffset: 9_999_500,
      viewportSize: 500,
      overscan: 2,
    });

    expect(top.offsets).toBe(layout.offsets);
    expect(bottom.offsets).toBe(layout.offsets);
    expect(top.items).toHaveLength(7);
    expect(bottom.items.at(-1)?.index).toBe(99_999);
  });
});
