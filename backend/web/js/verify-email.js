document.addEventListener("DOMContentLoaded", () => {
  if (!Session.isLoggedIn()) {
    window.location.href = "login.html";
    return;
  }
  const user = Session.getUser();
  if (user && user.email_verified) {
    document.getElementById("verify-intro").textContent = "Your email is already verified.";
    document.getElementById("verify-form").classList.add("hidden");
    return;
  }

  const errBox = document.getElementById("error");
  function showError(msg) {
    errBox.textContent = msg;
    errBox.classList.remove("hidden");
  }

  // No SMTP configured on the backend (see internal/mailer) means there's
  // no real inbox to check — the API hands the code straight back for
  // local development instead, so show it here and prefill the input
  // rather than sending the user to dig through server logs.
  function showDevCode(code) {
    if (!code) return;
    const hint = document.getElementById("dev-code-hint");
    hint.textContent = `Dev mode (no SMTP configured): your code is ${code}`;
    hint.classList.remove("hidden");
    document.getElementById("verify-code").value = code;
  }
  showDevCode(sessionStorage.getItem("cf_dev_verification_code"));
  sessionStorage.removeItem("cf_dev_verification_code");

  document.getElementById("verify-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.classList.add("hidden");
    const code = document.getElementById("verify-code").value.trim();
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      await api("/api/verify-email", { method: "POST", body: JSON.stringify({ code }) });
      // Keep localStorage in sync so the profile banner/gating reflect
      // verification immediately, without asking the user to log in again.
      const u = Session.getUser();
      if (u) { u.email_verified = true; Session.set(Session.getToken(), u); }
      window.location.href = "index.html";
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("resend-btn").addEventListener("click", async () => {
    errBox.classList.add("hidden");
    const status = document.getElementById("resend-status");
    const btn = document.getElementById("resend-btn");
    btn.disabled = true;
    try {
      const res = await api("/api/resend-verification", { method: "POST" });
      status.textContent = "A new code was sent — check your inbox.";
      status.classList.remove("hidden");
      showDevCode(res.dev_verification_code);
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
    }
  });
});
