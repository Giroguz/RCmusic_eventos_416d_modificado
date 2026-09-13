import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, Check, CheckCircle2, CircleAlert, Clock3, Crown, Download, ExternalLink, Eye, Headphones, ImagePlus, Link2, ListMusic, LoaderCircle, MessageCircleHeart, Music2, PauseCircle, Play, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Trash2, UserRound, X } from 'lucide-react'
import { AppShell, PageContainer } from './Brand'
import { getEvents, makeCode, saveEvents } from '../lib/storage'
import { createDjEvent, finalizeDjEvent, getDjAccess, getDjEventQr, getDjEvents, getStoredDjSession, getSubscriptionPlanPrices, setRequestStatus, signOutDj, supabaseEnabled, updateDjEventInfo, updateDjEventQr, updateDjEventTipSettings, deleteDjEvent, subscribeToEventPresence } from '../lib/supabase'
import AdminPanel from './AdminPanel'
import { PlanCards } from './DjLogin'
import { useLanguage } from '../lib/i18n'
import ChatRoom from './ChatRoom'
import { downloadDriveAudio, fetchDriveAudio, searchDriveAudio, downloadYoutubeAudio } from '../lib/download'
import { countdownText, getPlanOption, mergePlanOptions, PLAN_OPTIONS, planPriceText } from '../lib/plans'

const BACKUP_DRIVE_URL = 'https://drive.google.com/drive/folders/1UTIQESYvJcNdKXNsDdDs0dRCrDzs5JvF'
const DJ_OVERLAY_KEY = 'rcMusicDjOverlay'

function GoogleDriveIcon({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><path fill="#0F9D58" d="M17.36 6.5 6.04 26.1l6.93 12L24.3 18.5z" /><path fill="#FFBA00" d="M24 44h13.8l6.9-12H30.9z" /><path fill="#4285F4" d="M13.4 2.5h13.8l17.5 29.5H30.9z" /></svg>
}

function EmailVerificationBadge({ access }) {
  const verified = Boolean(access?.email_verified || access?.emailVerified)
  return <span className={`hidden rounded-full border px-3 py-1.5 text-[11px] font-bold sm:inline ${verified ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-200' : 'border-amber-300/30 bg-amber-400/10 text-amber-100'}`}>{verified ? '✓ Correo verificado' : 'Correo pendiente'}</span>
}

function AccessCountdown({ access }) {
  const [now, setNow] = useState(Date.now())
  const expiresAt = access?.planExpiresAt || access?.plan_expires_at
  useEffect(() => {
    if (!expiresAt || access?.role === 'admin') return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [expiresAt, access?.role])
  if (!expiresAt || access?.role === 'admin') return null
  const expired = new Date(expiresAt).getTime() <= now
  return <span className={`rounded-full border px-3 py-1.5 text-[11px] font-bold ${expired ? 'border-red-300/30 bg-red-400/10 text-red-200' : 'border-neon/20 bg-neon/10 text-neon'}`}>Plan: {countdownText(expiresAt, now)}</span>
}

function PlanCountdownCard({ access }) {
  const [now, setNow] = useState(Date.now())
  const expiresAt = access?.planExpiresAt || access?.plan_expires_at
  const planType = access?.planType || access?.plan_type
  useEffect(() => {
    if (!expiresAt || access?.role === 'admin') return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [expiresAt, access?.role])
  if (!expiresAt || access?.role === 'admin') return null
  const expired = new Date(expiresAt).getTime() <= now
  const plan = getPlanOption(planType)
  return <section className={`mb-5 rounded-2xl border p-4 ${expired ? 'border-red-300/25 bg-red-400/10' : 'border-neon/25 bg-neon/10'}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className={`text-[10px] font-bold uppercase tracking-[.2em] ${expired ? 'text-red-200/75' : 'text-neon/75'}`}>Estado de tu plan</p><p className="mt-1 text-lg font-bold text-white">{plan?.label || 'Plan contratado'}</p><p className="mt-1 text-xs text-white/50">Vence: {new Date(expiresAt).toLocaleString('es-PE')}</p></div><div className="text-right"><p className={`font-mono text-xl font-black tracking-wider ${expired ? 'text-red-200' : 'text-neon'}`}>{countdownText(expiresAt, now)}</p><p className="mt-1 text-[10px] uppercase tracking-widest text-white/45">Tiempo restante</p></div></div></section>
}

function PlanOfferSummary() {
  const [plans, setPlans] = useState(PLAN_OPTIONS)
  useEffect(() => {
    let active = true
    const load = () => getSubscriptionPlanPrices().then((rows) => { if (active) setPlans(mergePlanOptions(rows)) }).catch(() => {})
    load()
    const timer = setInterval(load, 30000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  return <p className="mt-2 text-[11px] font-semibold text-turquoise/80">{plans.map((plan) => `${plan.label}: ${planPriceText(plan)} · ${plan.days} días`).join('  ·  ')}</p>
}

function Modal({ children, onClose, title }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={onClose}><div className="glass max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[2rem] p-5 sm:p-7" onMouseDown={(e) => e.stopPropagation()}><div className="mb-6 flex items-center justify-between"><h2 className="font-display text-2xl font-bold">{title}</h2><button onClick={onClose} className="rounded-xl p-2 text-white/50 hover:bg-white/10 hover:text-white"><X size={20} /></button></div>{children}</div></div>
}

function Stat({ icon: Icon, label, value, accent = 'white', onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={`glass w-full rounded-xl p-2.5 text-left transition sm:rounded-2xl sm:p-3 ${onClick ? 'cursor-pointer hover:border-neon/30 hover:bg-white/[.08]' : ''}`}><div className={`mb-2 flex h-7 w-7 items-center justify-center rounded-lg ${accent === 'lime' ? 'bg-neon/15 text-neon' : accent === 'violet' ? 'bg-violet/20 text-violet-200' : accent === 'amber' ? 'bg-amber-300/15 text-amber-200' : 'bg-white/10 text-white/60'}`}><Icon size={15} /></div><p className="text-xl font-bold sm:text-2xl">{value}</p><p className="mt-0.5 text-[10px] text-white/40 sm:text-xs">{label}</p></Tag>
}

function MediaThumbnail({ src, alt = '', className = '' }) { const [failed, setFailed] = useState(!src); if (failed) return <img src="/music-placeholder.svg" alt={alt || 'Música'} className={className} />; return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} /> }
function PreviewFrame({ track }) { if (track.source === 'unknown') return <div className="grid min-h-40 place-items-center p-8 text-center text-sm text-white/55">Este pedido no tiene una vista previa disponible.</div>
  if (track.source === 'spotify' || String(track.videoId || '').startsWith('spotify:')) {
    const spotifyId = track.spotifyId || String(track.videoId).replace(/^spotify:/, '')
    return <iframe title={track.title} src={`https://open.spotify.com/embed/track/${spotifyId}`} className="h-[352px] w-full" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" />
  }
  return <iframe title={track.title} src={`https://www.youtube-nocookie.com/embed/${track.videoId}?autoplay=1&rel=0`} className="aspect-video w-full" allow="autoplay; encrypted-media" allowFullScreen />
}

function DjRequestRow({ request, onStatus, onPreview, onProof, onDriveSearch, onDriveCancel, searchingDrive, readOnly, t }) {
  const played = request.status === 'played'; const notFound = request.status === 'not-found'; const awaiting = request.status === 'awaiting-payment'; const rejected = request.status === 'payment-rejected'
  const statusText = awaiting ? t('paymentPending') : rejected ? 'Rechazada' : played ? t('alreadyPlayed') : notFound ? t('notLocated') : t('inQueue')
  const statusTone = played ? 'text-[#b8ff3d]' : notFound ? 'text-[#ffe600]' : rejected ? 'text-[#ff3b5f]' : awaiting ? 'text-violet-200' : 'text-amber-300'
  return <div className={`flex flex-col gap-4 border-b border-white/10 px-4 py-4 last:border-0 sm:flex-row sm:items-center ${played || rejected ? 'opacity-55' : ''}`}><button onClick={() => onPreview(request)} className="group relative h-16 w-full shrink-0 overflow-hidden rounded-xl bg-white/10 sm:w-24"><MediaThumbnail src={request.thumbnail} alt={request.title} className="h-full w-full object-cover" /><span className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition group-hover:opacity-100"><Play size={18} fill="currentColor" /></span></button><div className="min-w-0 flex-1"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><p className={`truncate font-bold ${played || notFound || rejected ? 'line-through decoration-white/60' : ''}`}>{request.title}</p><p className="truncate text-xs text-white/50">{request.artist}</p></div><span className="flex items-center gap-1 rounded-lg bg-neon/10 px-2 py-1 text-xs font-extrabold text-neon">{request.likes} <span className="font-normal text-neon/60">likes</span></span></div><div className="mt-2 space-y-1 text-xs text-white/45"><p><span className="font-semibold text-white/65">{t('requestedBy')}:</span> {request.requester || '—'}</p><p><span className="font-semibold text-white/65">{t('dedicatedTo')}:</span> {request.dedication || '—'}</p><p className={`${statusTone} font-bold`}><span>{t('statusLabel')}:</span> {statusText}</p>{request.paymentProof && <button onClick={() => onProof(request.paymentProof)} className="font-semibold text-turquoise underline-offset-2 hover:underline">{t('viewPaymentProof')}</button>}</div></div><div className="flex w-full flex-wrap gap-2 sm:w-auto">{!readOnly && (awaiting ? <><button onClick={() => onStatus(request.id, 'pending')} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-400/15 px-3 py-2.5 text-xs font-bold text-emerald-200 transition hover:bg-emerald-400/25 sm:flex-none" title={t('approvePayment')}><CheckCircle2 size={15} /><span>{t('approvePayment')}</span></button><button onClick={() => onStatus(request.id, 'payment-rejected')} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-400/10 px-3 py-2.5 text-xs font-bold text-amber-200 transition hover:bg-amber-400/20 sm:flex-none" title={t('rejectPayment')}><CircleAlert size={15} /><span>{t('rejectPayment')}</span></button></> : <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto"><button onClick={() => onStatus(request.id, 'played')} className="flex min-w-0 items-center justify-center gap-1 rounded-xl px-2 py-2.5 text-[11px] font-bold transition hover:brightness-125 sm:flex-none sm:px-3 sm:text-xs" style={{ backgroundColor: played ? 'rgba(184,255,61,.25)' : 'rgba(184,255,61,.10)', color: '#b8ff3d', boxShadow: played ? '0 0 14px rgba(184,255,61,.2)' : 'none' }} title="Tocada"><CheckCircle2 size={14} /><span className="truncate">Tocada</span></button><button onClick={() => onStatus(request.id, 'not-found')} className="flex min-w-0 items-center justify-center gap-1 rounded-xl px-2 py-2.5 text-[11px] font-bold transition hover:brightness-125 sm:flex-none sm:px-3 sm:text-xs" style={{ backgroundColor: notFound ? 'rgba(255,230,0,.25)' : 'rgba(255,230,0,.10)', color: '#ffe600', boxShadow: notFound ? '0 0 14px rgba(255,230,0,.2)' : 'none' }} title="No ubicada"><CircleAlert size={14} /><span className="truncate">No ubicada</span></button><button onClick={() => onStatus(request.id, 'payment-rejected')} className="flex min-w-0 items-center justify-center gap-1 rounded-xl px-2 py-2.5 text-[11px] font-bold transition hover:brightness-125 sm:flex-none sm:px-3 sm:text-xs" style={{ backgroundColor: rejected ? 'rgba(255,59,95,.25)' : 'rgba(255,59,95,.10)', color: '#ff3b5f', boxShadow: rejected ? '0 0 14px rgba(255,59,95,.2)' : 'none' }} title="Rechazada"><X size={14} /><span className="truncate">Rechazada</span></button></div>)} </div></div>
}
async function fileToQrDataUrl(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('invalid-image')
  const source = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file) })
  const image = await new Promise((resolve, reject) => { const value = new Image(); value.onload = () => resolve(value); value.onerror = reject; value.src = source })
  const maxSide = 900; const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight)); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale)); canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
  const png = canvas.toDataURL('image/png')
  return png.length <= 1150000 ? png : canvas.toDataURL('image/webp', 0.86)
}

export default function DjApp({ onExit, session = getStoredDjSession() }) {
  const { t } = useLanguage()
  const [events, setEvents] = useState(() => supabaseEnabled ? [] : getEvents())
  const [activeId, setActiveId] = useState(undefined)
  const [access, setAccess] = useState(session)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [showAdmin, setShowAdmin] = useState(false)
  const [showPlans, setShowPlans] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showFinalize, setShowFinalize] = useState(false)
  const [preview, setPreview] = useState(null)
  const [paymentProof, setPaymentProof] = useState('')
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState('all')
  const [sortMode, setSortMode] = useState('likes')
  const [form, setForm] = useState({ name: '', contact: '', yapeNumber: '', thankYou: '', qrImage: '', tipsRequired: false, tipCurrency: 'PEN', tipAmount: '', fixedTipAmount: false })
  const [profileForm, setProfileForm] = useState({ djName: '', yapeNumber: '', contact: '', thankYou: '', qrImage: '', tipsRequired: false })
  const [onlineCount, setOnlineCount] = useState(0); const [chatOpen, setChatOpen] = useState(false); const [presenceNotice, setPresenceNotice] = useState(''); const previousOnlineCount = useRef(null); const presenceNoticeTimer = useRef(null)
  const [qrLoading, setQrLoading] = useState(false)
  const activeEvent = events.find((event) => event.id === activeId) || events[0]

  function syncDjOverlay(state = window.history.state) {
    const overlay = state?.[DJ_OVERLAY_KEY] || ''
    setShowAdmin(overlay === 'admin')
    setShowPlans(overlay === 'plans')
    setShowCreate(overlay === 'create')
    setShowSettings(overlay === 'settings')
    setShowFinalize(overlay === 'finalize')
    setPreview(overlay === 'preview' ? state?.djOverlayData || null : null)
    setPaymentProof(overlay === 'payment' ? state?.djOverlayData || '' : '')
    setDownloadOptions(overlay === 'downloads' ? state?.djOverlayData || null : null)
    setChatOpen(overlay === 'chat')
  }

  function openDjOverlay(name, data = null) {
    const current = window.history.state || {}
    if (current[DJ_OVERLAY_KEY] === name) return
    window.history.pushState({ ...current, [DJ_OVERLAY_KEY]: name, djOverlayData: data }, '', window.location.href)
    syncDjOverlay({ ...current, [DJ_OVERLAY_KEY]: name, djOverlayData: data })
  }

  function closeDjOverlay(fallback) {
    if (window.history.state?.[DJ_OVERLAY_KEY]) { window.history.back(); return }
    fallback?.()
  }

  useEffect(() => {
    syncDjOverlay()
    const handleDjPopState = (event) => syncDjOverlay(event.state)
    window.addEventListener('popstate', handleDjPopState)
    return () => window.removeEventListener('popstate', handleDjPopState)
  }, [])

  useEffect(() => {
    const sync = async () => {
      try {
        if (supabaseEnabled) {
          const currentAccess = await getDjAccess(session?.token)
          if (!currentAccess) throw new Error('SESSION_EXPIRED')
          setAccess({ ...session, ...currentAccess })
          const remoteEvents = await getDjEvents(session?.token)
          const eventsWithQr = await Promise.all(remoteEvents.map(async (event) => { try { return { ...event, qrImage: await getDjEventQr(event.id, session?.token) } } catch { return event } }))
          setEvents(eventsWithQr)
          setActiveId((current) => eventsWithQr.some((event) => event.id === current) ? current : eventsWithQr[0]?.id)
        } else {
          const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
          const freshEvents = getEvents().filter((event) => !event.createdAt || new Date(event.createdAt).getTime() > cutoff)
          setEvents(freshEvents); saveEvents(freshEvents); setActiveId((current) => freshEvents.some((event) => event.id === current) ? current : freshEvents[0]?.id)
        }
      } catch (error) {
        setLoadError(error?.message === 'SESSION_EXPIRED' ? 'La sesión del DJ venció. Vuelve a ingresar con tu correo y código.' : 'No se pudo cargar el Panel de DJ. Revisa tu conexión e inténtalo nuevamente.')
      } finally { setLoading(false) }
    }
    sync()
    if (!supabaseEnabled) { window.addEventListener('storage', sync); window.addEventListener('rc-events-updated', sync) }
    const interval = setInterval(sync, 25000)
    return () => { window.removeEventListener('storage', sync); window.removeEventListener('rc-events-updated', sync); clearInterval(interval) }
  }, [session?.token])

  const requests = useMemo(() => [...(activeEvent?.requests || [])].filter((request) => filter === 'all' || request.status === filter).sort((a, b) => sortMode === 'recent' ? String(b.createdAt || '').localeCompare(String(a.createdAt || '')) : (b.likes - a.likes) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))), [activeEvent, filter, sortMode])
  useEffect(() => {
    previousOnlineCount.current = null
    setPresenceNotice('')
    if (!activeEvent?.id) return undefined
    const unsubscribe = subscribeToEventPresence(activeEvent.id, 'dj', (count) => {
      const previous = previousOnlineCount.current
      setOnlineCount(count)
      if (previous !== null && count > previous) {
        setPresenceNotice(`${t('participantJoined')} · ${count}`)
        if (presenceNoticeTimer.current) clearTimeout(presenceNoticeTimer.current)
        presenceNoticeTimer.current = setTimeout(() => setPresenceNotice(''), 4500)
      }
      previousOnlineCount.current = count
    })
    return () => {
      unsubscribe?.()
      if (presenceNoticeTimer.current) clearTimeout(presenceNoticeTimer.current)
      presenceNoticeTimer.current = null
    }
  }, [activeEvent?.id, t])
  useEffect(() => {
    if (activeEvent) setProfileForm({ djName: activeEvent.djName || '', yapeNumber: activeEvent.yapeNumber || '', contact: activeEvent.contact || '', thankYou: activeEvent.thankYou || '', qrImage: activeEvent.qrImage || '', tipsRequired: Boolean(activeEvent.tipsRequired), tipCurrency: activeEvent.tipCurrency || 'PEN', tipAmount: activeEvent.tipAmount ? String(activeEvent.tipAmount) : '', fixedTipAmount: Number(activeEvent.tipAmount || 0) > 0 })
  }, [activeEvent?.id, activeEvent?.djName, activeEvent?.yapeNumber, activeEvent?.contact, activeEvent?.thankYou, activeEvent?.qrImage, activeEvent?.tipsRequired, activeEvent?.tipCurrency, activeEvent?.tipAmount])

  async function handleQrUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setQrLoading(true)
    try { const qrImage = await fileToQrDataUrl(file); setProfileForm((current) => ({ ...current, qrImage })) } catch { setNotice(t('qrImageInvalid')); setTimeout(() => setNotice(''), 3500) } finally { setQrLoading(false); e.target.value = '' }
  }

  async function handleEventQrUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setQrLoading(true)
    try { const qrImage = await fileToQrDataUrl(file); setForm((current) => ({ ...current, qrImage })) } catch { setNotice(t('qrImageInvalid')); setTimeout(() => setNotice(''), 3500) } finally { setQrLoading(false); e.target.value = '' }
  }

  async function saveProfile(e) {
    e.preventDefault()
    if (!activeEvent) return
    if (profileForm.tipsRequired && profileForm.fixedTipAmount && Number(profileForm.tipAmount) <= 0) { setNotice('Coloca un monto de propina mayor que 0.'); setTimeout(() => setNotice(''), 3500); return }
    const updated = { ...activeEvent, djName: profileForm.djName.trim() || 'DJ', yapeNumber: profileForm.yapeNumber.trim(), contact: profileForm.contact.trim(), thankYou: profileForm.thankYou.trim().slice(0, 150), qrImage: profileForm.qrImage || '', tipsRequired: Boolean(profileForm.tipsRequired), tipCurrency: String(profileForm.tipCurrency || 'PEN').toUpperCase(), tipAmount: profileForm.fixedTipAmount ? Number(profileForm.tipAmount || 0) : 0, fixedTipAmount: Boolean(profileForm.fixedTipAmount) }
    try {
      const saved = supabaseEnabled ? await updateDjEventInfo(activeEvent.id, updated, session?.token) : updated
      if (supabaseEnabled && profileForm.qrImage !== (activeEvent.qrImage || '')) await updateDjEventQr(activeEvent.id, profileForm.qrImage, session?.token)
      if (supabaseEnabled && (Boolean(profileForm.tipsRequired) !== Boolean(activeEvent.tipsRequired) || String(profileForm.tipCurrency || 'PEN') !== String(activeEvent.tipCurrency || 'PEN') || Boolean(profileForm.fixedTipAmount) !== (Number(activeEvent.tipAmount || 0) > 0) || Number(profileForm.tipAmount || 0) !== Number(activeEvent.tipAmount || 0))) await updateDjEventTipSettings(activeEvent.id, profileForm.tipsRequired, profileForm.tipCurrency, profileForm.fixedTipAmount ? profileForm.tipAmount : 0, session?.token)
      setEvents((current) => current.map((event) => event.id === activeEvent.id ? { ...event, djName: saved.djName, yapeNumber: saved.yapeNumber, contact: saved.contact, thankYou: updated.thankYou, qrImage: updated.qrImage, tipsRequired: updated.tipsRequired, tipCurrency: updated.tipCurrency, tipAmount: updated.tipAmount } : event))
      if (!supabaseEnabled) saveEvents(events.map((event) => event.id === activeEvent.id ? updated : event))
      closeDjOverlay(() => setShowSettings(false)); setNotice(t('profileSaved')); setTimeout(() => setNotice(''), 4000)
    } catch { setNotice(t('profileSaveFailed')) }
  }

  const [driveSearchId, setDriveSearchId] = useState('')
  const [driveSearchController, setDriveSearchController] = useState(null)
  const [downloadingFileId, setDownloadingFileId] = useState('')
  const [noticeLoading, setNoticeLoading] = useState(false)
  const [downloadOptions, setDownloadOptions] = useState(null)
  const [drivePreview, setDrivePreview] = useState({ id: '', url: '', loading: false })
  const [driveLibraryQuery, setDriveLibraryQuery] = useState('')
  const [driveLibrarySearching, setDriveLibrarySearching] = useState(false)

  async function searchDriveForRequest(request) {
    if (!request || driveSearchId || downloadingFileId) return
    const controller = new AbortController()
    setDriveSearchController(controller)
    setDriveSearchId(request.id)
    setNotice(t('searching'))
    try {
      const matches = await searchDriveAudio(`${request.title} ${request.artist}`, controller.signal)
      openDjOverlay('downloads', { request, matches }); setDownloadOptions({ request, matches })
      if (!matches.length) setNotice(t('notLocated'))
    } catch (error) {
      if (error?.name !== 'AbortError') setNotice(t('downloadFailed'))
    } finally {
      setDriveSearchController(null)
      setDriveSearchId('')
      setTimeout(() => setNotice(''), 4500)
    }
  }

  function cancelDriveSearch() {
    driveSearchController?.abort()
    setDriveSearchController(null)
    setDriveSearchId('')
    setNotice('')
  }

  async function searchDriveLibrary(event) {
    event.preventDefault()
    const query = driveLibraryQuery.trim()
    if (!query || driveLibrarySearching || driveSearchId || downloadingFileId) return
    setDriveLibrarySearching(true)
    setNotice(t('searching'))
    try {
      const matches = await searchDriveAudio(query)
      openDjOverlay('downloads', { request: null, query, matches }); setDownloadOptions({ request: null, query, matches })
      if (!matches.length) setNotice(t('driveNoMatches'))
    } catch (error) {
      if (error?.name !== 'AbortError') setNotice(t('downloadFailed'))
    } finally {
      setDriveLibrarySearching(false)
      setTimeout(() => setNotice(''), 4500)
    }
  }

  async function previewDriveFile(file) {
    if (!file?.id || drivePreview.loading) return
    if (drivePreview.url) URL.revokeObjectURL(drivePreview.url)
    setDrivePreview({ id: file.id, url: '', loading: true })
    try {
      const blob = await fetchDriveAudio(file.id)
      setDrivePreview({ id: file.id, url: URL.createObjectURL(blob), loading: false })
    } catch { setDrivePreview({ id: '', url: '', loading: false }); setNotice(t('downloadFailed')) }
  }

  async function downloadSelectedDriveFile(file) {
    if (!file?.id || downloadingFileId) return
    setDownloadingFileId(file.id)
    setNoticeLoading(true)
    setNotice(t('downloadPreparing'))
    try {
      await downloadDriveAudio(file.id, file.name)
      setNoticeLoading(false)
      setNotice(t('downloadCompleted'))
    } catch {
      setNoticeLoading(false)
      setNotice(t('downloadFailed'))
    } finally {
      setDownloadingFileId('')
      setTimeout(() => setNotice(''), 4500)
    }
  }

  async function finishActiveEvent() {
    if (!activeEvent || activeEvent.finalized) return
    try {
      const finalizedAt = supabaseEnabled ? await finalizeDjEvent(activeEvent.id, session?.token) : new Date().toISOString()
      const updated = { ...activeEvent, finalized: true, finalizedAt, qrImage: '', requests: (activeEvent.requests || []).map((request) => ({ ...request, paymentProof: '' })) }
      const next = events.map((event) => event.id === activeEvent.id ? updated : event)
      setEvents(next)
      if (!supabaseEnabled) saveEvents(next)
      closeDjOverlay(() => setShowFinalize(false))
      setNotice(t('eventFinalized'))
      setTimeout(() => setNotice(''), 5000)
    } catch { setNotice(t('eventFinalizeFailed')) }
  }

  const pending = activeEvent?.requests?.filter((request) => request.status === 'pending').length || 0
  const played = activeEvent?.requests?.filter((request) => request.status === 'played').length || 0
  const notFound = activeEvent?.requests?.filter((request) => request.status === 'not-found').length || 0
  const awaitingPayment = activeEvent?.requests?.filter((request) => request.status === 'awaiting-payment').length || 0

  function focusQueue(nextFilter) {
    setFilter(nextFilter)
    requestAnimationFrame(() => document.getElementById('dj-request-queue')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  async function updateEvent(nextEvent) {
    const previous = activeEvent
    const next = events.map((event) => event.id === nextEvent.id ? nextEvent : event)
    // Actualiza la cola de inmediato para que cualquier estado responda al clic.
    setEvents(next)
    try {
      if (supabaseEnabled && previous) {
        const changed = nextEvent.requests.find((request) => previous.requests.find((oldRequest) => oldRequest.id === request.id && oldRequest.status !== request.status))
        if (changed) await setRequestStatus(changed.id, changed.status, access?.token)
      } else {
        saveEvents(next)
      }
    } catch {
      setNotice(t('updateDjError'))
      setTimeout(() => setNotice(''), 4000)
    }
  }

  function markStatus(id, status) {
    if (!activeEvent || activeEvent.finalized) return
    updateEvent({ ...activeEvent, requests: activeEvent.requests.map((request) => request.id === id ? { ...request, status } : request) })
  }

  function downloadSongRecord() {
    if (!activeEvent) return
    const lineBreak = '\r\n'
    const recordedRequests = (activeEvent.requests || []).slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    const songLines = recordedRequests.map((request, index) => `${index + 1}.-Canción: ${request.title}`)
    const separator = '-'.repeat(Math.max(1, ...songLines.map((line) => line.length)))
    const entries = recordedRequests.map((request, index) => [
      songLines[index],
      `Artista: ${request.artist}`,
    ].join(lineBreak))
    const content = [
      `Registro de canciones tocadas — ${activeEvent.name}`,
      `Código del evento: ${activeEvent.code}`,
      separator,
      '',
      entries.join(`${lineBreak}${lineBreak}`),
      '',
      separator,
    ].join(lineBreak)
    const blob = new Blob([`\ufeff${content}`], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `registro-canciones-${activeEvent.code}.txt`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  async function removeActiveEvent() {
    if (!activeEvent?.id) return
    const confirmed = window.confirm(`¿Eliminar el evento “${activeEvent.name}”? Esta acción no se puede deshacer.`)
    if (!confirmed) return
    try {
      if (supabaseEnabled && !activeEvent.localOnly) await deleteDjEvent(activeEvent.id, session?.token)
      const remaining = events.filter((event) => event.id !== activeEvent.id)
      setEvents(remaining)
      if (!supabaseEnabled) saveEvents(remaining)
      setActiveId(remaining[0]?.id)
      setNotice('Evento eliminado')
      setTimeout(() => setNotice(''), 4000)
    } catch { setNotice('No se pudo eliminar el evento. Inténtalo nuevamente.'); setTimeout(() => setNotice(''), 4500) }
  }

  async function createEvent(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    const input = { code: makeCode(events.map((item) => item.code)), name: form.name.trim(), djName: t('defaultDjName'), contact: form.contact.trim() || t('defaultContact'), yapeNumber: form.yapeNumber.trim() || t('defaultYape'), thankYou: form.thankYou.trim() || t('defaultThanks') }
    try {
      const event = supabaseEnabled ? await createDjEvent(input, session?.token) : { id: `event-${Date.now()}`, ...input, createdAt: new Date().toISOString(), requests: [] }
      if (supabaseEnabled && form.qrImage) await updateDjEventQr(event.id, form.qrImage, session?.token)
      const eventWithOptions = { ...event, qrImage: form.qrImage || event.qrImage || '', tipsRequired: Boolean(event.tipsRequired) }
      const next = [...events, eventWithOptions]
      setEvents(next); if (!supabaseEnabled) saveEvents(next); setActiveId(event.id); closeDjOverlay(() => setShowCreate(false)); setForm({ name: '', contact: '', yapeNumber: '', thankYou: '', qrImage: '', tipsRequired: false }); setNotice(`${t('eventCreated')} ${event.code}`); setTimeout(() => setNotice(''), 5000)
    } catch {
      setNotice(t('createFailed'))
    }
  }

  if (loading) return <div className="grid min-h-screen place-items-center bg-ink px-5 text-center text-sm text-white/50">{t('accessChecking')}</div>
  if (loadError) return <div className="grid min-h-screen place-items-center bg-ink bg-grid px-5 text-center"><div className="glass w-full max-w-md rounded-[2rem] p-7"><Headphones size={30} className="mx-auto mb-4 text-violet-200" /><h1 className="font-display text-2xl font-bold text-white">Panel de DJ</h1><p className="mt-3 text-sm leading-6 text-white/60">{loadError}</p><button type="button" onClick={onExit} className="btn-primary mt-6 w-full">Volver</button></div></div>
  if (!activeEvent) return <AppShell onHome={onExit} right={<div className="flex items-center gap-2"><EmailVerificationBadge access={access} /><AccessCountdown access={access} />{access?.role !== 'admin' && <button onClick={() => openDjOverlay('plans')} className="inline-flex rounded-full border border-turquoise/30 bg-turquoise/10 px-3 py-1.5 text-[11px] font-bold text-turquoise transition hover:bg-turquoise/20">Adquirir un plan</button>}{access?.role === 'admin' && <button onClick={() => openDjOverlay('admin')} className="btn-secondary px-3 py-2 text-sm"><Crown size={16} /> Desarrollador</button>}</div>}><PageContainer><PlanCountdownCard access={access} /><div className="mx-auto max-w-lg glass rounded-2xl p-6"><Headphones size={28} className="mx-auto mb-3 text-violet-200" /><p className="mb-5 text-center text-white/60">{t('noEvents')}</p><form onSubmit={createEvent} className="space-y-3"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-dark" placeholder={t('eventName')} /><button className="btn-primary w-full"><Plus size={17} /> {t('create')}</button></form></div>{showPlans && <Modal title="Adquirir un plan" onClose={() => closeDjOverlay(() => setShowPlans(false))}><p className="mb-3 text-sm leading-6 text-white/55">Elige un plan, realiza el pago y envía tu comprobante para activar o renovar tu acceso.</p><PlanCards token={access?.token} email={access?.email} /></Modal>}{showAdmin && access?.role === 'admin' && <AdminPanel session={access} onClose={() => closeDjOverlay(() => setShowAdmin(false))} />}</PageContainer></AppShell>
  return <AppShell onHome={onExit} right={<div className="flex items-center gap-2"><EmailVerificationBadge access={access} /><AccessCountdown access={access} />{access?.role !== 'admin' && <button onClick={() => openDjOverlay('plans')} className="inline-flex rounded-full border border-turquoise/30 bg-turquoise/10 px-3 py-1.5 text-[11px] font-bold text-turquoise transition hover:bg-turquoise/20">Adquirir un plan</button>}{access?.role === 'admin' && <button onClick={() => openDjOverlay('admin')} className="btn-secondary px-3 py-2 text-sm"><ShieldCheck size={16} /> <span className="hidden sm:inline">Desarrollador</span></button>}</div>}><PageContainer><PlanCountdownCard access={access} /><div className="mb-7 flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div><p className="eyebrow text-violet-200">{t('panelTitle')}</p><h1 className="mt-2 font-display text-4xl font-bold tracking-tight sm:text-5xl">{t('panelHeading')}</h1><p className="mt-3 text-sm text-white/50">{t('panelDescription')}</p></div><div className="flex w-full min-w-0 flex-col items-end gap-2 lg:w-auto"><div className="grid w-full min-w-0 grid-cols-3 gap-1.5 sm:flex sm:justify-end sm:gap-2"><button onClick={() => openDjOverlay('create')} className="btn-primary flex min-w-0 w-full items-center justify-center gap-1 px-1.5 py-2 text-[9px] leading-tight sm:w-auto sm:shrink-0 sm:whitespace-nowrap sm:px-3 sm:text-xs lg:text-sm"><Plus size={14} /><span className="sm:hidden">Nuevo</span><span className="hidden sm:inline">Nuevo evento</span></button><button onClick={downloadSongRecord} disabled={!activeEvent?.requests?.length} className="btn-secondary flex min-w-0 w-full items-center justify-center gap-1 px-1.5 py-2 text-[9px] leading-tight sm:w-auto sm:shrink-0 sm:whitespace-nowrap sm:px-3 sm:text-xs lg:text-sm disabled:cursor-not-allowed disabled:opacity-40"><Download size={14} /><span className="sm:hidden">Registro</span><span className="hidden sm:inline">Descargar registro</span></button>{!activeEvent.finalized && <button onClick={() => openDjOverlay('finalize')} className="flex min-w-0 w-full items-center justify-center gap-1 whitespace-nowrap rounded-xl border border-amber-300/30 bg-amber-300/10 px-1.5 py-2 text-[9px] font-bold leading-tight text-amber-200 transition hover:bg-amber-300/20 sm:w-auto sm:shrink-0 sm:px-3 sm:text-xs lg:text-sm"><CircleAlert size={14} /><span className="sm:hidden">Finalizar</span><span className="hidden sm:inline">Finalizar evento</span></button>}{activeEvent.finalized && <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-amber-300/30 bg-amber-300/10 px-2.5 py-2 text-[10px] font-bold text-amber-200 sm:px-3 sm:text-xs lg:text-sm"><CheckCircle2 size={15} /> {t('eventFinalizedLabel')}</span>}</div>{!activeEvent.finalized && <button onClick={() => openDjOverlay('settings')} className="btn-secondary shrink-0 whitespace-nowrap px-3 py-1.5 text-[11px] sm:text-xs"><Settings2 size={15} /> Ajustes</button>}</div></div><section className="mb-5 flex flex-col gap-2 rounded-xl border border-turquoise/25 bg-turquoise/10 p-2.5 sm:flex-row sm:items-center sm:justify-between sm:p-3"><div><p className="flex items-center gap-2 text-sm font-bold text-turquoise"><Crown size={15} /> ¿Quieres seguir usando el Panel de DJ?</p><p className="mt-0.5 text-[11px] leading-4 text-white/55">Adquiere o renueva tu plan y mantén habilitado tu acceso al catálogo privado.</p><PlanOfferSummary /></div><button type="button" onClick={() => openDjOverlay('plans')} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-turquoise px-3 py-2 text-xs font-extrabold text-ink transition hover:bg-turquoise/85">Adquirir un plan <ExternalLink size={16} /></button></section>{presenceNotice && <div className="fixed left-1/2 top-5 z-[90] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-2xl border border-emerald-300/30 bg-[#071c1a]/95 px-4 py-3 text-xs font-bold text-emerald-200 shadow-2xl shadow-emerald-400/10 sm:text-sm"><UserRound size={17} /> {presenceNotice}</div>}{notice && <div className="fixed bottom-5 left-1/2 z-[80] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-2xl border border-neon/30 bg-ink/95 px-3 py-3 text-xs font-bold text-neon shadow-2xl shadow-neon/10 sm:px-5 sm:text-sm">{noticeLoading ? <LoaderCircle size={18} className="animate-spin" /> : <Check size={18} />} {notice}</div>}<button onClick={() => openDjOverlay('chat')} className="mb-4 inline-flex items-center justify-center gap-2 rounded-full border border-neon/30 bg-neon/10 px-3 py-2 text-xs font-semibold text-neon transition hover:bg-neon/20"><MessageCircleHeart size={17} /> {t('chatRoom')}</button><section className="mb-7 flex flex-col gap-4 rounded-[2rem] border border-violet/20 bg-violet/10 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div className="flex min-w-0 items-center gap-3"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-violet/30 text-violet-100"><Headphones size={23} /></div><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-200/70">{t('activeEvent')}</p><div className="mt-1 flex items-center gap-2"><h2 className="truncate font-display text-xl font-bold">{activeEvent.name}</h2><span className="rounded-lg bg-white/10 px-2 py-1 text-xs font-bold tracking-widest text-neon">{activeEvent.code}</span><span className="flex items-center gap-1.5 text-[11px] font-light text-emerald-200/75"><span className="grid h-5 w-5 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-cyan-500 text-white shadow-[0_0_10px_rgba(34,211,238,.35)]"><UserRound size={13} strokeWidth={2.5} /></span>{onlineCount} en línea</span></div></div></div><div className="flex items-center gap-2"><select value={activeEvent.id} onChange={(e) => setActiveId(e.target.value)} className="rounded-xl border border-white/10 bg-ink/50 px-3 py-2 text-sm text-white outline-none"><option value={activeEvent.id}>{activeEvent.name}</option>{events.filter((event) => event.id !== activeEvent.id).map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select><button onClick={removeActiveEvent} className="rounded-xl border border-red-300/20 bg-red-400/10 p-2.5 text-red-200 transition hover:border-red-300/40 hover:bg-red-400/20" title="Eliminar evento" aria-label="Eliminar evento"><Trash2 size={17} /></button></div></section><section className="mb-5 rounded-2xl border border-turquoise/20 bg-turquoise/[.06] px-3 py-2.5 sm:px-4"><a href={BACKUP_DRIVE_URL} target="_blank" rel="noreferrer" className="flex w-full items-center justify-center gap-2 rounded-xl bg-turquoise px-4 py-3 text-sm font-extrabold text-ink transition hover:bg-turquoise/85"><GoogleDriveIcon size={18} /><span>Backup actualizado en Drive</span><ExternalLink size={14} /></a></section><div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3"><Stat icon={ListMusic} label={t('totalRequests')} value={activeEvent.requests?.length || 0} onClick={() => focusQueue('all')} /><Stat icon={Clock3} label={t('queued')} value={pending} accent="lime" onClick={() => focusQueue('pending')} /><Stat icon={CheckCircle2} label={t('played')} value={played} accent="violet" onClick={() => focusQueue('played')} /><Stat icon={CircleAlert} label={t('notFound')} value={notFound} accent="amber" onClick={() => focusQueue('not-found')} /></div><section id="dj-request-queue" className="scroll-mt-24 overflow-hidden rounded-[2rem] border border-white/10 bg-white/[.035]"><div className="flex flex-col justify-between gap-4 border-b border-white/10 p-4 sm:flex-row sm:items-center sm:p-5"><div><div className="flex items-center gap-2"><BarChart3 size={19} className="text-neon" /><h2 className="font-display text-xl font-bold">{t('requestQueue')}</h2><span className="flex h-2 w-2 animate-pulse rounded-full bg-emerald-300" /></div><p className="mt-1 text-xs text-white/40">{t('queueLive')}</p><div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-[10px] font-bold uppercase tracking-widest text-white/35">{t('sortRequests')}:</span><button onClick={() => setSortMode('recent')} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${sortMode === 'recent' ? 'bg-violet-200 text-ink' : 'bg-white/10 text-white/55'}`}>{t('sortRecent')}</button><button onClick={() => setSortMode('likes')} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${sortMode === 'likes' ? 'bg-neon text-ink' : 'bg-white/10 text-white/55'}`}>{t('sortLikes')}</button></div></div><div className="flex gap-2 overflow-x-auto no-scrollbar"><button onClick={() => setFilter('all')} className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold ${filter === 'all' ? 'bg-white text-ink' : 'bg-white/10 text-white/55'}`}>{t('all')}</button><button onClick={() => setFilter('pending')} className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold ${filter === 'pending' ? 'bg-neon text-ink' : 'bg-white/10 text-white/55'}`}>{t('queued')}</button><button onClick={() => setFilter('played')} className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold ${filter === 'played' ? 'bg-emerald-300 text-ink' : 'bg-white/10 text-white/55'}`}>{t('played')}</button><button onClick={() => setFilter('not-found')} className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold ${filter === 'not-found' ? 'bg-amber-300 text-ink' : 'bg-white/10 text-white/55'}`}>{t('notFound')}</button><button onClick={() => setFilter('awaiting-payment')} className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold ${filter === 'awaiting-payment' ? 'bg-violet-200 text-ink' : 'bg-white/10 text-white/55'}`}>{t('paymentPending')} {awaitingPayment ? `(${awaitingPayment})` : ''}</button></div></div>{requests.length ? requests.map((request) => <DjRequestRow key={request.id} request={request} onStatus={markStatus} onPreview={(request) => { openDjOverlay('preview', request); setPreview(request) }} onProof={(proof) => { openDjOverlay('payment', proof); setPaymentProof(proof) }} onDriveSearch={searchDriveForRequest} onDriveCancel={cancelDriveSearch} searchingDrive={driveSearchId === request.id} readOnly={activeEvent.finalized} t={t} />) : <div className="px-5 py-14 text-center text-sm text-white/35"><Music2 size={25} className="mx-auto mb-3 text-white/20" />{t('noSongs')}</div>}</section><div className="mt-6 grid gap-4 md:grid-cols-3"><div className="glass rounded-2xl p-5 md:col-span-2"><div className="flex items-center gap-2 text-sm font-bold"><Settings2 size={17} className="text-violet-200" /> {t('shareAccess')}</div><p className="mt-2 text-sm text-white/50">{t('shareHint')}</p><div className="mt-4 flex items-center justify-between rounded-2xl bg-black/20 p-4"><span className="font-display text-3xl font-bold tracking-[.18em] text-neon">{activeEvent.code}</span><button onClick={() => navigator.clipboard?.writeText(activeEvent.code)} className="btn-secondary px-3 py-2 text-xs">{t('copyCode')}</button></div></div><div className="rounded-2xl border border-neon/20 bg-neon/10 p-5"><Sparkles size={19} className="text-neon" /><p className="mt-3 font-bold text-neon">{t('boothTip')}</p><p className="mt-2 text-sm leading-6 text-white/60">{t('boothTipText')}</p></div></div></PageContainer>{chatOpen && <ChatRoom eventId={activeEvent.id} role="dj" onClose={() => closeDjOverlay(() => setChatOpen(false))} />}{showFinalize && <Modal title={t('finalizeEvent')} onClose={() => closeDjOverlay(() => setShowFinalize(false))}><div className="space-y-4"><div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">{t('finalizeEventWarning')}</div><p className="text-sm leading-6 text-white/60">{t('finalizeEventDetails')}</p><div className="flex gap-3"><button type="button" onClick={() => setShowFinalize(false)} className="btn-secondary flex-1">{t('cancel')}</button><button type="button" onClick={finishActiveEvent} className="flex-1 rounded-xl bg-amber-300 px-4 py-3 text-sm font-extrabold text-ink hover:bg-amber-200">{t('confirmFinalize')}</button></div></div></Modal>}{showSettings && <Modal title={t('configureProfile')} onClose={() => closeDjOverlay(() => setShowSettings(false))}><form onSubmit={saveProfile} className="space-y-4"><p className="text-sm leading-6 text-white/55">{t('profileHint')}</p><label className="block"><span className="mb-2 block text-sm font-semibold text-white/75">{t('stageName')}</span><input value={profileForm.djName} onChange={(e) => setProfileForm({ ...profileForm, djName: e.target.value })} className="input-dark" placeholder={t('stageNamePlaceholder')} /></label><label className="block"><span className="mb-2 block text-sm font-semibold text-white/75">{t('yapeNameNumber')}</span><input value={profileForm.yapeNumber} onChange={(e) => setProfileForm({ ...profileForm, yapeNumber: e.target.value })} className="input-dark" placeholder={t('yapeProfilePlaceholder')} /></label><label className="block"><span className="mb-2 block text-sm font-semibold text-white/75">{t('bookingContact')}</span><input value={profileForm.contact} onChange={(e) => setProfileForm({ ...profileForm, contact: e.target.value })} className="input-dark" placeholder={t('bookingContactPlaceholder')} /></label><label className="block"><span className="mb-2 block text-sm font-semibold text-white/75">{t('guestMessage')}</span><textarea value={profileForm.thankYou} onChange={(e) => setProfileForm({ ...profileForm, thankYou: e.target.value })} className="input-dark min-h-24 resize-none" placeholder={t('thanksPlaceholder')} maxLength={150} /><span className="mt-1 block text-right text-[10px] text-white/35">{profileForm.thankYou.length}/150</span></label><div className="rounded-2xl border border-neon/20 bg-neon/10 p-4"><div className="flex items-center gap-2 text-neon"><ImagePlus size={18} /><span className="text-sm font-bold">{t('qrImageLabel')}</span></div><p className="mt-1 text-xs leading-5 text-white/55">{t('qrImageHint')}</p><label className="mt-3 inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-neon/30 bg-black/20 px-3 py-2.5 text-xs font-bold text-neon hover:bg-neon/10"><ImagePlus size={15} />{qrLoading ? t('qrImageLoading') : t('qrImageLabel')}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={qrLoading} onChange={handleQrUpload} className="sr-only" /></label>{profileForm.qrImage && <div className="mt-3 flex items-center gap-3 rounded-xl bg-white p-3"><img src={profileForm.qrImage} alt={t('qrImageLabel')} className="h-24 w-24 rounded-lg object-contain" /><button type="button" onClick={() => setProfileForm({ ...profileForm, qrImage: '' })} className="rounded-lg bg-red-500/10 px-2.5 py-2 text-xs font-bold text-red-200">{t('removeQrImage')}</button></div>}</div><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_130px]"><label className="flex items-start gap-3 rounded-2xl border border-violet/25 bg-violet/10 p-4"><input type="checkbox" checked={profileForm.tipsRequired} onChange={(e) => setProfileForm({ ...profileForm, tipsRequired: e.target.checked })} className="mt-1 h-4 w-4 accent-[#b8ff3d]" /><span><span className="block text-sm font-bold text-white/85">{t('requireTipForRequests')}</span><span className="mt-1 block text-xs leading-5 text-white/50">{t('requireTipHint')}</span></span></label>{profileForm.tipsRequired && <><label className="flex items-start gap-3 rounded-2xl border border-violet/25 bg-violet/10 p-3 sm:col-span-2"><input type="checkbox" checked={profileForm.fixedTipAmount} onChange={(e) => setProfileForm({ ...profileForm, fixedTipAmount: e.target.checked, tipAmount: e.target.checked ? profileForm.tipAmount : '' })} className="mt-1 h-4 w-4 accent-[#b8ff3d]" /><span><span className="block text-sm font-bold text-white/85">Activar monto fijo</span><span className="mt-1 block text-xs leading-5 text-white/50">Si lo desactivas, el asistente podrá dejar una propina voluntaria.</span></span></label>{profileForm.fixedTipAmount && <><label className="block rounded-2xl border border-violet/25 bg-violet/10 p-3"><span className="mb-1 block text-[11px] font-semibold text-white/55">Moneda de la propina</span><select value={profileForm.tipCurrency} onChange={(e) => setProfileForm({ ...profileForm, tipCurrency: e.target.value })} className="input-dark py-2 text-sm"><option value="PEN">S/ · Sol peruano</option><option value="USD">$ · Dólar estadounidense</option><option value="EUR">€ · Euro de Francia</option><option value="BRL">R$ · Real brasileño</option><option value="CNY">¥ · Yuan chino</option><option value="JPY">¥ · Yen japonés</option></select></label><label className="block rounded-2xl border border-violet/25 bg-violet/10 p-3"><span className="mb-1 block text-[11px] font-semibold text-white/55">Monto de la propina</span><input type="number" min="0.01" step="0.01" required value={profileForm.tipAmount} onChange={(e) => setProfileForm({ ...profileForm, tipAmount: e.target.value })} className="input-dark py-2 text-sm" placeholder="Ej. 5.00" /></label></>}</>}</div><button disabled={qrLoading} className="btn-primary w-full"><Check size={17} /> {t('saveProfile')}</button></form></Modal>}{showCreate && <Modal title={t('createEvent')} onClose={() => closeDjOverlay(() => setShowCreate(false))}><form onSubmit={createEvent} className="space-y-4"><label className="block"><span className="mb-2 block text-sm font-semibold text-white/75">{t('eventName')} <span className="text-neon">*</span></span><input autoFocus required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-dark" placeholder={t('newEventName')} /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="mb-2 block text-sm font-semibold text-white/75">{t('contact')}</span><input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} className="input-dark" placeholder={t('contactPlaceholder')} /></label><label className="block"><span className="mb-2 block text-sm font-semibold text-white/75">{t('yape')}</span><input value={form.yapeNumber} onChange={(e) => setForm({ ...form, yapeNumber: e.target.value })} className="input-dark" placeholder={t('yapePlaceholder')} /></label></div><label className="block"><span className="mb-2 block text-sm font-semibold text-white/75">{t('guestMessage')}</span><textarea value={form.thankYou} onChange={(e) => setForm({ ...form, thankYou: e.target.value })} className="input-dark min-h-24 resize-none" placeholder={t('thanksPlaceholder')} maxLength={150} /></label><div className="rounded-2xl border border-white/10 bg-white/[.03] p-4"><div className="flex items-center gap-2"><ImagePlus size={18} className="text-neon" /><span className="text-sm font-semibold text-white/75">Imagen QR de Yape</span></div><p className="mt-1 text-xs leading-5 text-white/45">El QR aparecerá a tus invitados antes de pedir una canción.</p><input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleEventQrUpload} className="input-dark mt-3 text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-neon file:px-3 file:py-2 file:font-bold file:text-ink" />{form.qrImage && <div className="mt-3 flex items-center gap-3 rounded-xl bg-white p-3"><img src={form.qrImage} alt="QR de Yape" className="h-20 w-20 rounded-lg object-contain" /><button type="button" onClick={() => setForm({ ...form, qrImage: '' })} className="rounded-lg bg-red-500/10 px-2.5 py-2 text-xs font-bold text-red-200">Quitar QR</button></div>}</div><button className="btn-primary w-full"><Plus size={18} /> {t('create')}</button></form></Modal>}{preview && <Modal title={t('preview')} onClose={() => closeDjOverlay(() => setPreview(null))}><div className="overflow-hidden rounded-2xl bg-black"><PreviewFrame track={preview} /></div><h3 className="mt-4 font-bold">{preview.title}</h3><p className="mt-1 text-sm text-white/50">{preview.artist}</p></Modal>}{paymentProof && <Modal title={t('paymentProof')} onClose={() => closeDjOverlay(() => setPaymentProof(''))}><div className="rounded-2xl bg-white p-3"><img src={paymentProof} alt={t('paymentProof')} className="mx-auto max-h-[65vh] w-full object-contain" /></div></Modal>}{downloadOptions && <Modal title={t('downloadOptionsTitle')} onClose={() => closeDjOverlay(() => { if (drivePreview.url) URL.revokeObjectURL(drivePreview.url); setDrivePreview({ id: '', url: '', loading: false }); setDownloadOptions(null) })}><p className="mb-5 text-sm leading-6 text-white/55">{downloadOptions.query ? <>Búsqueda: <span className="font-semibold text-white/80">{downloadOptions.query}</span></> : t('downloadOptionsHint')}</p><div className="space-y-3">{downloadOptions.matches.length === 0 && <p className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/45">{t('driveNoMatches')}</p>}{downloadOptions.matches.map((file) => <article key={file.id} className="rounded-2xl border border-white/10 bg-white/[.04] p-4"><p className="font-semibold text-white">{file.name}</p><p className="mt-1 text-xs text-white/45">{file.mimeType || 'Audio'}{file.size ? ` · ${Math.round(Number(file.size) / 1024 / 1024 * 10) / 10} MB` : ''}</p>{drivePreview.id === file.id && drivePreview.url && <audio className="mt-3 w-full" controls autoPlay src={drivePreview.url} />}{drivePreview.id === file.id && drivePreview.loading && <p className="mt-3 text-xs text-white/45">{t('loadingPreview')}</p>}<div className="mt-3 flex gap-2"><button type="button" onClick={() => previewDriveFile(file)} className="btn-secondary flex-1 whitespace-nowrap px-2 py-2 text-[11px] sm:px-3 sm:text-xs" disabled={drivePreview.loading}>{drivePreview.id === file.id && drivePreview.loading ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={14} />} {drivePreview.id === file.id && drivePreview.loading ? t('loadingPreview') : t('playPreview')}</button><button type="button" onClick={() => downloadSelectedDriveFile(file)} className="btn-primary flex-1 whitespace-nowrap px-2 py-2 text-[11px] sm:px-3 sm:text-xs" disabled={Boolean(downloadingFileId)}>{downloadingFileId === file.id ? <LoaderCircle size={14} className="animate-spin" /> : <Download size={14} />} {downloadingFileId === file.id ? t('downloadPleaseWait') : t('downloadAudio')}</button></div></article>)}</div></Modal>}{showPlans && <Modal title="Adquirir un plan" onClose={() => closeDjOverlay(() => setShowPlans(false))}><p className="mb-3 text-sm leading-6 text-white/55">Elige un plan, realiza el pago y envía tu comprobante para activar o renovar tu acceso.</p><PlanCards token={access?.token} email={access?.email} /></Modal>}{showAdmin && access?.role === 'admin' && <AdminPanel session={access} onClose={() => closeDjOverlay(() => setShowAdmin(false))} />}</AppShell>
}
