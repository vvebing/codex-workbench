import { useEffect, useState } from "react";
import { Button, Modal, SelectField, ScrollArea } from "../../components/ui";
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
    { value: "all", label: "全部分区" },
    { value: "unsectioned", label: "未分区" },
    ...(mixed ? [{ value: "filtered", label: "已筛选分区" }] : []),
    ...visible.flatMap((entry) =>
      entry.runtime.sessions.getSnapshot().sections.map((section) => ({
        value: encode(entry.id, section.id),
        label:
          visible.length > 1 ? `${entry.name} · ${section.name}` : section.name,
      })),
    ),
    { value: "manage", label: "管理分区…" },
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
        label="管理分区"
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
        title="管理分区"
        description="分区按设备保存，所有客户端共享。删除分区会保留其中会话。"
      >
        {selected ? (
          <>
            <SelectField
              label="分区所属设备"
              className="mb-4 w-full"
              value={selected.id}
              onValueChange={setDeviceId}
              options={entries.map((entry) => ({
                value: entry.id,
                label: entry.name,
              }))}
            />
            <ScrollArea className="max-h-[55dvh]">
              <SectionEditor key={selected.id} environment={selected} />
            </ScrollArea>
          </>
        ) : (
          <p className="text-sm text-muted">连接设备后可管理分区。</p>
        )}
      </Modal>
    </>
  );
}

function SectionEditor({ environment }: { environment: Environment }) {
  const { sessions, connection } = environment.runtime;
  const state = useStore(sessions);
  const status = useStore(connection);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | undefined>();
  const [deleting, setDeleting] = useState<string | undefined>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (status.status === "connected") void sessions.loadSections();
  }, [sessions, status.epoch, status.status]);
  const action = async (run: () => Promise<void>) => {
    setError("");
    try {
      await run();
      setNewName("");
      setEditing(undefined);
      setDeleting(undefined);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div className="mb-3 px-2 text-xs text-muted">
      {state.sectionsError && (
        <p role="alert" className="text-danger">
          {state.sectionsError}
        </p>
      )}
      <Button
        disabled={state.sectionsLoading}
        onClick={() => void sessions.loadSections()}
      >
        刷新分区
      </Button>
      <div className="my-3 space-y-2">
        {state.sections.map((section) => (
          <div key={section.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{section.name}</span>
            <Button
              disabled={state.loading}
              onClick={() => {
                setEditing(section.id);
                setNewName(section.name);
              }}
            >
              重命名
            </Button>
            <Button
              disabled={state.loading}
              onClick={() => setDeleting(section.id)}
            >
              删除
            </Button>
          </div>
        ))}
      </div>
      {deleting && (
        <div role="alert" className="my-3">
          <p>确认删除此分区？其中的会话会保留并移至未分区。</p>
          <Button
            disabled={state.loading}
            onClick={() => void action(() => sessions.deleteSection(deleting))}
          >
            确认删除分区
          </Button>
          <Button onClick={() => setDeleting(undefined)}>取消</Button>
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void action(() => sessions.saveSection(newName, editing));
        }}
      >
        <label className="block text-[13px] font-medium">
          {editing ? "分区新名称" : "新分区名称"}
          <input
            className="my-2 block w-full rounded border border-border bg-elevated p-2"
            value={newName}
            required
            maxLength={100}
            onChange={(event) => setNewName(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={state.loading || !newName.trim()}>
          {editing ? "保存名称" : "新建分区"}
        </Button>
        {editing && (
          <Button
            type="button"
            onClick={() => {
              setEditing(undefined);
              setNewName("");
            }}
          >
            取消重命名
          </Button>
        )}
      </form>
      {error && (
        <p role="alert" className="mt-3 text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
