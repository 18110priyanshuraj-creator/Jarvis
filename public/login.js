(() => {
  const form = document.getElementById("login-form");
  const passwordInput = document.getElementById("password");
  const button = document.getElementById("login-button");
  const toast = document.getElementById("toast");

  if (!form || !passwordInput || !button) return;

  function showMessage(message, isError = false) {
    if (!toast) return;
    toast.textContent = message;
    toast.className = "toast show" + (isError ? " error" : "");
  }

  form.addEventListener("submit", async (event) => {
    // This handler is loaded independently of the large dashboard module,
    // so a dashboard startup error cannot fall through to a native form reload.
    event.preventDefault();
    event.stopImmediatePropagation?.();
    if (button.disabled) return;

    button.disabled = true;
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        // Passwords are opaque: do not trim or normalize them.
        body: JSON.stringify({ password: passwordInput.value })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Sign-in failed. Please try again.");
      }

      // Confirm the browser retained the HttpOnly cookie before unlocking.
      const sessionResponse = await fetch("/api/session", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store"
      });
      const session = await sessionResponse.json().catch(() => ({}));
      if (!sessionResponse.ok || session.authenticated !== true) {
        throw new Error(session.error || "Sign-in was accepted, but this browser did not retain the session. Enable site cookies and try again.");
      }

      passwordInput.value = "";
      document.getElementById("login-screen")?.classList.add("hidden");
      document.getElementById("app-shell")?.classList.remove("hidden");
      window.dispatchEvent(new Event("jarvis:authenticated"));
      showMessage("Workspace unlocked.");
    } catch (error) {
      showMessage(error?.message || "Sign-in failed. Please try again.", true);
    } finally {
      button.disabled = false;
    }
  });
})();
