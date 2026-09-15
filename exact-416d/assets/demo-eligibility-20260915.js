(() => {
  const DEMO_LABEL = 'Probar demo gratis';
  const NOTICE_ID = 'rc-demo-plan-notice';
  const PROXY = 'https://rc-music-eventos-dj-proxy.gianfranguz.workers.dev/api/dj/login';
  let timer = null;
  let lastKey = '';
  let busyKey = '';

  const findDemoButton = () => [...document.querySelectorAll('button')].find((button) => button.textContent.trim().startsWith(DEMO_LABEL));
  const findLoginInputs = () => {
    const email = [...document.querySelectorAll('input[type="email"]')].find((input) => input.closest('form'));
    const code = [...document.querySelectorAll('input')].find((input) => input.type === 'password' || input.getAttribute('autocomplete') === 'one-time-code');
    return { email, code };
  };
  const clearNotice = () => document.getElementById(NOTICE_ID)?.remove();
  const restoreDemo = () => {
    const button = findDemoButton();
    if (button) button.style.display = '';
    clearNotice();
  };
  const showPlanNotice = () => {
    const button = findDemoButton();
    if (!button) return;
    button.style.display = 'none';
    if (document.getElementById(NOTICE_ID)) return;
    const notice = document.createElement('p');
    notice.id = NOTICE_ID;
    notice.textContent = 'Este usuario ya está registrado. Adquiere o renueva un plan para continuar.';
    notice.style.cssText = 'margin-top:1rem;text-align:center;color:#67e8f9;font-size:.875rem;font-weight:700;';
    button.parentNode.insertBefore(notice, button);
  };
  const sync = async () => {
    const { email, code } = findLoginInputs();
    const emailValue = email?.value.trim().toLowerCase() || '';
    const codeValue = code?.value.trim() || '';
    if (!emailValue || codeValue.length < 6) {
      lastKey = '';
      busyKey = '';
      restoreDemo();
      return;
    }
    const key = `${emailValue}|${codeValue}`;
    if (key === lastKey || key === busyKey) return;
    lastKey = key;
    busyKey = key;
    try {
      const response = await fetch(PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_email: emailValue, p_code: codeValue })
      });
      if (!response.ok) {
        restoreDemo();
        return;
      }
      const access = await response.json();
      if (access?.session_token) showPlanNotice();
      else restoreDemo();
    } catch {
      restoreDemo();
    } finally {
      busyKey = '';
    }
  };
  document.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(sync, 350);
  }, true);
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(sync, 100);
  }).observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(sync, 500);
})();
