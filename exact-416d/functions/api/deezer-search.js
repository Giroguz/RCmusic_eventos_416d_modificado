const EDGE_CACHE_TTL_SECONDS = 6 * 60 * 60
const BROWSER_CACHE_TTL_SECONDS = 5 * 60
const OFFICIAL_FILTER_VERSION = 'official-v1'
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

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const QUERY_STOP_WORDS = new Set(['official', 'audio', 'video', 'lyrics', 'lyric', 'music', 'song', 'track', 'feat', 'featuring', 'ft'])
const ALTERNATE_VERSION = /\b(karaoke|covers?|tribute|instrumental|remixes?|nightcore|sped up|slowed|mashup|bootleg|parody|acoustic|acustic[oa]|concierto|en directo)\b/
const LIVE_VERSION = /\b(live|en vivo|en directo)\b/

function isAlternateVersion(track) {
  const title = normalizeText(track?.title_short || track?.title)
  const version = normalizeText(track?.title_version)
  const album = normalizeText(track?.album?.title)
  if (ALTERNATE_VERSION.test(`${title} ${version} ${album}`)) return true
  if (LIVE_VERSION.test(version) || LIVE_VERSION.test(album)) return true
  // A song can itself contain the word "Live"; treat it as an alternate only
  // when the marker is at the end of the title or explicitly parenthesized.
  if (/\b(live|en vivo|en directo)\s*(version|recording|session)?$/.test(title)) return true
  return false
}

function selectLikelyOfficialTrack(tracks, query) {
  if (!Array.isArray(tracks) || !tracks.length) return null
  const tokens = normalizeText(query).split(/\s+/).filter((token) => token.length > 1 && !QUERY_STOP_WORDS.has(token))
  const ranked = tracks
    .filter((track) => track && track.id && track.title && track.artist?.name && !isAlternateVersion(track))
    .map((track) => {
      const title = normalizeText(track.title_short || track.title)
      const contributors = Array.isArray(track.contributors) ? track.contributors.map((artist) => artist?.name || '').join(' ') : ''
      const artist = normalizeText(`${track.artist?.name || ''} ${contributors}`)
      const searchable = `${title} ${artist}`
      const titleHits = tokens.filter((token) => title.includes(token)).length
      const artistHits = tokens.filter((token) => artist.includes(token)).length
      const matchedTokens = tokens.filter((token) => searchable.includes(token)).length
      if (tokens.length && matchedTokens < Math.min(2, tokens.length)) return null
      const exactTitle = title && title === normalizeText(query) ? 1 : 0
      const rank = Number(track.rank) || 0
      return { track, score: exactTitle * 1_000_000_000 + titleHits * 100_000 + artistHits * 10_000 + rank }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
  return ranked[0]?.track || null
}

function filterResponse(body, query) {
  try {
    const payload = JSON.parse(body)
    if (!Array.isArray(payload.data)) return body
    const official = selectLikelyOfficialTrack(payload.data, query)
    return JSON.stringify({ ...payload, data: official ? [official] : [], total: official ? 1 : 0, next: null })
  } catch {
    return body
  }
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

  // Version the cache key so old multi-result responses cannot leak through.
  const cacheUrl = new URL('/api/deezer-search', incoming.origin)
  cacheUrl.searchParams.set('q', query)
  cacheUrl.searchParams.set('filter', OFFICIAL_FILTER_VERSION)
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
      const target = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=25`
      const upstream = await fetch(target, { headers: { Accept: 'application/json' } })
      const rawBody = await upstream.text()
      const body = upstream.ok ? filterResponse(rawBody, query) : rawBody

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
