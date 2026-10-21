// Establish Tailwind's layer order before App imports any feature stylesheet.
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./features/shell/App";
import { initializeTheme } from "./features/settings/theme";
import { initializeTypography } from "./features/settings/typography";
import { initializeConversationLayout } from "./features/settings/conversation-layout";
import { initializeSidebarLayout } from "./features/shell/sidebar-layout";

initializeTypography();
initializeConversationLayout();
initializeSidebarLayout();
initializeTheme();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
