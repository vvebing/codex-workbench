import { t, useLocale } from "../../lib/i18n";
import { settingsInputClass } from "../settings/settings-ui";
import { useEffect, useState } from "react";
import {
  Button,
  Modal,
  SelectField,
  ErrorNotice,
  ScrollArea,
} from "../../components/ui";
import { useStore } from "../../components/hooks";
import type { Environment } from "../connection/environments";

export function SectionControls({
  entries,
  preferredId,
  deviceFilter,
  onDeviceFilterChange,
}: {
  entries: Environment[];
  preferredId?: string;
  deviceFilter: string;
  onDeviceFilterChange: (id: string) => void;
}) {
  const i18nLocale = useLocale();
  void i18nLocale;

  const [open, setOpen] = useState(false);
  const [deviceId, setDeviceId] = useState<string>();
  const selected =
    entries.find((entry) => entry.id === deviceId) ??
    entries.find((entry) => entry.id === preferredId) ??
    entries[0];
  const visible = entries.filter(
    (entry) => deviceFilter === "all" || entry.id === deviceFilter,
  );
  const encode = (device: string, section: string) =>
    JSON.stringify([device, section]);
  const filter =
    visible[0]?.runtime.sessions.getSnapshot().sectionFilter ?? "all";
  const mixed =
    visible.length > 1 &&
    ((filter !== "all" && filter !== "unsectioned") ||
      visible.some(
        (entry) =>
          entry.runtime.sessions.getSnapshot().sectionFilter !== filter,
      ));
  const value = mixed
    ? "filtered"
    : filter === "all" || filter === "unsectioned"
      ? filter
      : encode(visible[0].id, filter);
  const options = [
    { value: "all", label: t("全部分区") },
    { value: "unsectioned", label: t("未分区") },
    ...(mixed ? [{ value: "filtered", label: t("已筛选分区") }] : []),
    ...visible.flatMap((entry) =>
      entry.runtime.sessions.getSnapshot().sections.map((section) => ({
        value: encode(entry.id, section.id),
        label:
          visible.length > 1 ? `${entry.name} · ${section.name}` : section.name,
      })),
    ),
    { value: "manage", label: t("管理分区…") },
  ];
  const choose = (next: string) => {
    if (next === "manage") {
      setDeviceId(preferredId);
      setOpen(true);
      return;
    }
    if (next === "filtered") return;
    if (next === "all" || next === "unsectioned") {
      for (const entry of visible)
        void entry.runtime.sessions.setSectionFilter(next).catch(() => {});
      return;
    }
    const [device, section] = JSON.parse(next) as [string, string];
    const entry = entries.find((entry) => entry.id === device);
    if (entry) {
      onDeviceFilterChange(device);
      void entry.runtime.sessions.setSectionFilter(section).catch(() => {});
    }
  };
  return (
    <>
      <SelectField
        label={t("管理分区")}
        className="min-h-7 min-w-0 max-w-[110px] px-2 py-1 tracking-normal [&>span:first-child]:truncate"
        value={value}
        options={options}
        disabled={
          !visible.length ||
          visible.some((entry) => entry.runtime.sessions.getSnapshot().loading)
        }
        onValueChange={choose}
        onOpenChange={(open) => {
          if (open)
            for (const entry of visible)
              void entry.runtime.sessions.loadSections();
        }}
      />
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t("管理分区")}
        description={t("用分区整理会话。分区按设备保存，并在客户端之间共享。")}
      >
        {selected ? (
          <>
            <label className="mb-2 block text-caption text-muted">
              {t("分区所属设备")}
            </label>
            <SelectField
              label={t("分区所属设备")}
              className="mb-4 w-full"
              value={selected.id}
              onValueChange={setDeviceId}
              options={entries.map((entry) => ({
                value: entry.id,
                label: entry.name,
              }))}
            />
            <SectionEditor key={selected.id} environment={selected} />
          </>
        ) : (
          <p className="text-sm text-muted">{t("连接设备后可管理分区。")}</p>
        )}
      </Modal>
    </>
  );
}

function SectionEditor({ environment }: { environment: Environment }) {
  const i18nLocale = useLocale();
  void i18nLocale;

  const { sessions, connection } = environment.runtime;
  const state = useStore(sessions);
  const status = useStore(connection);
  const [newName, setNewName] = useState("");
  const [editName, setEditName] = useState("");
  const [editing, setEditing] = useState<string>();
  const [deleting, setDeleting] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const connected = status.status === "connected";
  const busy = pending || state.loading || !connected;
  useEffect(() => {
    if (status.status === "connected") void sessions.loadSections();
  }, [sessions, status.epoch, status.status]);
  const action = async (run: () => Promise<void>, message: string) => {
    if (pending) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      await run();
      setEditing(undefined);
      setDeleting(undefined);
      setNotice(message);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="space-y-4">
      {!connected && (
        <p role="status" className="text-caption text-warning">
          {t("设备未连接，连接后可管理分区。")}
        </p>
      )}
      <form
        className="border-b border-border pb-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && newName.trim())
            void action(async () => {
              await sessions.saveSection(newName);
              setNewName("");
            }, t("分区已创建"));
        }}
      >
        <label
          htmlFor="section-new-name"
          className="mb-2 block text-control font-medium"
        >
          {t("新分区名称")}
        </label>
        <div className="flex gap-2">
          <input
            id="section-new-name"
            className={`${settingsInputClass} min-w-0 flex-1`}
            placeholder={t("输入分区名称")}
            value={newName}
            maxLength={100}
            disabled={busy}
            onChange={(event) => setNewName(event.target.value)}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !newName.trim()}
          >
            {t("新建分区")}
          </Button>
        </div>
      </form>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-control font-medium">
            {t("已有分区")}
            <span className="text-muted">{state.sections.length}</span>
          </h3>
          <Button
            size="sm"
            variant="quiet"
            disabled={busy || state.sectionsLoading}
            onClick={() => void sessions.loadSections()}
          >
            {state.sectionsLoading ? t("刷新中…") : t("刷新")}
          </Button>
        </div>
        {state.sectionsError && (
          <ErrorNotice className="mb-2">{state.sectionsError}</ErrorNotice>
        )}
        <ScrollArea
          className="max-h-[36dvh]"
          aria-busy={pending || state.sectionsLoading}
        >
          <div className="space-y-2">
            {state.sections.length === 0 && (
              <div className="px-1 py-6 text-caption text-muted">
                {state.sectionsLoading
                  ? t("正在加载分区…")
                  : state.sectionsError
                    ? t("暂时无法加载分区，请重试。")
                    : t("还没有分区，创建第一个分区来整理会话。")}
              </div>
            )}
            {state.sections.map((section) => (
              <div
                key={section.id}
                className="border-b border-border py-4 last:border-b-0"
              >
                {editing === section.id ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!busy && editName.trim())
                        void action(
                          () => sessions.saveSection(editName, section.id),
                          t("分区名称已更新"),
                        );
                    }}
                  >
                    <label
                      className="mb-2 block text-caption text-muted"
                      htmlFor="section-edit-name"
                    >
                      {t("分区新名称")}
                    </label>
                    <input
                      id="section-edit-name"
                      autoFocus
                      className={`${settingsInputClass} w-full`}
                      value={editName}
                      maxLength={100}
                      disabled={busy}
                      onChange={(event) => setEditName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape" && !pending) {
                          event.stopPropagation();
                          setEditing(undefined);
                        }
                      }}
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() => setEditing(undefined)}
                      >
                        {t("取消")}
                      </Button>
                      <Button
                        size="sm"
                        type="submit"
                        variant="primary"
                        disabled={busy || !editName.trim()}
                      >
                        {t("保存名称")}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 break-all text-control font-medium">
                      {section.name}
                    </span>
                    <Button
                      size="sm"
                      variant="quiet"
                      disabled={busy}
                      onClick={() => {
                        setEditing(section.id);
                        setEditName(section.name);
                        setDeleting(undefined);
                        setError("");
                        setNotice("");
                      }}
                    >
                      {t("重命名")}
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      disabled={busy}
                      onClick={() => {
                        setDeleting(section.id);
                        setEditing(undefined);
                        setError("");
                        setNotice("");
                      }}
                    >
                      {t("删除")}
                    </Button>
                  </div>
                )}
                {deleting === section.id && (
                  <div
                    className="mt-3 rounded-lg bg-danger-soft p-3"
                    role="alert"
                  >
                    <p className="text-caption leading-relaxed">
                      {t("确认删除「")}
                      {section.name}
                      {t("」？其中的会话会保留并移至未分区。")}
                    </p>
                    <div className="mt-3 flex justify-end gap-2">
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() => setDeleting(undefined)}
                      >
                        {t("取消")}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busy}
                        onClick={() =>
                          void action(
                            () => sessions.deleteSection(section.id),
                            t("分区已删除，会话已保留"),
                          )
                        }
                      >
                        {t("确认删除分区")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <p role="status" className="text-caption text-muted">
        {pending
          ? t("正在保存更改…")
          : notice || t("删除分区不会删除其中的会话。")}
      </p>
    </div>
  );
}
