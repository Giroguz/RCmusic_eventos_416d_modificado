import { useEffect, useRef, useState } from 'react'
import { Download, LoaderCircle, Music2, Play, RefreshCw, Search, ShieldCheck, X } from 'lucide-react'
import { downloadDriveAudio, fetchDriveAudio, listDriveAudioCatalog } from '../lib/download'

function extensionOf(name = '') {
  return String(name).split('.').pop()?.toUpperCase() || 'AUDIO'
}

function sizeLabel(size) {
  const bytes = Number(size || 0)
  if (!bytes) return ''
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export default function DjMusicLibrary({ djToken }) {
  const [query, setQuery] = useState('')
  const [genre, setGenre] = useState('')
  const [genres, setGenres] = useState([])
  const [files, setFiles] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState({ id: '', url: '', loading: false })
  const [downloadId, setDownloadId] = useState('')
  const [notice, setNotice] = useState('')
  const abortRef = useRef(null)
  const pageSize = 60

  useEffect(() => {
    let current = true
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    const timer = setTimeout(async () => {
      setLoading(true)
      setLoadingMore(false)
      setError('')
      setFiles([])
      try {
        const result = await listDriveAudioCatalog({ query, genre, offset: 0, limit: pageSize }, controller.signal, djToken)
        if (!current) return
        setFiles(result.files || [])
        setTotal(Number(result.total || 0))
        setGenres(result.genres || [])
      } catch (requestError) {
        if (!current || requestError?.name === 'AbortError') return
        setError(requestError?.message === 'DJ_AUTH_REQUIRED' ? 'Vuelve a ingresar con tu usuario y código para abrir la biblioteca.' : requestError?.message === 'DJ_LIBRARY_API_NOT_CONFIGURED' ? 'La URL del API de staging no está configurada para esta biblioteca.' : requestError?.message === 'DRIVE_SERVER_NOT_CONFIGURED' || requestError?.message === 'DRIVE_AUTH_REQUIRED' ? 'El administrador debe configurar o renovar las credenciales OAuth de Google Drive en el servicio API.' : 'No se pudo cargar la biblioteca. Revisa tu conexión e inténtalo de nuevo.')
      } finally {
        if (current) setLoading(false)
      }
    }, query.trim() ? 250 : 0)
    return () => { current = false; clearTimeout(timer); controller.abort() }
  }, [query, genre, djToken])

  useEffect(() => () => {
    abortRef.current?.abort()
    if (preview.url) URL.revokeObjectURL(preview.url)
  }, [preview.url])

  async function refreshCatalog() {
    abortRef.current?.abort()
    setLoading(true)
    setError('')
    try {
      const result = await listDriveAudioCatalog({ query, genre, offset: 0, limit: pageSize, refresh: true }, undefined, djToken)
      setFiles(result.files || [])
      setTotal(Number(result.total || 0))
      setGenres(result.genres || [])
    } catch {
      setError('No se pudo actualizar la biblioteca desde Drive.')
    } finally { setLoading(false) }
  }

  async function loadMore() {
    if (loadingMore || files.length >= total) return
    setLoadingMore(true)
    setError('')
    try {
      const result = await listDriveAudioCatalog({ query, genre, offset: files.length, limit: pageSize }, undefined, djToken)
      setFiles((current) => [...current, ...(result.files || [])])
      setTotal(Number(result.total || 0))
      setGenres(result.genres || genres)
    } catch {
      setError('No se pudieron cargar más canciones.')
    } finally { setLoadingMore(false) }
  }

  async function togglePreview(file) {
    if (preview.id === file.id && preview.url) {
      URL.revokeObjectURL(preview.url)
      setPreview({ id: '', url: '', loading: false })
      return
    }
    if (preview.url) URL.revokeObjectURL(preview.url)
    setPreview({ id: file.id, url: '', loading: true })
    try {
      const blob = await fetchDriveAudio(file.id, djToken)
      setPreview({ id: file.id, url: URL.createObjectURL(blob), loading: false })
    } catch {
      setPreview({ id: '', url: '', loading: false })
      setError('No se pudo preparar la vista previa de esta canción.')
    }
  }

  async function download(file) {
    if (downloadId) return
    setDownloadId(file.id)
    setNotice('Preparando descarga…')
    try {
      await downloadDriveAudio(file.id, file.name, djToken)
      setNotice('Descarga completada.')
    } catch {
      setNotice('No se pudo descargar esta canción.')
    } finally {
      setDownloadId('')
      setTimeout(() => setNotice(''), 3500)
    }
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-turquoise/20 bg-turquoise/[.06] p-3 sm:p-4">
      <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-turquoise/15 text-turquoise"><Music2 size={20} /></div><div><h3 className="font-bold text-white">PACK TODOS LOS GÉNEROS</h3><p className="text-xs text-white/45">Biblioteca sincronizada con Google Drive</p></div></div>
      <button type="button" onClick={refreshCatalog} disabled={loading} className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-xs"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />Actualizar</button>
    </div>

    <div className="grid gap-4 lg:grid-cols-[190px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-white/10 bg-white/[.025] p-3">
        <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-[.18em] text-white/40">Géneros</p>
        <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          <button type="button" onClick={() => setGenre('')} className={`shrink-0 rounded-xl px-3 py-2 text-left text-xs font-semibold transition ${!genre ? 'bg-neon text-ink' : 'bg-white/[.04] text-white/60 hover:bg-white/10'}`}>Todos</button>
          {genres.map((item) => <button key={item} type="button" onClick={() => setGenre(item)} className={`shrink-0 rounded-xl px-3 py-2 text-left text-xs font-semibold transition ${genre === item ? 'bg-neon text-ink' : 'bg-white/[.04] text-white/60 hover:bg-white/10'}`}>{item}</button>)}
        </div>
      </aside>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[.025]">
        <form onSubmit={(event) => event.preventDefault()} className="flex gap-2 border-b border-white/10 p-3 sm:p-4">
          <div className="relative min-w-0 flex-1"><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="input-dark pl-10" placeholder="Buscar canción, artista o remix…" aria-label="Buscar canción, artista o remix" /></div>
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Limpiar búsqueda" className="rounded-xl border border-white/10 px-3 text-white/55 hover:bg-white/10"><X size={16} /></button>}
        </form>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-white/40"><span>{loading ? 'Buscando canciones…' : `${files.length} de ${total} canciones`}</span><span className="inline-flex items-center gap-1.5"><ShieldCheck size={14} className="text-turquoise" />Acceso privado para DJ</span></div>
        {error && <p className="mx-4 mb-3 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">{error}</p>}
        {loading ? <div className="grid min-h-44 place-items-center text-sm text-white/40"><span className="inline-flex items-center gap-2"><LoaderCircle size={17} className="animate-spin" />Cargando biblioteca…</span></div> : files.length ? <div className="divide-y divide-white/[.06]">
          {files.map((file) => <article key={file.id} className="grid min-w-0 grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 sm:grid-cols-[40px_minmax(0,1fr)_90px_88px] sm:px-4">
            <button type="button" onClick={() => togglePreview(file)} disabled={preview.loading} aria-label={preview.id === file.id && preview.url ? 'Detener vista previa' : 'Escuchar vista previa'} className="grid h-9 w-9 place-items-center rounded-xl border border-violet/20 bg-violet/10 text-violet-100 hover:bg-violet/20 disabled:opacity-50">{preview.id === file.id && preview.loading ? <LoaderCircle size={15} className="animate-spin" /> : preview.id === file.id && preview.url ? <X size={15} /> : <Play size={15} fill="currentColor" />}</button>
            <div className="min-w-0"><p className="break-words text-sm font-semibold leading-5 text-white">{file.name}</p><p className="mt-1 truncate text-[11px] text-white/40">{file.folderPath?.join(' / ') || file.genre || 'PACK TODOS LOS GÉNEROS'}{sizeLabel(file.size) ? ` · ${sizeLabel(file.size)}` : ''}</p>{preview.id === file.id && preview.url && <audio className="mt-2 h-9 w-full max-w-xl" controls autoPlay src={preview.url} />}</div>
            <span className="hidden rounded-lg bg-white/[.06] px-2 py-1 text-center text-[10px] font-bold text-white/50 sm:inline-block">{extensionOf(file.name)}</span>
            <button type="button" onClick={() => download(file)} disabled={Boolean(downloadId)} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-turquoise px-2.5 py-2 text-[11px] font-extrabold text-ink transition hover:brightness-110 disabled:opacity-50 sm:px-3" title="Descargar canción">{downloadId === file.id ? <LoaderCircle size={14} className="animate-spin" /> : <Download size={14} />}<span>Descargar</span></button>
          </article>)}
          {files.length < total && <div className="p-4 text-center"><button type="button" onClick={loadMore} disabled={loadingMore} className="btn-secondary inline-flex items-center gap-2 px-4 py-2.5 text-xs">{loadingMore && <LoaderCircle size={14} className="animate-spin" />}Cargar más canciones</button></div>}
        </div> : <div className="grid min-h-44 place-items-center px-5 text-center text-sm text-white/40">{query ? 'No encontramos canciones con esa búsqueda.' : 'No hay canciones disponibles en esta carpeta.'}</div>}
      </section>
    </div>
    {notice && <div role="status" className="fixed bottom-5 left-1/2 z-[100] -translate-x-1/2 rounded-xl border border-turquoise/30 bg-ink/95 px-4 py-3 text-xs font-bold text-turquoise shadow-xl">{notice}</div>}
  </div>
}
