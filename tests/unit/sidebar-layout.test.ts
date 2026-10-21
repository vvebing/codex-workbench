import { describe, expect, it } from "vitest";
import { fitSidebars } from "../../src/features/shell/sidebar-layout";

describe("sidebar pixel layout", () => {
  it("keeps preferred pixels while the central area absorbs viewport changes", () => {
    for (const width of [1440, 1920, 2560]) {
      expect(
        fitSidebars(width, { navigation: 280, details: 320 }, true, true),
      ).toEqual({ available: width - 4, left: 280, right: 320 });
    }
  });
  it("temporarily fits both sidebars without consuming the central minimum", () => {
    const preferred = { navigation: 400, details: 480 };
    const result = fitSidebars(1024, preferred, true, true);
    expect(result.left).toBeGreaterThanOrEqual(240);
    expect(result.right).toBeGreaterThanOrEqual(280);
    expect(result.available - result.left - result.right).toBeCloseTo(480);
    expect(preferred).toEqual({ navigation: 400, details: 480 });
    expect(fitSidebars(1920, preferred, true, true)).toMatchObject({
      left: 400,
      right: 480,
    });
  });
  it("releases all space occupied by hidden sidebars", () => {
    expect(
      fitSidebars(1024, { navigation: 280, details: 320 }, false, false),
    ).toEqual({ available: 1024, left: 0, right: 0 });
  });
});
