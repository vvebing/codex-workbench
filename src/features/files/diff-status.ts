/** Monaco 0.57 exposes computation status at runtime but omits it from its typings. */
export function diffQuitEarly(editor: {
  getLineChanges(): unknown[] | null;
  getDiffComputationResult?: () => { quitEarly: boolean } | null;
}): boolean {
  if (editor.getDiffComputationResult) {
    // A null result is still computing, not a timeout.
    return editor.getDiffComputationResult()?.quitEarly ?? false;
  }
  return editor.getLineChanges() === null;
}
