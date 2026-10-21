import type { Draft } from "./drafts";
import type { JSONContent } from "@tiptap/core";

const LIMIT = 2_000_000;
export function readLocalDraftData(kind: string, scope: string): unknown {
  try {
    const raw = localStorage.getItem(`codex-workbench.${kind}:${scope}`);
    if (!raw || raw.length > LIMIT) return;
    const data = JSON.parse(raw);
    if (data?.version === 1) return data.value;
  } catch {
    /* Persistence is optional. */
  }
}
export function writeLocalDraftData(
  kind: string,
  scope: string,
  value: unknown,
): boolean {
  if (!scope) return true;
  const key = `codex-workbench.${kind}:${scope}`;
  try {
    const raw = JSON.stringify({ version: 1, value });
    if (raw.length > LIMIT) {
      localStorage.removeItem(key);
      return false;
    }
    localStorage.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}
export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function validDocument(value: unknown, depth = 0): value is JSONContent {
  if (!record(value) || depth > 30 || typeof value.type !== "string")
    return false;
  if (
    !["doc", "paragraph", "text", "hardBreak", "reference"].includes(value.type)
  )
    return false;
  if (depth === 0 && value.type !== "doc") return false;
  if (
    value.marks !== undefined &&
    (!Array.isArray(value.marks) || value.marks.length > 0)
  )
    return false;
  if (
    value.type === "reference" &&
    (!record(value.attrs) ||
      !["file", "skill", "app"].includes(String(value.attrs.kind)) ||
      !["label", "value", "name", "path"].every(
        (key) =>
          typeof (value.attrs as Record<string, unknown>)[key] === "string",
      ))
  )
    return false;
  if (value.text !== undefined && typeof value.text !== "string") return false;
  if (value.attrs !== undefined && !record(value.attrs)) return false;
  return (
    value.content === undefined ||
    (Array.isArray(value.content) &&
      value.content.length < 10000 &&
      value.content.every((child) => validDocument(child, depth + 1)))
  );
}
export function readDrafts(scope: string): Record<string, Draft> {
  const data = readLocalDraftData("drafts", scope);
  if (!record(data)) return {};
  const entries: [string, Draft][] = [];
  for (const [id, value] of Object.entries(data).slice(0, 500)) {
    if (
      !record(value) ||
      typeof value.text !== "string" ||
      value.text.length > 500000
    )
      continue;
    const skills = Array.isArray(value.skills)
      ? (value.skills.filter(
          (s) =>
            record(s) &&
            typeof s.name === "string" &&
            typeof s.path === "string",
        ) as Draft["skills"])
      : [];
    entries.push([
      id,
      {
        text: value.text,
        images: [],
        revision: 0,
        skills,
        document: validDocument(value.document) ? value.document : undefined,
        restored: {
          source: "draft",
          id: crypto.randomUUID(),
          preserved: false,
          unavailableAttachments: value.unavailableAttachments === true,
        },
      },
    ]);
  }
  return Object.fromEntries(entries);
}
export function writeDrafts(
  scope: string,
  drafts: Record<string, Draft>,
): boolean {
  return writeLocalDraftData(
    "drafts",
    scope,
    Object.fromEntries(
      Object.entries(drafts)
        .filter(
          ([, draft]) =>
            draft.text.trim() ||
            draft.images.length ||
            draft.restored?.unavailableAttachments,
        )
        .map(([id, draft]) => [
          id,
          {
            text: draft.text,
            document: draft.document,
            skills: draft.skills,
            unavailableAttachments:
              draft.images.length > 0 ||
              draft.restored?.unavailableAttachments === true,
          },
        ]),
    ),
  );
}
