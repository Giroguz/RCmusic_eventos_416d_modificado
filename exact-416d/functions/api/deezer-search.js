const EDGE_CACHE_TTL_SECONDS = 6 * 60 * 60
const BROWSER_CACHE_TTL_SECONDS = 5 * 60
const inFlight = new Map()

function jsonResponse(body, status, cacheState) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': status >= 200 && status < 300
      ? `public, max-age=${BROWSER_CACHE_TTL_SECONDS}`
      : 'no-store',
  })
  if (cacheState) headers.set('x-search-cache', cacheState)
  return new Response(body, { status, headers })
}

export async function onRequestGet({ request }) {
  const incoming = new URL(request.url)
  const query = (incoming.searchParams.get('q') || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()

  if (!query) return Response.json({ data: [] }, { headers: { 'cache-control': 'no-store' } })
  if (query.length > 160) {
    return Response.json({ data: [], error: 'La búsqueda es demasiado larga.' }, {
      status: 400,
      headers: { 'cache-control': 'no-store' },
    })
  }

  const cacheUrl = new URL('/api/deezer-search', incoming.origin)
  cacheUrl.searchParams.set('q', query)
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' })
  const edgeCache = typeof caches !== 'undefined' ? caches.default : null

  if (edgeCache) {
    try {
      const cached = await edgeCache.match(cacheKey)
      if (cached) return jsonResponse(await cached.text(), cached.status, 'HIT')
    } catch {
      // If edge cache is unavailable, continue with a normal Deezer request.
    }
  }

  const key = cacheKey.url
  let work = inFlight.get(key)
  const cacheState = work ? 'COALESCED' : 'MISS'

  if (!work) {
    work = (async () => {
      const target = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=8`
      const upstream = await fetch(target, { headers: { Accept: 'application/json' } })
      const body = await upstream.text()

      if (edgeCache && upstream.ok) {
        try {
          const payload = JSON.parse(body)
          if (Array.isArray(payload.data)) {
            const stored = new Response(body, {
              status: upstream.status,
              headers: {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': `public, max-age=${EDGE_CACHE_TTL_SECONDS}`,
              },
            })
            await edgeCache.put(cacheKey, stored)
          }
        } catch {
          // A cache write must never turn a successful search into a failure.
        }
      }
      return { body, status: upstream.status }
    })()
    inFlight.set(key, work)
  }

  try {
    const result = await work
    return jsonResponse(result.body, result.status, cacheState)
  } catch {
    return Response.json({ data: [] }, { status: 502, headers: { 'cache-control': 'no-store' } })
  } finally {
    if (inFlight.get(key) === work) inFlight.delete(key)
  }
}
