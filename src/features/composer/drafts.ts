import type { UserInput } from "../../generated/v2/UserInput";
import { restoredMessage } from "./restore-message";
import { textDocument, documentApps } from "./editor-document";
import { hasSkillToken } from "./completion-token";
import { Store } from "../../lib/store";
import type { JSONContent } from "@tiptap/core";
export interface DraftImage {
  id: string;
  name: string;
  url: string;
}
export interface Draft {
  text: string;
  images: DraftImage[];
  revision: number;
  skills?: { name: string; path: string }[];
  document?: JSONContent;
  restored?: {
    id: string;
    preserved: boolean;
    unavailableAttachments: boolean;
  };
}
export const emptyDraft = (): Draft => ({ text: "", images: [], revision: 0 });
export class DraftsStore extends Store<Record<string, Draft>> {
  private scopes = new Map<string, Record<string, Draft>>();
  private scope = "";
  private aliases = new Map<string, string>();
  private aliasScopes = new Map<string, Map<string, string>>();
  constructor() {
    super({});
  }
  activateScope(scope: string): void {
    if (scope === this.scope) return;
    this.scopes.set(this.scope, this.state);
    this.aliasScopes.set(this.scope, this.aliases);
    this.scope = scope;
    this.aliases = this.aliasScopes.get(scope) ?? new Map();
    this.update(this.scopes.get(scope) ?? {});
  }
  get(threadId: string): Draft {
    return this.state[this.resolveId(threadId)] ?? emptyDraft();
  }
  hasContent(): boolean {
    return [
      this.state,
      ...Array.from(this.scopes)
        .filter(([scope]) => scope !== this.scope)
        .map(([, drafts]) => drafts),
    ].some((drafts) =>
      Object.values(drafts).some(
        (draft) => !!draft.text.trim() || draft.images.length > 0,
      ),
    );
  }
  private resolveId(id: string): string {
    while (this.aliases.has(id)) id = this.aliases.get(id)!;
    return id;
  }
  move(from: string, to: string): void {
    from = this.resolveId(from);
    to = this.resolveId(to);
    if (from === to) return;
    const state = { ...this.state, [to]: this.get(from) };
    delete state[from];
    this.aliases.set(from, to);
    this.update(state);
  }
  remove(id: string): void {
    id = this.resolveId(id);
    const state = { ...this.state };
    delete state[id];
    this.update(state);
  }
  private edit(threadId: string, patch: Partial<Draft>): void {
    threadId = this.resolveId(threadId);
    const old = this.get(threadId);
    this.update({
      ...this.state,
      [threadId]: {
        ...old,
        restored: undefined,
        ...patch,
        revision: old.revision + 1,
      },
    });
  }
  restoreMessage(threadId: string, content: UserInput[]): void {
    const original = restoredMessage(content);
    const existing = this.get(threadId);
    const preserved = !!existing.text.trim() || existing.images.length > 0;
    const appendText = !!existing.text && existing.text !== original.text;
    const text = appendText
      ? [original.text, existing.text].filter(Boolean).join("\n\n")
      : original.text;
    const document = appendText
      ? {
          type: "doc",
          content: [
            ...(original.text ? original.document?.content || [] : []),
            ...(original.text ? [{ type: "paragraph" }] : []),
            ...((existing.document || textDocument(existing.text)).content ||
              []),
          ],
        }
      : original.document;
    this.edit(threadId, {
      text,
      document,
      skills: [
        ...new Map(
          [...(original.skills || []), ...(existing.skills || [])].map(
            (skill) => [skill.path, skill],
          ),
        ).values(),
      ],
      images: [
        ...new Map(
          [...original.images, ...existing.images].map((image) => [
            image.url,
            image,
          ]),
        ).values(),
      ],
      restored: {
        id: crypto.randomUUID(),
        preserved,
        unavailableAttachments: original.unavailableAttachments,
      },
    });
  }
  setText(threadId: string, text: string): void {
    this.edit(threadId, {
      text,
      document: undefined,
      skills: this.get(threadId).skills?.filter((skill) =>
        hasSkillToken(text, skill.name),
      ),
    });
  }
  setDocument(
    threadId: string,
    document: JSONContent,
    text: string,
    skills: { name: string; path: string }[],
  ): void {
    this.edit(threadId, { document, text, skills });
  }
  addSkill(threadId: string, skill: { name: string; path: string }): void {
    this.edit(threadId, {
      skills: [
        ...(this.get(threadId).skills ?? []).filter(
          (entry) => entry.name !== skill.name,
        ),
        skill,
      ],
    });
  }
  addApp(threadId: string, app: { id: string; name: string }): void {
    if (!app.id.trim() || !app.name.trim())
      throw new Error("应用信息不完整，无法插入引用。");
    const draft = this.get(threadId);
    const path = `app://${app.id}`;
    if (documentApps(draft.document).some((entry) => entry.path === path))
      return;
    const document = structuredClone(
      draft.document ?? textDocument(draft.text),
    );
    const reference: JSONContent = {
      type: "reference",
      attrs: {
        kind: "app",
        label: app.name,
        name: app.name,
        path,
        value: `@${path}`,
      },
    };
    const paragraph: JSONContent = {
      type: "paragraph",
      content: [reference, { type: "text", text: " " }],
    };
    if (
      !draft.text &&
      document.content?.length === 1 &&
      !document.content[0].content?.length
    )
      document.content = [paragraph];
    else document.content = [...(document.content ?? []), paragraph];
    this.edit(threadId, {
      document,
      text: `${draft.text}${draft.text ? "\n" : ""}@${path} `,
    });
  }
  addImage(threadId: string, image: DraftImage): void {
    this.edit(threadId, { images: [...this.get(threadId).images, image] });
  }
  removeImage(threadId: string, id: string): void {
    this.edit(threadId, {
      images: this.get(threadId).images.filter((image) => image.id !== id),
    });
  }
  clearIfRevision(threadId: string, revision: number): boolean {
    if (this.get(threadId).revision !== revision) return false;
    this.edit(threadId, {
      text: "",
      images: [],
      skills: [],
      document: undefined,
    });
    return true;
  }
}
