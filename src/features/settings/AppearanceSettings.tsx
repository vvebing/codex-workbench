import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "./theme";
import { resetSidebarWidths } from "../shell/sidebar-layout";
import {
  setConversationWidth,
  useConversationWidth,
} from "./conversation-layout";
import { Button, SelectField } from "../../components/ui";
import {
  SettingsField,
  SettingsSection,
  settingsSelectClass,
} from "./settings-ui";
import {
  codeFontOptions,
  defaultTypography,
  fontSizeOptions,
  interfaceFontOptions,
  setTypography,
  useTypography,
  type TypographyPreference,
} from "./typography";

const themes = [
  { value: "light", label: "浅色", Icon: Sun, description: "明亮清晰" },
  { value: "dark", label: "深色", Icon: Moon, description: "适合暗光环境" },
  {
    value: "system",
    label: "跟随系统",
    Icon: Monitor,
    description: "自动切换外观",
  },
] as const;

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  const typography = useTypography();
  const conversationWidth = useConversationWidth();
  const isDefault = Object.entries(defaultTypography).every(
    ([key, value]) => typography[key as keyof TypographyPreference] === value,
  );
  return (
    <div className="space-y-6">
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">显示主题</legend>
        <div className="grid grid-cols-3 gap-3 max-[550px]:grid-cols-1">
          {themes.map(({ value, label, Icon, description }) => (
            <label
              key={value}
              className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface p-4 text-sm hover:bg-hover has-[:checked]:border-accent has-[:checked]:bg-selected has-[:checked]:text-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
            >
              <input
                type="radio"
                name="theme"
                value={value}
                aria-label={label}
                checked={theme === value}
                onChange={() => setTheme(value)}
                className="size-4 shrink-0 accent-accent"
              />
              <Icon size={18} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block font-medium">{label}</span>
                <span className="mt-1 block text-meta font-normal text-muted">
                  {description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <SettingsSection
        title="会话布局"
        trailing={
          <Button size="sm" onClick={resetSidebarWidths}>
            重置侧栏宽度
          </Button>
        }
      >
        <SettingsField
          id="conversation-width"
          label="会话宽度"
          description="舒适模式正文最多 880px，宽模式最多 1080px，铺满使用全部可用宽度。所有内容与会话区域对齐，超宽代码、表格和图表可局部滚动；窄屏自动收缩。"
        >
          <SelectField
            id="conversation-width"
            label="会话宽度"
            value={conversationWidth}
            onValueChange={setConversationWidth}
            className={settingsSelectClass}
            options={[
              { value: "reading", label: "舒适（默认）" },
              { value: "wide", label: "宽" },
              { value: "fluid", label: "铺满" },
            ]}
          />
        </SettingsField>
      </SettingsSection>
      <SettingsSection
        title="字体与字号"
        description="调整后立即生效，并保存在当前浏览器。"
        trailing={
          <Button
            size="sm"
            disabled={isDefault}
            onClick={() => setTypography(defaultTypography)}
          >
            重置字体设置
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-4 max-[550px]:grid-cols-1">
          {[
            {
              key: "fontSize",
              label: "界面基准字号",
              options: fontSizeOptions(
                typography.fontSize,
                defaultTypography.fontSize,
              ),
              description: "设置正文基准字号，标题、辅助文字和图表按比例调整。",
            },
            {
              key: "codeFontSize",
              label: "代码字号",
              options: fontSizeOptions(
                typography.codeFontSize,
                defaultTypography.codeFontSize,
              ),
              description: "独立设置编辑器和 Markdown 代码块的字号。",
            },
            {
              key: "interfaceFont",
              label: "界面字体",
              options: interfaceFontOptions,
              description: "应用于界面、正文和图表。",
            },
            {
              key: "codeFont",
              label: "等宽字体",
              options: codeFontOptions,
              description: "应用于代码和终端；未安装的字体会使用系统备用字体。",
            },
          ].map(({ key, label, options, description }) => (
            <SettingsField
              key={key}
              id={`appearance-${key}`}
              label={label}
              description={description}
            >
              <SelectField
                id={`appearance-${key}`}
                label={label}
                aria-describedby={`appearance-${key}-description`}
                className={settingsSelectClass}
                value={typography[key as keyof TypographyPreference]}
                onValueChange={(value) => setTypography({ [key]: value })}
                options={options}
              />
            </SettingsField>
          ))}
        </div>
        <div
          className="space-y-2 rounded-xl border border-border bg-surface p-4"
          role="group"
          aria-label="字体预览"
        >
          <p className="text-body">文字预览：让阅读和工作更舒适。Aa 0123</p>
          <p className="break-words font-mono text-code leading-code">
            const greeting = "你好，世界";
          </p>
        </div>
      </SettingsSection>
    </div>
  );
}
