import { expect, test } from "vitest";
import type { Thread } from "../../src/generated/v2/Thread";
import { mergeArchivedThreads } from "../../src/features/settings/archived-threads";

const thread = (id: string, updatedAt: number, name = id) =>
  ({ id, updatedAt, name }) as Thread;

test("five archived rollouts of one conversation produce one entry", () => {
  const rows = [5, 2, 4, 1, 3].map((time) => thread("same", time));
  expect(mergeArchivedThreads([], rows)).toEqual([rows[0]]);
});

test("pagination merges repeated IDs while retaining order and newest metadata", () => {
  const first = thread("first", 10);
  const second = thread("second", 20);
  const newer = thread("first", 30, "renamed");
  const third = thread("third", 15);
  const initial = mergeArchivedThreads([], [first, second]);
  expect(
    mergeArchivedThreads(initial, [newer, thread("second", 1), third, third]),
  ).toEqual([newer, second, third]);
  expect(initial).toEqual([first, second]);
});
