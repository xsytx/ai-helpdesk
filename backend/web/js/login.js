document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("login-form");
  const errBox = document.getElementById("error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.classList.add("hidden");
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    const btn = form.querySelector("button");
    btn.disabled = true;
    try {
      const res = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      Session.set(res.token, res.user);
      window.location.href = "index.html";
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove("hidden");
    } finally {
      btn.disabled = false;
    }
  });
});
