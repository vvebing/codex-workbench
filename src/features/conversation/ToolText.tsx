import { memo, useMemo } from "react";
import { Markdown } from "./Markdown";

/** Reuse conversation typography without highlighting unbounded tool logs. */
export const ToolText = memo(function ToolText({
  text,
  mimeType,
}: {
  text: string;
  mimeType?: string;
}) {
  const presentation = useMemo(() => {
    const mime = mimeType?.split(";")[0].trim().toLowerCase();
    const json = mime?.endsWith("/json") || mime?.endsWith("+json");
    const markdown = mime === "text/markdown" || mime === "text/x-markdown";
    if (text.length > 50_000 || (mime && !json && !markdown))
      return { format: "plain", text };
    const trimmed = text.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[") || json) {
      try {
        let preserveNumbers = false;
        const parsed: unknown = JSON.parse(trimmed, (_key, value: unknown) => {
          if (
            typeof value === "number" &&
            (!Number.isFinite(value) ||
              (Number.isInteger(value) && !Number.isSafeInteger(value)) ||
              Object.is(value, -0))
          )
            preserveNumbers = true;
          return value;
        });
        // Preserve large IDs, overflowing exponents and negative zero.
        const formatted = preserveNumbers
          ? trimmed
          : JSON.stringify(parsed, null, 2);
        if (formatted.length <= 50_000)
          return { format: "json", text: `\`\`\`json\n${formatted}\n\`\`\`` };
        return { format: "plain", text };
      } catch {
        // Tool text need not be valid JSON; render its Markdown normally.
      }
    }
    return { format: "markdown", text };
  }, [text, mimeType]);
  return (
    <div
      data-slot="tool-text"
      className={`min-w-0 [&_[data-slot=markdown]]:text-control ${presentation.format === "json" ? "" : "rounded-md border border-border bg-surface p-3"}`}
    >
      {presentation.format === "plain" ? (
        <pre className="font-mono text-code leading-code whitespace-pre-wrap [overflow-wrap:anywhere]">
          {text}
        </pre>
      ) : (
        <Markdown text={presentation.text} preserveLineBreaks />
      )}
    </div>
  );
});
