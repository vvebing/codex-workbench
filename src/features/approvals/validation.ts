import type { McpElicitationSchema } from "../../generated/v2/McpElicitationSchema";
import type { McpElicitationPrimitiveSchema } from "../../generated/v2/McpElicitationPrimitiveSchema";

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function safeElicitationUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function enumOptions(
  schema: unknown,
): { value: string; label: string }[] | undefined {
  if (!record(schema)) return undefined;
  if (
    Array.isArray(schema.enum) &&
    schema.enum.every((value) => typeof value === "string")
  )
    return schema.enum.map((value, index) => ({
      value: String(value),
      label: Array.isArray(schema.enumNames)
        ? String(schema.enumNames[index] ?? value)
        : String(value),
    }));
  const options = schema.oneOf ?? schema.anyOf;
  if (
    Array.isArray(options) &&
    options.every(
      (option) =>
        record(option) &&
        typeof option.const === "string" &&
        Object.keys(option).every((key) => ["const", "title"].includes(key)),
    )
  )
    return options.map((option) => ({
      value: option.const as string,
      label: String(option.title ?? option.const),
    }));
  return undefined;
}
const common = ["type", "title", "description", "default"];
function supportedField(
  value: unknown,
): value is McpElicitationPrimitiveSchema {
  if (!record(value)) return false;
  const keys =
    value.type === "string"
      ? ["minLength", "maxLength", "format", "enum", "enumNames", "oneOf"]
      : value.type === "number" || value.type === "integer"
        ? ["minimum", "maximum"]
        : value.type === "array"
          ? ["items", "minItems", "maxItems"]
          : value.type === "boolean"
            ? []
            : null;
  if (
    !keys ||
    Object.keys(value).some((key) => ![...common, ...keys].includes(key))
  )
    return false;
  for (const key of [
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "minItems",
    "maxItems",
  ]) {
    if (
      value[key] !== undefined &&
      !(
        (typeof value[key] === "number" || typeof value[key] === "bigint") &&
        Number.isFinite(Number(value[key]))
      )
    )
      return false;
  }
  if (value.type === "array") {
    if (
      !record(value.items) ||
      (value.items.type !== undefined && value.items.type !== "string") ||
      !enumOptions(value.items) ||
      Object.keys(value.items).some(
        (key) => !["type", "enum", "anyOf"].includes(key),
      )
    )
      return false;
  }
  for (const key of ["oneOf"]) {
    if (
      Array.isArray(value[key]) &&
      !value[key].every(
        (option) =>
          record(option) &&
          Object.keys(option).every((name) =>
            ["const", "title"].includes(name),
          ),
      )
    )
      return false;
  }
  if (("enum" in value || "oneOf" in value) && !enumOptions(value))
    return false;
  if (
    value.format &&
    !["email", "uri", "date", "date-time"].includes(String(value.format))
  )
    return false;
  return true;
}
export function supportedForm(schema: unknown): schema is McpElicitationSchema {
  return (
    record(schema) &&
    schema.type === "object" &&
    record(schema.properties) &&
    Object.keys(schema).every((key) =>
      ["$schema", "type", "properties", "required"].includes(key),
    ) &&
    Object.values(schema.properties).every(supportedField) &&
    (schema.required === undefined ||
      (Array.isArray(schema.required) &&
        schema.required.every(
          (key) =>
            typeof key === "string" &&
            Object.hasOwn(schema.properties as object, key),
        )))
  );
}
function validField(
  schema: McpElicitationPrimitiveSchema,
  value: unknown,
): boolean {
  const field = schema as unknown as Record<string, unknown>;
  const options = enumOptions(field);
  if (field.type === "boolean") return typeof value === "boolean";
  if (field.type === "number" || field.type === "integer")
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      (field.type !== "integer" || Number.isInteger(value)) &&
      (field.minimum === undefined || value >= Number(field.minimum)) &&
      (field.maximum === undefined || value <= Number(field.maximum))
    );
  if (field.type === "array")
    return (
      Array.isArray(value) &&
      new Set(value).size === value.length &&
      value.every((item) =>
        enumOptions(field.items)?.some((option) => option.value === item),
      ) &&
      (field.minItems === undefined ||
        value.length >= Number(field.minItems)) &&
      (field.maxItems === undefined || value.length <= Number(field.maxItems))
    );
  if (
    typeof value !== "string" ||
    (options && !options.some((option) => option.value === value))
  )
    return false;
  if (
    field.minLength !== undefined &&
    Array.from(value).length < Number(field.minLength)
  )
    return false;
  if (
    field.maxLength !== undefined &&
    Array.from(value).length > Number(field.maxLength)
  )
    return false;
  if (field.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    return false;
  if (field.format === "uri") {
    try {
      new URL(value);
    } catch {
      return false;
    }
  }
  if (
    field.format === "date" &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value)
  )
    return false;
  if (
    field.format === "date-time" &&
    (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ||
      !Number.isFinite(Date.parse(value)))
  )
    return false;
  return true;
}
export function fieldConstraints(
  schema: McpElicitationPrimitiveSchema,
): string {
  const field = schema as unknown as Record<string, unknown>;
  const hints: string[] = [];
  if (field.minLength !== undefined)
    hints.push(`至少 ${field.minLength} 个字符`);
  if (field.maxLength !== undefined)
    hints.push(`最多 ${field.maxLength} 个字符`);
  if (field.minimum !== undefined) hints.push(`最小值 ${field.minimum}`);
  if (field.maximum !== undefined) hints.push(`最大值 ${field.maximum}`);
  if (field.type === "integer") hints.push("请输入整数");
  if (field.minItems !== undefined) hints.push(`至少选择 ${field.minItems} 项`);
  if (field.maxItems !== undefined) hints.push(`最多选择 ${field.maxItems} 项`);
  if (field.format)
    hints.push(
      `格式：${{ email: "电子邮箱", uri: "完整 URL", date: "YYYY-MM-DD", "date-time": "含时区的日期时间，如 2026-01-01T12:00:00Z" }[String(field.format) as "email"]}`,
    );
  return hints.join("；");
}
export function fieldError(
  schema: McpElicitationPrimitiveSchema,
  value: unknown,
  required: boolean,
): string | undefined {
  if (value === undefined) return required ? "请填写此必填项。" : undefined;
  return validField(schema, value)
    ? undefined
    : `请检查此项。${fieldConstraints(schema) || "请选择有效的值。"}`;
}
export function validFormContent(schema: unknown, content: unknown): boolean {
  return (
    supportedForm(schema) &&
    record(content) &&
    (schema.required ?? []).every((key) => Object.hasOwn(content, key)) &&
    Object.entries(content).every(
      ([key, value]) =>
        !!schema.properties[key] && validField(schema.properties[key], value),
    )
  );
}
/** Grants are exact requested entries or subsets; never infer broader path access. */
export function permissionSubset(
  granted: unknown,
  requested: unknown,
): boolean {
  if (!record(granted) || !record(requested)) return false;
  return Object.entries(granted).every(([key, value]) => {
    const original = requested[key];
    if (Array.isArray(value))
      return (
        Array.isArray(original) &&
        value.every((entry) =>
          original.some(
            (candidate) => JSON.stringify(candidate) === JSON.stringify(entry),
          ),
        )
      );
    if (record(value)) return permissionSubset(value, original);
    return value === original;
  });
}
