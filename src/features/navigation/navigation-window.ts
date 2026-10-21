export interface NavigationListRow {
  key: string;
  height: number;
  navigable: boolean;
  sticky?: boolean;
}
export interface NavigationLayout {
  offsets: number[];
  indices: Map<string, number>;
  total: number;
}
export function navigationLayout(rows: NavigationListRow[]): NavigationLayout {
  const offsets: number[] = [];
  const indices = new Map<string, number>();
  let total = 0;
  rows.forEach((row, index) => {
    offsets.push(total);
    indices.set(row.key, index);
    total += row.height;
  });
  return { offsets, indices, total };
}
function lowerBound(length: number, before: (index: number) => boolean) {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (before(middle)) low = middle + 1;
    else high = middle;
  }
  return low;
}
export function navigationScrollTop(
  top: number,
  total: number,
  height: number,
) {
  return Math.min(Math.max(0, top), Math.max(0, total - height));
}
/** Native focus/scrollIntoView may move the viewport before its scroll event runs. */
export function navigationObservedTop(
  lastTop: number,
  actualTop: number,
  previousTotal: number,
  total: number,
  height: number,
) {
  const maximum = Math.max(0, total - height);
  // After a shorter list commits, the browser can clamp the old reading
  // position before layout effects. Only that case needs the cached position.
  return total < previousTotal &&
    lastTop > maximum &&
    Math.abs(actualTop - maximum) < 1
    ? lastTop
    : actualTop;
}
export function navigationWindow(
  rows: NavigationListRow[],
  scrollTop: number,
  height: number,
  layout = navigationLayout(rows),
) {
  const top = navigationScrollTop(scrollTop, layout.total, height);
  const start = lowerBound(
    rows.length,
    (index) => layout.offsets[index] + rows[index].height <= top - 280,
  );
  const end = lowerBound(
    rows.length,
    (index) => layout.offsets[index] < top + height + 280,
  );
  return { ...layout, start, end };
}
/** Preserve the first visible surviving row, even if the previous anchor was removed. */
export function navigationAnchor(
  previousRows: NavigationListRow[],
  previous: NavigationLayout,
  next: NavigationLayout,
  top: number,
  height: number,
) {
  const anchor = lowerBound(
    previousRows.length,
    (index) => previous.offsets[index] + previousRows[index].height <= top,
  );
  for (let index = anchor; index < previousRows.length; index++) {
    const nextIndex = next.indices.get(previousRows[index].key);
    if (nextIndex !== undefined)
      return navigationScrollTop(
        next.offsets[nextIndex] + top - previous.offsets[index],
        next.total,
        height,
      );
  }
  for (let index = anchor - 1; index >= 0; index--) {
    const nextIndex = next.indices.get(previousRows[index].key);
    if (nextIndex !== undefined)
      return navigationScrollTop(
        next.offsets[nextIndex] + top - previous.offsets[index],
        next.total,
        height,
      );
  }
  return navigationScrollTop(top, next.total, height);
}
/** A saved position may exceed the first page while summary pages are still arriving. */
export function navigationRestore(
  target: number,
  total: number,
  height: number,
) {
  const top = navigationScrollTop(target, total, height);
  return { top, pending: height <= 0 || top < target };
}
export function navigationRenderedIndices(
  count: number,
  start: number,
  end: number,
  focusedIndex: number | undefined,
  virtual: boolean,
  stickyIndex?: number,
) {
  const indices = Array.from(
    { length: virtual ? end - start : count },
    (_, index) => index + (virtual ? start : 0),
  );
  if (focusedIndex !== undefined && !indices.includes(focusedIndex))
    indices.push(focusedIndex);
  if (stickyIndex !== undefined && !indices.includes(stickyIndex))
    indices.push(stickyIndex);
  return indices.sort((a, b) => a - b);
}

/** Keep the active project reachable until the following project pushes it out. */
export function navigationStickyProject(
  rows: NavigationListRow[],
  layout: NavigationLayout,
  projects: number[],
  top: number,
) {
  const next = lowerBound(
    projects.length,
    (index) => layout.offsets[projects[index]] <= top,
  );
  const index = projects[next - 1];
  if (index === undefined) return undefined;
  const following = projects[next];
  const offset = Math.min(
    top,
    following === undefined
      ? layout.total - rows[index].height
      : layout.offsets[following] - rows[index].height,
  );
  return { index, top: Math.max(layout.offsets[index], offset) };
}
