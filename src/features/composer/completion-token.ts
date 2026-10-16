export interface CompletionToken {
  prefix: "/" | "$" | "@";
  query: string;
  start: number;
  end: number;
}
export function completionToken(
  text: string,
  caret: number,
): CompletionToken | null {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)([$@][^\s$@]*|\/[^\s/]*)$/.exec(before);
  if (!match) return null;
  const token = match[1];
  const start = caret - token.length;
  if (token[0] === "/" && text.slice(0, start).trim()) return null;
  return {
    prefix: token[0] as CompletionToken["prefix"],
    query: token.slice(1),
    start,
    end: caret,
  };
}
export function hasSkillToken(text: string, name: string): boolean {
  return text.split(/\s+/).some((token) => token === `$${name}`);
}
