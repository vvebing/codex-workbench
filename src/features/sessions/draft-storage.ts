import { placeholderThread } from "../../lib/state";
import {
  readLocalDraftData,
  writeLocalDraftData,
  record,
} from "../composer/draft-storage";
import type { SessionsState } from "./state";
import type { ThreadStartParams } from "../../generated/v2/ThreadStartParams";
function options(value: unknown): ThreadStartParams {
  if (!record(value)) return {};
  const result: ThreadStartParams = {};
  for (const key of ["cwd", "model", "modelProvider"] as const)
    if (typeof value[key] === "string") result[key] = value[key];
  if (
    ["read-only", "workspace-write", "danger-full-access"].includes(
      String(value.sandbox),
    )
  )
    result.sandbox = value.sandbox as ThreadStartParams["sandbox"];
  if (
    ["untrusted", "on-request", "never"].includes(String(value.approvalPolicy))
  )
    result.approvalPolicy =
      value.approvalPolicy as ThreadStartParams["approvalPolicy"];
  return result;
}
export function saveLocalSessions(
  scope: string,
  state: SessionsState,
): boolean {
  return writeLocalDraftData("local-sessions", scope, {
    selectedId: state.localDrafts[state.selectedId ?? ""]
      ? state.selectedId
      : null,
    drafts: Object.fromEntries(
      Object.entries(state.localDrafts).map(([id, draft]) => [
        id,
        {
          options: options(draft.options),
          serverId: draft.serverId,
          name: state.threads[id]?.name,
          createdAt: state.threads[id]?.createdAt,
          updatedAt: state.threads[id]?.updatedAt,
        },
      ]),
    ),
  });
}
export function restoreLocalSessions(
  scope: string,
  state: SessionsState,
): SessionsState {
  const data = readLocalDraftData("local-sessions", scope);
  if (!record(data) || !record(data.drafts)) return state;
  const localDrafts: SessionsState["localDrafts"] = {};
  const threads = { ...state.threads };
  for (const [id, draft] of Object.entries(data.drafts).slice(0, 500)) {
    if (!id.startsWith("local-draft-") || !record(draft)) continue;
    const params = options(draft.options);
    localDrafts[id] = {
      options: params,
      ...(typeof draft.serverId === "string"
        ? { serverId: draft.serverId }
        : {}),
    };
    threads[id] = {
      ...placeholderThread(id),
      cwd: params.cwd ?? "",
      model: params.model ?? null,
      name: typeof draft.name === "string" ? draft.name : null,
      createdAt:
        typeof draft.createdAt === "number" && Number.isFinite(draft.createdAt)
          ? draft.createdAt
          : 0,
      updatedAt:
        typeof draft.updatedAt === "number" && Number.isFinite(draft.updatedAt)
          ? draft.updatedAt
          : 0,
    };
  }
  return {
    ...state,
    localDrafts,
    threads,
    selectedId:
      typeof data.selectedId === "string" && localDrafts[data.selectedId]
        ? data.selectedId
        : state.selectedId,
  };
}
