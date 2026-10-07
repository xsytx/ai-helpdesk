async function loadFAQ() {
  const errBox = document.getElementById("error");
  const container = document.getElementById("faq-list");
  try {
    const faqs = await api("/api/faq");
    if (faqs.length === 0) {
      container.innerHTML = `<p class="muted">No FAQ entries yet.</p>`;
      return;
    }
    container.innerHTML = faqs.map(f => `
      <details class="faq-item">
        <summary>${escapeHtml(f.question)}</summary>
        <div class="faq-answer">${escapeHtml(f.answer)}</div>
      </details>
    `).join("");
  } catch (e) {
    errBox.textContent = e.message;
    errBox.classList.remove("hidden");
  }
}

document.addEventListener("DOMContentLoaded", loadFAQ);
