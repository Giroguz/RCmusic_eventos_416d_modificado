(() => {
  const noticeId = 'rc-demo-plan-notice';
  const sync = () => {
    const demo = [...document.querySelectorAll('button')].find((button) => button.textContent.trim().startsWith('Probar demo gratis'));
    const email = [...document.querySelectorAll('input[type="email"]')].find((input) => input.closest('form'));
    const code = [...document.querySelectorAll('input')].find((input) => input.type === 'password' || input.getAttribute('autocomplete') === 'one-time-code');
    const registeredAttempt = Boolean(email?.value.trim() && code?.value.trim().length >= 6);
    const old = document.getElementById(noticeId);
    if (!demo) return;
    if (!registeredAttempt) {
      demo.style.display = '';
      old?.remove();
      return;
    }
    demo.style.display = 'none';
    if (!old) {
      const notice = document.createElement('p');
      notice.id = noticeId;
      notice.textContent = 'Este usuario ya está registrado. Adquiere o renueva un plan para continuar.';
      notice.style.cssText = 'margin-top:1rem;text-align:center;color:#67e8f9;font-size:.875rem;font-weight:700;';
      demo.parentNode.insertBefore(notice, demo);
    }
  };
  document.addEventListener('input', sync, true);
  new MutationObserver(sync).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(sync, 250);
  sync();
})();
