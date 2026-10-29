import {
  t,
  useLocale,
  useLanguagePreference,
  setLanguagePreference,
  type LanguagePreference,
} from "../../lib/i18n";
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
  {
    value: "light",
    get label() {
      return t("浅色");
    },
    get description() {
      return t("明亮清晰");
    },
  },
  {
    value: "dark",
    get label() {
      return t("深色");
    },
    get description() {
      return t("适合暗光环境");
    },
  },
  {
    value: "system",
    get label() {
      return t("跟随系统");
    },
    get description() {
      return t("自动切换外观");
    },
  },
] as const;

export function AppearanceSettings() {
  useLocale();
  const { theme, setTheme } = useTheme();
  const language = useLanguagePreference();
  const typography = useTypography();
  const conversationWidth = useConversationWidth();
  const isDefault = Object.entries(defaultTypography).every(
    ([key, value]) => typography[key as keyof TypographyPreference] === value,
  );
  return (
    <div className="space-y-6">
      <SettingsSection
        title={t("语言")}
        description={t("选择界面语言。此设置仅保存在当前浏览器，立即生效。")}
      >
        <SettingsField id="interface-language" label={t("界面语言")}>
          <SelectField
            id="interface-language"
            label={t("界面语言")}
            value={language}
            onValueChange={(value) =>
              setLanguagePreference(value as LanguagePreference)
            }
            className={settingsSelectClass}
            options={[
              { value: "system", label: t("跟随浏览器") },
              { value: "en", label: "English" },
              { value: "zh-CN", label: "简体中文" },
            ]}
          />
        </SettingsField>
      </SettingsSection>
      <fieldset className="space-y-3 border-t border-border pt-6">
        <legend className="text-sm font-semibold">{t("显示主题")}</legend>
        <div className="grid grid-cols-3 gap-2 max-[550px]:grid-cols-1">
          {themes.map(({ value, label, description }) => (
            <label
              key={value}
              className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 py-3 text-control hover:bg-hover has-[:checked]:border-accent has-[:checked]:bg-selected has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
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
        title={t("会话布局")}
        trailing={
          <Button size="sm" onClick={resetSidebarWidths}>
            {t("重置侧栏宽度")}
          </Button>
        }
      >
        <SettingsField
          id="conversation-width"
          label={t("会话宽度")}
          description={t(
            "舒适模式正文最多 880px，宽模式最多 1080px，铺满使用全部可用宽度。所有内容与会话区域对齐，超宽代码、表格和图表可局部滚动；窄屏自动收缩。",
          )}
        >
          <SelectField
            id="conversation-width"
            label={t("会话宽度")}
            value={conversationWidth}
            onValueChange={setConversationWidth}
            className={settingsSelectClass}
            options={[
              { value: "reading", label: t("舒适（默认）") },
              { value: "wide", label: t("宽") },
              { value: "fluid", label: t("铺满") },
            ]}
          />
        </SettingsField>
      </SettingsSection>
      <SettingsSection
        title={t("字体与字号")}
        description={t("调整后立即生效，并保存在当前浏览器。")}
        trailing={
          <Button
            size="sm"
            disabled={isDefault}
            onClick={() => setTypography(defaultTypography)}
          >
            {t("重置字体设置")}
          </Button>
        }
      >
        <div className="space-y-5">
          {[
            {
              key: "fontSize",
              label: t("界面基准字号"),
              options: fontSizeOptions(
                typography.fontSize,
                defaultTypography.fontSize,
              ),
              description: t(
                "设置正文基准字号，标题、辅助文字和图表按比例调整。",
              ),
            },
            {
              key: "codeFontSize",
              label: t("代码字号"),
              options: fontSizeOptions(
                typography.codeFontSize,
                defaultTypography.codeFontSize,
              ),
              description: t("独立设置编辑器和 Markdown 代码块的字号。"),
            },
            {
              key: "interfaceFont",
              label: t("界面字体"),
              options: interfaceFontOptions,
              description: t("应用于界面、正文和图表。"),
            },
            {
              key: "codeFont",
              label: t("等宽字体"),
              options: codeFontOptions,
              description: t(
                "应用于代码和终端；未安装的字体会使用系统备用字体。",
              ),
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
          className="space-y-2 border-t border-border pt-4"
          role="group"
          aria-label={t("字体预览")}
        >
          <p className="text-body">
            {t("文字预览：让阅读和工作更舒适。Aa 0123")}
          </p>
          <p className="break-words font-mono text-code leading-code">
            {t('const greeting = "你好，世界";')}
          </p>
        </div>
      </SettingsSection>
    </div>
  );
}
