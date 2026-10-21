import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { LocalDeliveryMessage } from "../../src/features/conversation/Timeline";
import type { LocalMessage } from "../../src/features/composer/local-messages";
function render(status: LocalMessage["status"], input: LocalMessage["input"]) {
  return renderToStaticMarkup(
    createElement(LocalDeliveryMessage, {
      message: {
        id: "local",
        threadId: "thread",
        input,
        status,
        baseline: new Set<string>(),
      },
      onDismiss: () => {},
      onRestore: () => {},
    }),
  );
}
it("renders pending message content before server acknowledgement without claiming delivery", () => {
  const html = render("sending", [
    { type: "text", text: "immediate message", text_elements: [] },
  ]);
  expect(html).toContain("immediate message");
  expect(html).toContain("正在发送…");
  expect(html).not.toContain("服务器已接收");
});
it("keeps image-only sends visible as attachments", () => {
  const html = render("sending", [{ type: "image", fileId: "attachment" }]);
  expect(html).toContain("音频或图片附件");
  expect(html).toContain("正在发送…");
});
it("explains uncertain delivery and provides recovery and discard controls", () => {
  const html = render("uncertain", [
    { type: "text", text: "check me", text_elements: [] },
  ]);
  expect(html).toContain("发送结果待核实");
  expect(html).toContain("确认未送达后再恢复编辑并手动发送");
  expect(html).toContain("恢复到输入框");
  expect(html).toContain("丢弃消息");
});
it("renders a preview for an image URL while sending", () => {
  const html = render("sending", [
    { type: "image", url: "data:image/png;base64,aGVsbG8=" },
  ]);
  expect(html).toContain('src="data:image/png;base64,aGVsbG8="');
  expect(html).toContain("对话附件 1");
});

it("shows thread creation separately from queueing and offers failed content recovery", () => {
  const input: LocalMessage["input"] = [
    { type: "text", text: "first", text_elements: [] },
  ];
  expect(render("creating", input)).toContain("正在创建会话…");
  const html = render("failed", input);
  expect(html).toContain("恢复到输入框");
  expect(html).not.toContain("内容仍保留在输入框");
});
