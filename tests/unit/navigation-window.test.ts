import { expect, it } from "vitest";
import {
  navigationAnchor,
  navigationLayout,
  navigationObservedTop,
  navigationRenderedIndices,
  navigationRestore,
  navigationWindow,
  navigationStickyProject,
  type NavigationListRow,
} from "../../src/features/navigation/navigation-window";

const rows = (count: number): NavigationListRow[] =>
  Array.from({ length: count }, (_, index) => ({
    key: `session-${index}`,
    height: 54,
    navigable: true,
  }));

it("keeps long projects collapsible while scrolling and yields to the following header", () => {
  const list = [
    { key: "a", height: 46, navigable: true, sticky: true },
    ...rows(1000),
    { key: "b", height: 46, navigable: true, sticky: true },
    ...rows(10),
  ];
  const layout = navigationLayout(list);
  const projects = [0, 1001];
  expect(navigationStickyProject(list, layout, projects, 30000)).toEqual({
    index: 0,
    top: 30000,
  });
  expect(navigationStickyProject(list, layout, projects, 54020)).toEqual({
    index: 0,
    top: 54000,
  });
  expect(navigationStickyProject(list, layout, projects, 54046)).toEqual({
    index: 1001,
    top: 54046,
  });
  const rendered = navigationRenderedIndices(
    1012,
    500,
    520,
    undefined,
    true,
    0,
  );
  expect(rendered).toHaveLength(21);
  expect(rendered).toContain(0);
});

it("keeps native scrollIntoView changes when pointer focus renders before the scroll event", () => {
  expect(navigationObservedTop(2000, 0, 5000, 5000, 600)).toBe(0);
  expect(navigationObservedTop(0, 2000, 5000, 5000, 600)).toBe(2000);
  // Genuine shrinkage still anchors from the unclamped reading position.
  expect(navigationObservedTop(2000, 400, 5000, 1000, 600)).toBe(2000);
  expect(navigationObservedTop(2000, 100, 5000, 4000, 600)).toBe(100);
});

it("renders a bounded viewport from a 1,000-session history at the start, middle and end", () => {
  const list = rows(1000);
  const layout = navigationLayout(list);
  expect(layout.total).toBe(54000);
  for (const top of [0, 22000, 53400]) {
    const window = navigationWindow(list, top, 600, layout);
    expect(window.offsets).toBe(layout.offsets);
    expect(window.end - window.start).toBeLessThanOrEqual(23);
    expect(layout.offsets[window.start]).toBeLessThanOrEqual(top);
    const last = window.end - 1;
    expect(layout.offsets[last] + list[last].height).toBeGreaterThanOrEqual(
      top + 600,
    );
  }
  const end = navigationWindow(list, 53400, 600, layout);
  expect(end.end).toBe(1000);
  const beyond = navigationWindow(list, 90000, 600, layout);
  expect(beyond.start).toBe(end.start);
  expect(beyond.end).toBe(end.end);
});

it("calculates variable project and date header heights without gaps at row boundaries", () => {
  const list: NavigationListRow[] = [
    { key: "project", height: 46, navigable: true },
    { key: "date", height: 30, navigable: false },
    ...rows(1000),
  ];
  const layout = navigationLayout(list);
  expect(layout.offsets.slice(0, 4)).toEqual([0, 46, 76, 130]);
  const window = navigationWindow(list, 76 + 54 * 500, 600, layout);
  expect(window.start).toBe(496);
  expect(window.end).toBe(519);
});

it("retains the focused control outside the viewport without rendering the intervening history", () => {
  const list = rows(1000);
  const window = navigationWindow(list, 30000, 600);
  const indices = navigationRenderedIndices(
    1000,
    window.start,
    window.end,
    1,
    true,
  );
  expect(indices).toContain(1);
  expect(indices.length).toBe(window.end - window.start + 1);
  expect(indices.length).toBeLessThan(25);
  expect(
    navigationRenderedIndices(
      1000,
      window.start,
      window.end,
      window.start,
      true,
    ),
  ).toHaveLength(window.end - window.start);
});

it("holds a saved reading position until enough summary pages arrive", () => {
  const target = 18000;
  expect(navigationRestore(target, 2700, 600)).toEqual({
    top: 2100,
    pending: true,
  });
  expect(navigationRestore(target, 5400, 600)).toEqual({
    top: 4800,
    pending: true,
  });
  expect(navigationRestore(target, 18900, 600)).toEqual({
    top: target,
    pending: false,
  });
  expect(navigationRestore(target, 18900, 0).pending).toBe(true);
});

it("preserves the visible session's screen offset when earlier pages or favorites add rows above it", () => {
  const list = rows(1000);
  const before = navigationLayout(list);
  const additions = rows(4).map((row) => ({ ...row, key: `new-${row.key}` }));
  const next = navigationLayout([...additions, ...list]);
  const top = 5405;
  const anchored = navigationAnchor(list, before, next, top, 600);
  expect(anchored).toBe(top + 216);
  const session = "session-100";
  expect(next.offsets[next.indices.get(session)!] - anchored).toBe(
    before.offsets[before.indices.get(session)!] - top,
  );
});

it("keeps the top pinned through repeated activity reordering but anchors a scrolled reader", () => {
  let list = rows(100);
  for (const key of ["session-90", "session-89", "session-88", "session-90"]) {
    const before = navigationLayout(list);
    const nextRows = [
      list.find((row) => row.key === key)!,
      ...list.filter((row) => row.key !== key),
    ];
    const next = navigationLayout(nextRows);
    for (const top of [-1, 0, 0.5, 1])
      expect(navigationAnchor(list, before, next, top, 600)).toBe(0);
    const reader = list[20].key;
    const top = before.offsets[20] + 5;
    const anchored = navigationAnchor(list, before, next, top, 600);
    expect(next.offsets[next.indices.get(reader)!] - anchored).toBe(-5);
    list = nextRows;
  }
});

it("uses the next surviving session when an archived anchor is removed", () => {
  const list = rows(1000);
  const before = navigationLayout(list);
  const nextRows = list.filter((row) => row.key !== "session-100");
  const next = navigationLayout(nextRows);
  const top = 5405;
  const anchored = navigationAnchor(list, before, next, top, 600);
  expect(anchored).toBe(top - 54);
  const survivor = "session-101";
  expect(next.offsets[next.indices.get(survivor)!] - anchored).toBe(
    before.offsets[before.indices.get(survivor)!] - top,
  );
});

it("clamps a collapsed tail and handles histories with no surviving rows", () => {
  const list = rows(1000);
  const before = navigationLayout(list);
  expect(
    navigationAnchor(
      list,
      before,
      navigationLayout(list.slice(0, 20)),
      50000,
      600,
    ),
  ).toBe(480);
  expect(navigationAnchor(list, before, navigationLayout([]), 50000, 600)).toBe(
    0,
  );
  expect(navigationWindow([], 0, 600)).toMatchObject({
    start: 0,
    end: 0,
    total: 0,
  });
});
