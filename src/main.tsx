import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./features/shell/App";
import "./styles.css";
import { initializeTheme } from "./features/settings/theme";

initializeTheme();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
