document.addEventListener("DOMContentLoaded", () => {
  const token = qs("token");
  const form = document.getElementById("reset-form");
  const errBox = document.getElementById("error");
  const successBox = document.getElementById("success-box");

  if (!token) {
    form.classList.add("hidden");
    errBox.textContent = "Missing or invalid reset link. Request a new one from the login page.";
    errBox.classList.remove("hidden");
    return;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.classList.add("hidden");
    const newPassword = document.getElementById("new-password").value;
    const btn = form.querySelector("button");
    btn.disabled = true;
    try {
      await api("/api/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, new_password: newPassword }),
      });
      form.classList.add("hidden");
      successBox.innerHTML = `Password reset — <a href="login.html">log in</a> with your new password.`;
      successBox.classList.remove("hidden");
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove("hidden");
    } finally {
      btn.disabled = false;
    }
  });
});
