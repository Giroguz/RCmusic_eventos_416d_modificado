import { useCallback, useEffect, useState } from 'react'
import { LogOut, Music2, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import DjLogin from './components/DjLogin'
import DjMusicLibrary from './components/DjMusicLibrary'
import DriveAccessManager from './components/DriveAccessManager'
import { Brand, PageContainer } from './components/Brand'
import { adminListDjs, getDjAccess, getStoredDjSession, signOutDj, supabaseEnabled } from './lib/supabase'

function LibraryAdminPanel({ session, onSignOut }) {
  const [djs, setDjs] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setMessage('')
    try { setDjs(await adminListDjs(session.token)) }
    catch { setMessage('No se pudo cargar la lista de DJs. Revisa la conexión con Supabase.') }
    finally { setLoading(false) }
  }, [session.token])

  useEffect(() => { refresh() }, [refresh])

  return <div className="party-page min-h-screen bg-ink bg-grid"><PageContainer className="min-h-screen py-5 sm:py-8">
    <header className="flex items-center justify-between gap-3"><Brand /><button type="button" onClick={onSignOut} className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-xs"><LogOut size={15} />Salir</button></header>
    <div className="mx-auto mt-8 max-w-5xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow text-turquoise">PACK TODOS LOS GÉNEROS</p><h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">Gestión de biblioteca</h1><p className="mt-2 text-sm text-white/55">Usuarios DJ y permisos de solo lectura para la carpeta musical.</p></div><button type="button" onClick={refresh} disabled={loading} className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-xs"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />Actualizar usuarios</button></div>
      <DriveAccessManager djs={djs} adminToken={session.token} />
      <section className="mt-5 rounded-2xl border border-white/10 bg-white/[.025] p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2"><Users size={17} className="text-turquoise" /><h2 className="font-bold">Usuarios registrados</h2><span className="ml-auto text-xs text-white/40">{loading ? 'Cargando…' : `${djs.length} DJs`}</span></div>
        {message && <p className="mb-3 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">{message}</p>}
        {!loading && !djs.length && !message && <p className="py-5 text-center text-sm text-white/45">Todavía no hay DJs registrados.</p>}
        <div className="space-y-2">{djs.map((dj) => <article key={dj.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{dj.displayName || 'DJ'}</p><p className="truncate text-xs text-white/45">{dj.email}</p></div><div className="flex items-center gap-2 text-[11px]"><span className={`rounded-lg px-2 py-1 font-bold ${dj.blocked ? 'bg-red-400/10 text-red-200' : dj.isActive ? 'bg-turquoise/10 text-turquoise' : 'bg-white/5 text-white/45'}`}>{dj.blocked ? 'Bloqueado' : dj.isActive ? 'Activo' : 'Inactivo'}</span><span className="text-white/40">{dj.planType || 'Sin plan'}</span></div></article>)}</div>
      </section>
      <p className="mt-4 flex items-center gap-2 text-xs text-white/40"><ShieldCheck size={14} className="text-turquoise" />Este panel solo administra la biblioteca; no muestra asistentes ni pedidos de eventos.</p>
    </div>
  </PageContainer></div>
}

export default function DjLibraryStandaloneApp() {
  const [session, setSession] = useState(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [loginOpen, setLoginOpen] = useState(() => window.location.hash === '#dj-login')

  useEffect(() => {
    let active = true
    const stored = getStoredDjSession()
    if (!stored?.token) { setCheckingSession(false); return () => { active = false } }
    getDjAccess(stored.token).then((access) => {
      if (!active) return
      if (access) setSession(access)
      else setLoginOpen(true)
    }).catch(() => {
      if (!active) return
      signOutDj(stored.token).catch(() => {})
      setSession(null)
      setLoginOpen(true)
    }).finally(() => { if (active) setCheckingSession(false) })
    return () => { active = false }
  }, [])

  function openLogin() {
    setLoginOpen(true)
    window.history.replaceState(window.history.state, '', `${window.location.pathname}#dj-login`)
  }

  async function signOut() {
    await signOutDj(session?.token).catch(() => {})
    setSession(null)
    setLoginOpen(true)
    window.history.replaceState(window.history.state, '', `${window.location.pathname}#dj-login`)
  }

  if (checkingSession) return <div className="grid min-h-screen place-items-center bg-[#060509] text-sm text-white/55">Verificando acceso…</div>
  if (session?.role === 'admin') return <LibraryAdminPanel session={session} onSignOut={signOut} />
  if (session) return <div className="party-page min-h-screen bg-ink bg-grid"><PageContainer className="min-h-screen py-5 sm:py-8"><header className="mb-6 flex items-center justify-between gap-3"><Brand /><button type="button" onClick={signOut} className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-xs"><LogOut size={15} />Salir</button></header><div className="mx-auto max-w-6xl"><DjMusicLibrary djToken={session.token} /></div></PageContainer></div>
  if (loginOpen) return <DjLogin onBack={() => { setLoginOpen(false); window.history.replaceState(window.history.state, '', `${window.location.pathname}#home`) }} onLogin={(access) => { setSession(access); setLoginOpen(false) }} />

  return <div className="party-page min-h-screen bg-ink bg-grid"><PageContainer className="flex min-h-screen flex-col"><header className="flex items-center justify-between gap-3"><Brand /><span className="rounded-full border border-turquoise/20 bg-turquoise/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-turquoise">Biblioteca privada</span></header><main className="flex flex-1 items-center justify-center py-10"><section className="w-full max-w-xl text-center"><div className="neon-orb mx-auto grid h-20 w-20 place-items-center rounded-3xl border border-turquoise/25 bg-turquoise/10 text-turquoise"><Music2 size={34} /></div><p className="eyebrow mt-7 text-turquoise">PACK TODOS LOS GÉNEROS</p><h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">Tu música, lista para encontrar</h1><p className="mx-auto mt-4 max-w-md text-sm leading-6 text-white/55">Busca por canción o género, escucha una vista previa y descarga pistas individuales con tu acceso de DJ.</p><button type="button" onClick={openLogin} className="btn-primary mt-7 w-full max-w-xs">Ingresar a la biblioteca</button>{!supabaseEnabled && <p className="mx-auto mt-4 max-w-md text-xs text-amber-200/70">El acceso de pruebas se habilitará al conectar el Supabase independiente de la biblioteca.</p>}</section></main></PageContainer></div>
}
