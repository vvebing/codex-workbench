import type { OtelRequirements } from "../../generated/v2/OtelRequirements";
import { t } from "../../lib/i18n";

/** Selected managed requirements only, without exporter credentials or endpoints. */
export function TelemetryRequirements({
  value,
}: {
  value: OtelRequirements | null | undefined;
}) {
  if (!value) return null;
  const state = (enabled: boolean | null) =>
    enabled === true ? t("开启") : enabled === false ? t("关闭") : t("未指定");
  return (
    <section className="space-y-2 border-t border-border pt-3">
      <h4 className="font-medium">{t("受管遥测要求")}</h4>
      <p className="text-muted">
        {t("以下为受管配置要求，不代表已验证日志实际发送或保存。")}
      </p>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
        {[
          [t("提示词日志"), value.log_user_prompt],
          [t("助手回复日志"), value.log_agent_responses],
          [t("自动审批评估日志"), value.log_guardian_assessments],
        ].map(([label, enabled]) => (
          <div className="contents" key={String(label)}>
            <dt>{label}</dt>
            <dd>{state(enabled as boolean | null)}</dd>
          </div>
        ))}
        {value.tool_result && (
          <>
            <dt>{t("工具结果日志字节上限")}</dt>
            <dd className="tabular-nums">{value.tool_result.max_bytes}</dd>
          </>
        )}
      </dl>
    </section>
  );
}
