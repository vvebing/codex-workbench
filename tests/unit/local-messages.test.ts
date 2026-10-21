import { expect, it } from "vitest";
import { LocalMessagesStore } from "../../src/features/composer/local-messages";
import { Store } from "../../src/lib/store";
import type { SessionsStore } from "../../src/features/sessions/store";
import type { Thread } from "../../src/generated/v2/Thread";

it("deduplicates a server echo by client ID even if its text is normalized", () => {
  class Sessions extends Store<{
    threads: Record<string, Thread>;
    localDrafts: Record<string, { serverId?: string }>;
  }> {
    resolveId(id: string) {
      return id;
    }
    echo(clientId: string) {
      this.update({
        localDrafts: { local: { serverId: "server" } },
        threads: {
          server: {
            id: "server",
            turns: [
              {
                items: [
                  {
                    id: "echo",
                    type: "userMessage",
                    clientId,
                    content: [
                      { type: "text", text: "normalized", text_elements: [] },
                    ],
                  },
                ],
              },
            ],
          } as unknown as Thread,
        },
      });
    }
  }
  const sessions = new Sessions({ threads: {}, localDrafts: {} });
  const messages = new LocalMessagesStore(sessions as unknown as SessionsStore);
  const id = messages.add("local", [
    { type: "text", text: "original", text_elements: [] },
  ]);
  expect(messages.forThread("local")).toHaveLength(1);
  sessions.echo(id);
  expect(messages.forThread("server")).toHaveLength(0);
  messages.set(id, "accepted");
  expect(messages.getSnapshot()).toHaveLength(0);
});
