import { OpenCurrentFile } from "../files/FileLinkContext";
import { useState } from "react";
import { ChevronRight, FileDiff, ListChecks } from "lucide-react";
import type { Turn } from "../../generated/v2/Turn";
import type { TurnPlanStep } from "../../generated/v2/TurnPlanStep";
import { Markdown } from "./Markdown";
import { executionStatusLabel } from "./model";
import { turnFileResults } from "./turn-results";

export function TurnResults({
  turn,
  cwd,
  diff,
  plan,
}: {
  turn: Turn;
  cwd?: string;
  diff?: string;
  plan?: TurnPlanStep[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const results = turnFileResults(turn, diff, cwd);
  const recordedPlans = turn.items.filter((item) => item.type === "plan");
  const hasPlan = !!plan?.length || recordedPlans.length > 0;
  const hasChanges = results.files.length > 0 || !!results.rawDiff.trim();
  if (!hasPlan && !hasChanges) return null;
  const active = plan?.find((step) => step.status === "inProgress");
  const selectedFile = results.files.find((file) => file.path === selected);
  const content =
    selectedFile?.diff ??
    (results.aggregate
      ? results.rawDiff
      : results.files.map((file) => `${file.path}\n${file.diff}`).join("\n\n"));
  return (
    <div
      data-slot="turn-results"
      className="mt-3 rounded-lg border border-border text-xs text-muted"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-hover"
      >
        <ChevronRight size={14} className={open ? "rotate-90" : ""} />
        {hasPlan && (
          <>
            <ListChecks size={14} />
            <span>
              执行计划
              {plan?.length
                ? ` ${plan.filter((step) => step.status === "completed").length}/${plan.length}`
                : "记录"}
            </span>
          </>
        )}
        {hasChanges && (
          <>
            <FileDiff size={14} />
            <span>
              本轮变更
              {results.files.length
                ? ` ${results.files.length} 个文件`
                : "记录"}
            </span>
          </>
        )}
        {turn.status === "inProgress" && active && (
          <span className="min-w-0 truncate text-accent">{active.step}</span>
        )}
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-3">
          {plan?.length ? (
            <ol className="space-y-2">
              {plan.map((step, index) => (
                <li
                  key={index}
                  className="flex items-start justify-between gap-3"
                >
                  <span>{step.step}</span>
                  <span className="shrink-0">
                    {executionStatusLabel(step.status)}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            recordedPlans.map((item) => (
              <div key={item.id}>
                <p className="mb-2">计划文本记录 · 步骤完成状态未记录</p>
                <Markdown text={item.text} />
              </div>
            ))
          )}
          {hasChanges && (
            <>
              <p>
                {results.aggregate
                  ? "本轮汇总变更"
                  : "本轮已完成的文件操作记录（按执行顺序保留 patch，不代表最终净变更）"}
                {turn.itemsView !== "full" && !results.aggregate
                  ? " · 历史明细尚未完整加载"
                  : ""}
              </p>
              <div className="flex flex-wrap gap-1">
                {[
                  { path: null, label: "全部变更" },
                  ...results.files.map((file) => ({
                    path: file.path,
                    label: file.path,
                  })),
                ].map((file) => (
                  <button
                    key={file.path ?? "all"}
                    type="button"
                    aria-pressed={file.path === (selectedFile?.path ?? null)}
                    onClick={() => setSelected(file.path)}
                    className="max-w-full rounded px-2 py-1 text-left [overflow-wrap:anywhere] hover:bg-hover aria-pressed:bg-selected aria-pressed:text-accent"
                  >
                    {file.label}
                  </button>
                ))}
              </div>
              {selectedFile && <OpenCurrentFile path={selectedFile.path} />}
              <pre className="max-h-[420px] overflow-auto rounded bg-surface p-3 text-[11px] text-foreground">
                {content}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
