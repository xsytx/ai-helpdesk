// Theme before the first paint, so a dark page never flashes white (see
// src/shared/lib/theme.ts). A file rather than an inline <script>, so the
// Content-Security-Policy (nginx-security-headers.conf) can forbid inline scripts.
(function () {
  var choice = null;
  try { choice = localStorage.getItem("ai_helpdesk_theme"); } catch (e) {}
  var dark = choice === "dark" || (choice !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
