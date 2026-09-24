import { djLibraryStandalone } from './supabase'

const apiBase = String((djLibraryStandalone ? import.meta.env.VITE_DJ_LIBRARY_API_BASE_URL : import.meta.env.VITE_SPOTIFY_API_BASE_URL) || '').replace(/\/$/, '')
const DRIVE_SESSION_KEY = djLibraryStandalone ? 'pack_dj_drive_session_v1' : 'rc_drive_session'
const DRIVE_RETURN_SCREEN_KEY = djLibraryStandalone ? 'pack_dj_drive_return_screen_v1' : 'rc_drive_return_screen'

function apiUrl(path) {
  if (djLibraryStandalone && !apiBase) throw new Error('DJ_LIBRARY_API_NOT_CONFIGURED')
  return `${apiBase}${path}`
}

function getDriveSession() {
  try { return localStorage.getItem(DRIVE_SESSION_KEY) || sessionStorage.getItem(DRIVE_SESSION_KEY) || '' } catch { return '' }
}

function captureDriveSession() {
  try {
    const url = new URL(window.location.href)
    const session = url.searchParams.get('drive_session')
    if (session) {
      localStorage.setItem(DRIVE_SESSION_KEY, session)
      sessionStorage.setItem(DRIVE_SESSION_KEY, session)
      url.searchParams.delete('drive_session')
      url.searchParams.delete('drive')
      // Keep the SPA route state so Android/browser Back returns to the
      // page that opened Drive instead of resetting the app to Home.
      window.history.replaceState(window.history.state, document.title, url.toString())
    }
  } catch {}
}

captureDriveSession()

function driveRequestHeaders(djToken = '') {
  const driveSession = getDriveSession()
  return { 'Content-Type': 'application/json', ...(driveSession ? { 'X-Drive-Session': driveSession } : {}), ...(djToken ? { 'X-DJ-Session': djToken } : {}) }
}

async function driveFetch(url, options = {}, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const abortFromCaller = () => controller.abort()
  if (options.signal) {
    if (options.signal.aborted) controller.abort()
    else options.signal.addEventListener('abort', abortFromCaller, { once: true })
  }
  try { return await fetch(url, { ...options, signal: controller.signal }) }
  finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}

async function handleDriveResponse(response) {
  if (response.ok) return response
  const error = (await response.json().catch(() => null))?.error
  if (response.status === 401 && error === 'DRIVE_AUTH_REQUIRED' && !djLibraryStandalone) {
    try { localStorage.removeItem(DRIVE_SESSION_KEY); sessionStorage.removeItem(DRIVE_SESSION_KEY); localStorage.setItem(DRIVE_RETURN_SCREEN_KEY, 'dj') } catch {}
    window.location.href = `${apiUrl('/drive/auth')}?returnTo=${encodeURIComponent(window.location.href)}`
  }
  throw new Error(error || 'DOWNLOAD_FAILED')
}

export async function grantDriveFolderAccess(email) {
  captureDriveSession()
  const response = await driveFetch(apiUrl('/drive/grant-folder-access'), { method: 'POST', headers: driveRequestHeaders(), credentials: 'include', body: JSON.stringify({ email }) }, 120000)
  return handleDriveResponse(response).then((value) => value.json())
}

export async function getDriveStatus(djToken) {
  captureDriveSession()
  const response = await driveFetch(apiUrl('/drive/status'), { headers: driveRequestHeaders(djToken), credentials: 'include' }, 30000)
  return handleDriveResponse(response).then((value) => value.json())
}

export function startDriveAuthorization() {
  captureDriveSession()
  window.location.href = `${apiUrl('/drive/auth')}?returnTo=${encodeURIComponent(window.location.href)}`
}

export async function getDriveFolderPermissions(adminToken) {
  captureDriveSession()
  const response = await driveFetch(apiUrl('/drive/folder-permissions'), { headers: driveRequestHeaders(adminToken), credentials: 'include' }, 120000)
  return handleDriveResponse(response).then((value) => value.json())
}

export async function setDriveFolderPermission(email, enabled, durationDays, adminToken) {
  captureDriveSession()
  const response = await driveFetch(apiUrl('/drive/folder-permissions'), { method: 'POST', headers: driveRequestHeaders(adminToken), credentials: 'include', body: JSON.stringify({ email, enabled, durationDays }) }, 120000)
  return handleDriveResponse(response).then((value) => value.json())
}

export async function listDriveAudioCatalog({ query = '', genre = '', offset = 0, limit = 60, refresh = false } = {}, signal, djToken) {
  captureDriveSession()
  const params = new URLSearchParams({ q: String(query || '').trim(), genre: String(genre || ''), offset: String(offset), limit: String(limit), refresh: refresh ? '1' : '0' })
  const response = await driveFetch(`${apiUrl('/drive/catalog')}?${params}`, { headers: driveRequestHeaders(djToken), credentials: 'include', signal }, 120000)
  return handleDriveResponse(response).then((value) => value.json())
}

export async function searchDriveAudio(query, signal, djToken = '') {
  captureDriveSession()
  const response = await driveFetch(`${apiUrl('/drive/search')}?q=${encodeURIComponent(String(query || '').trim())}`, { headers: driveRequestHeaders(djToken), credentials: 'include', signal }, 120000)
  const data = await handleDriveResponse(response).then((value) => value.json())
  return data.matches || []
}

export async function fetchDriveAudio(fileId, djToken = '', { download = false } = {}) {
  captureDriveSession()
  const params = new URLSearchParams({ id: String(fileId || '') })
  if (download) params.set('download', '1')
  const response = await driveFetch(`${apiUrl('/drive/preview')}?${params}`, { headers: driveRequestHeaders(djToken), credentials: 'include' }, 600000)
  return handleDriveResponse(response).then((value) => value.blob())
}

export async function downloadDriveAudio(fileId, fileName = 'cancion', djToken = '') {
  const blob = await fetchDriveAudio(fileId, djToken, { download: djLibraryStandalone })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = String(fileName || 'cancion').replace(/[\p{L}\p{N}_-]+/gu, (value) => value).replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '') || 'cancion'
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url)
}

export async function downloadYoutubeAudio(videoId, _format = 'mp3', fileName = 'cancion', searchQuery = '') {
  captureDriveSession()
  if (!apiBase) throw new Error('DOWNLOAD_API_NOT_CONFIGURED')
  const cleanId = String(videoId || '').replace(/^youtube:/, '')
  const body = /^[A-Za-z0-9_-]{11}$/.test(cleanId)
    ? { videoId: cleanId }
    : { query: String(searchQuery || '').trim() }
  if (!body.videoId && !body.query) throw new Error('INVALID_DOWNLOAD_SOURCE')
  const response = await fetch(apiUrl('/youtube-download'), { method: 'POST', headers: driveRequestHeaders(), credentials: 'include', body: JSON.stringify(body) })
  const blob = await handleDriveResponse(response).then((value) => value.blob())
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${String(fileName).replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '') || 'cancion'}.mp3`
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url)
}
