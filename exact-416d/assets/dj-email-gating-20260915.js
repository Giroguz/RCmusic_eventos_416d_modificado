(() => {
  const URL = "https://fzqpmpgbubpmongodcat.supabase.co";
  const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZXIsInJlZiI6ImZ6cXBtcGdidWJwbW9uZ29kY2F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5NzI5MzIsImV4cCI6MjEwMzU0ODkzMn0.pLJfo5jpfMNRQCAbKC1dEW_INuBJan_eoyB_hWpChdw";
  const ADMIN_REQUEST = "rcmusiceventos@gmail.com";
  const style = "margin-top:1rem;text-align:center;color:#67e8f9;font-size:.875rem;font-weight:700;line-height:1.5;";
  let timer = null;
  let sequence = 0;
  let lastEmail = "";
  let appliedStatus = "idle";

  const visible = (node) => node && node.getBoundingClientRect().width > 0 && getComputedStyle(node).display !== "none";
  const emailField = () => [...document.querySelectorAll('input[type="email"]')].find(visible);
  const findDemo = () => [...document.querySelectorAll("button")].find((b) => /^(Probar demo gratis|Try free demo)/.test(b.textContent.trim()));
  const findForgot = () => [...document.querySelectorAll("button")].find((b) => b.textContent.trim().includes("¿Olvidaste tu código? Solicitar al administrador"));
  const mailPlan = () => {
    const email = emailField()?.value.trim().toLowerCase() || "";
    const subject = encodeURIComponent("Solicitud de plan para Panel de DJ");
    const body = encodeURIComponent(`Hola,\n\nSolicito información y activación de un plan para ingresar al Panel de DJ.\n\nCorreo registrado: ${email}\n\nGracias.`);
    window.location.href = `mailto:${ADMIN_REQUEST}?subject=${subject}&body=${body}`;
  };
  const ensure = (id, text, onClick) => {
    let node = document.getElementById(id);
    if (!node) {
      node = document.createElement("button");
      node.id = id;
      node.type = "button";
      node.style.cssText = style + "display:block;width:100%;border:1px solid rgba(103,232,249,.35);border-radius:12px;padding:.75rem;color:#67e8f9;background:rgba(103,232,249,.08);";
      node.addEventListener("click", onClick);
      const demo = findDemo();
      (demo?.parentNode || document.querySelector("form") || document.body).appendChild(node);
    }
    node.textContent = text;
    node.style.display = "block";
    return node;
  };
  const clear = (id) => { const node = document.getElementById(id); if (node) node.remove(); };
  const render = (status, email) => {
    appliedStatus = status;
    const demo = findDemo();
    if (demo) demo.style.display = status === "new" ? "" : "none";
    clear("rc-email-plans");
    clear("rc-email-status");
    if (status === "idle") return;
    if (status === "active") {
      ensure("rc-email-status", "🔒 Correo reconocido. Si olvidaste tu código, solicítalo al administrador.", () => {});
      if (!findForgot()) ensure("rc-email-forgot", "¿Olvidaste tu código? Solicitar al administrador", () => {});
      return;
    }
    if (status === "expired") {
      clear("rc-email-forgot");
      findForgot()?.remove();
      ensure("rc-email-status", "🔒 Tu demo o plan ya venció. Adquiere o renueva un plan para continuar.", () => {});
      ensure("rc-email-plans", "Adquirir un plan", mailPlan);
      return;
    }
    clear("rc-email-forgot");
    findForgot()?.remove();
    ensure("rc-email-status", "🔒 Correo nuevo. Confírmalo para activar la demo.", () => {});
    ensure("rc-email-plans", "Ver planes disponibles", mailPlan);
  };
  const lookup = async (email, id) => {
    try {
      const response = await fetch(`${URL}/rest/v1/rpc/dj_email_status`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_email: email }) });
      const rows = await response.json();
      if (id !== sequence) return;
      render(rows?.[0]?.status || "new", email);
    } catch { if (id === sequence) render("new", email); }
  };
  const sync = () => {
    const field = emailField();
    const email = field?.value.trim().toLowerCase() || "";
    if (email === lastEmail) {
      const demo = findDemo();
      if (demo) demo.style.display = appliedStatus === "new" ? "" : "none";
      if (appliedStatus === "expired" || appliedStatus === "new") {
        findForgot()?.remove();
        clear("rc-email-forgot");
      }
      return;
    }
    lastEmail = email;
    sequence += 1;
    clearTimeout(timer);
    clear("rc-email-status");
    clear("rc-email-plans");
    clear("rc-email-forgot");
    const demo = findDemo();
    if (demo) demo.style.display = email ? "none" : "";
    if (!email || !email.includes("@") || email.length < 5) return;
    timer = setTimeout(() => lookup(email, sequence), 350);
  };
  document.addEventListener("input", sync, true);
  new MutationObserver(sync).observe(document.documentElement, { childList: true, subtree: true });
  sync();
})();
