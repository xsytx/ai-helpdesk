const threadId = qs("id");
let myVotes = {}; // key: "thread:1" or "comment:3" -> last value sent (1 or -1), client-side only
let currentThread = null;
let currentComments = [];
let currentSubscribed = false;
let replyingToId = null; // id of the comment currently showing an inline reply form, if any
const MAX_INDENT_DEPTH = 6; // cap visual nesting so very deep reply chains don't run off narrow screens

// Turns the flat, chronologically-ordered comment list from the API into
// a reply tree: each node gets a `replies` array of its direct children,
// in the same order they were posted. A comment whose parent no longer
// exists in the list (shouldn't normally happen — deleting a comment
// cascades to its replies) is treated as top-level, so it's never lost.
function buildCommentTree(comments) {
  const byId = new Map(comments.map(c => [c.id, { ...c, replies: [] }]));
  const roots = [];
  for (const c of byId.values()) {
    const parent = c.parent_comment_id && byId.get(c.parent_comment_id);
    (parent ? parent.replies : roots).push(c);
  }
  return roots;
}

function isOwner(authorUserId) {
  const u = Session.getUser();
  return !!u && u.id === authorUserId;
}

function voteButtons(targetType, id, score) {
  const key = `${targetType}:${id}`;
  const mine = myVotes[key] || 0;
  return `
    <div class="vote-row" data-target="${targetType}" data-id="${id}">
      <button class="vote-btn ${mine === 1 ? "active" : ""}" data-value="1" title="Upvote">▲</button>
      <span class="score" data-score>${score}</span>
      <button class="vote-btn ${mine === -1 ? "active" : ""}" data-value="-1" title="Downvote">▼</button>
    </div>
  `;
}

// canEdit/canDelete/canReport/canReply are independent: a moderator can
// delete anyone's post but only the author can edit its content, reporting
// your own post makes no sense, but replying to your own comment is fine
// (continuing your own point) so it isn't excluded like the others are.
function postActions(kind, id, { canEdit, canDelete, canReport, canReply }) {
  if (!canEdit && !canDelete && !canReport && !canReply) return "";
  return `
    <div class="post-actions">
      ${canReply ? `<button class="link-btn" data-action="reply" data-id="${id}">Reply</button>` : ""}
      ${canEdit ? `<button class="link-btn" data-action="edit" data-kind="${kind}" data-id="${id}">Edit</button>` : ""}
      ${canDelete ? `<button class="link-btn danger" data-action="delete" data-kind="${kind}" data-id="${id}">Delete</button>` : ""}
      ${canReport ? `<button class="link-btn" data-action="report" data-kind="${kind}" data-id="${id}">Report</button>` : ""}
    </div>
  `;
}

function replyForm(parentId) {
  return `
    <form class="stack edit-form reply-form" data-parent-id="${parentId}">
      <textarea placeholder="Write a reply…" required></textarea>
      <div class="form-actions">
        <button type="submit" class="primary">Reply</button>
        <button type="button" class="link-btn cancel-reply">Cancel</button>
      </div>
    </form>
  `;
}

function renderThread(t) {
  currentThread = t;
  document.title = t.title + " — SDU Threads";
  const owner = isOwner(t.user_id);
  const mod = Session.isModerator();
  const tagsRow = (t.tags && t.tags.length) ? `
    <div class="pill-row" style="margin:8px 0;">${t.tags.map(tag => `<a class="pill" href="search.html?tag=${encodeURIComponent(tag)}">#${escapeHtml(tag)}</a>`).join("")}</div>
  ` : "";
  const attachmentsHtml = (t.attachments && t.attachments.length) ? `
    <div class="pill-row" style="margin:10px 0;">
      ${t.attachments.map(a => `<a href="${a.url}" target="_blank" rel="noopener"><img src="${a.url}" alt="attachment" style="max-width:220px;max-height:220px;border-radius:8px;border:1px solid var(--border);" /></a>`).join("")}
    </div>
  ` : "";
  document.getElementById("thread-card").innerHTML = `
    <h1>${escapeHtml(t.title)} ${t.locked_at ? `<span class="muted" style="font-size:0.7em;">🔒 locked</span>` : ""}</h1>
    <div class="card-meta">${authorLink(t.user_id, t.author_name)} · ${timeAgo(t.created_at)}</div>
    <div class="thread-body">${t.body_html || escapeHtml(t.body)}</div>
    ${attachmentsHtml}
    ${tagsRow}
    ${voteButtons("thread", t.id, t.score)}
    ${postActions("thread", t.id, { canEdit: owner, canDelete: owner || mod, canReport: Session.isLoggedIn() && !owner })}
    <div class="post-actions">
      ${Session.isLoggedIn() ? `<button class="link-btn" id="toggle-subscribe-btn">${currentSubscribed ? "🔔 Following" : "🔕 Follow thread"}</button>` : ""}
      ${mod ? `<button class="link-btn" id="toggle-lock-btn">${t.locked_at ? "Unlock thread" : "Lock thread"}</button>` : ""}
    </div>
    ${owner ? attachmentUploadForm() : ""}
  `;
  attachVoteHandlers();
  attachThreadActionHandlers();
  attachSubscribeHandler();
  attachUploadHandler();
  renderCommentForm();
}

function attachmentUploadForm() {
  return `
    <form id="attachment-form" class="stack" style="margin-top:10px;flex-direction:row;gap:8px;align-items:center;">
      <input type="file" id="attachment-file" accept="image/png,image/jpeg,image/gif,image/webp" />
      <button type="submit" class="link-btn">Add photo</button>
    </form>
  `;
}

function attachUploadHandler() {
  const form = document.getElementById("attachment-form");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("attachment-file");
    if (!input.files[0]) return;
    const fd = new FormData();
    fd.append("file", input.files[0]);
    try {
      const token = Session.getToken();
      const res = await fetch(`/api/threads/${currentThread.id}/attachments`, {
        method: "POST",
        headers: token ? { Authorization: "Bearer " + token } : {},
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Upload failed (${res.status})`);
      }
      await loadThread();
    } catch (err) {
      showError(err.message);
    }
  });
}

function attachSubscribeHandler() {
  const btn = document.getElementById("toggle-subscribe-btn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    try {
      const method = currentSubscribed ? "DELETE" : "POST";
      await api(`/api/threads/${currentThread.id}/subscribe`, { method });
      currentSubscribed = !currentSubscribed;
      btn.textContent = currentSubscribed ? "🔔 Following" : "🔕 Follow thread";
    } catch (err) {
      showError(err.message);
    }
  });
}

function renderCommentNode(c, depth) {
  const owner = isOwner(c.user_id);
  const mod = Session.isModerator();
  const indent = Math.min(depth, MAX_INDENT_DEPTH) * 18;
  const canReply = !currentThread.locked_at;
  return `
    <div class="comment${depth > 0 ? " reply" : ""}" data-comment-id="${c.id}"${depth > 0 ? ` style="margin-left:${indent}px;"` : ""}>
      <div class="card-meta">${authorLink(c.user_id, c.author_name)} · ${timeAgo(c.created_at)}</div>
      <div class="comment-body">${c.body_html || escapeHtml(c.body)}</div>
      ${voteButtons("comment", c.id, c.score)}
      ${postActions("comment", c.id, { canEdit: owner, canDelete: owner || mod, canReport: Session.isLoggedIn() && !owner, canReply })}
      ${replyingToId === c.id ? replyForm(c.id) : ""}
    </div>
    ${c.replies.map(r => renderCommentNode(r, depth + 1)).join("")}
  `;
}

function renderComments(comments) {
  currentComments = comments;
  const container = document.getElementById("comments");
  if (comments.length === 0) {
    container.innerHTML = `<p class="muted">No comments yet.</p>`;
    return;
  }
  const tree = buildCommentTree(comments);
  container.innerHTML = tree.map(c => renderCommentNode(c, 0)).join("");
  attachVoteHandlers();
  attachCommentActionHandlers();
}

function showError(msg) {
  const errBox = document.getElementById("error");
  errBox.textContent = msg;
  errBox.classList.remove("hidden");
}

async function castVote(targetType, id, value, rowEl) {
  if (!Session.isLoggedIn()) {
    window.location.href = "login.html";
    return;
  }
  const key = `${targetType}:${id}`;
  const endpoint = targetType === "thread" ? `/api/threads/${id}/vote` : `/api/comments/${id}/vote`;
  try {
    const res = await api(endpoint, { method: "POST", body: JSON.stringify({ value }) });
    rowEl.querySelector("[data-score]").textContent = res.score;
    myVotes[key] = (myVotes[key] === value) ? 0 : value;
    rowEl.querySelectorAll(".vote-btn").forEach(btn => {
      const v = parseInt(btn.dataset.value, 10);
      btn.classList.toggle("active", myVotes[key] === v);
    });
  } catch (e) {
    showError(e.message);
  }
}

function attachVoteHandlers() {
  document.querySelectorAll(".vote-row").forEach(row => {
    row.querySelectorAll(".vote-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const targetType = row.dataset.target;
        const id = row.dataset.id;
        const value = parseInt(btn.dataset.value, 10);
        castVote(targetType, id, value, row);
      });
    });
  });
}

// --- Reporting (shared by threads and comments) ---

async function reportPost(kind, id) {
  const reason = prompt("Why are you reporting this? (optional)", "");
  if (reason === null) return; // cancelled
  try {
    await api(`/api/${kind}s/${id}/report`, { method: "POST", body: JSON.stringify({ reason }) });
    alert("Thanks — this has been reported to the moderators.");
  } catch (err) {
    showError(err.message);
  }
}

// --- Thread edit/delete/lock ---

function attachThreadActionHandlers() {
  const card = document.getElementById("thread-card");
  const editBtn = card.querySelector('[data-action="edit"]');
  const deleteBtn = card.querySelector('[data-action="delete"]');
  const reportBtn = card.querySelector('[data-action="report"]');
  const lockBtn = document.getElementById("toggle-lock-btn");
  if (editBtn) editBtn.addEventListener("click", enterThreadEditMode);
  if (deleteBtn) deleteBtn.addEventListener("click", deleteThread);
  if (reportBtn) reportBtn.addEventListener("click", () => reportPost("thread", currentThread.id));
  if (lockBtn) lockBtn.addEventListener("click", toggleThreadLock);
}

async function toggleThreadLock() {
  try {
    await api(`/api/threads/${currentThread.id}/lock`, {
      method: "POST",
      body: JSON.stringify({ locked: !currentThread.locked_at }),
    });
    await loadThread();
  } catch (err) {
    showError(err.message);
  }
}

function enterThreadEditMode() {
  const t = currentThread;
  document.getElementById("thread-card").innerHTML = `
    <form id="thread-edit-form" class="stack edit-form">
      <input id="edit-thread-title" value="${escapeHtml(t.title)}" required maxlength="200" />
      <textarea id="edit-thread-body" required>${escapeHtml(t.body)}</textarea>
      <input id="edit-thread-tags" value="${escapeHtml((t.tags || []).join(", "))}" placeholder="Tags, comma-separated (optional)" />
      <div class="form-actions">
        <button type="submit" class="primary">Save</button>
        <button type="button" id="cancel-thread-edit" class="link-btn">Cancel</button>
      </div>
    </form>
  `;
  document.getElementById("cancel-thread-edit").addEventListener("click", () => renderThread(currentThread));
  document.getElementById("thread-edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("edit-thread-title").value.trim();
    const body = document.getElementById("edit-thread-body").value.trim();
    const tags = document.getElementById("edit-thread-tags").value.split(",").map(s => s.trim()).filter(Boolean);
    try {
      const updated = await api(`/api/threads/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title, body, tags }),
      });
      renderThread(updated);
    } catch (err) {
      showError(err.message);
    }
  });
}

async function deleteThread() {
  if (!confirm("Delete this thread? This also deletes its comments.")) return;
  try {
    await api(`/api/threads/${currentThread.id}`, { method: "DELETE" });
    window.location.href = "index.html";
  } catch (err) {
    showError(err.message);
  }
}

// --- Comment edit/delete ---

function attachCommentActionHandlers() {
  document.querySelectorAll(".comment").forEach(el => {
    const id = parseInt(el.dataset.commentId, 10);
    const editBtn = el.querySelector('[data-action="edit"]');
    const deleteBtn = el.querySelector('[data-action="delete"]');
    const reportBtn = el.querySelector('[data-action="report"]');
    const replyBtn = el.querySelector('[data-action="reply"]');
    if (editBtn) editBtn.addEventListener("click", () => enterCommentEditMode(id, el));
    if (deleteBtn) deleteBtn.addEventListener("click", () => deleteComment(id));
    if (reportBtn) reportBtn.addEventListener("click", () => reportPost("comment", id));
    if (replyBtn) replyBtn.addEventListener("click", () => {
      replyingToId = (replyingToId === id) ? null : id;
      renderComments(currentComments);
    });
  });
  document.querySelectorAll(".reply-form").forEach(form => {
    const parentId = parseInt(form.dataset.parentId, 10);
    form.querySelector(".cancel-reply").addEventListener("click", () => {
      replyingToId = null;
      renderComments(currentComments);
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = form.querySelector("textarea").value.trim();
      if (!body) return;
      try {
        await api(`/api/threads/${threadId}/comments`, {
          method: "POST",
          body: JSON.stringify({ body, parent_comment_id: parentId }),
        });
        replyingToId = null;
        await loadThread();
      } catch (err) {
        showError(err.message);
      }
    });
  });
}

function enterCommentEditMode(id, el) {
  const c = currentComments.find(c => c.id === id);
  if (!c) return;
  el.innerHTML = `
    <form class="stack edit-form comment-edit-form">
      <textarea required>${escapeHtml(c.body)}</textarea>
      <div class="form-actions">
        <button type="submit" class="primary">Save</button>
        <button type="button" class="link-btn cancel-comment-edit">Cancel</button>
      </div>
    </form>
  `;
  el.querySelector(".cancel-comment-edit").addEventListener("click", () => renderComments(currentComments));
  el.querySelector(".comment-edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = el.querySelector("textarea").value.trim();
    try {
      await api(`/api/comments/${id}`, { method: "PATCH", body: JSON.stringify({ body }) });
      await loadThread();
    } catch (err) {
      showError(err.message);
    }
  });
}

async function deleteComment(id) {
  if (!confirm("Delete this comment?")) return;
  try {
    await api(`/api/comments/${id}`, { method: "DELETE" });
    await loadThread();
  } catch (err) {
    showError(err.message);
  }
}

// --- Load / new comment form ---

async function loadThread() {
  if (!threadId) {
    showError("No thread specified.");
    return;
  }
  try {
    const data = await api(`/api/threads/${threadId}`);
    currentSubscribed = !!data.subscribed;
    renderThread(data.thread);
    renderComments(data.comments);
  } catch (e) {
    showError(e.message);
  }
}

function renderCommentForm() {
  const card = document.getElementById("new-comment-card");
  const prompt = document.getElementById("login-prompt");
  if (currentThread.locked_at) {
    card.classList.add("hidden");
    prompt.classList.remove("hidden");
    prompt.textContent = "🔒 This thread is locked — no new comments.";
    return;
  }
  // Commenting doesn't require an account right now (anonymous posting —
  // see CreateComment on the backend); auth is coming back later, at
  // which point this should go back to gating on Session again.
  card.classList.remove("hidden");
  prompt.classList.add("hidden");
}

function setupCommentForm() {
  const form = document.getElementById("comment-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    document.getElementById("error").classList.add("hidden");
    const body = document.getElementById("comment-body").value.trim();
    const btn = form.querySelector("button");
    btn.disabled = true;
    try {
      await api(`/api/threads/${threadId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      document.getElementById("comment-body").value = "";
      await loadThread();
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadThread();
  setupCommentForm();
});
