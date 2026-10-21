import { useSyncExternalStore } from "react";

export const TYPOGRAPHY_STORAGE_KEY = "codex-workbench.typography";
export function fontSizeOptions(current: string, defaultSize: string) {
  // Include migrated fractional sizes so existing preferences remain selectable.
  return [
    ...new Set([12, 13, 14, 15, 16, 18, 20, 21, 24, 28, 32, Number(current)]),
  ]
    .sort((a, b) => a - b)
    .map((size) => ({
      value: String(size),
      label: `${size} px${String(size) === defaultSize ? "（默认）" : ""}`,
    }));
}
export const interfaceFontOptions = [
  { value: "default", label: "默认字体" },
  { value: "system", label: "系统字体" },
  { value: "serif", label: "衬线字体" },
];
export const codeFontOptions = [
  { value: "default", label: "默认等宽字体" },
  { value: "menlo", label: "Menlo" },
  { value: "courier", label: "Courier New" },
];
const interfaceFonts = {
  default: "",
  system: "var(--font-system)",
  serif: "var(--font-serif)",
};
const codeFonts = {
  default: "",
  menlo: "var(--font-menlo)",
  courier: "var(--font-courier)",
};
export interface TypographyPreference {
  fontSize: string;
  codeFontSize: string;
  interfaceFont: keyof typeof interfaceFonts;
  codeFont: keyof typeof codeFonts;
}
export const defaultTypography: TypographyPreference = {
  fontSize: "14",
  codeFontSize: "13",
  interfaceFont: "default",
  codeFont: "default",
};
let preference = defaultTypography;
const listeners = new Set<() => void>();
let cleanup: (() => void) | undefined;

function parse(raw: string | null): TypographyPreference {
  try {
    const value = JSON.parse(raw ?? "null") as Record<string, unknown> | null;
    const legacyScale = (key: string) =>
      ["0.875", "1", "1.125", "1.25", "1.5"].includes(String(value?.[key]))
        ? Number(value?.[key])
        : 1;
    const size = (key: "fontSize" | "codeFontSize", legacy: number) => {
      if (value?.[key] === undefined) return String(legacy);
      const candidate = value[key];
      return typeof candidate === "string" &&
        candidate.trim() !== "" &&
        Number.isFinite(Number(candidate)) &&
        Number(candidate) >= 8 &&
        Number(candidate) <= 40
        ? String(Number(candidate))
        : defaultTypography[key];
    };
    const choice = (
      key: keyof TypographyPreference,
      options: { value: string }[],
    ) =>
      options.find((option) => option.value === value?.[key])?.value ??
      defaultTypography[key];
    return {
      fontSize: size("fontSize", 14 * legacyScale("fontScale")),
      codeFontSize: size(
        "codeFontSize",
        13 * legacyScale("fontScale") * legacyScale("codeFontScale"),
      ),
      interfaceFont: choice(
        "interfaceFont",
        interfaceFontOptions,
      ) as TypographyPreference["interfaceFont"],
      codeFont: choice(
        "codeFont",
        codeFontOptions,
      ) as TypographyPreference["codeFont"],
    };
  } catch {
    return defaultTypography;
  }
}
function update(next: TypographyPreference) {
  preference = next;
  const style = document.documentElement.style;
  const values = {
    "--font-scale":
      next.fontSize === "14" ? "" : String(Number(next.fontSize) / 14),
    "--code-font-size":
      next.codeFontSize === "13" ? "" : `${next.codeFontSize}px`,
    "--font-sans": interfaceFonts[next.interfaceFont],
    "--font-mono": codeFonts[next.codeFont],
  };
  for (const [property, value] of Object.entries(values)) {
    if (value) style.setProperty(property, value);
    else style.removeProperty(property);
  }
  for (const listener of listeners) listener();
}

/** Apply saved variables before React mounts; retain stylesheet defaults. */
export function initializeTypography() {
  cleanup?.();
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(TYPOGRAPHY_STORAGE_KEY);
  } catch {
    /* Local storage is optional. */
  }
  update(parse(raw));
  const onStorage = (event: StorageEvent) => {
    if (event.key === TYPOGRAPHY_STORAGE_KEY || event.key === null)
      update(parse(event.newValue));
  };
  window.addEventListener("storage", onStorage);
  cleanup = () => {
    window.removeEventListener("storage", onStorage);
    cleanup = undefined;
  };
  return cleanup;
}
export function setTypography(next: Partial<TypographyPreference>) {
  const validated = parse(JSON.stringify({ ...preference, ...next }));
  try {
    window.localStorage.setItem(
      TYPOGRAPHY_STORAGE_KEY,
      JSON.stringify(validated),
    );
  } catch {
    /* Changes still apply for this visit when persistence is unavailable. */
  }
  update(validated);
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useTypography() {
  return useSyncExternalStore(
    subscribe,
    () => preference,
    () => defaultTypography,
  );
}
