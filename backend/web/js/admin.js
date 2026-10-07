const validStatuses = ["open", "resolved"];
let currentStatus = validStatuses.includes(qs("status")) ? qs("status") : "open";
let currentPage = parseInt(qs("page"), 10) > 0 ? parseInt(qs("page"), 10) : 1;
const pageSize = 20;

function showError(msg) {
  const errBox = document.getElementById("error");
  errBox.textContent = msg;
  errBox.classList.remove("hidden");
}

function syncUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("status", currentStatus);
  url.searchParams.set("page", currentPage);
  history.replaceState(null, "", url);
}

function renderReports(reports) {
  const container = document.getElementById("report-list");
  if (reports.length === 0) {
    container.innerHTML = `<p class="muted">Nothing here.</p>`;
    return;
  }
  container.innerHTML = reports.map(r => `
    <div class="card" data-id="${r.id}">
      <div class="card-meta">
        ${r.target_type === "thread" ? "🧵 Thread" : "💬 Comment"} reported by ${escapeHtml(r.reporter_name)} · ${timeAgo(r.created_at)}
      </div>
      <div class="comment-body">${escapeHtml(r.preview)}</div>
      ${r.reason ? `<div class="card-meta">Reason: “${escapeHtml(r.reason)}”</div>` : ""}
      <div class="post-actions">
        ${r.thread_id ? `<a class="link-btn" href="thread.html?id=${r.thread_id}">View thread</a>` : ""}
        ${r.status === "open" ? `<button class="link-btn" data-action="resolve" data-id="${r.id}">Mark resolved</button>` : `<span class="muted">Resolved</span>`}
      </div>
    </div>
  `).join("");
  container.querySelectorAll('[data-action="resolve"]').forEach(btn => {
    btn.addEventListener("click", () => resolveReport(btn.dataset.id));
  });
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

async function loadReports() {
  try {
    const res = await api(`/api/reports?status=${currentStatus}&page=${currentPage}&page_size=${pageSize}`);
    renderReports(res.reports);
    renderPager(res.page, res.page_size, res.total);
  } catch (e) {
    showError(e.message);
  }
}

async function resolveReport(id) {
  try {
    await api(`/api/reports/${id}/resolve`, { method: "POST" });
    await loadReports();
  } catch (e) {
    showError(e.message);
  }
}

function setupTabs() {
  document.querySelectorAll(".sort-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.status === currentStatus);
    btn.addEventListener("click", () => {
      if (btn.dataset.status === currentStatus) return;
      currentStatus = btn.dataset.status;
      currentPage = 1;
      syncUrl();
      document.querySelectorAll(".sort-tab").forEach(b => b.classList.toggle("active", b === btn));
      loadReports();
    });
  });
}

function setupPager() {
  document.getElementById("pager-prev").addEventListener("click", () => {
    if (currentPage <= 1) return;
    currentPage -= 1;
    syncUrl();
    loadReports();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.getElementById("pager-next").addEventListener("click", () => {
    currentPage += 1;
    syncUrl();
    loadReports();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function setupBanControls() {
  async function setBanned(banned) {
    const id = document.getElementById("ban-user-id").value.trim();
    if (!id) return;
    try {
      await api(`/api/users/${id}/ban`, { method: "POST", body: JSON.stringify({ banned }) });
      alert(banned ? "User banned." : "User unbanned.");
    } catch (e) {
      showError(e.message);
    }
  }
  document.getElementById("ban-btn").addEventListener("click", () => setBanned(true));
  document.getElementById("unban-btn").addEventListener("click", () => setBanned(false));
}

// --- FAQ management ---

function renderFAQAdmin(faqs) {
  const container = document.getElementById("faq-admin-list");
  if (faqs.length === 0) {
    container.innerHTML = `<p class="muted">No FAQ entries yet.</p>`;
    return;
  }
  container.innerHTML = faqs.map(f => `
    <div class="card" data-id="${f.id}">
      <strong>${escapeHtml(f.question)}</strong>
      <div class="comment-body">${escapeHtml(f.answer)}</div>
      <div class="card-meta">Sort order: ${f.sort_order}</div>
      <div class="post-actions">
        <button class="link-btn" data-action="edit-faq" data-id="${f.id}">Edit</button>
        <button class="link-btn danger" data-action="delete-faq" data-id="${f.id}">Delete</button>
      </div>
    </div>
  `).join("");
  container.querySelectorAll('[data-action="edit-faq"]').forEach(btn => {
    btn.addEventListener("click", () => enterFAQEditMode(parseInt(btn.dataset.id, 10)));
  });
  container.querySelectorAll('[data-action="delete-faq"]').forEach(btn => {
    btn.addEventListener("click", () => deleteFAQ(parseInt(btn.dataset.id, 10)));
  });
}

async function loadFAQAdmin() {
  try {
    currentFAQs = await api("/api/faq");
    renderFAQAdmin(currentFAQs);
  } catch (e) {
    showError(e.message);
  }
}
let currentFAQs = [];

function enterFAQEditMode(id) {
  const f = currentFAQs.find(f => f.id === id);
  if (!f) return;
  const el = document.querySelector(`#faq-admin-list [data-id="${id}"]`);
  el.innerHTML = `
    <form class="stack edit-form faq-edit-form">
      <input type="text" value="${escapeHtml(f.question)}" required maxlength="300" />
      <textarea required>${escapeHtml(f.answer)}</textarea>
      <input type="number" value="${f.sort_order}" />
      <div class="form-actions">
        <button type="submit" class="primary">Save</button>
        <button type="button" class="link-btn cancel-faq-edit">Cancel</button>
      </div>
    </form>
  `;
  el.querySelector(".cancel-faq-edit").addEventListener("click", () => renderFAQAdmin(currentFAQs));
  el.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const inputs = el.querySelectorAll("input, textarea");
    try {
      await api(`/api/faq/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          question: inputs[0].value.trim(),
          answer: inputs[1].value.trim(),
          sort_order: parseInt(inputs[2].value, 10) || 0,
        }),
      });
      await loadFAQAdmin();
    } catch (err) {
      showError(err.message);
    }
  });
}

async function deleteFAQ(id) {
  if (!confirm("Delete this FAQ entry?")) return;
  try {
    await api(`/api/faq/${id}`, { method: "DELETE" });
    await loadFAQAdmin();
  } catch (e) {
    showError(e.message);
  }
}

function setupFAQForm() {
  document.getElementById("faq-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const question = document.getElementById("faq-question").value.trim();
    const answer = document.getElementById("faq-answer").value.trim();
    const sortOrder = parseInt(document.getElementById("faq-sort").value, 10) || 0;
    try {
      await api("/api/faq", {
        method: "POST",
        body: JSON.stringify({ question, answer, sort_order: sortOrder }),
      });
      e.target.reset();
      await loadFAQAdmin();
    } catch (err) {
      showError(err.message);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (!Session.isModerator()) {
    window.location.href = "index.html";
    return;
  }
  setupTabs();
  setupPager();
  setupBanControls();
  setupFAQForm();
  loadReports();
  loadFAQAdmin();
});
