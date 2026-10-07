let currentQuery = qs("q") || "";
let currentTag = qs("tag") || "";
let currentPage = parseInt(qs("page"), 10) > 0 ? parseInt(qs("page"), 10) : 1;
const pageSize = 20;

function syncUrl() {
  const url = new URL(window.location.href);
  if (currentTag) {
    url.searchParams.set("tag", currentTag);
    url.searchParams.delete("q");
  } else {
    url.searchParams.set("q", currentQuery);
    url.searchParams.delete("tag");
  }
  url.searchParams.set("page", currentPage);
  history.replaceState(null, "", url);
}

// Capped at 8 — a short, scannable shortcut list, not an attempt to
// surface every tag that exists (that's what typing "#tag" is for).
const BROWSE_TAGS_LIMIT = 8;

async function renderBrowseTags() {
  const card = document.getElementById("browse-tags-card");
  try {
    const tags = await api(`/api/tags/trending?limit=${BROWSE_TAGS_LIMIT}`);
    if (tags.length === 0) return;
    card.classList.remove("hidden");
    document.getElementById("browse-tags").innerHTML = tags.map(t => `
      <a class="pill${t.name === currentTag ? " active-pill" : ""}" href="search.html?tag=${encodeURIComponent(t.name)}">#${escapeHtml(t.name)}</a>
    `).join("");
  } catch (e) {
    // Non-fatal: search still works without the browse-by-tag shortcut.
  }
}

function renderResults(threads) {
  const container = document.getElementById("results");
  if (threads.length === 0) {
    container.innerHTML = `<p class="muted">No threads matched “${escapeHtml(currentTag ? "#" + currentTag : currentQuery)}”.</p>`;
    return;
  }
  container.innerHTML = threads.map(t => `
    <div class="card">
      <a class="title" href="thread.html?id=${t.id}">${escapeHtml(t.title)}</a>
      <div class="card-meta">
        ${authorLink(t.user_id, t.author_name)} · ${timeAgo(t.created_at)} ·
        ▲ ${t.score} · 💬 ${t.comment_count}
      </div>
    </div>
  `).join("");
}

function renderPager(page, pageSize, total) {
  const pager = document.getElementById("pager");
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) {
    pager.classList.add("hidden");
    return;
  }
  pager.classList.remove("hidden");
  document.getElementById("pager-info").textContent = `Page ${page} of ${totalPages}`;
  document.getElementById("pager-prev").disabled = page <= 1;
  document.getElementById("pager-next").disabled = page >= totalPages;
}

async function runSearch() {
  const errBox = document.getElementById("error");
  errBox.classList.add("hidden");
  if (currentTag) {
    document.getElementById("search-heading").textContent = `Threads tagged #${currentTag}`;
  } else {
    document.getElementById("search-heading").textContent = currentQuery
      ? `Search results for “${currentQuery}”`
      : "Search";
  }
  if (!currentTag && !currentQuery) {
    document.getElementById("results").innerHTML = `<p class="muted">Type something in the search box above.</p>`;
    document.getElementById("pager").classList.add("hidden");
    return;
  }
  try {
    const url = currentTag
      ? `/api/tags/${encodeURIComponent(currentTag)}/threads?page=${currentPage}&page_size=${pageSize}`
      : `/api/search?q=${encodeURIComponent(currentQuery)}&page=${currentPage}&page_size=${pageSize}`;
    const res = await api(url);
    renderResults(res.threads);
    renderPager(res.page, res.page_size, res.total);
  } catch (e) {
    errBox.textContent = e.message;
    errBox.classList.remove("hidden");
  }
}

function setupPager() {
  document.getElementById("pager-prev").addEventListener("click", () => {
    if (currentPage <= 1) return;
    currentPage -= 1;
    syncUrl();
    runSearch();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.getElementById("pager-next").addEventListener("click", () => {
    currentPage += 1;
    syncUrl();
    runSearch();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  setupPager();
  await renderBrowseTags();
  await runSearch();
});
