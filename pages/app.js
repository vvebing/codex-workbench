"use strict";
const sessions = [
  {
    project: "atlas-web",
    title: "为项目列表添加搜索",
    status: "已完成",
    request:
      "给项目列表添加搜索功能，支持按名称过滤，并补充没有匹配结果时的提示。",
    reply:
      "已完成项目搜索。输入关键词后，列表会即时筛选；清空关键词即可恢复全部项目。\n\n空结果会显示清晰的提示，并保留搜索框，方便修改关键词。搜索框带有可访问名称，支持键盘操作。",
    files: [
      {
        name: "src/ProjectList.tsx",
        stat: "+18 −3",
        diff: '  export function ProjectList() {\n+   const [query, setQuery] = useState("");\n+   const visible = projects.filter(project =>\n+     project.name.toLowerCase().includes(\n+       query.trim().toLowerCase()\n+     )\n+   );\n\n+   return <ProjectSearch\n+     query={query}\n+     onQueryChange={setQuery}\n+     projects={visible}\n+   />;\n  }',
      },
      {
        name: "src/ProjectSearch.tsx",
        stat: "+32",
        diff: '+ <label htmlFor="project-search">搜索项目</label>\n+ <input id="project-search" value={query}\n+   onChange={e => onQueryChange(e.target.value)} />\n+ {projects.length === 0 &&\n+   <p role="status">没有匹配的项目</p>}',
      },
    ],
    activity: [
      "读取项目列表与搜索组件",
      "实现名称筛选和空结果提示",
      "模拟检查：搜索、清空与键盘操作通过",
    ],
  },
  {
    project: "atlas-web",
    title: "修复移动端导航布局",
    status: "待审阅",
    request: "移动端导航在窄屏下会挤压内容，请调整布局并保留键盘焦点。",
    reply:
      "已将窄屏导航调整为横向滚动布局，主内容保持完整宽度。\n\n保留了焦点轮廓，并扩大了导航按钮的点击区域。你可以在右侧检查媒体查询的模拟变更。",
    files: [
      {
        name: "src/navigation.css",
        stat: "+12 −2",
        diff: "+ @media (max-width: 650px) {\n+   .navigation {\n+     display: flex;\n+     overflow-x: auto;\n+   }\n+   .navigation button {\n+     min-height: 44px;\n+     flex-shrink: 0;\n+   }\n+ }",
      },
    ],
    activity: [
      "定位窄屏导航溢出",
      "调整导航布局与点击区域",
      "模拟检查：375px 与 768px 布局通过",
      "等待审阅模拟代码变更",
    ],
  },
  {
    project: "field-notes",
    title: "整理 Markdown 导出流程",
    status: "已完成",
    request: "导出笔记时保留标题和段落结构，并使用笔记标题作为文件名。",
    reply:
      "已整理 Markdown 导出流程。导出的文件包含标题、正文及段落换行，文件名使用清理后的笔记标题。\n\n空标题使用 note.md，避免生成无名称文件。",
    files: [
      {
        name: "src/export.ts",
        stat: "+9 −2",
        diff: '+ const title = note.title.trim();\n+ const safeTitle = title.replace(/[^a-zA-Z0-9_一-鿿-]/g, "_");\n+ const filename = (safeTitle || "note") + ".md";\n+ const content = `# ${title || "未命名笔记"}\n\n${note.body}`;\n+ download(filename, content);',
      },
    ],
    activity: [
      "检查现有笔记导出流程",
      "保留标题、正文与换行",
      "模拟检查：空标题和文件名处理通过",
    ],
  },
  {
    project: "design-system",
    title: "补充按钮的焦点状态",
    status: "已完成",
    request: "为按钮补充可见的键盘焦点，并支持减少动态效果的系统设置。",
    reply:
      "按钮现在使用统一的焦点轮廓，键盘导航时更容易定位。\n\n当系统启用减少动态效果时，组件会关闭过渡动画。颜色继续沿用现有主题变量。",
    files: [
      {
        name: "src/button.css",
        stat: "+8",
        diff: "+ button:focus-visible {\n+   outline: 2px solid var(--accent);\n+   outline-offset: 3px;\n+ }\n+ @media (prefers-reduced-motion: reduce) {\n+   button { transition: none; }\n+ }",
      },
    ],
    activity: [
      "核对现有主题变量",
      "补充键盘焦点状态",
      "模拟检查：浅色与深色主题通过",
    ],
  },
];
const $ = (id) => document.getElementById(id);
let selected = 0;
let fileIndex = 0;
let messages = sessions.map(() => []);
function node(tag, text, className) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
}
function navigation() {
  const query = $("search").value.trim().toLowerCase();
  $("sessions").replaceChildren();
  let lastProject = "";
  sessions.forEach((session, index) => {
    if (!(session.title + session.project).toLowerCase().includes(query))
      return;
    if (lastProject !== session.project) {
      $("sessions").append(node("p", session.project, "project-label"));
      lastProject = session.project;
    }
    const button = node("button", session.title, "session");
    button.setAttribute("aria-pressed", String(index === selected));
    button.append(node("small", session.status + " · 模拟会话"));
    button.onclick = () => {
      selected = index;
      fileIndex = 0;
      render();
    };
    $("sessions").append(button);
  });
  if (!$("sessions").children.length)
    $("sessions").append(
      node("p", "没有匹配的会话，请尝试其他关键词。", "muted"),
    );
}
function renderMessages() {
  const session = sessions[selected];
  $("messages").replaceChildren();
  [
    ["你", session.request],
    ["Codex · 模拟回复", session.reply],
    ...messages[selected],
  ].forEach(([role, text]) => {
    const article = node(
      "article",
      "",
      "message" + (role === "你" ? " user" : ""),
    );
    article.append(node("div", role, "role"), node("p", text));
    $("messages").append(article);
  });
  $("messages").append(node("span", "演示结果 · 未执行实际任务", "result"));
}
function renderFiles() {
  const session = sessions[selected];
  $("files").replaceChildren();
  session.files.forEach((file, index) => {
    const button = node("button", "", "file");
    button.append(node("span", file.name), node("span", file.stat, "added"));
    button.setAttribute("aria-pressed", String(index === fileIndex));
    button.onclick = () => {
      fileIndex = index;
      renderFiles();
    };
    $("files").append(button);
  });
  $("filename").textContent = session.files[fileIndex].name;
  $("diff").textContent = session.files[fileIndex].diff;
}
function render() {
  const session = sessions[selected];
  navigation();
  $("project").textContent = session.project + " / 演示工作区";
  $("title").textContent = session.title;
  $("status").textContent = session.status;
  renderMessages();
  renderFiles();
  $("activity").replaceChildren(
    ...session.activity.map((item) => node("li", item)),
  );
}
$("search").addEventListener("input", navigation);
$("composer").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("prompt").value.trim();
  if (!text) return;
  messages[selected].push(
    ["你", text],
    [
      "Codex · 模拟回复",
      "已收到演示消息。当前任务「" +
        sessions[selected].title +
        "」包含 " +
        sessions[selected].files.length +
        " 个模拟变更文件。你可以切换右侧文件查看差异，或打开任务记录了解示例流程。\n\n这是一条预设回复，未调用模型或执行代码。",
    ],
  );
  $("prompt").value = "";
  renderMessages();
  $("prompt").focus();
});
$("reset").onclick = () => {
  messages = sessions.map(() => []);
  selected = 0;
  fileIndex = 0;
  $("search").value = "";
  $("prompt").value = "";
  render();
};
const tabs = [$("files-tab"), $("activity-tab")];
function activateTab(index) {
  tabs.forEach((tab, i) => {
    tab.setAttribute("aria-selected", String(i === index));
    tab.tabIndex = i === index ? 0 : -1;
    $(i === 0 ? "files-panel" : "activity-panel").hidden = i !== index;
  });
}
tabs.forEach((tab, i) => {
  tab.onclick = () => activateTab(i);
  tab.onkeydown = (event) => {
    let index;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") index = 1 - i;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = 1;
    else return;
    event.preventDefault();
    activateTab(index);
    tabs[index].focus();
  };
});
let dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
function theme() {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $("theme").textContent = dark ? "浅色外观" : "深色外观";
  $("theme").setAttribute("aria-label", dark ? "切换浅色主题" : "切换深色主题");
}
$("theme").onclick = () => {
  dark = !dark;
  theme();
};
theme();
render();
