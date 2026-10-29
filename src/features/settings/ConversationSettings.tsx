import { t, useLocale } from "../../lib/i18n";
import { Switch } from "radix-ui";
import { useState } from "react";
import { SelectField } from "../../components/ui";
import {
  SettingsField,
  SettingsSection,
  settingsSelectClass,
} from "./settings-ui";
import {
  setAutoCollapseProcess,
  useAutoCollapseProcess,
  setRunningSendMode,
  useRunningSendMode,
  type RunningSendMode,
} from "./conversation-preferences";

export function ConversationSettings() {
  useLocale();
  const mode = useRunningSendMode();
  const autoCollapse = useAutoCollapseProcess();
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState(false);
  function save(update: () => void) {
    try {
      update();
      setError(false);
      setFeedback("已保存");
    } catch {
      setError(true);
      setFeedback("无法保存偏好，请检查浏览器存储权限后重试。");
    }
  }
  return (
    <SettingsSection title={t("会话交互")}>
      <SettingsField
        id="running-send-mode"
        label={t("执行中发送")}
        description={t(
          "决定会话执行时按 Enter 或点击发送按钮的行为。仅保存在当前浏览器，立即生效；不改变已有队列。Shift+Enter 换行。",
        )}
      >
        <SelectField
          id="running-send-mode"
          label={t("执行中发送")}
          value={mode}
          className={settingsSelectClass}
          aria-describedby="running-send-mode-description"
          options={[
            { value: "queue", label: t("排队（默认）") },
            { value: "steer", label: t("引导当前任务") },
          ]}
          onValueChange={(value) =>
            save(() => setRunningSendMode(value as RunningSendMode))
          }
        />
      </SettingsField>
      <p className="text-xs leading-relaxed text-muted">
        {mode === "queue"
          ? t("排队：保留为独立任务，当前轮次完成后依次发送。")
          : t(
              "引导：将补充要求立即交给正在执行的任务。若当前轮次已结束或无法定位，则按会话状态发送或排队。",
            )}{" "}
        {t(
          "输入区仍可单次选择另一种发送方式。⌘/Ctrl+Enter 始终引导，⌘/Ctrl+Shift+Enter 始终排队。",
        )}
      </p>
      <SettingsField
        id="auto-collapse-process"
        label={t("完成后自动收起执行过程")}
        description={t(
          "默认关闭。开启后，已结束的轮次（包括失败和中断）自动收起过程，保留用户消息和最终总结；仍可手动展开。设置保存在当前浏览器。",
        )}
      >
        <Switch.Root
          id="auto-collapse-process"
          checked={autoCollapse}
          aria-describedby="auto-collapse-process-description"
          className="inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-subtle p-0.5 outline-accent focus-visible:outline-2 focus-visible:outline-offset-2 data-[state=checked]:bg-accent"
          onCheckedChange={(checked) =>
            save(() => setAutoCollapseProcess(checked))
          }
        >
          <Switch.Thumb className="block size-5 rounded-full bg-background transition-transform motion-reduce:transition-none data-[state=checked]:translate-x-5" />
        </Switch.Root>
      </SettingsField>
      {feedback && (
        <p
          role={error ? "alert" : "status"}
          className={`text-xs ${error ? "text-danger" : "text-muted"}`}
        >
          {t(feedback)}
        </p>
      )}
    </SettingsSection>
  );
}
