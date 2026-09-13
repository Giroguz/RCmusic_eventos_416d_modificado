import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseEnabled = Boolean(url && anonKey && !String(url).includes('tu-proyecto'))
export const supabase = supabaseEnabled ? createClient(url, anonKey) : null
const SESSION_KEY = 'rc_music_dj_session_v1'

export function getStoredDjSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    // Keep the in-tab copy available while also restoring the session after a reload.
    if (!sessionStorage.getItem(SESSION_KEY)) sessionStorage.setItem(SESSION_KEY, raw)
    return JSON.parse(raw)
  } catch { return null }
}
function storeDjSession(value) {
  try {
    if (value) {
      const raw = JSON.stringify(value)
      sessionStorage.setItem(SESSION_KEY, raw)
      localStorage.setItem(SESSION_KEY, raw)
    } else {
      sessionStorage.removeItem(SESSION_KEY)
      localStorage.removeItem(SESSION_KEY)
    }
  } catch {}
}

export async function ensureAnonymousSession() {
  if (!supabase) return null
  const { data: existing } = await supabase.auth.getSession()
  if (existing.session) return existing.session
  const { data, error } = await supabase.auth.signInAnonymously()
  if (error) throw error
  return data.session
}

// DJ access is deliberately not backed by a shared frontend password. The RPC validates
// a per-DJ code server-side and returns a short-lived, revocable session token.
export async function sendEmailVerificationLink(email) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: true, emailRedirectTo: window.location.origin } })
  if (error) throw error
}

export async function startDjTrial(email, displayName) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('dj_start_trial', { p_email: email.trim().toLowerCase(), p_display_name: displayName.trim() })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row?.generated_code) throw new Error('Trial unavailable')
  return row
}

export async function signInDj(email, code) {
  if (!supabase) throw new Error('Supabase is not configured')
  const loginRequest = supabase.rpc('dj_login', { p_email: email.trim().toLowerCase(), p_code: code })
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('LOGIN_TIMEOUT')), 15000))
  const { data, error } = await Promise.race([loginRequest, timeout])
  if (error) throw error
  const access = Array.isArray(data) ? data[0] : data
  if (!access?.session_token) throw new Error('Access denied')
  const session = { token: access.session_token, ...access }
  delete session.session_token
  session.token = access.session_token
  if (access.role !== 'admin' && (!access.plan_expires_at || new Date(access.plan_expires_at).getTime() <= Date.now())) {
    // Keep the short-lived DJ session available so the renewal form can submit a proof.
    storeDjSession(session)
    const expired = new Error('DJ plan expired')
    expired.access = session
    throw expired
  }
  storeDjSession(session)
  return session
}

export async function getDjAccess(token = getStoredDjSession()?.token) {
  if (!supabase || !token) return null
  const { data, error } = await supabase.rpc('dj_check_access', { p_token: token })
  if (error) throw error
  const access = Array.isArray(data) ? data[0] : data
  if (!access?.is_active) { storeDjSession(null); return null }
  return { token, ...access }
}

export async function signOutDj(token = getStoredDjSession()?.token) {
  if (supabase && token) await supabase.rpc('dj_logout', { p_token: token }).catch(() => {})
  storeDjSession(null)
}

function mapRequest(row) {
  const rawVideoId = String(row.video_id || ''); const source = rawVideoId.match(/^(spotify|deezer|soundcloud):/)?.[1] || 'youtube'; const videoId = rawVideoId.replace(/^(spotify|deezer|soundcloud):/, ''); const externalUrl = source === 'deezer' ? `https://www.deezer.com/track/${videoId}` : source === 'soundcloud' ? `https://soundcloud.com/search/sounds?q=${encodeURIComponent(`${row.title} ${row.artist}`)}` : ''; return { id: row.id, title: row.title, artist: row.artist, videoId, source, spotifyId: videoId, externalUrl, thumbnail: row.thumbnail, requester: row.requester, dedication: row.dedication || '', paymentProof: row.payment_proof || '', likes: row.likes || 0, status: row.status, createdAt: row.created_at }
}
export function mapEvent(row, requests = []) {
  return { id: row.id, code: row.code, name: row.name, djName: row.dj_name, contact: row.contact || '', yapeNumber: row.yape_number || '', thankYou: row.thank_you || '', qrImage: row.qr_image_url || '', tipsRequired: Boolean(row.tips_required), tipCurrency: String(row.tip_currency || 'PEN').toUpperCase(), tipAmount: Number(row.tip_amount || 0), finalized: Boolean(row.finalized_at || row.finalized), finalizedAt: row.finalized_at || null, createdAt: row.created_at, requests: requests.map(mapRequest) }
}

export async function getPublicEvent(query) {
  if (!supabase) return null
  await ensureAnonymousSession()
  const normalized = query.trim().toUpperCase()
  const { data: event, error } = await supabase.from('events').select('*').eq('code', normalized).maybeSingle()
  if (error) throw error
  if (!event) return null
  const { data: requests, error: requestsError } = await supabase.from('song_requests').select('id,video_id,title,artist,thumbnail,requester,dedication,likes,status,created_at').eq('event_id', event.id).order('likes', { ascending: false })
  if (requestsError) throw requestsError
  return mapEvent(event, requests || [])
}

export async function getDjEvents(token = getStoredDjSession()?.token) {
  if (!supabase || !token) return []
  const { data, error } = await supabase.rpc('dj_get_events', { p_token: token })
  if (error) throw error
  return (data || []).map((row) => mapEvent(row, row.requests || []))
}

export async function deleteDjEvent(eventId, token = getStoredDjSession()?.token) {
  if (!supabase || !token) throw new Error('DJ session required')
  const { error } = await supabase.rpc('dj_delete_event', { p_token: token, p_event_id: eventId })
  if (error) throw error
}

export async function createDjEvent(input, token = getStoredDjSession()?.token) {
  if (!supabase || !token) throw new Error('DJ session required')
  const { data, error } = await supabase.rpc('dj_create_event', { p_token: token, p_code: input.code, p_name: input.name, p_dj_name: input.djName, p_contact: input.contact, p_yape_number: input.yapeNumber, p_thank_you: input.thankYou })
  if (error) throw error
  return mapEvent(Array.isArray(data) ? data[0] : data, [])
}

export async function updateDjEventInfo(eventId, input, token = getStoredDjSession()?.token) {
  if (!supabase || !token) throw new Error('DJ session required')
  const { data, error } = await supabase.rpc('dj_update_event_info', { p_token: token, p_event_id: eventId, p_dj_name: input.djName, p_yape_number: input.yapeNumber, p_contact: input.contact, p_thank_you: input.thankYou || '' })
  if (error) throw error
  return mapEvent(Array.isArray(data) ? data[0] : data, [])
}

export async function updateDjEventQr(eventId, qrImage, token = getStoredDjSession()?.token) {
  if (!supabase || !token) throw new Error('DJ session required')
  const { data, error } = await supabase.rpc('dj_update_event_qr', { p_token: token, p_event_id: eventId, p_qr_image: qrImage || null })
  if (error) throw error
  return data
}

export async function updateDjEventTipSettings(eventId, tipsRequired, tipCurrency = 'PEN', tipAmount = 0, token = getStoredDjSession()?.token) {
  if (!supabase || !token) throw new Error('DJ session required')
  const { data, error } = await supabase.rpc('dj_update_event_tip_settings', { p_token: token, p_event_id: eventId, p_tips_required: Boolean(tipsRequired), p_tip_currency: String(tipCurrency || 'PEN').toUpperCase(), p_tip_amount: Number(tipAmount || 0) })
  if (error) throw error
  return Boolean(data)
}

export async function getDjEventQr(eventId, token = getStoredDjSession()?.token) {
  if (!supabase || !token) return ''
  const { data, error } = await supabase.rpc('dj_get_event_qr', { p_token: token, p_event_id: eventId })
  if (error) throw error
  return data || ''
}

export async function finalizeDjEvent(eventId, token = getStoredDjSession()?.token) {
  if (!supabase || !token) throw new Error('DJ session required')
  const { data, error } = await supabase.rpc('dj_finalize_event', { p_token: token, p_event_id: eventId })
  if (error) throw error
  try {
    const channel = supabase.channel(`event-chat-${eventId}`)
    await new Promise((resolve) => channel.subscribe(() => resolve()))
    await channel.send({ type: 'broadcast', event: 'event_finalized', payload: { eventId } })
    await supabase.removeChannel(channel)
  } catch {}
  return data
}

export async function addSongRequest(eventId, song, form) {
  const { data, error } = await supabase.rpc('submit_song_request', { p_event_id: eventId, p_video_id: song.source === 'youtube' ? song.id : `${song.source}:${song.id}`, p_title: song.title, p_artist: song.artist, p_thumbnail: song.thumbnail, p_requester: form.requester || 'Anónimo', p_dedication: form.dedication || null, p_payment_proof: form.paymentProof || null })
  if (error) throw error
  return mapRequest(Array.isArray(data) ? data[0] : data)
}
export async function likeSongRequest(requestId) { const { error } = await supabase.rpc('like_request', { request_uuid: requestId }); if (error) throw error }
export async function setRequestStatus(requestId, status, token = getStoredDjSession()?.token) {
  if (status === 'not-found' || status === 'pending') {
    const { error } = await supabase.rpc('dj_set_request_not_found', { p_token: token, p_request_id: requestId, p_not_found: status === 'not-found' })
    if (!error) return
  }
  const { error } = await supabase.rpc('dj_set_request_status', { p_token: token, p_request_id: requestId, p_status: status })
  if (error) throw error
}

function account(row) { return { id: row.id, email: row.email, displayName: row.display_name, role: row.role, approved: row.approved, blocked: row.blocked, planType: row.plan_type, planStartedAt: row.plan_started_at, planExpiresAt: row.plan_expires_at, daysUsed: row.days_used, daysRemaining: row.days_remaining, isActive: row.is_active, generatedCode: row.generated_code, planPausedRemainingSeconds: row.plan_paused_remaining_seconds } }
export async function adminListDjs(token) { const { data, error } = await supabase.rpc('admin_list_djs', { p_token: token }); if (error) throw error; return (data || []).map(account) }
export async function adminCreateDj(input, token) { const { data, error } = await supabase.rpc('admin_create_dj', { p_token: token, p_email: input.email, p_display_name: input.displayName, p_plan_type: input.planType || 'monthly' }); if (error) throw error; return account(Array.isArray(data) ? data[0] : data) }
export async function adminSetDjState(id, state, token) { const { data, error } = await supabase.rpc('admin_set_dj_state', { p_token: token, p_dj_id: id, p_approved: state.approved, p_blocked: state.blocked }); if (error) throw error; return account(Array.isArray(data) ? data[0] : data) }
export async function adminUpdateDj(id, input, token) { const { data, error } = await supabase.rpc('admin_update_dj', { p_token: token, p_dj_id: id, p_email: input.email, p_display_name: input.displayName }); if (error) throw error; return account(Array.isArray(data) ? data[0] : data) }
export async function adminActivateDj(id, input, token) { const { data, error } = await supabase.rpc('admin_activate_dj', { p_token: token, p_dj_id: id || null, p_email: input.email, p_display_name: input.displayName, p_access_code: null, p_plan_type: input.planType }); if (error) throw error; return account(Array.isArray(data) ? data[0] : data) }
export async function adminSetDjPlan(id, planType, token) { const { data, error } = await supabase.rpc('admin_set_dj_plan', { p_token: token, p_dj_id: id, p_plan_type: planType }); if (error) throw error; return account(Array.isArray(data) ? data[0] : data) }
export async function adminRegenerateCode(id, token) { const { data, error } = await supabase.rpc('admin_regenerate_code', { p_token: token, p_dj_id: id }); if (error) throw error; return account(Array.isArray(data) ? data[0] : data) }
export async function adminGetSubscriptionQr(token) { if (!supabase || !token) return ''; const { data, error } = await supabase.rpc('admin_get_subscription_qr', { p_token: token }); if (error) throw error; return data || '' }
export async function adminSetSubscriptionQr(qrImage, token) { if (!supabase || !token) throw new Error('Admin session required'); const { data, error } = await supabase.rpc('admin_set_subscription_qr', { p_token: token, p_qr_image: qrImage || null }); if (error) throw error; return data || '' }
export async function adminGetSubscriptionYapeNumber(token) { if (!supabase || !token) return ''; const { data, error } = await supabase.rpc('admin_get_subscription_yape_number', { p_token: token }); if (error) throw error; return data || '' }
export async function adminSetSubscriptionYapeNumber(yapeNumber, token) { if (!supabase || !token) throw new Error('Admin session required'); const { data, error } = await supabase.rpc('admin_set_subscription_yape_number', { p_token: token, p_yape_number: yapeNumber || null }); if (error) throw error; return data || '' }
export async function adminGetNotificationSettings(token) { if (!supabase || !token) throw new Error('Admin session required'); const { data, error } = await supabase.rpc('admin_get_notification_settings', { p_token: token }); if (error) throw error; return Array.isArray(data) ? (data[0] || {}) : (data || {}) }
export async function adminSetNotificationSettings(input, token) { if (!supabase || !token) throw new Error('Admin session required'); const { data, error } = await supabase.rpc('admin_set_notification_settings', { p_token: token, p_notification_email: input.email || null, p_notification_whatsapp: input.whatsapp || null }); if (error) throw error; return Array.isArray(data) ? (data[0] || {}) : (data || {}) }
export async function getSubscriptionPlanPrices() { if (!supabase) return []; const { data, error } = await supabase.rpc('get_subscription_plan_prices'); if (error) return []; return data || [] }
export async function adminGetSubscriptionPlanPrices(token) { if (!supabase || !token) return []; const { data, error } = await supabase.rpc('admin_get_subscription_plan_prices', { p_token: token }); if (error) throw error; return data || [] }
export async function adminSetSubscriptionPlanPrices(prices, token) { if (!supabase || !token) throw new Error('Admin session required'); const byType = Object.fromEntries((prices || []).map((item) => [item.planType || item.plan_type, item])); const { data, error } = await supabase.rpc('admin_set_subscription_plan_prices', { p_token: token, p_fifteen_days: Number(byType.fifteen?.days), p_fifteen_price: Number(byType.fifteen?.pricePen ?? byType.fifteen?.price_pen), p_monthly_days: Number(byType.monthly?.days), p_monthly_price: Number(byType.monthly?.pricePen ?? byType.monthly?.price_pen), p_annual_days: Number(byType.annual?.days), p_annual_price: Number(byType.annual?.pricePen ?? byType.annual?.price_pen) }); if (error) throw error; return data || [] }
export async function adminGetDemoDays(token) { if (!supabase || !token) return 1; const { data, error } = await supabase.rpc('admin_get_demo_days', { p_token: token }); if (error) throw error; return Number(data || 1) }
export async function adminSetDemoDays(days, token) { if (!supabase || !token) throw new Error('Admin session required'); const { data, error } = await supabase.rpc('admin_set_demo_days', { p_token: token, p_demo_days: Number(days) }); if (error) throw error; return Number(data || days) }
export async function getDemoDays() { if (!supabase) return 1; const { data, error } = await supabase.rpc('get_demo_days'); if (error) return 1; return Number(data || 1) }
export async function adminExtendDjPlan(id, days, token) { const { data, error } = await supabase.rpc('admin_extend_dj_plan', { p_token: token, p_dj_id: id, p_days: Number(days) }); if (error) throw error; return account(Array.isArray(data) ? data[0] : data) }
export async function getSubscriptionQr() { if (!supabase) return ''; const { data, error } = await supabase.rpc('get_subscription_qr'); if (error) return ''; return data || '' }
export async function getSubscriptionYapeNumber() { if (!supabase) return ''; const { data, error } = await supabase.rpc('get_subscription_yape_number'); if (error) return ''; return data || '' }
export async function submitSubscriptionProof(planType, proofImage, token) { if (!supabase || !token) throw new Error('DJ session required'); const { data, error } = await supabase.rpc('submit_subscription_proof', { p_token: token, p_plan_type: planType, p_proof_image: proofImage }); if (error) throw error; return data }
export async function requestAdminCodeNotification(email) { if (!supabase) throw new Error('Supabase is not configured'); const { data, error } = await supabase.rpc('request_admin_code', { p_email: email.trim().toLowerCase() }); if (error) throw error; return data }
export async function adminListSubscriptionProofs(token) { if (!supabase || !token) return []; const { data, error } = await supabase.rpc('admin_list_subscription_proofs', { p_token: token }); if (error) throw error; return data || [] }
export async function adminReviewSubscriptionProof(id, status, notes, token) { if (!supabase || !token) throw new Error('Admin session required'); const { data, error } = await supabase.rpc('admin_review_subscription_proof', { p_token: token, p_proof_id: id, p_status: status, p_notes: notes || null }); if (error) throw error; return Array.isArray(data) ? data[0] : data }
export async function sendSubscriptionEmail(input) { if (!supabase) throw new Error('Supabase is not configured'); const { data, error } = await supabase.functions.invoke('send-subscription-email', { body: input }); if (error) throw error; if (!data?.ok) throw new Error(data?.error || 'Email failed'); return data }
export async function adminDeleteSubscriptionProof(id, token) { if (!supabase || !token) throw new Error('Admin session required'); const { data, error } = await supabase.rpc('admin_delete_subscription_proof', { p_token: token, p_proof_id: id }); if (error) throw error; return data }
export async function adminDeleteDj(id, token) { if (!supabase || !token) throw new Error('Admin session required'); const { data, error } = await supabase.rpc('admin_delete_dj', { p_token: token, p_dj_id: id }); if (error) throw error; return data }

export function subscribeToEventPresence(eventId, role = 'attendee', callback = () => {}, scope = 'event', countAll = false) {
  if (!supabase || !eventId) return () => {}
  const presenceKey = `${role}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`
  const channel = supabase.channel(`event-presence-${scope}-${eventId}`, { config: { broadcast: { self: false }, presence: { key: presenceKey } } })
  const broadcastSeen = new Map()
  let heartbeatTimer
  let refreshTimer
  let tracked = false
  const countAttendees = () => {
    const state = channel.presenceState()
    const members = Object.values(state).flatMap((metas) => Array.isArray(metas) ? metas : [metas]).filter((presence) => countAll ? Boolean(presence?.role) : presence?.role === 'attendee')
    const memberIds = new Set(members.map((presence) => presence.clientId || `${presence.role}-${presence.joinedAt || JSON.stringify(presence)}`))
    if (tracked && (countAll || role === 'attendee')) memberIds.add(presenceKey)
    const cutoff = Date.now() - 15000
    for (const [clientId, timestamp] of broadcastSeen) {
      if (timestamp < cutoff) broadcastSeen.delete(clientId)
      else if (countAll || clientId.startsWith('attendee-')) memberIds.add(clientId)
    }
    callback(memberIds.size)
  }
  const sendHeartbeat = () => {
    channel.send({ type: 'broadcast', event: 'attendee_presence', payload: { role, clientId: presenceKey, timestamp: Date.now() } }).catch(() => {})
  }
  const reset = () => callback(0)
  channel.on('presence', { event: 'sync' }, countAttendees)
    .on('presence', { event: 'join' }, countAttendees)
    .on('presence', { event: 'leave' }, countAttendees)
    .on('broadcast', { event: 'attendee_presence' }, ({ payload }) => {
      if ((countAll || payload?.role === 'attendee') && payload.clientId) {
        broadcastSeen.set(payload.clientId, Number(payload.timestamp) || Date.now())
        countAttendees()
      }
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try {
          await channel.track({ role, clientId: presenceKey, joinedAt: Date.now() })
          tracked = true
          sendHeartbeat()
          countAttendees()
          heartbeatTimer = setInterval(sendHeartbeat, 5000)
          refreshTimer = setInterval(countAttendees, 3000)
        } catch { tracked = false; reset() }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') reset()
    })
  return () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (refreshTimer) clearInterval(refreshTimer)
    supabase.removeChannel(channel)
  }
}
export function subscribeToEvent(eventId, callback) {
  if (!supabase) return () => {}
  const channel = supabase.channel(`event-${eventId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'song_requests', filter: `event_id=eq.${eventId}` }, callback).subscribe()
  return () => { supabase.removeChannel(channel) }
}
