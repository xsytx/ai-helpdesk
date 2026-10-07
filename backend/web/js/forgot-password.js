document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("forgot-form");
  const errBox = document.getElementById("error");
  const successBox = document.getElementById("success-box");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.classList.add("hidden");
    const email = document.getElementById("email").value.trim();
    const btn = form.querySelector("button");
    btn.disabled = true;
    try {
      await api("/api/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
      form.classList.add("hidden");
      successBox.textContent = "If that email is registered, a reset link has been sent to it.";
      successBox.classList.remove("hidden");
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove("hidden");
    } finally {
      btn.disabled = false;
    }
  });
});
