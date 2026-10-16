type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
};

/** User-entered newlines remain visible; code and existing hard breaks stay intact. */
export function promptLineBreaks() {
  return function transform(node: MarkdownNode) {
    if (!node.children) return;
    node.children = node.children.flatMap((child) => {
      if (child.type === "text" && child.value && /[\r\n]/.test(child.value)) {
        return child.value
          .split(/\r\n?|\n/)
          .flatMap((value, index) =>
            index
              ? [{ type: "break" }, { type: "text", value }]
              : [{ type: "text", value }],
          );
      }
      transform(child);
      return [child];
    });
  };
}
