export interface VirtualItem {
  index: number;
  start: number;
  size: number;
}

interface VirtualLayoutOptions {
  itemCount: number;
  estimatedItemSize: number;
  measuredItemSizes?: ReadonlyMap<number, number>;
}

export interface VirtualLayout {
  offsets: number[];
  sizes: number[];
  totalSize: number;
}

interface VirtualWindowOptions {
  layout: VirtualLayout;
  scrollOffset: number;
  viewportSize: number;
  overscan?: number;
}

export interface VirtualWindow extends VirtualLayout {
  items: VirtualItem[];
}

function positiveSize(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getVirtualLayout({
  itemCount,
  estimatedItemSize,
  measuredItemSizes,
}: VirtualLayoutOptions): VirtualLayout {
  const count = Math.max(0, Math.floor(Number(itemCount) || 0));
  if (!count) return { offsets: [], sizes: [], totalSize: 0 };

  const estimate = positiveSize(estimatedItemSize, 1);
  const offsets = new Array<number>(count);
  const sizes = new Array<number>(count);
  let totalSize = 0;
  for (let index = 0; index < count; index += 1) {
    offsets[index] = totalSize;
    const size = positiveSize(Number(measuredItemSizes?.get(index)), estimate);
    sizes[index] = size;
    totalSize += size;
  }

  return { offsets, sizes, totalSize };
}

export function getVirtualWindow({
  layout,
  scrollOffset,
  viewportSize,
  overscan = 3,
}: VirtualWindowOptions): VirtualWindow {
  const { offsets, sizes, totalSize } = layout;
  const count = offsets.length;
  if (!count) return { items: [], offsets, sizes, totalSize };

  const visibleStart = Math.max(0, Number(scrollOffset) || 0);
  const visibleEnd = visibleStart + Math.max(1, Number(viewportSize) || 0);
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] + sizes[middle] <= visibleStart) low = middle + 1;
    else high = middle;
  }

  const firstVisible = Math.min(count - 1, low);
  let endVisible = firstVisible;
  while (endVisible < count && offsets[endVisible] < visibleEnd) {
    endVisible += 1;
  }

  const extra = Math.max(0, Math.floor(Number(overscan) || 0));
  const startIndex = Math.max(0, firstVisible - extra);
  const endIndex = Math.min(count, endVisible + extra);
  const items = Array.from({ length: endIndex - startIndex }, (_, offset) => {
    const index = startIndex + offset;
    return { index, start: offsets[index], size: sizes[index] };
  });

  return { items, offsets, sizes, totalSize };
}
