(() => {
  const sync = () => {
    const demo = [...document.querySelectorAll('button')].find((button) => button.textContent.trim().startsWith('Probar demo gratis'));
    const email = [...document.querySelectorAll('input[type="email"]')].find((input) => input.closest('form'));
    const code = [...document.querySelectorAll('input')].find((input) => input.type === 'password' || input.getAttribute('autocomplete') === 'one-time-code');
    const registeredAttempt = Boolean(email?.value.trim() && code?.value.trim().length >= 6);
    if (!demo) return;
    // The access-status script owns the active/expired messaging. Never show a
    // generic purchase notice for an active paid account here.
    demo.style.display = registeredAttempt ? 'none' : '';
  };
  document.addEventListener('input', sync, true);
  new MutationObserver(sync).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(sync, 250);
  sync();
})();
