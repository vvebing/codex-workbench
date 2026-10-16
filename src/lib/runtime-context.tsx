import { createContext, useContext } from "react";
import { runtime, type createRuntime } from "./runtime";

export const RuntimeContext =
  createContext<ReturnType<typeof createRuntime>>(runtime);
export const useRuntime = () => useContext(RuntimeContext);
