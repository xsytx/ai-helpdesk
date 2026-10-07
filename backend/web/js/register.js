document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("register-form");
  const errBox = document.getElementById("error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.classList.add("hidden");
    const display_name = document.getElementById("display_name").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    const btn = form.querySelector("button");
    btn.disabled = true;
    try {
      const res = await api("/api/register", {
        method: "POST",
        body: JSON.stringify({ display_name, email, password }),
      });
      Session.set(res.token, res.user);
      // With no SMTP configured, the backend hands the code straight
      // back instead of only logging it server-side — sessionStorage
      // carries it across this redirect so verify-email.html can show it
      // directly (dev convenience only; a real deployment with SMTP set
      // never gets dev_verification_code in the first place).
      if (res.dev_verification_code) {
        sessionStorage.setItem("cf_dev_verification_code", res.dev_verification_code);
      }
      // A verification code was just emailed (see Register on the
      // backend) — walk the user straight into entering it rather than
      // dropping them on the feed and hoping they notice the email.
      window.location.href = "verify-email.html";
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove("hidden");
    } finally {
      btn.disabled = false;
    }
  });
});
