/** Build-time flag; ordinary builds retain the real local app-server transport. */
export const DEMO_MODE = import.meta.env.MODE === "demo";
