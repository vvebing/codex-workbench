export interface OutputWindow {
  output: string;
  outputStart: number;
}

/** Positions count UTF-16 code units, matching the execution store's history. */
export function outputUpdate(window: OutputWindow, renderedEnd: number | null) {
  const end = window.outputStart + window.output.length;
  const reset =
    renderedEnd === null ||
    renderedEnd < window.outputStart ||
    renderedEnd > end;
  return {
    reset,
    text: reset
      ? window.output
      : window.output.slice(renderedEnd - window.outputStart),
    end,
  };
}

/** Filling a prompt must never inject Enter, escape sequences or other controls. */
export function singleLineCommand(value: string) {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 ||
      (code >= 127 && code <= 159) ||
      code === 0x2028 ||
      code === 0x2029
      ? " "
      : character;
  }).join("");
}
