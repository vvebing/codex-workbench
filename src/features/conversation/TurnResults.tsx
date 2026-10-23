import { useState } from "react";
import { ChevronRight, FileDiff, MoreHorizontal } from "lucide-react";
import {
  Button,
  IconButton,
  Menu,
  MenuItem,
  ScrollArea,
} from "../../components/ui";
import { OpenCurrentFile } from "../files/FileLinkContext";
import type { Turn } from "../../generated/v2/Turn";
import { exportText } from "./export";
import { turnFileResults, diffLineCounts, diffLineKind } from "./turn-results";
import { AnimatedDisclosure } from "./AnimatedDisclosure";
import { BEFORE_EXECUTION_LAYOUT } from "./AnimatedExecution";

export function TurnResults({
  turn,
  cwd,
  diff,
}: {
  turn: Turn;
  cwd?: string;
  diff?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const results = turnFileResults(turn, diff, cwd);
  if (!results.files.length && !results.rawDiff.trim()) return null;
  const selectedFile = results.files.find((file) => file.path === selected);
  const content =
    selectedFile?.diff ??
    (results.aggregate
      ? results.rawDiff
      : results.files.map((file) => `${file.path}\n${file.diff}`).join("\n\n"));
  const lines = content.split("\n");
  const totals = diffLineCounts(
    results.aggregate
      ? results.rawDiff
      : results.files.map((file) => file.diff).join("\n"),
  );
  return (
    <div
      data-slot="turn-results"
      className="mt-4 rounded-lg border border-border bg-surface/30 text-control text-foreground"
    >
      <div className="flex items-center gap-1 px-2 py-1">
        <Button
          variant="quiet"
          size="sm"
          aria-expanded={open}
          onClick={(event) => {
            event.currentTarget.dispatchEvent(
              new Event(BEFORE_EXECUTION_LAYOUT, { bubbles: true }),
            );
            setOpen(!open);
          }}
          className="min-w-0 flex-1 justify-start"
        >
          <ChevronRight
            size={14}
            className={`transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
          />
          <FileDiff size={14} />
          本轮变更
          {results.files.length ? ` · ${results.files.length} 个文件` : ""}
          <span
            className="ml-auto whitespace-nowrap text-xs"
            aria-label={`新增 ${totals.added} 行，删除 ${totals.removed} 行${results.aggregate ? "" : "，按操作记录累计"}`}
          >
            <span className="text-diff-added">+{totals.added}</span>{" "}
            <span className="text-diff-deleted">−{totals.removed}</span>
          </span>
        </Button>
        {results.aggregate && !!results.rawDiff.trim() && (
          <Menu
            label="本轮变更操作"
            trigger={
              <IconButton size="sm" label="本轮变更操作">
                <MoreHorizontal size={16} />
              </IconButton>
            }
          >
            <MenuItem
              className="menu-item"
              onSelect={() =>
                exportText(
                  results.rawDiff,
                  `turn-${encodeURIComponent(turn.id)}.patch`,
                )
              }
            >
              导出本轮补丁
            </MenuItem>
          </Menu>
        )}
      </div>
      <AnimatedDisclosure open={open}>
        {open && (
          <div className="space-y-2 border-t border-border p-3">
            {!results.aggregate && (
              <p>
                已完成的文件操作记录，按执行顺序保留
                patch；行数按记录累计，不代表最终净变更。
              </p>
            )}
            {turn.itemsView !== "full" && !results.aggregate && (
              <p>历史明细尚未完整加载。</p>
            )}
            <div className="grid min-w-0 gap-3 @min-[700px]/conversation:grid-cols-[minmax(150px,30%)_minmax(0,1fr)]">
              <ScrollArea className="max-h-48 @min-[700px]/conversation:max-h-[420px]">
                <nav aria-label="本轮变更文件" className="flex flex-col gap-1">
                  {[
                    { path: null, label: "全部变更" },
                    ...results.files.map((file) => ({
                      path: file.path,
                      label: file.path,
                    })),
                  ].map((file) => (
                    <Button
                      key={file.path ?? "all"}
                      variant="quiet"
                      size="sm"
                      aria-pressed={file.path === (selectedFile?.path ?? null)}
                      onClick={() => setSelected(file.path)}
                      className="h-auto max-w-full justify-start py-2 text-left [overflow-wrap:anywhere] aria-pressed:bg-selected aria-pressed:text-accent"
                    >
                      {file.label}
                    </Button>
                  ))}
                </nav>
              </ScrollArea>
              <div className="min-w-0 space-y-2">
                {selectedFile && <OpenCurrentFile path={selectedFile.path} />}
                <ScrollArea
                  orientation="both"
                  className="max-h-[420px] rounded bg-surface"
                >
                  <pre
                    className="min-w-fit py-3 text-code leading-code text-foreground"
                    aria-label="变更差异"
                  >
                    {content
                      ? lines.map((line, index) => {
                          const kind = diffLineKind(line);
                          return (
                            <span
                              key={index}
                              className={`block px-3 ${kind === "added" ? "bg-diff-added-soft text-diff-added" : kind === "removed" ? "bg-diff-deleted-soft text-diff-deleted" : kind === "header" ? "text-accent" : ""}`}
                            >
                              {line || " "}
                            </span>
                          );
                        })
                      : "此文件没有记录差异内容。"}
                  </pre>
                </ScrollArea>
              </div>
            </div>
          </div>
        )}
      </AnimatedDisclosure>
    </div>
  );
}
