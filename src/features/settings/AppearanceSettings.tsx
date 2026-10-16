import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "./theme";

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
  return (
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
              <span className="mt-1 block text-[11px] font-normal text-muted">
                {description}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
