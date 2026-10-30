import { t, useLocale } from "../../lib/i18n";
import { useMemo, type ComponentPropsWithoutRef } from "react";
import type { ExtraProps } from "react-markdown";
import { ScrollArea } from "../../components/ui";
import { Markdown } from "../conversation/Markdown";
import { FileLinkProvider } from "./FileLinkContext";
import { splitFrontmatter } from "./markdown-frontmatter";

function PreviewImage({
  src,
  alt,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"img"> & ExtraProps) {
  const i18nLocale = useLocale();
  void i18nLocale;

  void _node;
  // Relative URLs must never be fetched from the workbench server's origin.
  if (typeof src !== "string" || !/^(https?:)?\/\//i.test(src))
    return (
      <span
        className="file-image-placeholder"
        role="img"
        aria-label={alt || t("本地图片")}
      >
        {t("本地图片暂不支持预览")}
        {alt ? `：${alt}` : ""}
      </span>
    );
  return <img {...props} src={src} alt={alt} />;
}

export function MarkdownPreview({
  text,
  path,
  threadId,
}: {
  text: string;
  path: string;
  threadId?: string;
}) {
  const i18nLocale = useLocale();
  void i18nLocale;

  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const cwd = separator === 0 ? "/" : path.slice(0, separator + 1);
  const { body, rows } = useMemo(() => splitFrontmatter(text), [text]);
  return (
    <ScrollArea
      className="file-markdown-preview"
      orientation="both"
      viewportProps={{ tabIndex: 0, "aria-label": t("Markdown 预览") }}
    >
      <section
        className="file-markdown-preview-content"
        aria-label={t("Markdown 预览")}
      >
        <FileLinkProvider cwd={cwd} threadId={threadId}>
          {rows.length > 0 && (
            <div className="markdown-content mb-4">
              <ScrollArea scrollChaining orientation="both">
                <table aria-label="YAML frontmatter">
                  <tbody>
                    {rows.map(({ key, value }) => (
                      <tr key={key}>
                        <th scope="row">{key}</th>
                        <td className="whitespace-pre-wrap break-words">
                          {value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </div>
          )}
          <Markdown text={body} imageComponent={PreviewImage} />
        </FileLinkProvider>
      </section>
    </ScrollArea>
  );
}
