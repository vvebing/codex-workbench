import type { CommandExecParams } from "../../generated/v2/CommandExecParams";

/** A terminal always asks the server for a read-only, offline sandbox. */
export const READ_ONLY_TERMINAL_POLICY = {
  type: "readOnly",
  networkAccess: false,
} as const;

/**
 * Apple's /usr/bin/git is a developer-tool shim which writes xcrun caches.
 * Resolve its real toolchain only when that shim is the selected Git; preserve
 * Homebrew/custom Git and DEVELOPER_DIR. This runs in the selected environment,
 * so remote hosts do not accidentally inherit the browser machine's paths.
 */
export const TERMINAL_BOOTSTRAP = `if [ "$(uname -s)" = Darwin ] && [ "$(command -v git)" = /usr/bin/git ]; then
  codex_workbench_developer_dir=\${DEVELOPER_DIR-}
  if [ -z "$codex_workbench_developer_dir" ] && [ -x /usr/bin/xcode-select ]; then
    codex_workbench_developer_dir=$(/usr/bin/xcode-select -p)
  fi
  codex_workbench_developer_dir=\${codex_workbench_developer_dir%/}
  case "$codex_workbench_developer_dir" in
    *.app) codex_workbench_developer_dir="$codex_workbench_developer_dir/Contents/Developer" ;;
  esac
  if [ -n "$codex_workbench_developer_dir" ] && [ -x "$codex_workbench_developer_dir/usr/bin/git" ]; then
    PATH="$codex_workbench_developer_dir/usr/bin:$PATH"
    export PATH
  fi
fi
if [ -n "\${CODEX_WORKBENCH_TERMINAL_PS1-}" ]; then
  PS1=$CODEX_WORKBENCH_TERMINAL_PS1
  if [ "\${NO_COLOR+x}" != x ]; then
    if [ -n "\${BASH_VERSION-}" ] && [ -n "\${CODEX_WORKBENCH_TERMINAL_PS1_BASH-}" ]; then
      PS1=$CODEX_WORKBENCH_TERMINAL_PS1_BASH
    elif [ -n "\${CODEX_WORKBENCH_TERMINAL_PS1_POSIX-}" ]; then
      PS1=$CODEX_WORKBENCH_TERMINAL_PS1_POSIX
    fi
  fi
  export PS1
fi
if [ "\${NO_COLOR+x}" = x ]; then
  unset CLICOLOR CLICOLOR_FORCE
elif [ "$(uname -s)" = Darwin ] && [ "\${CLICOLOR+x}" != x ]; then
  CLICOLOR=1
  export CLICOLOR
fi
if [ -n "\${CODEX_WORKBENCH_TERMINAL_PS2-}" ]; then
  PS2=$CODEX_WORKBENCH_TERMINAL_PS2
  export PS2
fi
exec /bin/sh -i`;

export function readOnlyTerminalCommand(): string[] {
  return ["/bin/sh", "-c", TERMINAL_BOOTSTRAP];
}

export const READ_ONLY_TERMINAL_ENVIRONMENT: NonNullable<
  CommandExecParams["env"]
> = {
  TERM: "xterm-256color",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  PAGER: "cat",
  HISTFILE: "/dev/null",
};
