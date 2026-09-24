const SHELL_CACHE = 'pack-dj-shell-v1'
const ASSET_CACHE = 'pack-dj-assets-v1'
const APP_SHELL = [
  '/library/',
  '/library/manifest.webmanifest',
  '/library/icon-192.png',
  '/library/icon-512.png',
  '/library/icon-maskable-512.png',
  '/library/apple-touch-icon.png',
]

async function cacheAppShell() {
  const shellCache = await caches.open(SHELL_CACHE)
  await Promise.all(APP_SHELL.map((path) => shellCache.add(path).catch(() => null)))

  // In production Vite gives the library entry hashed JS/CSS names, so discover
  // those from its HTML entry and precache them for an offline app launch.
  try {
    const response = await fetch('/library/', { cache: 'no-cache' })
    if (!response.ok) return
    const html = await response.text()
    const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)]
      .map((match) => new URL(match[1], self.location.origin))
      .filter((url) => url.origin === self.location.origin && /\.(?:js|css)$/i.test(url.pathname))
      .map((url) => url.href)
    const assetCache = await caches.open(ASSET_CACHE)
    await Promise.all(assets.map((url) => assetCache.add(url).catch(() => null)))
  } catch {}
}

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(cacheAppShell())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys
      .filter((key) => key.startsWith('pack-dj-') && ![SHELL_CACHE, ASSET_CACHE].includes(key))
      .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

function isPrivateOrAudio(url, request) {
  const path = url.pathname.toLowerCase()
  const sensitiveParams = ['apikey', 'api_key', 'key', 'token', 'access_token', 'authorization']
  return /\.(mp3|wav|flac|m4a|aac|ogg|opus)$/.test(path)
    || /\/(api|drive|rest\/v1|auth\/v1|storage\/v1|functions\/v1)(\/|$)/.test(path)
    || sensitiveParams.some((name) => url.searchParams.has(name))
    || Boolean(request.headers.get('authorization'))
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin || isPrivateOrAudio(url, request)) return

  if (request.mode === 'navigate' && url.pathname.startsWith('/library/')) {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) caches.open(SHELL_CACHE).then((cache) => cache.put('/library/', response.clone()))
        return response
      }).catch(async () => (await caches.match('/library/')) || (await caches.match('/library/index.html')) || Response.error()),
    )
    return
  }

  const staticAsset = ['script', 'style', 'image', 'font'].includes(request.destination)
  if (!staticAsset) return

  event.respondWith(
    fetch(request).then((response) => {
      if (response.ok) caches.open(ASSET_CACHE).then((cache) => cache.put(request, response.clone()))
      return response
    }).catch(async () => (await caches.match(request)) || Response.error()),
  )
})
