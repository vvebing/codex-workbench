/** A fenced single-line shell example may be offered, never executed automatically. */
export function terminalCodeCommand(
  source: string,
  language: string | undefined,
  streaming = false,
): string | null {
  if (
    streaming ||
    !language ||
    !["sh", "bash", "zsh", "shell"].includes(language.toLowerCase())
  )
    return null;
  // Markdown adds one trailing newline to fenced code. Additional lines are substantive.
  const command = source.replace(/\n$/, "");
  if (
    !command.trim() ||
    command.length > 4096 ||
    Array.from(command).some((character) => {
      const code = character.charCodeAt(0);
      return (
        code < 32 ||
        (code >= 127 && code <= 159) ||
        code === 0x2028 ||
        code === 0x2029
      );
    })
  )
    return null;
  return command;
}
