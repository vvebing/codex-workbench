/** Bridge CSS tokens to renderers that require resolved colors and pixel sizes. */
export function readAppearance() {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const token = (name: string) => style.getPropertyValue(`--${name}`).trim();
  // CSS minifiers shorten hex colors, but Monaco's token parser requires
  // six/eight digits (including editor.background in inherited themes).
  const color = (name: string) =>
    token(name).replace(
      /^#([\da-f]{3,4})$/i,
      (_, digits: string) =>
        "#" + [...digits].map((digit) => digit + digit).join(""),
    );
  // Custom properties retain calc()/rem expressions. Resolve via font-size
  // rather than parseFloat(), which would silently lose scaling and units.
  const probe = document.createElement("span");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;font-size:var(--text-code)";
  root.append(probe);
  const codeFontSize = Number.parseFloat(getComputedStyle(probe).fontSize);
  probe.style.fontSize = "var(--text-base)";
  const diagramFontSize = getComputedStyle(probe).fontSize;
  probe.remove();
  return {
    dark: root.dataset.theme === "dark",
    fontFamily: token("font-sans"),
    codeFontFamily: token("font-mono"),
    codeFontSize,
    diagramFontSize,
    background: color("background"),
    surface: color("surface"),
    elevated: color("elevated"),
    selected: color("selected"),
    foreground: color("foreground"),
    muted: color("muted"),
    border: color("border"),
    accent: color("accent"),
    success: color("success"),
    warning: color("warning"),
  };
}

export type Appearance = ReturnType<typeof readAppearance>;

/** Runtime overrides live on the root, alongside the resolved theme. */
export function observeAppearance(update: (appearance: Appearance) => void) {
  let previous = JSON.stringify(readAppearance());
  const observer = new MutationObserver(() => {
    const appearance = readAppearance();
    const next = JSON.stringify(appearance);
    // Viewport/keyboard variables also live on the root. They must not cause
    // diagram rerenders or reset editor typography while the user is scrolling.
    if (next === previous) return;
    previous = next;
    update(appearance);
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "style", "class"],
  });
  return () => observer.disconnect();
}
