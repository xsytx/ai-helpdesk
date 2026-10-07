// The Threads-app-style home feed: every thread, tagged rather than
// filed under a category/board (there are none), paged via a "Load
// more" button. New/Top/Most-commented come from the API; "Saved" is a
// purely client-side bookmark list (localStorage) — there's no
// server-side saved-posts feature, so it never leaves this browser.
const Bookmarks = {
  KEY: "cf_bookmarks",
  getAll() {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || {}; }
    catch (_) { return {}; }
  },
  has(id) { return !!this.getAll()[id]; },
  toggle(thread) {
    const all = this.getAll();
    if (all[thread.id]) delete all[thread.id];
    else all[thread.id] = thread;
    try { localStorage.setItem(this.KEY, JSON.stringify(all)); } catch (_) { /* storage full/blocked */ }
    return !!all[thread.id];
  },
  list() {
    return Object.values(this.getAll()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },
};

const validSorts = ["new", "top", "comments", "saved"];
let currentSort = validSorts.includes(qs("sort")) ? qs("sort") : "new";
let currentPage = 1;
const pageSize = 20;
let loading = false;
let hasMore = true;

function showError(msg) {
  const errBox = document.getElementById("error");
  errBox.textContent = msg;
  errBox.classList.remove("hidden");
}

// A lightweight, transparent heuristic (not a real trending algorithm) —
// just enough to surface a badge on posts that are clearly getting traction.
function isTrending(t) {
  return t.score >= 5 || t.comment_count >= 5;
}

function tagPills(tags) {
  if (!tags || tags.length === 0) return "";
  return `<div class="pill-row" style="margin-top:6px;">${tags.map(t => `<a class="pill" href="search.html?tag=${encodeURIComponent(t)}">#${escapeHtml(t)}</a>`).join("")}</div>`;
}

function renderFeedPost(t) {
  const saved = Bookmarks.has(t.id);
  const snippet = t.body.length > 220 ? t.body.slice(0, 220) + "…" : t.body;
  return `
    <div class="feed-post" data-id="${t.id}">
      <div class="vote-col" data-target="thread" data-id="${t.id}">
        <button class="vote-btn" data-value="1" title="Upvote">▲</button>
        <span class="score" data-score>${t.score}</span>
        <button class="vote-btn" data-value="-1" title="Downvote">▼</button>
      </div>
      <div class="content">
        <div class="post-meta">
          ${avatarHTML(t.user_id, t.author_name, "sm")}
          <strong>${escapeHtml(t.author_name)}</strong>
          <span>${timeAgo(t.created_at)}</span>
          ${isTrending(t) ? `<span class="trending-badge">📈 Trending</span>` : ""}
        </div>
        <a class="post-title" href="thread.html?id=${t.id}">${escapeHtml(t.title)}</a>
        <p class="post-snippet">${escapeHtml(snippet)}</p>
        ${tagPills(t.tags)}
        <div class="post-footer">
          <a href="thread.html?id=${t.id}">💬 ${t.comment_count}</a>
          <button data-action="share" data-id="${t.id}">↗ Share</button>
          <button data-action="bookmark" data-id="${t.id}" class="${saved ? "bookmarked" : ""}">${saved ? "🔖 Saved" : "🔖 Save"}</button>
        </div>
      </div>
    </div>
  `;
}

function attachFeedHandlers(scope) {
  scope.querySelectorAll(".vote-col").forEach(col => {
    col.querySelectorAll(".vote-btn").forEach(btn => {
      btn.addEventListener("click", () => castVote(col, parseInt(btn.dataset.value, 10)));
    });
  });
  scope.querySelectorAll('[data-action="share"]').forEach(btn => {
    btn.addEventListener("click", () => shareThread(parseInt(btn.dataset.id, 10)));
  });
  scope.querySelectorAll('[data-action="bookmark"]').forEach(btn => {
    btn.addEventListener("click", () => toggleBookmark(parseInt(btn.dataset.id, 10), btn));
  });
}

async function castVote(col, value) {
  if (!Session.isLoggedIn()) {
    window.location.href = "login.html";
    return;
  }
  const id = col.dataset.id;
  try {
    const res = await api(`/api/threads/${id}/vote`, { method: "POST", body: JSON.stringify({ value }) });
    col.querySelector("[data-score]").textContent = res.score;
  } catch (e) {
    showError(e.message);
  }
}

async function shareThread(id) {
  const url = `${window.location.origin}/thread.html?id=${id}`;
  try {
    if (navigator.share) {
      await navigator.share({ url });
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      alert("Link copied to clipboard.");
    }
  } catch (e) {
    // User cancelled the share sheet, or clipboard was denied — not an error worth surfacing.
  }
}

function toggleBookmark(id, btn) {
  const card = btn.closest(".feed-post");
  const thread = feedItemsById[id];
  if (!thread) return;
  const saved = Bookmarks.toggle(thread);
  btn.textContent = saved ? "🔖 Saved" : "🔖 Save";
  btn.classList.toggle("bookmarked", saved);
  if (currentSort === "saved" && !saved) card.remove();
}

let feedItemsById = {};

function renderSavedTab() {
  const list = Bookmarks.list();
  document.getElementById("load-more-btn").classList.add("hidden");
  const container = document.getElementById("feed");
  const empty = document.getElementById("feed-empty");
  if (list.length === 0) {
    container.innerHTML = "";
    empty.textContent = "No saved discussions yet — click 🔖 Save on any post.";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  list.forEach(t => { feedItemsById[t.id] = t; });
  container.innerHTML = list.map(renderFeedPost).join("");
  attachFeedHandlers(container);
}

function resetFeed() {
  currentPage = 1;
  hasMore = true;
  document.getElementById("feed").innerHTML = "";
  document.getElementById("feed-empty").classList.add("hidden");
}

async function loadMore() {
  if (currentSort === "saved") { renderSavedTab(); return; }
  if (loading || !hasMore) return;
  loading = true;
  const btn = document.getElementById("load-more-btn");
  btn.disabled = true;
  btn.textContent = "Loading…";
  try {
    const res = await api(`/api/feed?sort=${currentSort}&page=${currentPage}&page_size=${pageSize}`);
    const container = document.getElementById("feed");
    if (res.threads.length === 0 && currentPage === 1) {
      document.getElementById("feed-empty").textContent = "No threads yet — be the first to post.";
      document.getElementById("feed-empty").classList.remove("hidden");
    } else {
      res.threads.forEach(t => { feedItemsById[t.id] = t; });
      container.insertAdjacentHTML("beforeend", res.threads.map(renderFeedPost).join(""));
      attachFeedHandlers(container);
    }
    const loadedSoFar = (currentPage - 1) * pageSize + res.threads.length;
    hasMore = loadedSoFar < res.total;
    btn.classList.toggle("hidden", !hasMore);
    currentPage += 1;
  } catch (e) {
    showError(e.message);
    hasMore = false;
  } finally {
    loading = false;
    btn.disabled = false;
    btn.textContent = "Load more discussions";
  }
}

function setupSortTabs() {
  document.querySelectorAll(".sort-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.sort === currentSort);
    btn.addEventListener("click", () => {
      if (btn.dataset.sort === currentSort) return;
      currentSort = btn.dataset.sort;
      const url = new URL(window.location.href);
      url.searchParams.set("sort", currentSort);
      history.replaceState(null, "", url);
      document.querySelectorAll(".sort-tab").forEach(b => b.classList.toggle("active", b === btn));
      resetFeed();
      loadMore();
    });
  });
}

function renderWelcomeBanner() {
  const user = Session.getUser();
  const el = document.getElementById("welcome-banner");
  if (user) {
    el.innerHTML = `
      <div class="welcome-banner">
        <span class="badge">👋 Welcome back, ${escapeHtml(user.display_name)}</span>
        <h1>What's happening on campus?</h1>
        <p>Join the conversation, find your people, and stay in the loop with everything happening around you.</p>
      </div>
    `;
  } else {
    el.innerHTML = `
      <div class="welcome-banner">
        <span class="badge">🧵 SDU Threads</span>
        <h1>What's happening on campus?</h1>
        <p>Post and comment freely — <a href="register.html" style="color:white;">sign up</a> to vote and follow discussions.</p>
      </div>
    `;
  }
}

async function renderTrendingTags() {
  try {
    const tags = await api("/api/tags/trending?limit=10");
    const html = tags.map(t => `<a class="pill" href="search.html?tag=${encodeURIComponent(t.name)}">#${escapeHtml(t.name)}</a>`).join("")
      || `<p class="muted">No tags yet — be the first to tag a post.</p>`;
    document.getElementById("trending-tags").innerHTML = html;
  } catch (e) {
    document.getElementById("trending-tags").innerHTML = "";
  }
}

async function renderStats() {
  const container = document.getElementById("stats-grid");
  try {
    const st = await api("/api/stats");
    container.innerHTML = `
      <div class="stat-tile"><div class="num">${st.users}</div><div class="label">Students</div></div>
      <div class="stat-tile"><div class="num">${st.threads}</div><div class="label">Posts</div></div>
      <div class="stat-tile"><div class="num">${st.tags}</div><div class="label">Tags</div></div>
      <div class="stat-tile"><div class="num">${st.comments}</div><div class="label">Comments</div></div>
    `;
  } catch (e) {
    container.innerHTML = "";
  }
}

function setupComposer() {
  // Posting doesn't require an account right now (anonymous posting —
  // see CreateThread on the backend); auth is coming back later, at
  // which point this composer should go back to gating on Session again.
  const form = document.getElementById("composer-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    document.getElementById("error").classList.add("hidden");
    const title = document.getElementById("composer-title").value.trim();
    const body = document.getElementById("composer-body").value.trim();
    const tags = document.getElementById("composer-tags").value.split(",").map(s => s.trim()).filter(Boolean);
    const btn = form.querySelector("button");
    btn.disabled = true;
    try {
      const thread = await api(`/api/threads`, {
        method: "POST",
        body: JSON.stringify({ title, body, tags }),
      });
      window.location.href = `thread.html?id=${thread.id}`;
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  if (window.location.hash === "#compose") {
    card.scrollIntoView({ behavior: "smooth" });
    document.getElementById("composer-title").focus();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  renderWelcomeBanner();
  renderStats();
  renderTrendingTags();
  setupSortTabs();
  document.getElementById("load-more-btn").addEventListener("click", loadMore);
  setupComposer();
  loadMore();
});
