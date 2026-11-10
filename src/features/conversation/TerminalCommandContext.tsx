import { createContext, useContext, type ReactNode } from "react";

type FillCommand = (command: string) => boolean;
const TerminalCommandContext = createContext<FillCommand | undefined>(
  undefined,
);

/** Only the originating conversation can offer a command to its project terminal. */
export function TerminalCommandProvider({
  onFill,
  children,
}: {
  onFill?: FillCommand;
  children: ReactNode;
}) {
  return (
    <TerminalCommandContext.Provider value={onFill}>
      {children}
    </TerminalCommandContext.Provider>
  );
}

export function useTerminalCommand() {
  return useContext(TerminalCommandContext);
}
