// Existing fixtures assert the original Chinese product copy explicitly.
// Production continues to follow the browser, with English as its fallback.
import { beforeEach } from "vitest";
import i18n from "../../src/lib/i18n";
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});
