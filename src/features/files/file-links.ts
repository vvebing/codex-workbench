import { defaultUrlTransform } from "react-markdown";

export interface FileLinkOrigin {
  cwd?: string;
  threadId?: string;
}
export interface FileLinkTarget extends FileLinkOrigin {
  path: string;
  line?: number;
  column?: number;
  endLine?: number;
}

const hasControlCharacters = (value: string) =>
  [...value].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );

/** Parse an explicit Markdown destination. Plain code spans are never links. */
export function parseFileLink(
  href: string,
  origin: FileLinkOrigin = {},
): FileLinkTarget | null {
  let path = href.trim();
  if (!path || hasControlCharacters(path)) return null;
  // Protocol-relative URLs and document fragments remain ordinary web links.
  if (/^(?:\/\/|#|\?)/.test(path)) return null;
  const windows = /^[a-z]:[\\/]/i.test(path);
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(path)?.[1];
  if (
    scheme &&
    !windows &&
    /^(?:javascript|vbscript|data|https?|mailto|tel|ftp|ftps|blob|about)$/i.test(
      scheme,
    )
  )
    return null;
  const basenameLocation = /^[^/\\:]+:\d+(?::\d+)?$/.test(path);
  if (scheme && !windows && !basenameLocation) {
    if (scheme.toLowerCase() !== "file") return null;
    try {
      const url = new URL(path);
      // Only local file URLs: do not silently turn remote hosts into local files.
      if (url.hostname && url.hostname !== "localhost") return null;
      if (url.search || url.username || url.password || url.port) return null;
      path = url.pathname + url.hash;
      if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
    } catch {
      return null;
    }
  }
  let line: number | undefined;
  let column: number | undefined;
  let endLine: number | undefined;
  // Parse locations before decoding so encoded colons/hash signs stay filenames.
  const hash = /#L(\d+)(?:-L?(\d+))?$/i.exec(path);
  const colon = hash ? null : /:(\d+)(?::(\d+))?$/.exec(path);
  const location = hash || colon;
  if (location) {
    path = path.slice(0, location.index);
    line = Number(location[1]);
    if (hash?.[2]) endLine = Number(hash[2]);
    if (colon?.[2]) column = Number(colon[2]);
    if (
      [line, column, endLine].some(
        (value) =>
          value !== undefined && (!Number.isSafeInteger(value) || value < 1),
      ) ||
      (endLine !== undefined && endLine < line)
    )
      return null;
  } else if (path.includes("#")) return null;
  if (path.includes("?")) return null;
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (!path || hasControlCharacters(path)) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path))
    return null;
  if (path.startsWith("//")) return null;
  // Preserve ../: the file store resolves it against this captured origin, not
  // the selected thread. Files outside the project remain valid local targets.
  return {
    ...origin,
    path,
    ...(line ? { line } : {}),
    ...(column ? { column } : {}),
    ...(endLine ? { endLine } : {}),
  };
}

/** Keep ReactMarkdown's sanitizer for every URL except validated file anchors. */
export function fileLinkUrlTransform(url: string, key: string) {
  return key === "href" && parseFileLink(url) ? url : defaultUrlTransform(url);
}
