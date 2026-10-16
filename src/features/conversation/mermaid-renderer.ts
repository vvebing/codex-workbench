let sequence = 0;
let queue: Promise<unknown> = Promise.resolve();

/** Mermaid has shared configuration and rendering state: keep each render isolated. */
export function renderMermaid(source: string, dark: boolean): Promise<string> {
  const result = queue.then(async () => {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: dark ? "dark" : "default",
      fontFamily: "system-ui, sans-serif",
      maxTextSize: 50000,
    });
    await mermaid.parse(source);
    await document.fonts?.ready;
    const container = document.createElement("div");
    container.style.cssText =
      "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none";
    document.body.append(container);
    try {
      const { svg } = await mermaid.render(
        `mermaid-diagram-${++sequence}`,
        source,
        container,
      );
      // A diagram is a viewer, not a navigation surface; remove link wrappers.
      // Mermaid labels can contain HTML (e.g. <br>); parse the sanitized SVG as HTML.
      const parsed = new DOMParser().parseFromString(svg, "text/html");
      const diagram = parsed.querySelector("svg");
      if (!diagram) throw new Error("图表渲染结果无效，请检查源码后重试。");
      for (const link of diagram.querySelectorAll("a")) {
        // Preserve node geometry: Mermaid can put its transform on the link itself.
        const group = parsed.createElementNS("http://www.w3.org/2000/svg", "g");
        for (const name of ["transform", "class", "id", "style"]) {
          const value = link.getAttribute(name);
          if (value != null) group.setAttribute(name, value);
        }
        group.append(...Array.from(link.childNodes));
        link.replaceWith(group);
      }
      for (const node of diagram.querySelectorAll(".clickable"))
        node.classList.remove("clickable");
      return new XMLSerializer().serializeToString(diagram);
    } finally {
      container.remove();
    }
  });
  queue = result.catch(() => {});
  return result;
}
