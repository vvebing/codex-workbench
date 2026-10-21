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
import { turnFileResults } from "./turn-results";

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
  return (
    <div
      data-slot="turn-results"
      className="mt-3 rounded-lg border border-border text-xs text-muted"
    >
      <div className="flex items-center gap-1 px-2 py-1">
        <Button
          variant="quiet"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="min-w-0 flex-1 justify-start"
        >
          <ChevronRight size={14} className={open ? "rotate-90" : ""} />
          <FileDiff size={14} />
          本轮变更
          {results.files.length ? ` · ${results.files.length} 个文件` : ""}
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
      {open && (
        <div className="space-y-2 border-t border-border p-3">
          {!results.aggregate && (
            <p>已完成的文件操作记录，按执行顺序保留 patch。</p>
          )}
          {turn.itemsView !== "full" && !results.aggregate && (
            <p>历史明细尚未完整加载。</p>
          )}
          <div className="flex flex-wrap gap-1">
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
                className="max-w-full text-left [overflow-wrap:anywhere] aria-pressed:bg-selected aria-pressed:text-accent"
              >
                {file.label}
              </Button>
            ))}
          </div>
          {selectedFile && <OpenCurrentFile path={selectedFile.path} />}
          <ScrollArea
            orientation="both"
            className="max-h-[420px] rounded bg-surface"
          >
            <pre className="p-3 text-meta text-foreground">
              {content || "此文件没有记录差异内容。"}
            </pre>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
