// Small fetch wrapper + auth/session helpers shared by every page.
const API_BASE = ""; // same origin as the served frontend

const Session = {
  getToken() { return localStorage.getItem("cf_token"); },
  getUser() {
    const raw = localStorage.getItem("cf_user");
    return raw ? JSON.parse(raw) : null;
  },
  set(token, user) {
    localStorage.setItem("cf_token", token);
    localStorage.setItem("cf_user", JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem("cf_token");
    localStorage.removeItem("cf_user");
  },
  isLoggedIn() { return !!Session.getToken(); },
  isModerator() {
    const u = Session.getUser();
    return !!u && (u.role === "moderator" || u.role === "admin");
  },
};

async function api(path, options = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
  const token = Session.getToken();
  if (token) headers["Authorization"] = "Bearer " + token;

  const res = await fetch(API_BASE + path, Object.assign({}, options, { headers }));
  let body = null;
  const text = await res.text();
  if (text) {
    try { body = JSON.parse(text); } catch (_) { body = text; }
  }
  if (!res.ok) {
    const msg = (body && body.error) ? body.error : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

function authorLink(userId, name) {
  return `<a href="profile.html?id=${userId}" style="text-decoration:none;color:inherit;font-weight:600;">${escapeHtml(name)}</a>`;
}

// Deterministic pastel-on-slate initials avatar for a user, since there's
// no avatar upload in this MVP. Same id always gets the same color.
const AVATAR_COLORS = ["#55697c", "#8a6a4f", "#4f7a5b", "#7a4f6c", "#4f6d7a", "#7a5b4f", "#5c4f7a", "#6a7a4f"];
function avatarInitials(name) {
  return (name || "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
}
function avatarHTML(userId, name, extraClass = "") {
  let h = 0;
  const s = String(userId);
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  const color = AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
  return `<span class="avatar ${extraClass}" style="background:${color}">${escapeHtml(avatarInitials(name))}</span>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function timeAgo(iso) {
  const d = new Date(iso);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// Primary nav row (Home/FAQ), inserted between the brand and the
// auth-status area on every page via api.js so it's never duplicated
// per-page. There are no boards/categories to browse anymore — tags are
// the only organizing structure, and search (including tag search — see
// renderSearchBox) covers discovering them.
function renderNavLinks() {
  const header = document.querySelector("header.site");
  const nav = document.getElementById("site-nav");
  if (!header || !nav) return;
  const here = window.location.pathname.split("/").pop() || "index.html";
  const div = document.createElement("div");
  div.className = "nav-links";
  div.innerHTML = `
    <a href="index.html" class="${here === "index.html" || here === "" ? "active" : ""}">Home</a>
    <a href="faq.html" class="${here === "faq.html" ? "active" : ""}">FAQ</a>
  `;
  header.insertBefore(div, nav);
}

// Renders the shared header nav (auth status + account actions) on every
// page. Call after DOM is ready.
function renderNav() {
  const nav = document.getElementById("site-nav");
  if (!nav) return;
  const user = Session.getUser();
  if (user) {
    nav.innerHTML = `
      ${Session.isModerator() ? `<a href="admin.html">Admin</a>` : ""}
      <a class="btn-new-post" href="index.html#compose">+ New post</a>
      <a href="profile.html?id=${user.id}" title="${escapeHtml(user.display_name)}">${avatarHTML(user.id, user.display_name)}</a>
      <button id="logout-btn">Log out</button>
    `;
    document.getElementById("logout-btn").addEventListener("click", () => {
      Session.clear();
      window.location.href = "index.html";
    });
  } else {
    nav.innerHTML = `
      <a href="login.html">Log in</a>
      <a href="register.html">Sign up</a>
    `;
  }
}

// Injects a search box into the shared header on every page, so search
// is reachable from anywhere without duplicating markup per-page.
function renderSearchBox() {
  const header = document.querySelector("header.site");
  const nav = document.getElementById("site-nav");
  if (!header || !nav) return;
  const form = document.createElement("form");
  form.className = "site-search";
  form.innerHTML = `<input type="search" name="q" placeholder="Search discussions…" aria-label="Search threads" />`;
  const params = new URLSearchParams(window.location.search);
  if (window.location.pathname.endsWith("search.html")) {
    if (params.get("tag")) form.querySelector("input").value = "#" + params.get("tag");
    else if (params.get("q")) form.querySelector("input").value = params.get("q");
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = form.querySelector("input").value.trim();
    if (!q) return;
    // "#tag" jumps straight to that tag's threads instead of a full-text
    // search for the literal string "#tag" (which usually finds nothing).
    if (q.startsWith("#") && q.length > 1) {
      window.location.href = `search.html?tag=${encodeURIComponent(q.slice(1))}`;
    } else {
      window.location.href = `search.html?q=${encodeURIComponent(q)}`;
    }
  });
  header.insertBefore(form, nav);
}

// Shows an unread-count badge on a bell link in the header, for logged-in
// users. Fetches once per page load (no polling/websockets in this MVP),
// using the lightweight count endpoint rather than pulling a full page
// of notifications just to read the badge number.
async function renderNotificationsBell() {
  if (!Session.isLoggedIn()) return;
  const nav = document.getElementById("site-nav");
  if (!nav) return;
  try {
    const res = await api("/api/notifications/unread-count");
    const bell = document.createElement("a");
    bell.href = "notifications.html";
    bell.className = "notif-bell";
    bell.innerHTML = res.unread > 0
      ? `🔔 <span class="notif-badge">${res.unread}</span>`
      : `🔔`;
    nav.insertBefore(bell, nav.firstChild);
  } catch (e) {
    // Non-fatal: the rest of the page still works without the bell.
  }
}

document.addEventListener("DOMContentLoaded", renderNav);
document.addEventListener("DOMContentLoaded", renderNavLinks);
document.addEventListener("DOMContentLoaded", renderSearchBox);
document.addEventListener("DOMContentLoaded", renderNotificationsBell);
