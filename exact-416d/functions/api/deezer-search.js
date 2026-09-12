export async function onRequestGet({ request }) {
  const incoming = new URL(request.url)
  const query = (incoming.searchParams.get('q') || '').trim()
  if (!query) return Response.json({ data: [] })
  const target = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=8`
  try {
    const response = await fetch(target, { headers: { Accept: 'application/json' } })
    const body = await response.text()
    return new Response(body, {
      status: response.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' },
    })
  } catch {
    return Response.json({ data: [] }, { status: 502 })
  }
}
