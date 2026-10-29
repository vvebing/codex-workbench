import { t, useLocale } from "../../lib/i18n";
import { useLayoutEffect, useRef, useState } from "react";
import { Tabs } from "radix-ui";
import { SelectField } from "../../components/ui";
import type { Environment } from "../connection/environments";
import { EnvironmentIcon } from "../connection/EnvironmentIcon";

export function EnvironmentFilter({
  entries,
  value,
  onValueChange,
}: {
  entries: Environment[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  const i18nLocale = useLocale();
  void i18nLocale;

  const container = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  const [fits, setFits] = useState(false);
  const [open, setOpen] = useState(false);
  const compact = !fits || open;

  useLayoutEffect(() => {
    const element = container.current;
    const content = measure.current;
    if (!element || !content) return;
    const update = () => {
      const width = element.getBoundingClientRect().width;
      const required = content.getBoundingClientRect().width;
      setFits((previous) => {
        // Leave room before expanding again to avoid toggling at the boundary.
        const next = width >= required + (previous ? 0 : 8);
        if (next !== previous && element.contains(document.activeElement))
          moveFocus.current = true;
        return next;
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    container.current
      ?.querySelector<HTMLElement>(
        '[role="combobox"], [role="tab"][aria-selected="true"]',
      )
      ?.focus({ preventScroll: true });
  }, [compact]);

  const icon = (environment: Environment) => (
    <EnvironmentIcon
      environment={environment}
      connection={environment.runtime.connection.getSnapshot()}
      focusable={false}
    />
  );

  return (
    <div
      ref={container}
      data-slot="environment-filter"
      className="relative h-[38px] min-w-0 max-[900px]:h-[52px]"
    >
      <div
        aria-hidden="true"
        inert
        className="pointer-events-none invisible absolute inset-0 overflow-hidden"
      >
        <div
          ref={measure}
          className="navigation-environments flex w-max gap-1 rounded-lg p-1"
        >
          {entries.length > 1 && (
            <span className="navigation-environment flex-none">
              {t("全部")}
            </span>
          )}
          {entries.map((environment) => (
            <span
              key={environment.id}
              className="navigation-environment flex-none"
            >
              {icon(environment)}
              <span>{environment.name}</span>
            </span>
          ))}
        </div>
      </div>
      {compact ? (
        <SelectField
          label={t("按工作环境筛选会话")}
          className="h-full w-full"
          value={value}
          onValueChange={onValueChange}
          onOpenChange={(next) => {
            if (!next) moveFocus.current = true;
            setOpen(next);
          }}
          onCloseAutoFocus={(event) => {
            moveFocus.current = false;
            const target = container.current?.querySelector<HTMLElement>(
              '[role="tab"][aria-selected="true"]',
            );
            if (!target) return;
            event.preventDefault();
            target.focus({ preventScroll: true });
          }}
          options={[
            ...(entries.length > 1
              ? [
                  {
                    value: "all",
                    label: t("全部环境 · {{value0}}", {
                      value0: entries.length,
                    }),
                  },
                ]
              : []),
            ...entries.map((environment) => ({
              value: environment.id,
              label: environment.name,
              icon: icon(environment),
            })),
          ]}
        />
      ) : (
        <Tabs.Root
          value={value}
          onValueChange={onValueChange}
          className="h-full"
        >
          <Tabs.List
            aria-label={t("按工作环境筛选会话")}
            className="navigation-environments flex h-full min-w-0 gap-1 rounded-lg border border-border bg-transparent p-1"
          >
            {entries.length > 1 && (
              <Tabs.Trigger value="all" className="navigation-environment">
                {t("全部")}
              </Tabs.Trigger>
            )}
            {entries.map((environment) => (
              <Tabs.Trigger
                key={environment.id}
                value={environment.id}
                aria-label={environment.name}
                className="navigation-environment"
              >
                {icon(environment)}
                <span>{environment.name}</span>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs.Root>
      )}
    </div>
  );
}
