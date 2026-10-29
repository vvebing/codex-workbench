import { t, useLocale } from "../../lib/i18n";
import { useState } from "react";
import { Button, SelectField, MultiSelectField } from "../../components/ui";
import type { PermissionsRequestApprovalParams } from "../../generated/v2/PermissionsRequestApprovalParams";
import type { PermissionsRequestApprovalResponse } from "../../generated/v2/PermissionsRequestApprovalResponse";
import type { McpServerElicitationRequestParams } from "../../generated/v2/McpServerElicitationRequestParams";
import type { McpServerElicitationRequestResponse } from "../../generated/v2/McpServerElicitationRequestResponse";
import type { JsonValue } from "../../generated/serde_json/JsonValue";
import {
  enumOptions,
  fieldConstraints,
  fieldError,
  safeElicitationUrl,
  supportedForm,
  validFormContent,
} from "./validation";

type Controls = { disabled: boolean; respond: (result: unknown) => void };
export function PermissionsApproval({
  params,
  disabled,
  respond,
}: Controls & { params: PermissionsRequestApprovalParams }) {
  const i18nLocale = useLocale();
  void i18nLocale;

  const [network, setNetwork] = useState(true);
  const [files, setFiles] = useState(true);
  const grant = (scope: "turn" | "session", deny = false) => {
    const result: PermissionsRequestApprovalResponse = {
      scope,
      permissions: {
        ...(!deny && network && params.permissions.network
          ? { network: params.permissions.network }
          : {}),
        ...(!deny && files && params.permissions.fileSystem
          ? { fileSystem: params.permissions.fileSystem }
          : {}),
      },
    };
    respond(result);
  };
  return (
    <div>
      {params.reason && <p>{params.reason}</p>}
      <p className="my-2 text-muted [overflow-wrap:anywhere]">
        {t("工作目录：")}
        {params.cwd}
      </p>
      {params.permissions.network && (
        <label className="mb-3 block">
          <input
            type="checkbox"
            checked={network}
            disabled={disabled}
            onChange={(event) => setNetwork(event.target.checked)}
          />{" "}
          {t("网络权限：")}
          {params.permissions.network.enabled === true
            ? t("允许访问网络")
            : params.permissions.network.enabled === false
              ? t("禁用网络访问")
              : t("保持当前网络设置")}
        </label>
      )}
      {params.permissions.fileSystem && (
        <label className="mb-3 block">
          <input
            type="checkbox"
            checked={files}
            disabled={disabled}
            onChange={(event) => setFiles(event.target.checked)}
          />{" "}
          {t("文件权限")}
          <span className="mt-2 block space-y-1 [overflow-wrap:anywhere]">
            {params.permissions.fileSystem.read?.map((path) => (
              <span className="block" key={`read-${path}`}>
                {t("读取：")}
                {path}
              </span>
            ))}
            {params.permissions.fileSystem.write?.map((path) => (
              <span className="block" key={`write-${path}`}>
                {t("写入：")}
                {path}
              </span>
            ))}
            {params.permissions.fileSystem.entries?.map((entry, index) => (
              <span className="block" key={index}>
                {entry.access === "read"
                  ? t("读取")
                  : entry.access === "write"
                    ? t("写入")
                    : t("禁止访问")}
                ：
                {entry.path.type === "path"
                  ? entry.path.path
                  : entry.path.type === "glob_pattern"
                    ? t("匹配路径 {{value0}}", { value0: entry.path.pattern })
                    : t("特殊路径 {{value0}}", {
                        value0: JSON.stringify(entry.path.value),
                      })}
              </span>
            ))}
            {params.permissions.fileSystem.globScanMaxDepth !== undefined && (
              <span className="block">
                {t("路径匹配最大深度：")}
                {params.permissions.fileSystem.globScanMaxDepth}
              </span>
            )}
          </span>
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={disabled}
          onClick={() => grant("turn")}
        >
          {t("本轮允许所选权限")}
        </Button>
        <Button disabled={disabled} onClick={() => grant("session")}>
          {t("本会话允许所选权限")}
        </Button>
        <Button disabled={disabled} onClick={() => grant("turn", true)}>
          {t("拒绝")}
        </Button>
      </div>
    </div>
  );
}
export function ElicitationApproval({
  params,
  disabled,
  respond,
}: Controls & { params: McpServerElicitationRequestParams }) {
  const i18nLocale = useLocale();
  void i18nLocale;

  const schema =
    params.mode === "form" && supportedForm(params.requestedSchema)
      ? params.requestedSchema
      : undefined;
  const [values, setValues] = useState<Record<string, JsonValue>>(() =>
    Object.fromEntries(
      Object.entries(schema?.properties ?? {})
        .filter(
          ([key, field]) =>
            field?.default !== undefined ||
            (field?.type === "string" &&
              !enumOptions(field) &&
              schema?.required?.includes(key)),
        )
        .map(([key, field]) => [key, (field!.default ?? "") as JsonValue]),
    ),
  );
  const send = (
    action: McpServerElicitationRequestResponse["action"],
    content: JsonValue = null,
  ) => {
    const result: McpServerElicitationRequestResponse = {
      action,
      content,
      _meta: null,
    };
    respond(result);
  };
  const url =
    params.mode === "url" ? safeElicitationUrl(params.url) : undefined;
  const set = (key: string, value: JsonValue | undefined) =>
    setValues((previous) => {
      const next = { ...previous };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  const valid = !!schema && validFormContent(schema, values);
  return (
    <div>
      <p className="text-muted">{params.serverName}</p>
      <p className="my-3 whitespace-pre-wrap [overflow-wrap:anywhere]">
        {params.message}
      </p>
      {params.mode === "url" ? (
        url ? (
          <p className="my-3">
            <a
              className="text-accent underline [overflow-wrap:anywhere]"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {url}
            </a>
          </p>
        ) : (
          <p role="alert">{t("此请求的链接不安全，无法确认。")}</p>
        )
      ) : !schema ? (
        <p role="alert">{t("暂不支持此表单结构。请拒绝或取消此请求。")}</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) send("accept", values);
          }}
        >
          {Object.entries(schema.properties).map(([key, field]) => {
            if (!field) return null;
            const options = enumOptions(
              field.type === "array" ? field.items : field,
            );
            const required = schema.required?.includes(key) ?? false;
            const error = fieldError(field, values[key], required);
            const hint = fieldConstraints(field);
            return (
              <label key={key} className="mb-3 block">
                {field.title ?? key}
                {schema.required?.includes(key) ? " *" : ""}
                {field.description && (
                  <small className="block text-muted">
                    {field.description}
                  </small>
                )}
                {hint && <small className="block text-muted">{hint}</small>}
                {options ? (
                  field.type === "array" ? (
                    <MultiSelectField
                      className="my-1 w-full"
                      disabled={disabled}
                      label={field.title ?? key}
                      aria-invalid={!!error}
                      value={(values[key] as string[]) ?? []}
                      onValueChange={(value) => set(key, value)}
                      options={options}
                    />
                  ) : (
                    <SelectField
                      className="my-1 w-full"
                      label={field.title ?? key}
                      disabled={disabled}
                      aria-required={required}
                      aria-invalid={!!error}
                      value={
                        values[key] === undefined
                          ? "unset"
                          : String(
                              options.findIndex(
                                (option) => option.value === values[key],
                              ) + 1,
                            )
                      }
                      onValueChange={(value) =>
                        set(
                          key,
                          value === "unset"
                            ? undefined
                            : options[Number(value) - 1]?.value,
                        )
                      }
                      options={[
                        { value: "unset", label: t("请选择") },
                        ...options.map((option, index) => ({
                          value: String(index + 1),
                          label: option.label,
                        })),
                      ]}
                    />
                  )
                ) : field.type === "boolean" ? (
                  <SelectField
                    className="my-1 w-full"
                    label={field.title ?? key}
                    disabled={disabled}
                    aria-required={required}
                    aria-invalid={!!error}
                    value={
                      values[key] === undefined ? "unset" : String(values[key])
                    }
                    onValueChange={(value) =>
                      set(key, value === "unset" ? undefined : value === "true")
                    }
                    options={[
                      { value: "unset", label: t("请选择") },
                      { value: "true", label: t("是") },
                      { value: "false", label: t("否") },
                    ]}
                  />
                ) : (
                  <input
                    className="my-1 block w-full rounded border border-border bg-elevated p-2"
                    disabled={disabled}
                    aria-label={field.title ?? key}
                    type={
                      field.type === "number" || field.type === "integer"
                        ? "number"
                        : "text"
                    }
                    aria-required={required}
                    aria-invalid={!!error}
                    required={
                      required &&
                      (field.type !== "string" ||
                        ("minLength" in field && (field.minLength ?? 0) > 0))
                    }
                    minLength={
                      "minLength" in field ? field.minLength : undefined
                    }
                    maxLength={
                      "maxLength" in field ? field.maxLength : undefined
                    }
                    min={"minimum" in field ? field.minimum : undefined}
                    max={"maximum" in field ? field.maximum : undefined}
                    step={field.type === "integer" ? 1 : "any"}
                    value={String(values[key] ?? "")}
                    onChange={(event) =>
                      set(
                        key,
                        event.target.value === ""
                          ? field.type === "string"
                            ? ""
                            : undefined
                          : field.type === "number" || field.type === "integer"
                            ? Number(event.target.value)
                            : event.target.value,
                      )
                    }
                  />
                )}
                {!required && values[key] !== undefined && (
                  <Button
                    type="button"
                    disabled={disabled}
                    onClick={() => set(key, undefined)}
                  >
                    {t("不填写此项")}
                  </Button>
                )}
                {error && (
                  <small className="block text-danger" role="status">
                    {error}
                  </small>
                )}
              </label>
            );
          })}
          <Button disabled={disabled || !valid} type="submit">
            {t("提交回答")}
          </Button>
        </form>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {url && (
          <Button disabled={disabled} onClick={() => send("accept")}>
            {t("已完成，确认继续")}
          </Button>
        )}
        <Button disabled={disabled} onClick={() => send("decline")}>
          {t("拒绝")}
        </Button>
        <Button disabled={disabled} onClick={() => send("cancel")}>
          {t("取消")}
        </Button>
      </div>
    </div>
  );
}
