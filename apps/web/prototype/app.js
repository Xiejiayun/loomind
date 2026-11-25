const demoMaps = [
  { id: "product", title: "产品规划", branches: ["用户需求", "核心功能", "设计方向", "下一步行动"], template: "blank-organic", age: 0 },
  { id: "okr", title: "季度 OKR", branches: ["目标设定", "关键结果", "行动计划", "复盘指标"], template: "quarterly-okr", age: 1 },
  { id: "reading", title: "深度读书笔记", branches: ["核心观点", "重要案例", "我的理解", "行动启发"], template: "blank-organic", age: 2 },
  { id: "architecture", title: "系统架构拆解", branches: ["前端体验", "核心服务", "数据流转", "基础设施"], template: "quarterly-okr", age: 3 },
  { id: "travel", title: "旅行计划", branches: ["目的地", "交通路线", "住宿安排", "行前清单"], template: "annual-roadmap", age: 4 },
  { id: "review", title: "项目复盘", branches: ["预期目标", "实际结果", "关键问题", "改进方向"], template: "root-cause-fishbone", age: 5 },
];

const mapsKey = "loomind-prototype-maps";
const promptKey = "loomind-prototype-prompt";
const collapsedKey = "loomind-prototype-sidebar";
const day = 24 * 60 * 60 * 1000;

function readCreatedMaps() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(mapsKey) || "[]");
    if (!Array.isArray(saved)) return [];
    return saved.filter((map) => typeof map?.id === "string" && typeof map.title === "string" &&
      Array.isArray(map.branches) && map.branches.every((branch) => typeof branch === "string"));
  } catch (error) {
    console.warn("无法读取原型中的示例导图。", error);
    return [];
  }
}

function allMaps() {
  const now = Date.now();
  return [
    ...readCreatedMaps(),
    ...demoMaps.map((map) => ({ ...map, updatedAt: now - map.age * day - 2 * 60 * 60 * 1000 })),
  ];
}

function showPrototypeError(message) {
  const content = document.querySelector(".app-main .app-inner");
  if (!content) return;
  let alert = content.querySelector("[data-prototype-error]");
  if (!alert) {
    alert = document.createElement("p");
    alert.className = "prototype-error";
    alert.dataset.prototypeError = "";
    alert.setAttribute("role", "alert");
    content.prepend(alert);
  }
  alert.textContent = message;
  alert.scrollIntoView({ block: "nearest" });
}

function saveCreatedMap(title, branches, template, outline = null) {
  const map = {
    id: `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    branches,
    template,
    outline,
    updatedAt: Date.now(),
  };
  try {
    sessionStorage.setItem(mapsKey, JSON.stringify([map, ...readCreatedMaps()]));
  } catch (error) {
    console.warn("无法保存原型中的示例导图。", error);
    showPrototypeError("无法保存原型导图。请检查浏览器存储空间后重试；当前输入仍保留在页面上。");
    return;
  }
  location.href = `./editor.html?map=${encodeURIComponent(map.id)}`;
}

function initRecentMaps() {
  const recent = document.querySelector(".sidebar-recent");
  if (!recent) return;
  const heading = recent.querySelector(".sidebar-recent-heading");
  const currentId = new URLSearchParams(location.search).get("map");
  const links = allMaps().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3).map((map) => {
    const link = document.createElement("a");
    link.className = "recent-link";
    link.href = `./editor.html?map=${encodeURIComponent(map.id)}`;
    link.title = map.title;
    if (map.id === currentId) link.setAttribute("aria-current", "page");
    const icon = document.createElement("span");
    icon.className = "recent-diamond";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "◇";
    const name = document.createElement("span");
    name.textContent = map.title;
    link.append(icon, name);
    return link;
  });
  recent.replaceChildren(heading, ...links);
}

function relativeDate(timestamp) {
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / day));
  if (days === 0) return "今天编辑";
  if (days === 1) return "昨天编辑";
  return `${days} 天前编辑`;
}

function createMapCard(map, index) {
  const card = document.createElement("a");
  card.className = "map-card";
  card.href = `./editor.html?map=${encodeURIComponent(map.id)}`;
  card.setAttribute("aria-label", `打开导图：${map.title}`);

  const preview = document.createElement("div");
  preview.className = "mini-map";
  preview.dataset.layout = map.template || "blank-organic";
  preview.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 300 140");
  svg.setAttribute("preserveAspectRatio", "none");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const paths = {
    "blank-organic": "M119 70 C100 70 105 35 86 35 M119 70 C100 70 105 105 86 105 M181 70 C200 70 195 35 214 35 M181 70 C200 70 195 105 214 105",
    "quarterly-okr": "M80 70 C130 70 155 18 215 18 M80 70 C130 70 155 52 215 52 M80 70 C130 70 155 88 215 88 M80 70 C130 70 155 122 215 122",
    "annual-roadmap": "M150 40 V80 H35 V96 M150 80 H110 V96 M150 80 H190 V96 M150 80 H265 V96",
    "root-cause-fishbone": "M255 70 H35 M75 70 L75 38 M145 70 L145 38 M75 70 L75 105 M145 70 L145 105",
  };
  path.setAttribute("d", paths[preview.dataset.layout] || paths["blank-organic"]);
  svg.append(path);
  preview.append(svg);
  for (const position of ["center", "left-top", "left-bottom", "right-top", "right-bottom"]) {
    const node = document.createElement("span");
    node.className = `mini-node ${position}`;
    preview.append(node);
  }

  const copy = document.createElement("div");
  copy.className = "map-card-copy";
  const title = document.createElement("strong");
  title.textContent = map.title;
  title.title = map.title;
  const meta = document.createElement("div");
  meta.className = "map-card-meta";
  const updated = document.createElement("span");
  updated.textContent = relativeDate(map.updatedAt);
  const number = document.createElement("span");
  number.textContent = `MAP / ${String(index + 1).padStart(2, "0")}`;
  meta.append(updated, number);
  copy.append(title, meta);
  card.append(preview, copy);
  return card;
}

function initMapGrid() {
  const grid = document.querySelector("[data-map-grid]");
  if (!grid) return;
  const search = document.querySelector("[data-map-search]");
  const sort = document.querySelector("[data-map-sort]");
  const empty = document.querySelector("[data-library-empty]");
  const visibleCount = document.querySelector("[data-visible-count]");
  const limit = Number(grid.dataset.limit) || Infinity;

  const render = () => {
    const query = search?.value.trim().toLocaleLowerCase("zh-CN") || "";
    const maps = allMaps().filter((map) => map.title.toLocaleLowerCase("zh-CN").includes(query));
    if (sort?.value === "title") maps.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    else maps.sort((a, b) => b.updatedAt - a.updatedAt);
    grid.replaceChildren(...maps.slice(0, limit).map(createMapCard));
    if (visibleCount) visibleCount.textContent = String(maps.length);
    if (empty) empty.hidden = maps.length !== 0;
  };

  search?.addEventListener("input", render);
  sort?.addEventListener("change", render);
  render();
}

function initShell() {
  if (!document.body.classList.contains("app-page")) return;
  const menu = document.querySelector("[data-sidebar-open]");
  const scrim = document.querySelector("[data-sidebar-close]");
  const collapse = document.querySelector("[data-sidebar-collapse]");
  initRecentMaps();
  try {
    document.body.classList.toggle("sidebar-collapsed", localStorage.getItem(collapsedKey) === "true");
  } catch (error) {
    console.warn("无法读取导航宽度偏好。", error);
  }
  const closeMenu = () => {
    document.body.classList.remove("nav-open");
    menu?.setAttribute("aria-expanded", "false");
  };
  menu?.addEventListener("click", () => {
    const open = document.body.classList.toggle("nav-open");
    menu.setAttribute("aria-expanded", String(open));
  });
  scrim?.addEventListener("click", closeMenu);
  collapse?.addEventListener("click", () => {
    const collapsed = document.body.classList.toggle("sidebar-collapsed");
    collapse.textContent = collapsed ? "⇥" : "⇤";
    collapse.setAttribute("aria-label", collapsed ? "展开导航" : "收起导航");
    collapse.title = collapsed ? "展开导航" : "收起导航";
    try { localStorage.setItem(collapsedKey, String(collapsed)); }
    catch (error) { console.warn("无法记住导航宽度。", error); }
  });
  if (document.body.classList.contains("sidebar-collapsed") && collapse) {
    collapse.textContent = "⇥";
    collapse.setAttribute("aria-label", "展开导航");
    collapse.title = "展开导航";
  }
  document.querySelectorAll("[data-map-count]").forEach((el) => {
    el.textContent = String(allMaps().length);
  });
  const search = document.querySelector("[data-map-search]");
  const focusSearch = () => {
    if (location.hash === "#search") search?.focus();
  };
  if (search) {
    window.addEventListener("hashchange", focusSearch);
    focusSearch();
    document.querySelector(".topbar-search")?.addEventListener("click", () => search.focus());
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
    if (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (search) search.focus();
      else location.href = "./library.html#search";
      return;
    }
    const editing = event.target instanceof HTMLElement &&
      (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName));
    if (editing) return;
    if (event.key.toLowerCase() === "n" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      location.href = "./create.html";
    }
  });
}

function initWorkspaceStart() {
  const form = document.querySelector("[data-start-ai]");
  if (!form) return;
  const textarea = form.querySelector("textarea");
  document.querySelectorAll("[data-prompt-fill]").forEach((button) => {
    button.addEventListener("click", () => {
      textarea.value = button.dataset.promptFill || "";
      textarea.focus();
    });
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const prompt = textarea.value.trim();
    if (!prompt) return;
    try { sessionStorage.setItem(promptKey, prompt); }
    catch (error) {
      console.warn("无法暂存原型对话输入。", error);
      showPrototypeError("无法暂存对话输入。请检查浏览器存储空间后重试；当前文字仍保留在输入框中。");
      return;
    }
    location.href = "./create.html?mode=ai&seed=1";
  });
}

function deriveTitle(prompt, fallback) {
  const firstLine = prompt.trim().split(/[\n。！？!?]/)[0].replace(/^(请|帮我|我想|帮忙)\s*/, "").trim();
  if (!firstLine) return fallback;
  return firstLine.length > 18 ? `${firstLine.slice(0, 18)}…` : firstLine;
}

function appendMessage(container, speaker, message, kind) {
  const bubble = document.createElement("div");
  bubble.className = `chat-message ${kind}`;
  const name = document.createElement("span");
  name.className = "speaker";
  name.textContent = speaker;
  const paragraph = document.createElement("p");
  paragraph.textContent = message;
  bubble.append(name, paragraph);
  container.append(bubble);
  bubble.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function parseOutline(raw) {
  const lines = raw.split(/\r?\n/).map((source) => {
    const line = source.replace(/\t/g, "  ");
    const heading = /^(\s*)(#{1,6})\s+(.+)$/.exec(line);
    const bullet = /^(\s*)(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
    return {
      text: (heading?.[3] ?? bullet?.[2] ?? line.trim()).trim(),
      indent: (heading?.[1] ?? bullet?.[1] ?? /^\s*/.exec(line)?.[0] ?? "").length,
      heading: heading?.[2].length ?? 0,
      bullet: !!bullet,
    };
  }).filter((line) => line.text);
  if (!lines.length) return { title: "", branches: [], tree: null, count: 0 };

  const listOnly = lines[0].bullet;
  const tree = { text: listOnly ? "未命名导图" : lines[0].text, children: [] };
  const rootHeading = lines[0].heading || 1;
  const stack = [{ level: 0, node: tree }];
  let activeHeadingLevel = 0;
  for (const line of lines.slice(listOnly ? 0 : 1)) {
    let level;
    if (line.heading) {
      level = Math.max(1, line.heading - rootHeading);
      activeHeadingLevel = level;
    } else if (line.bullet) {
      level = activeHeadingLevel + 1 + Math.floor(line.indent / 2);
    } else {
      level = activeHeadingLevel + Math.max(1, Math.floor(line.indent / 2));
    }
    level = Math.min(level, stack[stack.length - 1].level + 1);
    while (stack[stack.length - 1].level >= level) stack.pop();
    const node = { text: line.text, children: [] };
    stack[stack.length - 1].node.children.push(node);
    stack.push({ level, node });
  }
  return {
    title: tree.text,
    branches: tree.children.map((node) => node.text),
    tree,
    count: countOutlineNodes(tree),
  };
}

function countOutlineNodes(node) {
  return 1 + node.children.reduce((sum, child) => sum + countOutlineNodes(child), 0);
}

function renderOutlineList(nodes) {
  const list = document.createElement("ul");
  for (const node of nodes) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = node.text;
    item.append(label);
    if (node.children.length) item.append(renderOutlineList(node.children));
    list.append(item);
  }
  return list;
}

function initCreate() {
  if (!document.body.classList.contains("create-page")) return;
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") === "outline" ? "outline" : "ai";
  document.querySelectorAll("[data-create-panel]").forEach((panel) => { panel.hidden = panel.dataset.createPanel !== mode; });
  document.querySelectorAll("[data-create-tab]").forEach((tab) => {
    if (tab.dataset.createTab === mode) tab.setAttribute("aria-current", "page");
  });
  document.querySelectorAll("[data-nav-create]").forEach((link) => {
    if (link.dataset.navCreate === mode) link.setAttribute("aria-current", "page");
  });

  const prompt = document.querySelector("[data-ai-prompt]");
  if (mode === "ai" && params.get("seed") === "1" && prompt) {
    try {
      const saved = sessionStorage.getItem(promptKey);
      if (saved?.trim()) {
        prompt.textContent = saved.trim();
        document.querySelector("[data-ai-prompt-label]").textContent = "YOU / YOUR INPUT";
        document.querySelector("[data-draft-root]").textContent = deriveTitle(saved, "新建导图");
      }
      sessionStorage.removeItem(promptKey);
    } catch (error) {
      console.warn("无法读取原型对话输入。", error);
    }
  }

  const messages = document.querySelector("[data-chat-messages]");
  if (messages) messages.scrollTop = messages.scrollHeight;
  const compose = document.querySelector("[data-chat-compose]");
  compose?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = compose.querySelector("textarea");
    const message = input.value.trim();
    if (!message) return;
    appendMessage(messages, "YOU / FOLLOW-UP", message, "user");
    appendMessage(messages, "LOOMIND / DEMO", "已收到你的补充。当前是界面原型，右侧展示建议骨架；进入正式应用后，AI 会根据你的内容继续调整结构。", "assistant");
    input.value = "";
  });
  document.querySelector("[data-generate-ai]")?.addEventListener("click", () => {
    const title = document.querySelector("[data-draft-root]").textContent.trim();
    const branches = [...document.querySelectorAll(".draft-tree li")].map((item) => item.textContent.trim());
    const template = document.querySelector("[data-ai-template]").value;
    saveCreatedMap(title, branches, template);
  });

  const outlineInput = document.querySelector("[data-outline-input]");
  const outlinePreview = document.querySelector("[data-outline-preview]");
  const outlineGenerate = document.querySelector("[data-generate-outline]");
  const renderOutline = () => {
    if (!outlineInput || !outlinePreview || !outlineGenerate) return;
    const parsed = parseOutline(outlineInput.value);
    const title = document.createElement("strong");
    title.textContent = parsed.title || "等待输入大纲";
    const list = renderOutlineList(parsed.tree?.children || []);
    outlinePreview.replaceChildren(title, list);
    const count = document.querySelector("[data-outline-count]");
    if (count) count.textContent = `${parsed.count} 个节点`;
    outlineGenerate.disabled = !parsed.title || parsed.branches.length === 0;
  };
  outlineInput?.addEventListener("input", renderOutline);
  renderOutline();
  outlineGenerate?.addEventListener("click", () => {
    const parsed = parseOutline(outlineInput.value);
    if (!parsed.title || !parsed.branches.length) return;
    const template = document.querySelector('input[name="outline-template"]:checked')?.value || "blank-organic";
    saveCreatedMap(parsed.title, parsed.branches, template, parsed.tree);
  });
}

function initEditor() {
  if (!document.body.classList.contains("editor-page")) return;
  const id = new URLSearchParams(location.search).get("map") || "product";
  const map = allMaps().find((item) => item.id === id);
  if (!map) {
    document.querySelectorAll("[data-map-title]").forEach((el) => { el.textContent = "导图不存在"; });
    const empty = document.createElement("div");
    empty.className = "editor-not-found";
    const title = document.createElement("h1");
    title.textContent = "找不到这张导图";
    const description = document.createElement("p");
    description.textContent = "这张原型导图可能已从当前浏览器会话中移除。";
    const back = document.createElement("a");
    back.className = "button button-primary";
    back.href = "./library.html";
    back.textContent = "返回全部导图";
    empty.append(title, description, back);
    document.querySelector(".app-editor-main").replaceChildren(empty);
    document.title = "导图不存在 — Loomind";
    return;
  }
  const templates = {
    "blank-organic": { name: "自由导图", paths: [
      "M425 250 C330 250 320 150 215 150", "M425 250 C330 250 320 350 215 350",
      "M575 250 C670 250 680 150 785 150", "M575 250 C670 250 680 350 785 350",
    ] },
    "quarterly-okr": { name: "逻辑树", paths: [
      "M230 250 C460 250 480 80 680 80", "M230 250 C460 250 480 190 680 190",
      "M230 250 C460 250 480 310 680 310", "M230 250 C460 250 480 420 680 420",
    ] },
    "annual-roadmap": { name: "时间轴", paths: [
      "M500 135 C500 270 120 270 120 335", "M500 135 C500 270 375 270 375 335",
      "M500 135 C500 270 625 270 625 335", "M500 135 C500 270 880 270 880 335",
    ] },
    "root-cause-fishbone": { name: "鱼骨图", paths: [
      "M250 250 L250 150", "M450 250 L450 150",
      "M250 250 L250 350", "M450 250 L450 350",
    ] },
  };
  const templateId = Object.hasOwn(templates, map.template) ? map.template : "blank-organic";
  const template = templates[templateId];
  const outline = map.outline?.children ? map.outline : {
    text: map.title,
    children: map.branches.map((text) => ({ text, children: [] })),
  };
  document.querySelectorAll("[data-map-title]").forEach((el) => { el.textContent = map.title; });
  document.querySelector("[data-template-name]").textContent = template.name;
  document.querySelectorAll("[data-map-branch]").forEach((el) => {
    const branch = map.branches[Number(el.dataset.mapBranch)];
    el.parentElement.hidden = !branch;
    if (branch) el.textContent = branch;
  });
  const canvas = document.querySelector(".workspace-map");
  canvas.dataset.layout = templateId;
  const visibleBranches = Math.min(map.branches.length, 4);
  const branches = template.paths.slice(0, visibleBranches).join(" ");
  canvas.querySelector(".canvas-lines path").setAttribute("d", templateId === "root-cause-fishbone" ? `M765 250 H130 ${branches}` : branches);
  const count = countOutlineNodes(outline);
  const more = map.branches.length > 4 ? `画布显示前 4 个一级分支；切换大纲查看全部 ${count} 个节点。` : `切换到大纲查看完整层级（${count} 个节点）`;
  document.querySelector("[data-canvas-note]").textContent = more;
  document.querySelector("[data-outline-summary]").textContent = `${count} 个节点 · ${map.branches.length} 个一级分支 · ${template.name}布局`;
  const tree = document.querySelector("[data-editor-outline-tree]");
  const root = document.createElement("strong");
  root.textContent = outline.text;
  tree.replaceChildren(root, renderOutlineList(outline.children));
  document.querySelectorAll("[data-editor-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.editorView;
      document.querySelectorAll("[data-editor-view]").forEach((item) => {
        item.setAttribute("aria-pressed", String(item.dataset.editorView === view));
      });
      document.querySelectorAll("[data-editor-panel]").forEach((panel) => { panel.hidden = panel.dataset.editorPanel !== view; });
      document.querySelector("[data-editor-mode-label]").textContent = view === "canvas" ? "◇ 画布 01" : "≡ 完整大纲";
      document.querySelector("[data-editor-bottom-detail]").textContent = view === "canvas" ? "CANVAS / PROTOTYPE PREVIEW" : "OUTLINE / PROTOTYPE PREVIEW";
    });
  });
  document.title = `${map.title} — Loomind`;
}

document.addEventListener("DOMContentLoaded", () => {
  initShell();
  initMapGrid();
  initWorkspaceStart();
  initCreate();
  initEditor();
});
