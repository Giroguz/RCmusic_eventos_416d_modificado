(() => {
  const TARGET_EMAIL = "rcmusiceventos@gmail.com";
  const SUPABASE_URL = "https://fzqpmpgbubpmongodcat.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6cXBtcGdidWJwbW9uZ29kY2F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5NzI5MzIsImV4cCI6MjEwMzU0ODkzMn0.pLJfo5jpfMNRQCAbKC1dEW_INuBJan_eoyB_hWpChdw";
  const requestEmail = (subject, body, notify) => {
    const email = [...document.querySelectorAll('input[type="email"]')].find((input) => input.value.trim())?.value.trim().toLowerCase() || "";
    if (!email) return;
    if (notify) fetch(`${SUPABASE_URL}/rest/v1/rpc/request_admin_code`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_email: email })
    }).catch(() => {});
    window.location.href = `mailto:${TARGET_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace("{{email}}", email))}`;
  };
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    const label = button?.textContent.trim() || "";
    if (label.includes("¿Olvidaste tu código? Solicitar al administrador")) {
      event.preventDefault(); event.stopImmediatePropagation();
      requestEmail("Solicitud de reenvío de código de acceso DJ", "Hola,\\n\\nSolicito que me envíen nuevamente mi código de acceso al Panel de DJ.\\n\\nCorreo registrado: {{email}}\\n\\nGracias.", true);
    } else if (label === "Solicitar un plan") {
      event.preventDefault(); event.stopImmediatePropagation();
      requestEmail("Solicitud de plan para Panel de DJ", "Hola,\\n\\nSolicito información y activación de un plan para ingresar al Panel de DJ.\\n\\nCorreo registrado: {{email}}\\n\\nGracias.", false);
    }
  }, true);
})();
