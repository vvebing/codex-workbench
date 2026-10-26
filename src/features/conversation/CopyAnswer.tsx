import { useTranslation } from "react-i18next";
import { t } from "../../lib/i18n";
import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyAnswer({ text }: { text: string }) {
  useTranslation();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setCopied(false);
    setError("");
  }, [text]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 4000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  async function copy() {
    setError("");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError("复制失败，请重试。");
    }
  }
  return (
    <div
      className="inline-flex items-center gap-2"
      data-slot="final-answer-actions"
    >
      <button
        type="button"
        aria-label={t("复制最终回答")}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted hover:bg-hover"
        onClick={() => void copy()}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
        {copied ? t("已复制") : t("复制")}
      </button>
      <span
        role={error ? "alert" : "status"}
        aria-live="polite"
        className={error ? "text-xs text-danger" : "sr-only"}
      >
        {error ? t(error) : copied ? t("已复制回答") : ""}
      </span>
    </div>
  );
}
