type SidebarThread = { id: string; cwd: string; updatedAt: number };

export function groupThreadsByRecency<T extends SidebarThread>(threads: T[]) {
  const sorted = [...threads].sort(
    (a, b) =>
      b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return Map.groupBy(sorted, (thread) => thread.cwd);
}

export function updatedTimeAttributes(timestamp: number) {
  const date = new Date(timestamp * 1000);
  return {
    dateTime: date.toISOString(),
    title: `最近更新：${date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })}`,
  };
}
