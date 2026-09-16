(() => {
  const PROXY = 'https://rc-music-eventos-dj-proxy.gianfranguz.workers.dev/api/dj/login';
  const originalFetch = window.fetch.bind(window);
  const getCredentials = () => {
    const email = [...document.querySelectorAll('input')].find((input) => input.type === 'email')?.value.trim().toLowerCase();
    const code = [...document.querySelectorAll('input')].find((input) => input.type === 'password' || input.getAttribute('autocomplete') === 'one-time-code')?.value.trim();
    return email && code ? { email, code } : null;
  };
  const freshToken = async () => {
    const credentials = getCredentials();
    if (!credentials) return '';
    const response = await originalFetch(PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_email: credentials.email, p_code: credentials.code }) });
    if (!response.ok) return '';
    const data = await response.json();
    return data?.session_token || '';
  };
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.includes('/rest/v1/rpc/submit_subscription_proof')) return originalFetch(input, init);
    try {
      const token = await freshToken();
      if (token && typeof init.body === 'string') {
        const payload = JSON.parse(init.body);
        payload.p_token = token;
        const headers = new Headers(init.headers || {});
        headers.set('Authorization', `Bearer ${token}`);
        return originalFetch(input, { ...init, headers, body: JSON.stringify(payload) });
      }
    } catch {}
    return originalFetch(input, init);
  };
  const prices = [['15 días', 'S/. 25.00', 'S/. 16.00'], ['Mensual', 'S/. 35.00', 'S/. 30.00'], ['Anual', 'S/. 340.00', 'S/. 330.00']];
  const syncPrices = () => {
    document.querySelectorAll('button').forEach((button) => {
      if (!prices.some(([label]) => button.textContent.includes(label))) return;
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach((node) => prices.forEach(([, oldPrice, newPrice]) => {
        if (node.nodeValue.includes(oldPrice)) node.nodeValue = node.nodeValue.replaceAll(oldPrice, newPrice);
      }));
    });
  };
  new MutationObserver(syncPrices).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setInterval(syncPrices, 500);
  syncPrices();
})();
