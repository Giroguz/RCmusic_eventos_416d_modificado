export async function onRequestGet({ request }) {
  const incoming = new URL(request.url)
  const id = (incoming.searchParams.get('id') || '').trim()
  if (!/^\d+$/.test(id)) return Response.json({ preview: '', link: '' }, { status: 400 })
  try {
    const response = await fetch(`https://api.deezer.com/track/${id}`, { headers: { Accept: 'application/json' } })
    if (!response.ok) return Response.json({ preview: '', link: '' }, { status: response.status })
    const data = await response.json()
    return Response.json({ preview: data.preview || '', link: data.link || `https://www.deezer.com/track/${id}` }, { headers: { 'cache-control': 'public, max-age=300' } })
  } catch {
    return Response.json({ preview: '', link: `https://www.deezer.com/track/${id}` }, { status: 502 })
  }
}
