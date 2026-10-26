import { describe, expect, it } from "vitest";
import { parseCli } from "../../server/cli";

describe("CLI", () => {
  it("uses CLI port before environment and defaults", () => {
    expect(parseCli([], undefined)).toMatchObject({ port: 5180 });
    expect(parseCli([], "5182")).toMatchObject({ port: 5182 });
    expect(parseCli(["--port", "5181"], "5182")).toMatchObject({ port: 5181 });
    expect(parseCli(["-p", "5181", "--no-app-server"])).toMatchObject({
      port: 5181,
      manageAppServer: false,
    });
    expect(parseCli(["--port=5181"])).toMatchObject({ port: 5181 });
  });
  it.each(["0", "65536", "-1", "1.5", "", "abc", "0x143c", "1e3"])(
    "rejects invalid port %s",
    (port) => {
      expect(() => parseCli(["--port", port])).toThrow();
      expect(() => parseCli([], port)).toThrow();
    },
  );
  it("rejects unknown arguments and missing values", () => {
    for (const args of [["--port"], ["--prot", "5181"], ["start"]])
      expect(() => parseCli(args)).toThrow();
  });
  it("can show help and version even with an invalid environment", () => {
    expect(parseCli(["--help"], "invalid")).toEqual({ action: "help" });
    expect(parseCli(["-v"], "invalid")).toEqual({ action: "version" });
  });
});
