/** Optional local storage for ordinary question fields. Secret fields never enter it. */
export type QuestionDraft = {
  values: Record<string, string>;
  custom: Record<string, string>;
};
export function questionDraftKey(
  scope: string,
  threadId: string,
  itemId: string,
): string {
  return `codex-workbench.question-draft:${JSON.stringify([scope, threadId, itemId])}`;
}
export function readQuestionDraft(key: string): QuestionDraft {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    const fields = (input: unknown): Record<string, string> =>
      input && typeof input === "object" && !Array.isArray(input)
        ? (Object.fromEntries(
            Object.entries(input).filter(
              ([, value]) => typeof value === "string",
            ),
          ) as Record<string, string>)
        : {};
    return { values: fields(value?.values), custom: fields(value?.custom) };
  } catch {
    return { values: {}, custom: {} };
  }
}
export function writeQuestionDraft(
  key: string,
  draft: QuestionDraft,
  secretIds: string[] = [],
): void {
  const ordinary = (fields: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(fields).filter(([id]) => !secretIds.includes(id)),
    );
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        values: ordinary(draft.values),
        custom: ordinary(draft.custom),
      }),
    );
  } catch {
    /* Storage is optional. */
  }
}

export function clearQuestionDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* Storage is optional. */
  }
}
