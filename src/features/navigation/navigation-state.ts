import { Store } from "../../lib/store";

export type NavigationView = "projects" | "recent";
export type NavigationStatus = "all" | "attention" | "running" | "unread";
export interface NavigationState {
  scope: string;
  view: NavigationView;
  status: NavigationStatus;
  collapsed: Record<string, boolean>;
  visits: Record<string, number>;
}
type NavigationStorage = Pick<Storage, "getItem" | "setItem">;
export const NAVIGATION_STORAGE_KEY = "codex-workbench.navigation.v1";
const MAX_VISITS = 2000;
const MAX_COLLAPSED = 5000;
const MAX_POSITIONS = 500;
const defaults = (): NavigationState => ({
  scope: "current",
  view: "projects",
  status: "all",
  collapsed: {},
  visits: {},
});
const validScope = (scope: unknown): scope is string =>
  typeof scope === "string" && /^[\w-]{1,80}$/.test(scope);
const validKey = (key: string) =>
  key.length > 0 &&
  key.length <= 8192 &&
  !["__proto__", "prototype", "constructor"].includes(key);
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const finiteNonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const validTimestamp = (value: unknown): value is number =>
  finiteNonnegative(value) && value <= 8.64e15;
function validVisitKey(key: string) {
  try {
    const pair: unknown = JSON.parse(key);
    return (
      Array.isArray(pair) &&
      pair.length === 2 &&
      pair.every((part) => typeof part === "string" && part.length > 0)
    );
  } catch {
    return false;
  }
}

function browserStorage(): NavigationStorage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

function readPreferences(storage?: NavigationStorage): {
  state: NavigationState;
  positions: Record<string, number>;
} {
  try {
    const raw = object(
      JSON.parse(storage?.getItem(NAVIGATION_STORAGE_KEY) || "null"),
    );
    const records = <T>(
      value: unknown,
      valid: (entry: unknown) => entry is T,
      limit: number,
    ) =>
      Object.fromEntries(
        Object.entries(object(value))
          .filter(([key, entry]) => validKey(key) && valid(entry))
          .slice(-limit),
      ) as Record<string, T>;
    const visits = records(raw.visits, validTimestamp, Infinity);
    return {
      state: {
        scope: validScope(raw.scope) ? raw.scope : "current",
        view: raw.view === "recent" ? "recent" : "projects",
        status:
          typeof raw.status === "string" &&
          ["attention", "running", "unread"].includes(raw.status)
            ? (raw.status as NavigationStatus)
            : "all",
        collapsed: records(
          raw.collapsed,
          (entry): entry is boolean => typeof entry === "boolean",
          MAX_COLLAPSED,
        ),
        visits: Object.fromEntries(
          Object.entries(visits)
            .filter(([key]) => validVisitKey(key))
            .sort((a, b) => b[1] - a[1])
            .slice(0, MAX_VISITS),
        ),
      },
      positions: records(raw.positions, finiteNonnegative, MAX_POSITIONS),
    };
  } catch {
    return { state: defaults(), positions: {} };
  }
}

/** Endpoint identity survives reconnects while separating reused environment IDs. */
export function navigationEnvironmentKey(environment: {
  id: string;
  url: string;
}) {
  return JSON.stringify([environment.id, environment.url]);
}
export const navigationVisitKey = (environmentKey: string, id: string) =>
  JSON.stringify([environmentKey, id]);

export class NavigationStore extends Store<NavigationState> {
  private positions: Record<string, number>;
  private saveTimer?: ReturnType<typeof setTimeout>;
  constructor(
    private storage: NavigationStorage | undefined = browserStorage(),
  ) {
    const saved = readPreferences(storage);
    super(saved.state);
    this.positions = saved.positions;
  }
  private persist() {
    try {
      this.storage?.setItem(
        NAVIGATION_STORAGE_KEY,
        JSON.stringify({ ...this.state, positions: this.positions }),
      );
    } catch {
      /* Preferences remain usable for this visit. */
    }
  }
  private change(next: NavigationState) {
    this.update(next);
    this.persist();
  }
  setScope(scope: string) {
    if (validScope(scope) && scope !== this.state.scope)
      this.change({ ...this.state, scope });
  }
  setView(view: NavigationView) {
    if (["projects", "recent"].includes(view) && view !== this.state.view)
      this.change({ ...this.state, view });
  }
  setStatus(status: NavigationStatus) {
    if (
      ["all", "attention", "running", "unread"].includes(status) &&
      status !== this.state.status
    )
      this.change({ ...this.state, status });
  }
  setCollapsed(key: string, collapsed: boolean) {
    if (validKey(key) && this.state.collapsed[key] !== collapsed) {
      const entries = { ...this.state.collapsed, [key]: collapsed };
      this.change({
        ...this.state,
        collapsed: Object.fromEntries(
          Object.entries(entries).slice(-MAX_COLLAPSED),
        ),
      });
    }
  }
  collapseAll(keys: string[], collapsed: boolean) {
    const changes = keys.filter(
      (key) => validKey(key) && this.state.collapsed[key] !== collapsed,
    );
    if (!changes.length) return;
    this.change({
      ...this.state,
      collapsed: Object.fromEntries(
        Object.entries({
          ...this.state.collapsed,
          ...Object.fromEntries(changes.map((key) => [key, collapsed])),
        }).slice(-MAX_COLLAPSED),
      ),
    });
  }
  visit(environmentKey: string, id: string, now = Date.now()) {
    const key = navigationVisitKey(environmentKey, id);
    if (
      !environmentKey ||
      !id ||
      !validKey(key) ||
      !validTimestamp(now) ||
      this.state.visits[key] === now
    )
      return;
    const visits = { ...this.state.visits, [key]: now };
    this.change({
      ...this.state,
      visits: Object.fromEntries(
        Object.entries(visits)
          .sort((a, b) => b[1] - a[1])
          .slice(0, MAX_VISITS),
      ),
    });
  }
  scrollPosition(key: string) {
    return Object.hasOwn(this.positions, key) ? this.positions[key] : 0;
  }
  saveScroll(key: string, position: number) {
    if (
      !validKey(key) ||
      !finiteNonnegative(position) ||
      this.positions[key] === position
    )
      return;
    this.positions = Object.fromEntries(
      Object.entries({ ...this.positions, [key]: position }).slice(
        -MAX_POSITIONS,
      ),
    );
    if (!this.saveTimer)
      this.saveTimer = setTimeout(() => {
        this.saveTimer = undefined;
        this.persist();
      }, 150);
  }
}
export const navigationState = new NavigationStore();
