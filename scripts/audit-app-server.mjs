import ts from "typescript";
import { format } from "prettier";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";

// Inventory only: a source reference is not proof of runtime or account support.
const root = process.cwd();
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
const sources = program
  .getSourceFiles()
  .filter(
    (file) =>
      file.fileName.startsWith(`${root}/src/`) &&
      !file.fileName.includes("/generated/"),
  );
function contract(name) {
  const file = program.getSourceFile(resolve(`src/generated/${name}.ts`));
  const declaration = file.statements.find(
    (node) => ts.isTypeAliasDeclaration(node) && node.name.text === name,
  );
  return checker.getTypeAtLocation(declaration).types.map((type) => {
    const method = checker.getTypeOfPropertyOfType(type, "method").value;
    const params = checker.getTypeOfPropertyOfType(type, "params");
    const variants = params.isUnion() ? params.types : [params];
    const fields = new Map();
    for (const variant of variants) {
      if (!(variant.flags & ts.TypeFlags.Object)) continue;
      for (const field of variant.getProperties()) {
        const optional = !!(field.flags & ts.SymbolFlags.Optional);
        fields.set(field.name, `${field.name}${optional ? "?" : ""}`);
      }
    }
    return {
      method,
      params: checker.typeToString(params),
      fields: [...fields.values()],
      sites: new Set(),
    };
  });
}
const requests = contract("ClientRequest");
const notifications = contract("ServerNotification");
const serverRequests = contract("ServerRequest");
const byMethod = new Map(requests.map((entry) => [entry.method, entry]));
const inbound = new Map(
  [...notifications, ...serverRequests].map((entry) => [entry.method, entry]),
);
function unwrap(node) {
  while (
    node &&
    (ts.isAsExpression(node) || ts.isParenthesizedExpression(node))
  )
    node = node.expression;
  return node;
}
function methodNames(node) {
  node = unwrap(node);
  if (!node) return [];
  if (ts.isStringLiteral(node)) return [node.text];
  if (ts.isSpreadElement(node)) return methodNames(node.expression);
  if (ts.isArrayLiteralExpression(node)) return methodNames(node.elements[0]);
  if (ts.isConditionalExpression(node))
    return [...methodNames(node.whenTrue), ...methodNames(node.whenFalse)];
  return [];
}
for (const file of sources) {
  function visit(node) {
    const site = `${relative(root, file.fileName)}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    if (ts.isCallExpression(node)) {
      const name = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : ts.isIdentifier(node.expression)
          ? node.expression.text
          : "";
      const index = {
        request: 0,
        dispatch: 0,
        writeRequest: 2,
        threadRequest: 1,
        mutate: 0,
        pages: 1,
      }[name];
      if (index !== undefined)
        for (const method of methodNames(node.arguments[index]))
          byMethod.get(method)?.sites.add(site);
    }
    if (ts.isStringLiteral(node) && !ts.isLiteralTypeNode(node.parent))
      inbound.get(node.text)?.sites.add(site);
    ts.forEachChild(node, visit);
  }
  visit(file);
}
const aliases = new Map();
for (const file of program.getSourceFiles()) {
  if (!file.fileName.includes("/src/generated/")) continue;
  for (const node of file.statements)
    if (ts.isTypeAliasDeclaration(node))
      aliases.set(node.name.text, { node, file });
}
const responseOverrides = {
  "account/logout": "LogoutAccountResponse",
  "account/gatewayOAuth/read": "GatewayOAuthReadResponse",
  "account/gatewayOAuth/login": "GatewayOAuthLoginResponse",
  "account/gatewayOAuth/cancel": "GatewayOAuthCancelResponse",
  "account/workspaceMessages/read": "GetWorkspaceMessagesResponse",
  "configRequirements/read": "ConfigRequirementsReadResponse",
  "windowsSandbox/readiness": "WindowsSandboxReadinessResponse",
  "externalAgentConfig/import/readHistories":
    "ExternalAgentConfigImportHistoriesReadResponse",
  "config/value/write": "ConfigWriteResponse",
  "config/batchWrite": "ConfigWriteResponse",
};
function response(entry) {
  if (entry.method === "config/mcpServer/reload")
    return "空结果（无命名响应类型）";
  const name =
    responseOverrides[entry.method] ??
    entry.params.match(/\b(\w+)Params\b/)?.[1] + "Response";
  const alias = aliases.get(name);
  if (!alias)
    throw Error(`Missing response mapping: ${entry.method} / ${name}`);
  const type = checker.getTypeAtLocation(alias.node);
  const variants = type.isUnion() ? type.types : [type];
  const fields = [
    ...new Set(
      variants.flatMap((variant) =>
        variant.getProperties().map((field) => field.name),
      ),
    ),
  ];
  return `[${name}](../${relative(root, alias.file.fileName)})${fields.length ? "：" + fields.map((field) => `\`${field}\``).join("、") : "（空结果）"}`;
}
const used = requests.filter((entry) => entry.sites.size).length;
const link = (site) => {
  const file = site.replace(/:\d+$/, "");
  return `[${site}](../${file})`;
};
const row = (entry, withResponse) =>
  `| \`${entry.method}\` | ${entry.fields.length ? entry.fields.map((field) => `\`${field}\``).join("、") : "无字段"} | ${withResponse ? response(entry) : "通知，无响应"} | ${entry.sites.size ? [...entry.sites].map(link).join("<br>") : "未接入 / 无直接处理引用"} |`;
const lines = [
  "# app-server 接口逐项清单",
  "",
  "由 `node scripts/audit-app-server.mjs` 从当前生成类型和业务调用生成；用 `--check` 校验清单是否过期。请求生命周期、交互处理和验证边界见 [协议约定](protocol.md)。",
  "",
  `ClientRequest：${requests.length} 个，调用 ${used} 个，未调用 ${requests.length - used} 个。ServerRequest：${serverRequests.length} 个；ServerNotification：${notifications.length} 个。`,
  "",
  "字段为生成协议的顶层字段全集；`?` 表示可选。联合类型按各分支合并展示，具体互斥与必填条件以参数类型为准；无参数方法与空对象参数方法需按原类型区分。此表不要求发送所有可选字段。服务端请求/通知列仅统计运行时代码中的方法引用，不能据此宣称所有字段已处理或功能已端到端验证。",
  "",
];
for (const [title, entries] of [
  ["客户端请求", requests],
  ["服务端请求", serverRequests],
  ["服务端通知", notifications],
]) {
  lines.push(
    `## ${title}`,
    "",
    "| 方法 | 请求 / 通知字段 | 响应字段 | 调用 / 处理位置 |",
    "| --- | --- | --- | --- |",
  );
  for (const entry of entries) lines.push(row(entry, title !== "服务端通知"));
  lines.push("");
}
const output = await format(`${lines.join("\n")}\n`, { parser: "markdown" });
const target = "docs/app-server-interface-matrix.md";
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== output)
    throw Error(
      `Protocol inventory is stale; run node scripts/audit-app-server.mjs`,
    );
} else writeFileSync(target, output);
console.log(
  `Protocol inventory: ${used}/${requests.length} client methods, ${serverRequests.length} server requests, ${notifications.length} notifications.`,
);
