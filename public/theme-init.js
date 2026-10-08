// Applies the saved theme before first paint (kept external so the CSP can forbid inline scripts).
try {
  var t = localStorage.getItem("fintrack-theme");
  if (t === "dark" || (!t && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.documentElement.classList.add("dark");
  }
} catch (e) { /* storage unavailable */ }
