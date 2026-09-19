import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const app = express()
const port = Number(process.env.PORT || 8787)
const frontendOrigin = process.env.FRONTEND_ORIGIN || 'https://r-cmusic-eventos.vercel.app'
const corsOrigin = process.env.CORS_ORIGIN || frontendOrigin
const driveFolderId = process.env.DRIVE_FOLDER_ID || '1iwuKlMfb8JSLV86ZlbPNQg1ri2Q0CeNl'
const supabaseUrl = process.env.SUPABASE_URL || 'https://fzqpmpgbubpmongodcat.supabase.co'
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmctbW9uZ29kY2F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5NzI5MzIsImV4cCI6MjEwMzU0ODkzMn0.pLJfo5jpfMNRQCAbKC1dEW_INuBJan_eoyB_hWpChdw'
const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI || 'https://rcmusic-eventos.onrender.com/api/drive/callback'
const driveTokenCache = new Map()
let spotifyTokenCache = { value: '', expiresAt: 0 }
const driveCatalogCache = new Map()
const oauthStates = new Map()
const driveSessions = new Map()
const driveSessionTtl = 60 * 60 * 24 * 30 * 1000
const driveCookieKey = crypto.createHash('sha256').update(process.env.DRIVE_SESSION_SECRET || process.env.GOOGLE_CLIENT_SECRET || 'rc-drive-session').digest()

app.use(cors({ origin: corsOrigin, credentials: true }))
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'rc-music-eventos-api' })
})

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => {
    const index = part.indexOf('=')
    if (index < 0) return ['', '']
    return [decodeURIComponent(part.slice(0, index).trim()), decodeURIComponent(part.slice(index + 1).trim())]
  }).filter(([key, value]) => key && value))
}

function cookie(name, value, maxAge = 60 * 60 * 24 * 30) {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=None`
}

function encryptDriveRefreshToken(value) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', driveCookieKey, iv)
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')
}

function decryptDriveRefreshToken(value) {
  try {
    const raw = Buffer.from(String(value || ''), 'base64url')
    if (raw.length < 29) return ''
    const iv = raw.subarray(0, 12)
    const authTag = raw.subarray(12, 28)
    const ciphertext = raw.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', driveCookieKey, iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch { return '' }
}

function redirectWithDriveSession(returnTo, sessionId) {
  const target = new URL(safeReturnTo(returnTo))
  target.searchParams.set('drive', 'connected')
  target.searchParams.set('drive_session', sessionId)
  return target.toString()
}

function safeReturnTo(value) {
  return String(value || frontendOrigin).startsWith(frontendOrigin) ? String(value || frontendOrigin) : frontendOrigin
}

app.get('/api/drive/auth', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) return res.status(503).json({ error: 'Google Drive no está configurado' })
  const state = crypto.randomBytes(24).toString('hex')
  oauthStates.set(state, safeReturnTo(req.query.returnTo))
  setTimeout(() => oauthStates.delete(state), 10 * 60 * 1000)
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: googleRedirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'https://www.googleapis.com/auth/drive', state })
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
})

app.get('/api/drive/callback', async (req, res) => {
  const returnTo = oauthStates.get(String(req.query.state || '')) || frontendOrigin
  oauthStates.delete(String(req.query.state || ''))
  if (req.query.error) return res.redirect(`${safeReturnTo(returnTo)}?drive=denied`)
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: String(req.query.code || ''), client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: googleRedirectUri, grant_type: 'authorization_code' }) })
    const data = await response.json()
    if (!response.ok || !data.refresh_token) throw new Error('No se obtuvo autorización de Google Drive')
    // The session token is opaque and encrypted, so it remains valid if the
    // next request reaches another Render instance.
    const sessionId = encryptDriveRefreshToken(data.refresh_token)
    driveSessions.set(sessionId, { refreshToken: data.refresh_token, expiresAt: Date.now() + driveSessionTtl })
    setTimeout(() => driveSessions.delete(sessionId), driveSessionTtl)
    res.setHeader('Set-Cookie', cookie('drive_refresh_token', encryptDriveRefreshToken(data.refresh_token)))
    driveCatalogCache.clear()
    res.redirect(redirectWithDriveSession(returnTo, sessionId))
  } catch (error) {
    console.error(error.message)
    res.redirect(`${safeReturnTo(returnTo)}?drive=error`)
  }
})

async function getDriveAccessToken(req) {
  const sessionId = String(req.headers['x-drive-session'] || '')
  const session = sessionId ? driveSessions.get(sessionId) : null
  if (session && session.expiresAt <= Date.now()) driveSessions.delete(sessionId)
  const cookieValue = parseCookies(req).drive_refresh_token
  // Prefer the in-memory session, but fall back to the encrypted cookie so a
  // request routed to another Render instance survives the OAuth callback.
  const refreshToken = session && session.expiresAt > Date.now() ? session.refreshToken : (decryptDriveRefreshToken(sessionId) || decryptDriveRefreshToken(cookieValue) || cookieValue)
  if (!refreshToken) { const error = new Error('DRIVE_AUTH_REQUIRED'); error.code = 'DRIVE_AUTH_REQUIRED'; throw error }
  // Never share an access token between DJs. A viewer session must use the
  // Google account that owns the corresponding Drive permission.
  const cacheKey = sessionId || crypto.createHash('sha256').update(refreshToken).digest('hex')
  const cached = driveTokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now() + 30_000) return { accessToken: cached.value, cacheKey }
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: 'refresh_token' }) })
  const data = await response.json()
  if (!response.ok) { const error = new Error('DRIVE_AUTH_REQUIRED'); error.code = 'DRIVE_AUTH_REQUIRED'; throw error }
  driveTokenCache.set(cacheKey, { value: data.access_token, expiresAt: Date.now() + (data.expires_in * 1000) })
  return { accessToken: data.access_token, cacheKey }
}

async function driveList(accessToken, query, fields) {
  const params = new URLSearchParams({ q: query, fields: `nextPageToken,files(${fields})`, pageSize: '1000', orderBy: 'name' })
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) throw new Error('No se pudo consultar Google Drive')
  return response.json()
}

async function listDriveFolder(accessToken, parent) {
  const files = []
  let pageToken = ''
  do {
    const params = new URLSearchParams({ q: `'${parent}' in parents and trashed = false`, fields: 'nextPageToken,files(id,name,mimeType,size,parents,modifiedTime)', pageSize: '1000', orderBy: 'name' })
    if (pageToken) params.set('pageToken', pageToken)
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!response.ok) throw new Error('No se pudo leer la carpeta de Google Drive')
    const data = await response.json()
    files.push(...(data.files || []))
    pageToken = data.nextPageToken || ''
  } while (pageToken)
  return files
}

async function buildDriveCatalog(accessToken) {
  const folders = [driveFolderId]
  const files = []
  // Read several subfolders at once. A sequential crawl made the first
  // search needlessly slow when the DJ library contained many folders.
  while (folders.length) {
    const batch = folders.splice(0, 8)
    const results = await Promise.all(batch.map((parent) => listDriveFolder(accessToken, parent)))
    for (const children of results) {
      for (const file of children) {
        if (file.mimeType === 'application/vnd.google-apps.folder') folders.push(file.id)
        else if (file.mimeType?.startsWith('audio/') || /\.(mp3|m4a|wav|aif|aiff|flac|ogg)$/i.test(file.name)) files.push(file)
      }
    }
  }
  return files
}

const catalogRefreshes = new Map()

async function getDriveCatalog(accessToken, cacheKey) {
  const cached = driveCatalogCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.files

  // Once a catalog exists, return it immediately while refreshing it in the
  // background. This avoids a second long pause after the five-minute TTL.
  if (cached) {
    if (!catalogRefreshes.has(cacheKey)) {
      const refresh = buildDriveCatalog(accessToken)
        .then((files) => {
          driveCatalogCache.set(cacheKey, { files, expiresAt: Date.now() + 5 * 60 * 1000 })
          return files
        })
        .catch((error) => {
          console.error(error.message)
          return cached.files
        })
        .finally(() => catalogRefreshes.delete(cacheKey))
      catalogRefreshes.set(cacheKey, refresh)
    }
    return cached.files
  }

  if (!catalogRefreshes.has(cacheKey)) {
    const refresh = buildDriveCatalog(accessToken)
      .then((files) => {
        driveCatalogCache.set(cacheKey, { files, expiresAt: Date.now() + 5 * 60 * 1000 })
        return files
      })
      .finally(() => catalogRefreshes.delete(cacheKey))
    catalogRefreshes.set(cacheKey, refresh)
  }
  return catalogRefreshes.get(cacheKey)
}

function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

async function findDriveFile(accessToken, query, cacheKey) {
  const files = await getDriveCatalog(accessToken, cacheKey)
  const wanted = normalizeText(query)
  const words = wanted.split(' ').filter((word) => word.length > 1)
  return files.map((file) => {
    const name = normalizeText(file.name.replace(/\.[^.]+$/, ''))
    const matches = words.filter((word) => name.includes(word)).length
    const exact = name.includes(wanted) ? 100 : 0
    return { file, score: exact + matches * 10 }
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.file.name.localeCompare(b.file.name))[0]?.file || null
}

async function requireAdminDriveAction(req) {
  const token = String(req.headers['x-rc-session-token'] || '').trim()
  if (!token) { const error = new Error('ADMIN_REQUIRED'); error.status = 403; throw error }
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/dj_check_access`, { method: 'POST', headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_token: token }) })
  const data = await response.json().catch(() => null)
  const access = Array.isArray(data) ? data[0] : data
  if (!response.ok || access?.role !== 'admin' || access?.is_active === false) { const error = new Error('ADMIN_REQUIRED'); error.status = 403; throw error }
  return access
}
async function drivePermissions(accessToken) {
  const params = new URLSearchParams({ fields: 'permissions(id,type,role,emailAddress,displayName)', pageSize: '100', supportsAllDrives: 'true' })
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFolderId)}/permissions?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) { const error = new Error(response.status === 403 ? 'DRIVE_SCOPE_REQUIRED' : 'DRIVE_PERMISSION_READ_FAILED'); error.status = response.status === 403 ? 403 : 503; throw error }
  return (await response.json()).permissions || []
}
async function grantDriveFolderPermission(accessToken, email) {
  const normalized = String(email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized)) { const error = new Error('INVALID_EMAIL'); error.status = 400; throw error }
  const permissions = await drivePermissions(accessToken)
  const existing = permissions.find((permission) => permission.type === 'user' && String(permission.emailAddress || '').toLowerCase() === normalized)
  if (existing) {
    if (existing.role !== 'reader') {
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFolderId)}/permissions/${encodeURIComponent(existing.id)}?supportsAllDrives=true`, { method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'reader' }) })
      if (!response.ok) throw new Error('DRIVE_PERMISSION_UPDATE_FAILED')
    }
    return { ok: true, email: normalized, role: 'reader', updated: existing.role !== 'reader' }
  }
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFolderId)}/permissions?sendNotificationEmail=false&supportsAllDrives=true`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'user', role: 'reader', emailAddress: normalized }) })
  if (!response.ok) throw new Error('DRIVE_PERMISSION_CREATE_FAILED')
  return { ok: true, email: normalized, role: 'reader', created: true }
}
async function revokeDriveFolderPermission(accessToken, email) {
  const normalized = String(email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized)) { const error = new Error('INVALID_EMAIL'); error.status = 400; throw error }
  const permissions = await drivePermissions(accessToken)
  const matches = permissions.filter((permission) => permission.type === 'user' && String(permission.emailAddress || '').toLowerCase() === normalized)
  for (const permission of matches) {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFolderId)}/permissions/${encodeURIComponent(permission.id)}?supportsAllDrives=true`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } })
    if (!response.ok && response.status !== 404) throw new Error('DRIVE_PERMISSION_DELETE_FAILED')
  }
  return { ok: true, email: normalized, revoked: matches.length }
}
app.post('/api/drive/grant-folder-access', async (req, res) => {
  try { await requireAdminDriveAction(req); const { accessToken } = await getDriveAccessToken(req); return res.json(await grantDriveFolderPermission(accessToken, req.body?.email)) }
  catch (error) { if (error.code === 'DRIVE_AUTH_REQUIRED') return res.status(401).json({ error: 'DRIVE_AUTH_REQUIRED' }); return res.status(error.status || 503).json({ error: error.message || 'DRIVE_PERMISSION_FAILED' }) }
})
app.post('/api/drive/revoke-folder-access', async (req, res) => {
  try { await requireAdminDriveAction(req); const { accessToken } = await getDriveAccessToken(req); return res.json(await revokeDriveFolderPermission(accessToken, req.body?.email)) }
  catch (error) { if (error.code === 'DRIVE_AUTH_REQUIRED') return res.status(401).json({ error: 'DRIVE_AUTH_REQUIRED' }); return res.status(error.status || 503).json({ error: error.message || 'DRIVE_PERMISSION_FAILED' }) }
})

app.get('/api/drive/status', (req, res) => {
  const sessionId = String(req.headers['x-drive-session'] || '')
  const session = sessionId ? driveSessions.get(sessionId) : null
  const cookieToken = parseCookies(req).drive_refresh_token
  res.json({ authenticated: Boolean((session && session.expiresAt > Date.now()) || decryptDriveRefreshToken(cookieToken) || cookieToken) })
})

app.get('/api/drive/download-test', async (req, res) => {
  const fileId = String(req.query.id || '')
  if (!/^[A-Za-z0-9_-]{10,}$/.test(fileId)) return res.status(400).json({ error: 'Archivo inválido' })
  try {
    const { accessToken } = await getDriveAccessToken(req)
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!response.ok || !response.body) throw new Error('No se pudo descargar el archivo de Google Drive')
    const data = await response.arrayBuffer()
    return res.json({ ok: true, fileId, bytes: data.byteLength, contentType: response.headers.get('content-type') || 'application/octet-stream' })
  } catch (error) {
    if (error.code === 'DRIVE_AUTH_REQUIRED') return res.status(401).json({ error: 'DRIVE_AUTH_REQUIRED' })
    console.error(error.message)
    return res.status(503).json({ error: 'No se pudo probar la descarga de Google Drive' })
  }
})

app.get('/api/drive/preview', async (req, res) => {
  const fileId = String(req.query.id || '')
  if (!/^[A-Za-z0-9_-]{10,}$/.test(fileId)) return res.status(400).json({ error: 'Archivo inválido' })
  try {
    const { accessToken, cacheKey } = await getDriveAccessToken(req)
    const files = await getDriveCatalog(accessToken, cacheKey)
    const file = files.find((item) => item.id === fileId)
    if (!file) return res.status(404).json({ error: 'Archivo no encontrado' })
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!response.ok || !response.body) return res.status(503).json({ error: 'No se pudo leer el archivo de Google Drive' })
    const sourceType = response.headers.get('content-type') || file.mimeType || ''
    const needsTranscode = /\.(aif|aiff)$/i.test(file.name) || /aiff/i.test(sourceType)
    if (needsTranscode) {
      // Chrome/Android does not decode AIFF in an <audio> element. Convert
      // only the private preview stream to MP3; downloads remain untouched.
      const ffmpeg = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', '-f', 'mp3', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] })
      let conversionError = ''
      ffmpeg.stderr.on('data', (chunk) => { conversionError += String(chunk).slice(-2000) })
      ffmpeg.once('error', (error) => {
        conversionError = error.message
        if (!res.headersSent) res.status(503).json({ error: 'No se pudo preparar la preescucha' })
        else res.destroy(error)
      })
      res.status(200).set({ 'Content-Type': 'audio/mpeg', 'Content-Disposition': `inline; filename="${file.name.replace(/\.[^.]+$/, '').replace(/["\\r\\n]/g, '')}.mp3"`, 'Cache-Control': 'no-store' })
      ffmpeg.stdout.pipe(res)
      Readable.fromWeb(response.body).pipe(ffmpeg.stdin)
      ffmpeg.once('close', (code) => {
        if (code !== 0 && !res.writableEnded) res.destroy(new Error(conversionError || 'No se pudo preparar la preescucha'))
      })
      req.once('close', () => { if (!res.writableEnded) ffmpeg.kill('SIGTERM') })
      return
    }
    res.status(200).set({ 'Content-Type': sourceType || 'audio/mpeg', 'Content-Length': response.headers.get('content-length') || undefined, 'Content-Disposition': `inline; filename="${file.name.replace(/["\\r\\n]/g, '')}"`, 'Cache-Control': 'no-store' })
    return Readable.fromWeb(response.body).pipe(res)
  } catch (error) {
    if (error.code === 'DRIVE_AUTH_REQUIRED') return res.status(401).json({ error: 'DRIVE_AUTH_REQUIRED' })
    console.error(error.message)
    return res.status(503).json({ error: 'No se pudo leer el archivo de Google Drive' })
  }
})

app.get('/api/drive/search', async (req, res) => {
  const query = String(req.query.q || '').trim()
  if (query.length < 2 || query.length > 160) return res.status(400).json({ error: 'Búsqueda inválida' })
  try {
    const { accessToken, cacheKey } = await getDriveAccessToken(req)
    const files = await getDriveCatalog(accessToken, cacheKey)
    const wanted = normalizeText(query)
    const words = wanted.split(' ').filter((word) => word.length > 1)
    const matches = files.map((file) => {
      const name = normalizeText(file.name.replace(/\\.[^.]+$/, ''))
      const score = (name.includes(wanted) ? 100 : 0) + words.filter((word) => name.includes(word)).length * 10
      return { file, score }
    }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.file.name.localeCompare(b.file.name)).slice(0, 20)
    return res.json({ query, matches: matches.map(({ file, score }) => ({ id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, score })) })
  } catch (error) {
    if (error.code === 'DRIVE_AUTH_REQUIRED') return res.status(401).json({ error: 'DRIVE_AUTH_REQUIRED' })
    console.error(error.message)
    return res.status(503).json({ error: 'No se pudo consultar Google Drive' })
  }
})

async function streamDriveFile(req, res, query, format) {
  const { accessToken, cacheKey } = await getDriveAccessToken(req)
  const file = await findDriveFile(accessToken, query, cacheKey)
  if (!file) return false
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok || !response.body) throw new Error('No se pudo descargar el archivo de Google Drive')
  const extension = path.extname(file.name).slice(1).toLowerCase() || format
  res.status(200).set({ 'Content-Type': response.headers.get('content-type') || 'application/octet-stream', 'Content-Length': response.headers.get('content-length') || undefined, 'Content-Disposition': `attachment; filename="${file.name.replace(/["\r\n]/g, '')}"`, 'Cache-Control': 'no-store' })
  Readable.fromWeb(response.body).pipe(res)
  return true
}

async function getSpotifyToken() {
  if (spotifyTokenCache.value && spotifyTokenCache.expiresAt > Date.now() + 30_000) return spotifyTokenCache.value
  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Spotify no está configurado en el servidor')
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const response = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })
  if (!response.ok) throw new Error('No se pudo autenticar con Spotify')
  const data = await response.json()
  spotifyTokenCache = { value: data.access_token, expiresAt: Date.now() + (data.expires_in * 1000) }
  return spotifyTokenCache.value
}

app.get('/api/spotify-search', async (req, res) => {
  const query = String(req.query.q || '').trim()
  if (!query) return res.status(400).json({ error: 'Falta la búsqueda' })
  try {
    const token = await getSpotifyToken()
    const params = new URLSearchParams({ q: query, type: 'track', limit: '8', market: 'PE' })
    const response = await fetch(`https://api.spotify.com/v1/search?${params}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) return res.status(response.status).json({ error: 'Spotify no respondió' })
    const data = await response.json()
    return res.json({ tracks: (data.tracks?.items || []).map((track) => ({ id: track.id, title: track.name, artist: track.artists.map((artist) => artist.name).join(', '), duration: `${Math.floor(track.duration_ms / 60000)}:${String(Math.floor((track.duration_ms % 60000) / 1000)).padStart(2, '0')}`, thumbnail: track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || '' })) })
  } catch (error) { return res.status(503).json({ error: error.message }) }
})

app.post('/api/youtube-download', async (req, res) => {
  const videoId = String(req.body?.videoId || '')
  const query = String(req.body?.query || '').trim().replace(/[\r\n]+/g, ' ')
  const format = req.body?.format === 'm4a' ? 'm4a' : 'mp3'
  const validVideoId = /^[A-Za-z0-9_-]{11}$/.test(videoId)
  if (!validVideoId && (query.length < 2 || query.length > 160)) return res.status(400).json({ error: 'Canción inválida' })

  // Search the user's private Drive catalog first for every requested song.
  if (query) {
    try {
      if (await streamDriveFile(req, res, query, format)) return
    } catch (error) {
      if (error.code === 'DRIVE_AUTH_REQUIRED') return res.status(401).json({ error: 'DRIVE_AUTH_REQUIRED' })
      console.error(error.message)
    }
  }

  const executable = process.env.YTDLP_PATH || path.join(process.cwd(), 'bin', 'yt-dlp')
  const source = validVideoId ? `https://www.youtube.com/watch?v=${videoId}` : `ytsearch1:${query}`
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rc-youtube-'))
  const outputBase = path.join(directory, 'audio')
  const args = ['--no-playlist', '--no-warnings', '-x', '--audio-format', format, '--audio-quality', '0', '-o', `${outputBase}.%(ext)s`, source]
  const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  let errorText = ''
  child.stderr.on('data', (chunk) => { errorText += String(chunk).slice(-2000) })
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
    if (code !== 0) throw new Error(errorText || 'No se pudo preparar el audio')
    const files = await readdir(directory)
    const file = files.find((name) => name.endsWith(`.${format}`))
    if (!file) throw new Error('El archivo de audio no fue generado')
    const filePath = path.join(directory, file)
    const info = await stat(filePath)
    res.status(200).set({ 'Content-Type': format === 'm4a' ? 'audio/mp4' : 'audio/mpeg', 'Content-Length': String(info.size), 'Content-Disposition': `attachment; filename="youtube-${videoId || 'search'}.${format}"`, 'Cache-Control': 'no-store' })
    createReadStream(filePath).pipe(res)
    res.once('finish', () => rm(directory, { recursive: true, force: true }).catch(() => {}))
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
    if (!res.headersSent) res.status(502).json({ error: 'No se pudo preparar el audio' })
    console.error(error.message)
  }
  req.once('close', () => { if (!res.writableEnded) child.kill('SIGTERM') })
})

app.listen(port, () => console.log(`RC music_eventos API escuchando en el puerto ${port}`))

