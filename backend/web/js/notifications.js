let currentPage = parseInt(qs("page"), 10) > 0 ? parseInt(qs("page"), 10) : 1;
const pageSize = 20;

function showError(msg) {
  const errBox = document.getElementById("error");
  errBox.textContent = msg;
  errBox.classList.remove("hidden");
}

function notifText(n) {
  switch (n.type) {
    case "reply_to_comment":
      return `${authorLink(n.actor_id, n.actor_name)} replied to your comment in “${escapeHtml(n.thread_title)}”`;
    case "comment_on_thread":
    default:
      return `${authorLink(n.actor_id, n.actor_name)} commented on your thread “${escapeHtml(n.thread_title)}”`;
  }
}

function renderList(notifications) {
  const container = document.getElementById("notif-list");
  if (notifications.length === 0) {
    container.innerHTML = `<p class="muted">No notifications yet.</p>`;
    return;
  }
  container.innerHTML = notifications.map(n => `
    <a class="card notif-item ${n.read ? "" : "unread"}" href="thread.html?id=${n.thread_id}" data-id="${n.id}">
      <div>${notifText(n)}</div>
      <div class="card-meta">${timeAgo(n.created_at)}</div>
    </a>
  `).join("");
  container.querySelectorAll(".notif-item").forEach(el => {
    el.addEventListener("click", async (e) => {
      e.preventDefault();
      const href = el.getAttribute("href");
      try {
        await api(`/api/notifications/${el.dataset.id}/read`, { method: "POST" });
      } catch (err) {
        // Not fatal — still take the user to the thread.
      }
      window.location.href = href;
    });
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

async function loadNotifications() {
  try {
    const res = await api(`/api/notifications?page=${currentPage}&page_size=${pageSize}`);
    renderList(res.notifications);
    renderPager(res.page, res.page_size, res.total);
  } catch (e) {
    showError(e.message);
  }
}

function syncUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("page", currentPage);
  history.replaceState(null, "", url);
}

function setupPager() {
  document.getElementById("pager-prev").addEventListener("click", () => {
    if (currentPage <= 1) return;
    currentPage -= 1;
    syncUrl();
    loadNotifications();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.getElementById("pager-next").addEventListener("click", () => {
    currentPage += 1;
    syncUrl();
    loadNotifications();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function setupMarkAllRead() {
  document.getElementById("mark-all-read").addEventListener("click", async () => {
    try {
      await api("/api/notifications/read-all", { method: "POST" });
      await loadNotifications();
    } catch (e) {
      showError(e.message);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (!Session.isLoggedIn()) {
    window.location.href = "login.html";
    return;
  }
  setupPager();
  setupMarkAllRead();
  loadNotifications();
});
