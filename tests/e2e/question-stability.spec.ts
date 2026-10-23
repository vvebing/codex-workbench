import { expect, test, type Page } from "@playwright/test";
import { once } from "node:events";
import { createMockServer } from "../fixtures/app-server";

async function open(page: Page, url: string) {
  await page.route("**/codex-release", (route) =>
    route.fulfill({ json: { version: "0.160.0" } }),
  );
  await page.addInitScript(
    (url) =>
      localStorage.setItem(
        "codex-environments",
        JSON.stringify([
          { id: "local", name: "本机", kind: "local", url, autoConnect: true },
        ]),
      ),
    url,
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "开始新会话", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "搜索会话" });
  await search
    .getByPlaceholder("搜索标题、摘要或工作区…")
    .fill("接口分页与错误处理 · 10");
  await page.keyboard.press("Enter");
  await expect(search).toBeHidden();
  await expect(page.getByRole("textbox", { name: "消息输入框" })).toBeVisible();
}

for (const failure of [false, true]) {
  test(`async question preserves its draft then hands off to the timeline during ${failure ? "failed storage" : "confirmed delivery"}`, async ({
    page,
  }) => {
    const fixture = createMockServer();
    fixture.listen(0, "127.0.0.1");
    await once(fixture, "listening");
    const address = fixture.address();
    if (!address || typeof address === "string") throw new Error("No listener");
    try {
      await open(page, `ws://127.0.0.1:${address.port}`);
      await page
        .getByRole("textbox", { name: "消息输入框" })
        .fill("async-question");
      await page.locator("[data-slot=composer-action]").click();
      const card = page.locator("[data-async-question-id]");
      await card.getByRole("radio", { name: "自定义回答" }).check();
      const input = card.getByRole("textbox", { name: "选择导航布局" });
      await input.fill("分组布局");
      await card
        .getByRole("textbox", { name: "补充偏好" })
        .fill("保留阅读位置");
      const before = await card.boundingBox();
      await card.evaluate((element) => {
        (element as HTMLElement & { originalCard?: Element }).originalCard =
          element;
      });
      await page.evaluate((failure) => {
        const locks = navigator.locks;
        const original = locks.request.bind(locks);
        const controlled = window as unknown as { releaseQuestion: () => void };
        locks.request = ((
          name: string,
          callback: LockGrantedCallback<unknown>,
        ) => {
          if (!name.startsWith("codex-queue:")) return original(name, callback);
          locks.request = original;
          return new Promise<unknown>((resolve, reject) => {
            controlled.releaseQuestion = () => {
              if (failure) reject(new Error("question-storage-failure"));
              else original(name, callback).then(resolve, reject);
            };
          });
        }) as unknown as typeof locks.request;
      }, failure);
      const submit = card.getByRole("button", {
        name: "提交回答",
        exact: true,
      });
      await submit.click();
      await expect(
        card.getByRole("button", { name: "正在保存…" }),
      ).toBeDisabled();
      await expect(input).toBeVisible();
      await expect(input).toBeDisabled();
      expect(
        Math.abs((await card.boundingBox())!.height - before!.height),
      ).toBeLessThan(2);
      if (!failure)
        await page.evaluate(() => {
          const original = WebSocket.prototype.send;
          WebSocket.prototype.send = function (data) {
            if (
              typeof data === "string" &&
              JSON.parse(data).method === "turn/start" &&
              data.includes("回答问题")
            ) {
              WebSocket.prototype.send = original;
              (
                window as unknown as { deliverAnswer: () => void }
              ).deliverAnswer = () => original.call(this, data);
              return;
            }
            return original.call(this, data);
          };
        });
      await page.evaluate(() =>
        (
          window as unknown as { releaseQuestion: () => void }
        ).releaseQuestion(),
      );
      if (failure) {
        await expect(card).toContainText("question-storage-failure");
        await expect(input).toBeEnabled();
        await expect(input).toHaveValue("分组布局");
        await expect(submit).toBeFocused();
        expect(
          await card.evaluate(
            (element) =>
              (element as HTMLElement & { originalCard?: Element })
                .originalCard === element,
          ),
        ).toBe(true);
      }
      if (!failure) {
        await expect(card).toHaveCount(0);
        const record = page
          .locator("[data-answer-record]")
          .filter({ hasText: "回答问题：" });
        await expect(record).toHaveCount(1);
        await expect(record).toContainText("正在发送回答");
        await expect(record).toBeFocused();
        await record.evaluate((element) => {
          (window as unknown as { answerElement: Element }).answerElement =
            element;
        });
        await page.evaluate(() =>
          (window as unknown as { deliverAnswer: () => void }).deliverAnswer(),
        );
        await expect(
          page.locator('[data-slot="question-answer-delivery"]'),
        ).toHaveCount(0);
        await expect(record).toHaveCount(1);
        expect(
          await record.evaluate(
            (element) =>
              element ===
              (window as unknown as { answerElement: Element }).answerElement,
          ),
        ).toBe(true);
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(card).toHaveCount(0);
      }
    } finally {
      fixture.close();
    }
  });
}

test("blocking question preserves failures and records a redacted answer in the timeline", async ({
  page,
}) => {
  const fixture = createMockServer();
  fixture.listen(0, "127.0.0.1");
  await once(fixture, "listening");
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  try {
    await open(page, `ws://127.0.0.1:${address.port}`);
    fixture.publish({
      id: "stable-question",
      method: "item/tool/requestUserInput",
      params: {
        threadId: "mock-thread-010",
        turnId: "stable-turn",
        itemId: "stable-item",
        isBlocking: true,
        autoResolutionMs: null,
        questions: [
          {
            id: "normal",
            header: "偏好",
            question: "请补充偏好",
            isOther: true,
            isSecret: false,
            options: null,
          },
          {
            id: "secret",
            header: "秘密",
            question: "测试秘密",
            isOther: false,
            isSecret: true,
            options: null,
          },
        ],
      },
    });
    const card = page.locator('[data-question-request-id="stable-question"]');
    await card.getByRole("textbox", { name: "请补充偏好" }).fill("紧凑布局");
    await card.getByLabel("测试秘密").fill("never-show-this-secret");
    await card.evaluate((element) => {
      (element as HTMLElement & { originalCard?: Element }).originalCard =
        element;
    });
    await page.evaluate(() => {
      const original = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data) {
        if (
          typeof data === "string" &&
          JSON.parse(data).id === "stable-question"
        ) {
          WebSocket.prototype.send = original;
          throw new Error("question-send-failure");
        }
        return original.call(this, data);
      };
    });
    await card.getByRole("button", { name: "提交回答" }).click();
    await expect(page.getByLabel("待处理请求")).toContainText(
      "question-send-failure",
    );
    await expect(card.getByRole("textbox", { name: "请补充偏好" })).toHaveValue(
      "紧凑布局",
    );
    await card.getByRole("button", { name: "提交回答" }).click();
    await expect(card).toHaveCount(0);
    const receipt = page.locator('[data-slot="tool-answer-record"]');
    await expect(receipt).toContainText("紧凑布局");
    await expect(receipt).toContainText("私密回答已隐藏");
    await expect(receipt).toContainText("等待服务端确认");
    await expect(receipt).toBeFocused();
    await expect(
      page.getByText("never-show-this-secret", { exact: true }),
    ).toHaveCount(0);
    fixture.publish({
      method: "serverRequest/resolved",
      params: { threadId: "mock-thread-010", requestId: "stable-question" },
    });
    await expect(card).toHaveCount(0);
    await expect(receipt).not.toContainText("等待服务端确认");
    await expect(receipt).toContainText("紧凑布局");
  } finally {
    fixture.close();
  }
});

for (const reducedMotion of [false, true]) {
  test(`question removal ${reducedMotion ? "respects reduced motion" : "collapses its full footprint"}`, async ({
    page,
  }) => {
    await page.emulateMedia({
      reducedMotion: reducedMotion ? "reduce" : "no-preference",
    });
    const fixture = createMockServer();
    fixture.listen(0, "127.0.0.1");
    await once(fixture, "listening");
    const address = fixture.address();
    if (!address || typeof address === "string") throw new Error("No listener");
    try {
      await open(page, `ws://127.0.0.1:${address.port}`);
      fixture.publish({
        id: "motion-question",
        method: "item/tool/requestUserInput",
        params: {
          threadId: "mock-thread-010",
          turnId: "motion-turn",
          itemId: "motion-item",
          isBlocking: true,
          autoResolutionMs: null,
          questions: [
            {
              id: "answer",
              header: "偏好",
              question: "动画偏好",
              isOther: false,
              isSecret: false,
              options: null,
            },
          ],
        },
      });
      const card = page.locator('[data-question-request-id="motion-question"]');
      await card
        .getByRole("textbox", { name: "动画偏好" })
        .fill("保持阅读位置");
      // Hold the real exit animation so its intermediate layout can be measured deterministically.
      await page.evaluate(() => {
        const original = Element.prototype.animate;
        (
          window as unknown as { questionAnimations: Animation[] }
        ).questionAnimations = [];
        Element.prototype.animate = function (frames, options) {
          const animation = original.call(this, frames, options);
          if (this.getAttribute("data-slot") === "question-presence") {
            (
              window as unknown as { questionAnimations: Animation[] }
            ).questionAnimations.push(animation);
            animation.pause();
          }
          return animation;
        };
      });
      await card.getByRole("button", { name: "提交回答" }).click();
      await expect(
        page.locator('[data-slot="tool-answer-record"]'),
      ).toContainText("保持阅读位置");
      if (reducedMotion) {
        await expect(card).toHaveCount(0);
        expect(
          await page.evaluate(
            () =>
              (window as unknown as { questionAnimations: Animation[] })
                .questionAnimations.length,
          ),
        ).toBe(0);
      } else {
        const sizes = await page.evaluate(() => {
          const animation = (
            window as unknown as { questionAnimations: Animation[] }
          ).questionAnimations[0];
          const element = document.querySelector(
            '[data-slot="question-presence"][data-exiting]',
          )!;
          const heights = [0, 80, 160].map((time) => {
            animation.currentTime = time;
            return element.getBoundingClientRect().height;
          });
          animation.finish();
          return heights;
        });
        expect(sizes[0]).toBeGreaterThan(sizes[1]);
        expect(sizes[1]).toBeGreaterThan(sizes[2]);
        await expect(card).toHaveCount(0);
      }
    } finally {
      fixture.close();
    }
  });
}
