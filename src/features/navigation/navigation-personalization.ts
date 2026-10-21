import { Store } from "../../lib/store";

export const NAVIGATION_PERSONALIZATION_STORAGE_KEY =
  "codex-workbench.navigation-personalization";
export interface NavigationPersonalization {
  pinnedThreads: string[];
  pinnedProjects: string[];
}
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

/** Environment and item IDs are kept separate, including IDs containing punctuation. */
export function personalizationKey(environmentKey: string, id: string): string {
  return JSON.stringify([environmentKey, id]);
}
function validKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((key): key is string => {
        if (typeof key !== "string") return false;
        try {
          const pair: unknown = JSON.parse(key);
          return (
            Array.isArray(pair) &&
            pair.length === 2 &&
            pair.every((part) => typeof part === "string")
          );
        } catch {
          return false;
        }
      }),
    ),
  ];
}
function read(storage?: PreferenceStorage): NavigationPersonalization {
  try {
    const value: unknown = JSON.parse(
      storage?.getItem(NAVIGATION_PERSONALIZATION_STORAGE_KEY) ?? "null",
    );
    if (value && typeof value === "object") {
      const entry = value as Partial<NavigationPersonalization>;
      return {
        pinnedThreads: validKeys(entry.pinnedThreads),
        pinnedProjects: validKeys(entry.pinnedProjects),
      };
    }
  } catch {
    // Preferences remain usable in this browser session when storage is blocked.
  }
  return { pinnedThreads: [], pinnedProjects: [] };
}
function browserStorage(): PreferenceStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
export class NavigationPersonalizationStore extends Store<NavigationPersonalization> {
  constructor(
    private readonly storage: PreferenceStorage | undefined = browserStorage(),
  ) {
    super(read(storage));
  }
  reload(): void {
    this.update(read(this.storage));
  }
  private toggle(
    field: keyof NavigationPersonalization,
    environmentKey: string,
    id: string,
  ): void {
    const key = personalizationKey(environmentKey, id);
    const values = this.state[field];
    const next = {
      ...this.state,
      [field]: values.includes(key)
        ? values.filter((value) => value !== key)
        : [...values, key],
    };
    try {
      this.storage?.setItem(
        NAVIGATION_PERSONALIZATION_STORAGE_KEY,
        JSON.stringify(next),
      );
    } catch {
      // Local personalization must not block navigation or session actions.
    }
    this.update(next);
  }
  toggleThread(environmentKey: string, id: string): void {
    this.toggle("pinnedThreads", environmentKey, id);
  }
  toggleProject(environmentKey: string, projectKey: string): void {
    this.toggle("pinnedProjects", environmentKey, projectKey);
  }
  isThreadPinned(environmentKey: string, id: string): boolean {
    return this.state.pinnedThreads.includes(
      personalizationKey(environmentKey, id),
    );
  }
  isProjectPinned(environmentKey: string, projectKey: string): boolean {
    return this.state.pinnedProjects.includes(
      personalizationKey(environmentKey, projectKey),
    );
  }
}
export const navigationPersonalization = new NavigationPersonalizationStore();
if (typeof window !== "undefined")
  window.addEventListener("storage", (event) => {
    if (
      event.key === NAVIGATION_PERSONALIZATION_STORAGE_KEY ||
      event.key === null
    )
      navigationPersonalization.reload();
  });
