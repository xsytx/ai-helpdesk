const profileUserId = qs("id");
const validTabs = ["threads", "comments"];
let currentTab = validTabs.includes(qs("tab")) ? qs("tab") : "threads";
let currentPage = parseInt(qs("page"), 10) > 0 ? parseInt(qs("page"), 10) : 1;
const pageSize = 20;

function syncUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("id", profileUserId);
  url.searchParams.set("tab", currentTab);
  url.searchParams.set("page", currentPage);
  history.replaceState(null, "", url);
}

function showError(msg) {
  const errBox = document.getElementById("error");
  errBox.textContent = msg;
  errBox.classList.remove("hidden");
}

function isOwnProfile() {
  const u = Session.getUser();
  return !!u && String(u.id) === String(profileUserId);
}

async function loadProfileHeader() {
  const profile = await api(`/api/users/${profileUserId}`);
  document.title = `${profile.display_name} — SDU Threads`;
  const own = isOwnProfile();
  document.getElementById("profile-header").innerHTML = `
    <div style="display:flex; gap:14px; align-items:flex-start;">
      ${avatarHTML(profile.id, profile.display_name)}
      <div style="flex:1;">
        <h1>${escapeHtml(profile.display_name)} ${profile.email_verified ? `<span class="muted" style="font-size:0.6em; font-weight:600; color:#2563eb;" title="Verified @sdu.edu.kz email">✓ Verified</span>` : ""}</h1>
        <div class="card-meta">Member since ${new Date(profile.created_at).toLocaleDateString()}</div>
        ${profile.major ? `<div class="card-meta">🎓 ${escapeHtml(profile.major)}</div>` : ""}
        ${profile.bio ? `<p style="margin:8px 0 0; white-space:pre-wrap;">${escapeHtml(profile.bio)}</p>` : ""}
      </div>
      <div class="post-actions" style="margin-top:0;">
        ${own ? `<button class="link-btn" id="edit-profile-btn">Edit profile</button>` : ""}
      </div>
    </div>
    ${own ? `<div id="edit-profile-form-wrap"></div>` : ""}
  `;
  if (own) {
    document.getElementById("edit-profile-btn").addEventListener("click", () => enterProfileEditMode(profile));
    await maybeShowVerifyBanner();
  }
}

async function maybeShowVerifyBanner() {
  try {
    const me = await api("/api/me");
    if (me.email_verified) return;
    const banner = document.createElement("div");
    banner.className = "error-box";
    banner.style.marginTop = "10px";
    banner.style.background = "#fffbeb";
    banner.style.borderColor = "#fde68a";
    banner.style.color = "#92400e";
    banner.innerHTML = `Your email isn't verified yet — you can browse and vote, but not post. <a href="verify-email.html" style="color:#92400e;">Enter your code</a>`;
    document.getElementById("profile-header").appendChild(banner);
  } catch (e) {
    // Non-fatal.
  }
}

function enterProfileEditMode(profile) {
  const wrap = document.getElementById("edit-profile-form-wrap");
  wrap.innerHTML = `
    <form id="edit-profile-form" class="stack edit-form" style="margin-top:12px;">
      <input id="edit-display-name" value="${escapeHtml(profile.display_name)}" required maxlength="100" placeholder="Display name" />
      <input id="edit-major" value="${escapeHtml(profile.major || "")}" maxlength="100" placeholder="Major (optional)" />
      <textarea id="edit-bio" maxlength="500" placeholder="Short bio (optional)">${escapeHtml(profile.bio || "")}</textarea>
      <div class="form-actions">
        <button type="submit" class="primary">Save</button>
        <button type="button" class="link-btn" id="cancel-profile-edit">Cancel</button>
      </div>
    </form>
    <form id="change-password-form" class="stack edit-form" style="margin-top:16px; border-top:1px solid var(--border); padding-top:16px;">
      <strong style="font-size:0.9rem;">Change password</strong>
      <input id="change-password-current" type="password" required autocomplete="current-password" placeholder="Current password" />
      <input id="change-password-new" type="password" required minlength="8" autocomplete="new-password" placeholder="New password (min. 8 characters)" />
      <div class="form-actions">
        <button type="submit" class="primary">Update password</button>
      </div>
      <p class="muted hidden" id="change-password-status"></p>
    </form>
  `;
  document.getElementById("cancel-profile-edit").addEventListener("click", () => { wrap.innerHTML = ""; });
  document.getElementById("edit-profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const updated = await api("/api/me", {
        method: "PATCH",
        body: JSON.stringify({
          display_name: document.getElementById("edit-display-name").value.trim(),
          major: document.getElementById("edit-major").value.trim(),
          bio: document.getElementById("edit-bio").value.trim(),
        }),
      });
      // Keep localStorage in sync so the header/avatar reflect the change
      // immediately, without asking the user to log in again.
      Session.set(Session.getToken(), updated);
      await loadProfileHeader();
    } catch (err) {
      showError(err.message);
    }
  });
  document.getElementById("change-password-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("change-password-status");
    status.classList.remove("hidden");
    status.style.color = "";
    status.textContent = "Updating…";
    const form = e.target;
    try {
      await api("/api/me/password", {
        method: "POST",
        body: JSON.stringify({
          current_password: document.getElementById("change-password-current").value,
          new_password: document.getElementById("change-password-new").value,
        }),
      });
      status.textContent = "Password updated.";
      form.reset();
    } catch (err) {
      status.style.color = "var(--danger)";
      status.textContent = err.message;
    }
  });
}

function renderThreadsTab(threads) {
  const container = document.getElementById("profile-list");
  if (threads.length === 0) {
    container.innerHTML = `<p class="muted">No threads yet.</p>`;
    return;
  }
  container.innerHTML = threads.map(t => `
    <div class="card">
      <a class="title" href="thread.html?id=${t.id}">${escapeHtml(t.title)}</a>
      <div class="card-meta">${timeAgo(t.created_at)} · ▲ ${t.score} · 💬 ${t.comment_count}</div>
    </div>
  `).join("");
}

function renderCommentsTab(comments) {
  const container = document.getElementById("profile-list");
  if (comments.length === 0) {
    container.innerHTML = `<p class="muted">No comments yet.</p>`;
    return;
  }
  container.innerHTML = comments.map(c => `
    <div class="card">
      <div class="card-meta">
        On <a href="thread.html?id=${c.thread_id}">${escapeHtml(c.thread_title)}</a> ·
        ${timeAgo(c.created_at)} · ▲ ${c.score}
      </div>
      <div class="comment-body">${escapeHtml(c.body)}</div>
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

async function loadTab() {
  try {
    if (currentTab === "threads") {
      const res = await api(`/api/users/${profileUserId}/threads?page=${currentPage}&page_size=${pageSize}`);
      renderThreadsTab(res.threads);
      renderPager(res.page, res.page_size, res.total);
    } else {
      const res = await api(`/api/users/${profileUserId}/comments?page=${currentPage}&page_size=${pageSize}`);
      renderCommentsTab(res.comments);
      renderPager(res.page, res.page_size, res.total);
    }
  } catch (e) {
    showError(e.message);
  }
}

function setupTabs() {
  document.querySelectorAll(".sort-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === currentTab);
    btn.addEventListener("click", () => {
      if (btn.dataset.tab === currentTab) return;
      currentTab = btn.dataset.tab;
      currentPage = 1;
      syncUrl();
      document.querySelectorAll(".sort-tab").forEach(b => b.classList.toggle("active", b === btn));
      loadTab();
    });
  });
}

function setupPager() {
  document.getElementById("pager-prev").addEventListener("click", () => {
    if (currentPage <= 1) return;
    currentPage -= 1;
    syncUrl();
    loadTab();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.getElementById("pager-next").addEventListener("click", () => {
    currentPage += 1;
    syncUrl();
    loadTab();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!profileUserId) {
    showError("No user specified.");
    return;
  }
  setupTabs();
  setupPager();
  try {
    await loadProfileHeader();
  } catch (e) {
    showError(e.message);
    return;
  }
  await loadTab();
});
