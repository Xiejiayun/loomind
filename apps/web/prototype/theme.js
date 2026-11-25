const themeKey = "loomind-prototype-theme";
const root = document.documentElement;

try {
  root.dataset.theme = localStorage.getItem(themeKey) || "dark";
} catch (error) {
  console.warn("无法读取主题偏好，已使用深色主题。", error);
  root.dataset.theme = "dark";
}

document.addEventListener("DOMContentLoaded", () => {
  const update = () => {
    const dark = root.dataset.theme === "dark";
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.textContent = dark ? "☀" : "☾";
      button.setAttribute("aria-label", dark ? "切换到亮色模式" : "切换到深色模式");
      button.setAttribute("title", dark ? "切换到亮色模式" : "切换到深色模式");
      button.setAttribute("aria-pressed", String(dark));
    });
  };

  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
      try { localStorage.setItem(themeKey, root.dataset.theme); }
      catch (error) { console.warn("无法记住主题选择。", error); }
      update();
    });
  });
  update();
});
