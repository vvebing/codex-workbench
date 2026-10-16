import { Store, errorMessage } from "../../lib/store";
import type { ConnectionStore } from "../connection/store";
import type { ExternalAgentConfigDetectResponse } from "../../generated/v2/ExternalAgentConfigDetectResponse";
import type { ExternalAgentConfigImportResponse } from "../../generated/v2/ExternalAgentConfigImportResponse";
import type { ExternalAgentConfigImportHistoriesReadResponse } from "../../generated/v2/ExternalAgentConfigImportHistoriesReadResponse";
import type { ExternalAgentConfigImportTypeResult } from "../../generated/v2/ExternalAgentConfigImportTypeResult";
import type { ExternalAgentConfigImportProgressNotification } from "../../generated/v2/ExternalAgentConfigImportProgressNotification";

type State = {
  detected: ExternalAgentConfigDetectResponse | null;
  selected: number[];
  detecting: boolean;
  detectError: string | null;
  importing: boolean;
  importId: string | null;
  completed: boolean;
  importError: string | null;
  results: ExternalAgentConfigImportTypeResult[];
  histories: ExternalAgentConfigImportHistoriesReadResponse | null;
  historyLoading: boolean;
  historyError: string | null;
};
export class ConfigMigrationStore extends Store<State> {
  private alive = false;
  private generation = 0;
  private early = new Map<
    string,
    { event: ExternalAgentConfigImportProgressNotification; completed: boolean }
  >();
  private stop: (() => void) | undefined;
  constructor(
    readonly connection: ConnectionStore,
    readonly cwd?: string,
    readonly epoch = connection.getSnapshot().epoch,
  ) {
    super({
      detected: null,
      selected: [],
      detecting: false,
      detectError: null,
      importing: false,
      importId: null,
      completed: false,
      importError: null,
      results: [],
      histories: null,
      historyLoading: false,
      historyError: null,
    });
  }
  start(): () => void {
    if (this.alive) return () => this.dispose();
    this.alive = true;
    this.stop = this.connection.client.onNotification((event) => {
      if (
        !this.current() ||
        !this.state.importing ||
        (event.method !== "externalAgentConfig/import/progress" &&
          event.method !== "externalAgentConfig/import/completed")
      )
        return;
      const completed = event.method === "externalAgentConfig/import/completed";
      if (!this.state.importId) {
        const prior = this.early.get(event.params.importId);
        if (!prior?.completed) {
          const results = new Map(
            prior?.event.itemTypeResults.map((result) => [
              result.itemType,
              result,
            ]),
          );
          for (const result of event.params.itemTypeResults)
            results.set(result.itemType, result);
          this.early.set(event.params.importId, {
            event: { ...event.params, itemTypeResults: [...results.values()] },
            completed,
          });
        }
        if (this.early.size > 20)
          this.early.delete(this.early.keys().next().value!);
      } else this.apply(event.params, completed);
    });
    return () => this.dispose();
  }
  private current(generation = this.generation) {
    return (
      this.alive &&
      generation === this.generation &&
      this.connection.getSnapshot().epoch === this.epoch &&
      this.connection.getSnapshot().status === "connected"
    );
  }
  dispose() {
    this.alive = false;
    this.generation++;
    this.stop?.();
    this.stop = undefined;
    this.early.clear();
    this.update({
      ...this.state,
      detecting: false,
      historyLoading: false,
      importing: false,
      importId: null,
    });
  }
  select(index: number, checked: boolean) {
    if (this.state.importing || !this.state.detected?.items[index]) return;
    this.update({
      ...this.state,
      selected: checked
        ? [...new Set([...this.state.selected, index])]
        : this.state.selected.filter((value) => value !== index),
    });
  }
  async detect(includeHome = false) {
    if (!this.current() || this.state.detecting || this.state.importing) return;
    const generation = this.generation;
    this.update({
      ...this.state,
      detecting: true,
      detected: null,
      selected: [],
      detectError: null,
    });
    try {
      const detected =
        await this.connection.client.request<ExternalAgentConfigDetectResponse>(
          "externalAgentConfig/detect",
          { includeHome, cwds: this.cwd ? [this.cwd] : [], maxSessions: 100 },
        );
      if (this.current(generation))
        this.update({ ...this.state, detecting: false, detected });
    } catch (error) {
      if (this.current(generation))
        this.update({
          ...this.state,
          detecting: false,
          detectError: errorMessage(error),
        });
    }
  }
  async readHistories() {
    if (!this.current() || this.state.historyLoading) return;
    const generation = this.generation;
    this.update({ ...this.state, historyLoading: true, historyError: null });
    try {
      const histories =
        await this.connection.client.request<ExternalAgentConfigImportHistoriesReadResponse>(
          "externalAgentConfig/import/readHistories",
        );
      if (this.current(generation))
        this.update({ ...this.state, histories, historyLoading: false });
    } catch (error) {
      if (this.current(generation))
        this.update({
          ...this.state,
          historyLoading: false,
          historyError: errorMessage(error),
        });
    }
  }
  private apply(
    event: ExternalAgentConfigImportProgressNotification,
    completed: boolean,
  ) {
    if (
      !this.current() ||
      event.importId !== this.state.importId ||
      this.state.completed
    )
      return;
    // Type results are rolling per item type, so preserve progress from other types.
    const results = new Map(
      this.state.results.map((result) => [result.itemType, result]),
    );
    for (const result of event.itemTypeResults)
      results.set(result.itemType, result);
    this.update({
      ...this.state,
      results: [...results.values()],
      completed,
      importing: !completed,
    });
    if (completed) void this.readHistories();
  }
  async importSelected() {
    if (
      !this.current() ||
      this.state.importing ||
      this.state.detecting ||
      !this.state.detected ||
      !this.state.selected.length
    )
      return;
    const migrationItems = this.state.selected.flatMap((index) =>
      this.state.detected!.items[index]
        ? [this.state.detected!.items[index]!]
        : [],
    );
    if (!migrationItems.length) return;
    const generation = this.generation;
    this.early.clear();
    this.update({
      ...this.state,
      importing: true,
      completed: false,
      importId: null,
      importError: null,
      results: [],
    });
    try {
      const { importId } =
        await this.connection.client.request<ExternalAgentConfigImportResponse>(
          "externalAgentConfig/import",
          { migrationItems, source: "codex-workbench" },
        );
      if (!this.current(generation)) return;
      this.update({ ...this.state, importId });
      const early = this.early.get(importId);
      if (early) this.apply(early.event, early.completed);
      this.early.clear();
    } catch (error) {
      if (this.current(generation))
        this.update({
          ...this.state,
          importing: false,
          importError: `${errorMessage(error)} 请检查导入历史后再决定是否重试。`,
        });
    }
  }
}
