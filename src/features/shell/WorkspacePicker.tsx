import { useEffect, useId, useState } from "react";
import { Folder } from "lucide-react";
import { Button } from "../../components/ui";
import type { FsReadDirectoryResponse } from "../../generated/v2/FsReadDirectoryResponse";
import type { FileSearchClient } from "../composer/file-search";
import {
  absolutePath,
  completionDirectory,
  joinDirectory,
  parentDirectory,
  separator,
} from "./workspace-path";
const pathInputClass =
  "min-w-0 rounded-lg border border-border bg-elevated px-3 py-[11px] font-mono text-[12px]";

type Listing = { key: string; directories: string[]; error?: string };
function directoryError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /method.*not found|unknown method|unsupported|-32601/i.test(message)
    ? "此环境暂不支持目录浏览，请手动填写完整路径。"
    : `无法读取目录，请检查路径和访问权限。${message}`;
}
export function WorkspacePicker({
  client,
  value,
  onChange,
  environmentName,
  connected,
  disabled,
  initialPath,
}: {
  client: FileSearchClient;
  value: string;
  onChange: (path: string) => void;
  environmentName: string;
  connected: boolean;
  disabled: boolean;
  initialPath?: string;
}) {
  const listId = useId();
  const [focused, setFocused] = useState(false),
    [active, setActive] = useState(-1);
  const [browsePath, setBrowsePath] = useState<string | null>(null);
  const [address, setAddress] = useState(""),
    [addressError, setAddressError] = useState("");
  const [revision, setRevision] = useState(0),
    [listing, setListing] = useState<Listing | null>(null);
  const completion = completionDirectory(value.trim());
  const path = browsePath ?? (focused ? completion?.parent : undefined);
  const key = JSON.stringify([path, revision, connected]);
  useEffect(() => {
    if (!path || !connected || disabled) return;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void client
          .request<FsReadDirectoryResponse>("fs/readDirectory", { path })
          .then((result) => {
            if (!cancelled)
              setListing({
                key,
                directories: result.entries
                  .filter((entry) => entry.isDirectory)
                  .map((entry) => entry.fileName)
                  .sort((a, b) => a.localeCompare(b)),
              });
          })
          .catch((error: unknown) => {
            if (!cancelled)
              setListing({
                key,
                directories: [],
                error: directoryError(error),
              });
          });
      },
      browsePath === null ? 250 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, path, key, connected, disabled, browsePath]);
  const current = listing?.key === key ? listing : null;
  const suggestions =
    browsePath === null && focused && completion
      ? (current?.directories ?? [])
          .filter((name) =>
            name
              .toLocaleLowerCase()
              .startsWith(completion.prefix.toLocaleLowerCase()),
          )
          .slice(0, 20)
      : [];
  const choose = (name: string) => {
    onChange(
      joinDirectory(completion!.parent, name) + separator(completion!.parent),
    );
    setActive(-1);
  };
  const navigate = (next: string) => {
    setBrowsePath(next);
    setAddress(next);
    setAddressError("");
    setActive(-1);
  };
  const go = () => {
    if (absolutePath(address.trim())) navigate(address.trim());
    else setAddressError("请输入完整的绝对路径，例如 /home 或 C:\\Users。");
  };
  return (
    <div className="mt-2">
      <div className="flex items-start gap-2">
        <div
          className="min-w-0 flex-1"
          onBlur={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setFocused(false);
          }}
        >
          <input
            id="new-workspace-path"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={suggestions.length > 0}
            aria-controls={listId}
            aria-activedescendant={
              active >= 0 && active < suggestions.length
                ? `${listId}-${active}`
                : undefined
            }
            aria-describedby="new-workspace-help"
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              setActive(-1);
            }}
            onFocus={() => setFocused(true)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape" && focused) {
                event.preventDefault();
                event.stopPropagation();
                setFocused(false);
              }
              if (
                suggestions.length &&
                (event.key === "ArrowDown" || event.key === "ArrowUp")
              ) {
                event.preventDefault();
                setActive((index) =>
                  event.key === "ArrowDown"
                    ? (index + 1) % suggestions.length
                    : index <= 0
                      ? suggestions.length - 1
                      : index - 1,
                );
              }
              if (event.key === "Enter" && active >= 0 && suggestions[active]) {
                event.preventDefault();
                choose(suggestions[active]);
              }
            }}
            placeholder="输入或粘贴项目目录的完整路径"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            className={`${pathInputClass} w-full`}
          />
          {suggestions.length > 0 && (
            <ul
              id={listId}
              role="listbox"
              aria-label="目录建议"
              className="mt-1 max-h-40 overflow-auto rounded-lg border border-border bg-elevated p-1"
            >
              {suggestions.map((name, index) => (
                <li
                  key={name}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={active === index}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(name)}
                  className="cursor-pointer break-all rounded px-3 py-2 text-[12px] hover:bg-hover aria-selected:bg-hover"
                >
                  {name}
                  {separator(completion!.parent)}
                </li>
              ))}
            </ul>
          )}
          {browsePath === null && focused && current?.error && (
            <p role="status" className="mt-2 text-[12px] text-muted">
              {current.error}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled || !connected}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setFocused(false);
            const start = value.trim() || initialPath || "/";
            navigate(absolutePath(start) ? start : "/");
          }}
        >
          浏览目录
        </Button>
      </div>
      <p
        id="new-workspace-help"
        className="mt-2 text-[12px] leading-[1.7] text-muted"
      >
        目录位于「{environmentName}」所在机器。留空使用该环境的默认目录。
      </p>
      {browsePath !== null && (
        <section
          aria-label="目录浏览器"
          className="mt-3 rounded-lg border border-border p-3"
        >
          <p className="mb-2 text-[12px] text-muted">
            正在浏览：{environmentName}
          </p>
          <div className="flex items-center gap-2">
            <input
              aria-label="浏览路径"
              value={address}
              disabled={disabled}
              onChange={(event) => setAddress(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  go();
                }
              }}
              className={`${pathInputClass} flex-1`}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={disabled || !connected}
              onClick={go}
            >
              前往
            </Button>
          </div>
          {addressError && (
            <p role="alert" className="mt-2 text-[12px] text-danger">
              {addressError}
            </p>
          )}
          <div className="my-2 flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={
                disabled ||
                !connected ||
                parentDirectory(browsePath) === browsePath
              }
              onClick={() => navigate(parentDirectory(browsePath))}
            >
              上级目录
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={disabled || !connected}
              onClick={() => setRevision((n) => n + 1)}
            >
              刷新
            </Button>
          </div>
          <div
            className="max-h-48 overflow-auto"
            aria-busy={connected && !current}
          >
            {!connected ? (
              <p role="status" className="text-[12px] text-muted">
                环境已断开，重新连接后可继续浏览。
              </p>
            ) : !current ? (
              <p role="status" className="text-[12px] text-muted">
                正在读取目录…
              </p>
            ) : current.error ? (
              <p role="status" className="break-all text-[12px] text-danger">
                {current.error}
              </p>
            ) : current.directories.length === 0 ? (
              <p role="status" className="text-[12px] text-muted">
                此目录下没有子文件夹，可以直接选择此目录。
              </p>
            ) : (
              current.directories.map((name) => (
                <button
                  key={name}
                  type="button"
                  disabled={disabled}
                  onClick={() => navigate(joinDirectory(browsePath, name))}
                  className="flex min-h-10 w-full items-center gap-2 rounded px-2 py-2 text-left text-[12px] hover:bg-hover"
                >
                  <Folder size={15} className="shrink-0 text-muted" />
                  <span className="break-all">{name}</span>
                </button>
              ))
            )}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={disabled}
              onClick={() => setBrowsePath(null)}
            >
              收起浏览
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={disabled || !connected || !current || !!current.error}
              onClick={() => {
                onChange(browsePath);
                setBrowsePath(null);
              }}
            >
              选择此目录
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
