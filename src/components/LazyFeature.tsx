import { t } from "../lib/i18n";
import { Component, Suspense, type ReactNode } from "react";

/** Keep a failed optional chunk from taking down the workbench. */
export class LazyFeature extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed)
      return (
        <p role="alert" className="p-4 text-sm text-muted">
          {t("功能加载失败，请检查连接。刷新前请先保存或复制未保存的内容。")}
        </p>
      );
    return (
      <Suspense
        fallback={
          <p role="status" className="p-4 text-sm text-muted">
            {t("正在加载…")}
          </p>
        }
      >
        {this.props.children}
      </Suspense>
    );
  }
}
