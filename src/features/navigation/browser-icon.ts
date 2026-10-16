import { conversationExecuting } from "../conversation/activity";
import type { Environment } from "../connection/environments";
import { shouldNotifyThread } from "../sessions/state";

export type BrowserIconState = "idle" | "running" | "completed";

/** Recreate the link if browser integrations replaced the original head node. */
export function updateBrowserIcon(
  state: BrowserIconState,
  baseUrl: string,
): void {
  let icon = document.querySelector<HTMLLinkElement>("#product-favicon");
  if (!icon) {
    icon = document.createElement("link");
    icon.id = "product-favicon";
  }
  icon.rel = "icon";
  icon.type = "image/png";
  icon.sizes.value = "32x32";
  const href = `${baseUrl}icons/favicon${state === "idle" ? "" : `-${state}`}.png`;
  if (icon.getAttribute("href") !== href) icon.setAttribute("href", href);
  // The app's icon should be the last candidate if another integration added one.
  const icons = document.head.querySelectorAll('link[rel~="icon"]');
  if (!icon.isConnected || icons[icons.length - 1] !== icon)
    document.head.append(icon);
}

/** Unread results take priority so other running work cannot hide completion. */
export function browserIconState(
  environments: Environment[],
): BrowserIconState {
  const unread = environments.some(({ runtime }) => {
    const sessions = runtime.sessions.getSnapshot();
    return Object.keys(sessions.unreadCompleted).some((id) =>
      shouldNotifyThread(sessions, id),
    );
  });
  if (unread) return "completed";
  return hasExecutingSession(environments) ? "running" : "idle";
}

/** Include background sessions in every connected environment. */
export function hasExecutingSession(environments: Environment[]): boolean {
  return environments.some(
    ({ runtime }) =>
      runtime.connection.getSnapshot().status === "connected" &&
      Object.values(runtime.sessions.getSnapshot().threads).some(
        conversationExecuting,
      ),
  );
}
