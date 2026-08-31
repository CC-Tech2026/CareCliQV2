(function () {
  var KEY = "carecliq-theme";
  var LEGACY = "cc-theme";
  var mode = "system";
  try {
    var stored = localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      mode = stored;
    } else {
      var legacy = localStorage.getItem(LEGACY);
      if (legacy === "light" || legacy === "dark") {
        mode = legacy;
        localStorage.setItem(KEY, legacy);
      }
      localStorage.removeItem(LEGACY);
    }
  } catch (e) {}
  var isDark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  var root = document.documentElement;
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
})();
