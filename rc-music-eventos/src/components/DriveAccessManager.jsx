import { useEffect, useState } from 'react'
import { Check, Clock3, HardDrive, LoaderCircle, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { getDriveFolderPermissions, getDriveStatus, setDriveFolderPermission } from '../lib/download'

const DAY_MS = 24 * 60 * 60 * 1000

function remaining(expiresAt, now) {
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000))
  if (!seconds) return 'Vencido'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return days ? `${days} d ${String(hours).padStart(2, '0')} h` : `${hours} h ${String(minutes).padStart(2, '0')} min`
}

export default function DriveAccessManager({ djs = [], adminToken }) {
  const [permissions, setPermissions] = useState({})
  const [durationDays, setDurationDays] = useState({})
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [message, setMessage] = useState('')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  async function refresh() {
    setLoading(true)
    setMessage('')
    try {
      const status = await getDriveStatus(adminToken)
      const isConnected = Boolean(status?.authenticated && status?.configured)
      setConnected(isConnected)
      if (!isConnected) {
        setPermissions({})
        setMessage('La API debe tener configurados los secretos OAuth de Google Drive y acceso a la carpeta PACK.')
        return
      }
      const result = await getDriveFolderPermissions(adminToken)
      const rows = Array.isArray(result?.permissions) ? result.permissions : []
      const mapped = Object.fromEntries(rows.filter((row) => row.emailAddress).map((row) => [String(row.emailAddress).toLowerCase(), row]))
      setPermissions(mapped)
      setDurationDays((current) => {
        const next = { ...current }
        for (const dj of djs) {
          const permission = mapped[String(dj.email || '').toLowerCase()]
          const until = permission?.expirationTime ? new Date(permission.expirationTime).getTime() : 0
          if (!next[dj.id]) next[dj.id] = until > Date.now() ? String(Math.max(1, Math.ceil((until - Date.now()) / DAY_MS))) : '30'
        }
        return next
      })
    } catch (error) {
      setMessage(error?.message === 'DJ_LIBRARY_API_NOT_CONFIGURED' ? 'Configura VITE_DJ_LIBRARY_API_BASE_URL con la URL del API de staging terminada en /api.' : error?.message === 'DRIVE_AUTH_REQUIRED' ? 'La API de staging necesita credenciales OAuth vigentes para acceder a Google Drive.' : 'No se pudieron cargar los permisos de Drive.')
    } finally { setLoading(false) }
  }

  const djSignature = djs.map((dj) => `${dj.id}:${dj.email}:${dj.planExpiresAt}:${dj.isActive}:${dj.blocked}`).join('|')
  useEffect(() => { refresh() }, [adminToken, djSignature])

  async function togglePermission(dj, enabled) {
    const email = String(dj.email || '').trim().toLowerCase()
    if (!email.includes('@')) { setMessage('Este usuario necesita un correo válido para recibir acceso a Drive.'); return }
    if (enabled && (!dj.isActive || dj.blocked || !dj.planExpiresAt || new Date(dj.planExpiresAt).getTime() <= Date.now())) {
      setMessage('Solo puedes habilitar el acceso lector a un DJ con plan vigente y no bloqueado.')
      return
    }
    const days = Math.min(365, Math.max(1, Number(durationDays[dj.id] || 30)))
    const end = enabled ? new Date(Math.min(Date.now() + days * DAY_MS, new Date(dj.planExpiresAt).getTime())) : null
    const verb = enabled ? `Dar acceso de solo lectura a ${email} hasta ${end.toLocaleString('es-PE')}` : `Retirar el acceso lector de ${email}`
    if (!window.confirm(`${verb}?`)) return
    setBusyId(dj.id)
    setMessage('')
    try {
      const result = await setDriveFolderPermission(email, enabled, days, adminToken)
      const permission = result?.permission
      setPermissions((current) => {
        const next = { ...current }
        if (enabled && permission) next[email] = permission
        else delete next[email]
        return next
      })
      if (permission?.expirationTime) setDurationDays((current) => ({ ...current, [dj.id]: String(Math.max(1, Math.ceil((new Date(permission.expirationTime).getTime() - Date.now()) / DAY_MS))) }))
      setMessage(result?.message || (enabled ? 'Acceso lector activado.' : 'Acceso lector retirado.'))
    } catch (error) {
      setMessage(error?.message === 'DJ_LIBRARY_API_NOT_CONFIGURED' ? 'Configura VITE_DJ_LIBRARY_API_BASE_URL con la URL del API de staging terminada en /api.' : error?.message === 'DRIVE_AUTH_REQUIRED' ? 'La API de staging necesita credenciales OAuth vigentes para acceder a Google Drive.' : (error?.message || 'No se pudo actualizar el permiso de Drive.'))
    } finally { setBusyId('') }
  }

  return <section className="mb-5 rounded-2xl border border-turquoise/20 bg-turquoise/[.06] p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="flex items-center gap-2 font-bold text-turquoise"><HardDrive size={17} /> Acceso lector a PACK TODOS LOS GÉNEROS</p><p className="mt-1 text-xs leading-5 text-white/55">Actívalo por DJ; el permiso vence como máximo junto con su plan.</p></div>
      <div className="flex items-center gap-2">
        {connected && <button type="button" onClick={refresh} disabled={loading} className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Actualizar</button>}
        {!connected && <span className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/55">Drive API sin configurar</span>}
      </div>
    </div>
    {message && <p className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs leading-5 text-white/70">{message}</p>}
    {loading ? <div className="mt-4 flex items-center gap-2 text-xs text-white/45"><LoaderCircle size={15} className="animate-spin" />Revisando acceso a Drive…</div> : connected && <div className="mt-4 space-y-2">
      {djs.map((dj) => {
        const email = String(dj.email || '').toLowerCase()
        const permission = permissions[email]
        const hasPermission = Boolean(permission && permission.role === 'reader')
        const isEnabled = Boolean(hasPermission && (!permission.expirationTime || new Date(permission.expirationTime).getTime() > now))
        const expiresAt = permission?.expirationTime || ''
        const blocked = Boolean(dj.blocked)
        const busy = busyId === dj.id
        return <article key={dj.id} className="grid gap-3 rounded-xl border border-white/10 bg-black/20 p-3 sm:grid-cols-[minmax(0,1fr)_150px_minmax(140px,auto)] sm:items-center">
          <div className="min-w-0"><p className="truncate text-sm font-bold text-white">{dj.displayName || 'DJ'}</p><p className="truncate text-[11px] text-white/45">{email || 'Sin correo'}</p><p className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-semibold"><Clock3 size={13} className={isEnabled ? 'text-turquoise' : 'text-white/35'} />{isEnabled ? `Lector · ${expiresAt ? remaining(expiresAt, now) : 'sin vencimiento'}` : 'Sin permiso lector'}</p></div>
          <label className="block text-[10px] font-semibold text-white/45">Duración del permiso<input type="number" min="1" max="365" value={durationDays[dj.id] || '30'} onChange={(event) => setDurationDays((current) => ({ ...current, [dj.id]: event.target.value }))} className="input-dark mt-1 px-2 py-2 text-xs" disabled={busy || !dj.isActive || blocked} /><span className="mt-1 block text-[10px] text-white/35">días · máximo 365</span></label>
          <label className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold ${isEnabled ? 'border-turquoise/25 bg-turquoise/10 text-turquoise' : 'border-white/10 bg-white/[.03] text-white/55'}`}><input type="checkbox" checked={isEnabled} disabled={loading || busy || !connected || (!hasPermission && (!dj.isActive || blocked))} onChange={(event) => togglePermission(dj, event.target.checked)} className="h-4 w-4 accent-[#26f0d0]" />{busy ? <LoaderCircle size={14} className="animate-spin" /> : isEnabled ? <Check size={14} /> : <X size={14} />}{isEnabled ? 'Acceso lector activo' : 'Permitir lectura'}</label>
        </article>
      })}
      {!djs.length && <p className="py-4 text-center text-xs text-white/40">No hay usuarios DJ para administrar.</p>}
    </div>}
    {!connected && !loading && <p className="mt-3 text-xs leading-5 text-white/50">El administrador debe configurar en el servicio API GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y DRIVE_REFRESH_TOKEN para habilitar los permisos lectores.</p>}
  </section>
}
