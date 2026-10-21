import type { Thread } from "../../generated/v2/Thread";

export function promptEntries(turns: Thread["turns"]) {
  return turns.flatMap((turn, turnIndex) =>
    turn.items.flatMap((item) => {
      if (item.type !== "userMessage") return [];
      const text =
        item.content
          .map((part) => {
            switch (part.type) {
              case "text":
                return part.text;
              case "localImage":
                return `图片：${part.path.split(/[\\/]/).at(-1)}`;
              case "image":
                return "图片附件";
              case "localAudio":
                return `音频：${part.path.split(/[\\/]/).at(-1)}`;
              case "audio":
                return "音频附件";
              case "skill":
              case "mention":
                return part.name;
            }
          })
          .join("\n")
          .trim() || "空白消息";
      return [
        {
          id: item.id,
          turn: turnIndex + 1,
          text,
          label: text.replace(/\s+/g, " "),
        },
      ];
    }),
  );
}
