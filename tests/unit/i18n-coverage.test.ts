import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import en from "../../src/lib/locales/en.json";
import zh from "../../src/lib/locales/zh-CN.json";

const english: Record<string, string> = en;
const chinese: Record<string, string> = zh;
const han = /\p{Script=Han}/u;
const placeholders = (text: string) =>
  [...text.matchAll(/{{\s*([^}]+?)\s*}}/g)].map((match) => match[1]).sort();
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "generated" || entry.name === "locales") return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? sources(path)
      : /\.tsx?$/.test(path)
        ? [path]
        : [];
  });
}
it("keeps both catalogs complete, English translated, and interpolation parameters identical", () => {
  expect(Object.keys(english).sort()).toEqual(Object.keys(chinese).sort());
  const invalid = Object.keys(english).flatMap((key) => {
    const issues: string[] = [];
    if (han.test(english[key]))
      issues.push(`${key}: English still contains Chinese`);
    if (
      JSON.stringify(placeholders(english[key])) !==
      JSON.stringify(placeholders(chinese[key]))
    )
      issues.push(`${key}: interpolation parameters differ`);
    return issues;
  });
  expect(invalid).toEqual([]);
});
it("covers static translation calls and prevents untranslated Chinese JSX text or attributes", () => {
  const problems: string[] = [];
  for (const file of sources(resolve("src"))) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const report = (node: ts.Node, issue: string) => {
      const { line } = source.getLineAndCharacterOfPosition(
        node.getStart(source),
      );
      problems.push(`${relative(process.cwd(), file)}:${line + 1}: ${issue}`);
    };
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "t"
      ) {
        const key = node.arguments[0];
        if (
          key &&
          (ts.isStringLiteral(key) ||
            ts.isNoSubstitutionTemplateLiteral(key)) &&
          !(key.text in english)
        )
          report(key, `missing translation ${key.text}`);
      }
      if (
        (ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node)) &&
        han.test(node.text) &&
        // Language names stay in their native script so users can recover a language choice.
        node.text !== "简体中文" &&
        !(node.text in english)
      ) {
        report(node, "uncatalogued Chinese literal");
      }
      if (
        ts.isTemplateExpression(node) &&
        han.test(
          node.head.text +
            node.templateSpans.map((span) => span.literal.text).join(""),
        )
      ) {
        report(node, "untranslated Chinese template");
      }
      if (ts.isJsxText(node) && han.test(node.text))
        report(node, "untranslated JSX text");
      if (
        ts.isJsxAttribute(node) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer) &&
        han.test(node.initializer.text)
      )
        report(node, "untranslated JSX attribute");
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(problems).toEqual([]);
});
