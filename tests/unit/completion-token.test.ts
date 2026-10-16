import { expect, test } from "vitest";
import { completionToken } from "../../src/features/composer/completion-token";
import { DraftsStore } from "../../src/features/composer/drafts";

test("completes the token at the caret without treating paths or emails as commands", () => {
  expect(completionToken("/mod", 4)).toEqual({
    prefix: "/",
    query: "mod",
    start: 0,
    end: 4,
  });
  expect(completionToken("请用 $review 检查", 10)).toEqual({
    prefix: "$",
    query: "review",
    start: 3,
    end: 10,
  });
  expect(completionToken("检查 @src/app.ts", 7)).toEqual({
    prefix: "@",
    query: "src",
    start: 3,
    end: 7,
  });
  expect(completionToken("user@example.com", 16)).toBeNull();
  expect(completionToken("看 /tmp", 6)).toBeNull();
  expect(completionToken("/tmp/file", 9)).toBeNull();
});

test("skill references survive edits, disappear on removal, and clear only after a matching send", () => {
  const drafts = new DraftsStore();
  drafts.setText("a", "$review 检查代码");
  drafts.addSkill("a", { name: "review", path: "/skills/review/SKILL.md" });
  drafts.setText("a", "$review 检查新代码");
  expect(drafts.get("a").skills).toHaveLength(1);
  const revision = drafts.get("a").revision;
  drafts.setText("a", "$review-other 检查");
  expect(drafts.get("a").skills).toEqual([]);
  expect(drafts.clearIfRevision("a", revision)).toBe(false);
  drafts.clearIfRevision("a", drafts.get("a").revision);
  expect(drafts.get("a").text).toBe("");
  expect(drafts.get("a").skills).toEqual([]);
});
