import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { Readable } from 'node:stream'
import { createSign } from 'node:crypto'

const app = express()
const port = Number(process.env.PORT || 8787)
const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_ANON_KEY || ''
const driveFolderId = process.env.DRIVE_FOLDER_ID || '1UTIQESYvJcNdKXNsDdDs0dRCrDzs5JvF'
const corsOrigins = String(process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((item) => item.trim()).filter(Boolean)
const AUDIO_EXTENSIONS = /\.(mp3|m4a|mp4|wav|flac|ogg|oga|opus|aif|aiff|caf|aac|wma|alac)$/i
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const catalogCache = { files: null, genres: [], expiresAt: 0, refresh: null }
let accessTokenCache = { token: '', expiresAt: 0 }

app.use(cors({ origin(origin, callback) { callback(null, !origin || corsOrigins.includes(origin)) }, credentials: true }))
app.use(express.json({ limit: '1mb' }))

function firstRow(data) { return Array.isArray(data) ? data[0] : data }
async function rpc(name, body) {
  if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE_NOT_CONFIGURED')
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.message || data?.error_description || 'Supabase request failed')
  return data
}
function tokenFromRequest(req) { return String(req.headers['x-dj-session'] || req.body?.token || '').trim() }
async function getSession(req) {
  const token = tokenFromRequest(req)
  if (!token) return null
  try { return firstRow(await rpc('dj_check_access', { p_token: token })) } catch { return null }
}
function isActiveSession(session) {
  if (!session || session.blocked) return false
  if (session.role === 'admin') return true
  const expiry = Date.parse(session.plan_expires_at || session.planExpiresAt || '')
  return session.is_active === true && Number.isFinite(expiry) && expiry > Date.now()
}
async function requireDj(req, res, next) {
  const session = await getSession(req)
  if (!isActiveSession(session)) return res.status(401).json({ error: 'DJ_AUTH_REQUIRED' })
  req.djSession = session
  next()
}
async function requireAdmin(req, res, next) {
  const session = await getSession(req)
  if (!session || session.role !== 'admin' || session.blocked) return res.status(403).json({ error: 'ADMIN_REQUIRED' })
  req.djSession = session
  next()
}
function serverNotConfigured(res) { return res.status(503).json({ error: 'DRIVE_SERVER_NOT_CONFIGURED' }) }
function hasDriveCredentials() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || ((process.env.DRIVE_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN) && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET))
}
function driveCredentialMode() { return process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? 'service-account-readonly' : 'user-oauth' }
function serviceAccountCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) return null
  try {
    const credentials = JSON.parse(raw)
    if (credentials.type !== 'service_account' || !credentials.client_email || !credentials.private_key) throw new Error()
    return credentials
  } catch {
    const error = new Error('Invalid service account credential configuration'); error.code = 'DRIVE_SERVER_NOT_CONFIGURED'; throw error
  }
}
function base64urlJson(value) { return Buffer.from(JSON.stringify(value)).toString('base64url') }

app.get('/health', (_req, res) => res.json({ ok: true, service: 'pack-todos-los-generos-staging-api' }))
app.post('/api/dj/login', async (req, res) => {
  try { res.json(await rpc('dj_login', { p_email: String(req.body?.email || req.body?.p_email || '').trim().toLowerCase(), p_code: String(req.body?.code || req.body?.p_code || '').trim() })) }
  catch (error) { res.status(400).json({ error: error.message }) }
})
app.post('/api/dj/access', async (req, res) => {
  try { res.json(await rpc('dj_check_access', { p_token: String(req.body?.token || req.body?.p_token || '') })) }
  catch (error) { res.status(400).json({ error: error.message }) }
})
async function getDriveAccessToken() {
  if (!hasDriveCredentials()) {
    const error = new Error('DRIVE_SERVER_NOT_CONFIGURED'); error.code = error.message; throw error
  }
  if (accessTokenCache.token && accessTokenCache.expiresAt > Date.now() + 30_000) return accessTokenCache.token
  const serviceAccount = serviceAccountCredentials()
  let response
  if (serviceAccount) {
    const now = Math.floor(Date.now() / 1000)
    const unsigned = `${base64urlJson({ alg: 'RS256', typ: 'JWT' })}.${base64urlJson({ iss: serviceAccount.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`
    const signature = createSign('RSA-SHA256').update(unsigned).sign(serviceAccount.private_key, 'base64url')
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    })
  } else {
    const refreshToken = process.env.DRIVE_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    })
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.access_token) {
    const error = new Error('Google Drive authorization unavailable'); error.code = 'DRIVE_AUTH_REQUIRED'; throw error
  }
  accessTokenCache = { token: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 }
  return accessTokenCache.token
}
async function driveFetch(url, token, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    const error = new Error(data?.error?.message || 'Google Drive request failed')
    error.status = response.status
    throw error
  }
  return response
}
async function listChildren(accessToken, parentId) {
  const children = []
  let pageToken = ''
  do {
    const params = new URLSearchParams({ q: `'${parentId.replace(/'/g, "\\'")}' in parents and trashed = false`, fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime)', pageSize: '1000', orderBy: 'name' })
    if (pageToken) params.set('pageToken', pageToken)
    const response = await driveFetch(`${DRIVE_API}/files?${params}`, accessToken)
    const data = await response.json()
    children.push(...(data.files || []))
    pageToken = data.nextPageToken || ''
  } while (pageToken)
  return children
}
async function buildCatalog(accessToken) {
  const files = []
  const genres = new Set()
  const pending = [{ id: driveFolderId, path: [] }]
  while (pending.length) {
    const group = pending.splice(0, 12)
    const batches = await Promise.all(group.map(async (folder) => ({ folder, children: await listChildren(accessToken, folder.id) })))
    for (const { folder, children } of batches) {
      for (const item of children) {
        if (item.mimeType === FOLDER_MIME) {
          const folderPath = [...folder.path, item.name]
          if (folder.path.length === 0) genres.add(item.name)
          pending.push({ id: item.id, path: folderPath })
        } else if (item.mimeType?.startsWith('audio/') || AUDIO_EXTENSIONS.test(item.name)) {
          const folderPath = folder.path
          files.push({ id: item.id, name: item.name, mimeType: item.mimeType || 'audio/*', size: item.size || null, modifiedTime: item.modifiedTime || null, folderPath, genre: folderPath[0] || 'General' })
        }
      }
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
  return { files, genres: [...genres].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })) }
}
async function getCatalog(accessToken) {
  if (catalogCache.files && catalogCache.expiresAt > Date.now()) return catalogCache
  if (catalogCache.refresh) return catalogCache.refresh
  catalogCache.refresh = buildCatalog(accessToken).then(({ files, genres }) => {
    Object.assign(catalogCache, { files, genres, expiresAt: Date.now() + 5 * 60 * 1000 })
    return catalogCache
  }).finally(() => { catalogCache.refresh = null })
  return catalogCache.refresh
}
function normalize(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }
function scoreTrack(file, query) {
  const wanted = normalize(query)
  if (!wanted) return 1
  const title = normalize(file.name.replace(/\.[^.]+$/, ''))
  const words = wanted.split(' ').filter((word) => word.length > 1)
  const matched = words.filter((word) => title.includes(word)).length
  return (title.includes(wanted) ? 100 : 0) + matched * 10
}
function safeFilename(name) { return String(name || 'audio').replace(/[\r\n"\\]/g, '_').slice(0, 240) }

app.get('/api/drive/status', async (req, res) => {
  const session = await getSession(req)
  if (!isActiveSession(session)) return res.status(401).json({ error: 'DJ_AUTH_REQUIRED' })
  return res.json({ authenticated: hasDriveCredentials(), configured: hasDriveCredentials() && Boolean(driveFolderId) })
})
app.get('/api/drive/auth', (_req, res) => serverNotConfigured(res))
app.get('/api/drive/catalog', requireDj, async (req, res) => {
  if (!hasDriveCredentials()) return serverNotConfigured(res)
  try {
    const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0))
    const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query.limit) || 60)))
    const query = String(req.query.q || '').trim().slice(0, 160)
    const genre = String(req.query.genre || '').trim().slice(0, 100)
    const { files, genres } = await getCatalog(await getDriveAccessToken())
    const filtered = files.map((file) => ({ file, score: scoreTrack(file, query) })).filter(({ file, score }) => score > 0 && (!genre || normalize(file.genre) === normalize(genre))).sort((a, b) => b.score - a.score || a.file.name.localeCompare(b.file.name, 'es', { sensitivity: 'base' })).map(({ file }) => file)
    res.json({ files: filtered.slice(offset, offset + limit), total: filtered.length, genres, offset, limit })
  } catch (error) {
    if (error.code === 'DRIVE_AUTH_REQUIRED') return res.status(401).json({ error: 'DRIVE_AUTH_REQUIRED' })
    console.error('Drive catalog failed:', error.message)
    res.status(502).json({ error: 'DRIVE_CATALOG_UNAVAILABLE' })
  }
})
app.get('/api/drive/search', requireDj, async (req, res) => {
  const query = String(req.query.q || '').trim()
  if (query.length < 2 || query.length > 160) return res.status(400).json({ error: 'INVALID_QUERY' })
  if (!hasDriveCredentials()) return serverNotConfigured(res)
  try {
    const { files } = await getCatalog(await getDriveAccessToken())
    const matches = files.map((file) => ({ file, score: scoreTrack(file, query) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.file.name.localeCompare(b.file.name, 'es', { sensitivity: 'base' })).slice(0, 30)
    res.json({ query, matches: matches.map(({ file, score }) => ({ ...file, score })) })
  } catch (error) {
    if (error.code === 'DRIVE_AUTH_REQUIRED') return res.status(401).json({ error: 'DRIVE_AUTH_REQUIRED' })
    console.error('Drive search failed:', error.message)
    res.status(502).json({ error: 'DRIVE_CATALOG_UNAVAILABLE' })
  }
})
async function streamCatalogTrack(req, res) {
  const fileId = String(req.query.id || '')
  if (!/^[A-Za-z0-9_-]{10,}$/.test(fileId)) return res.status(400).json({ error: 'INVALID_FILE_ID' })
  if (!hasDriveCredentials()) return serverNotConfigured(res)
  try {
    const accessToken = await getDriveAccessToken()
    const { files } = await getCatalog(accessToken)
    const file = files.find((item) => item.id === fileId)
    if (!file) return res.status(404).json({ error: 'TRACK_NOT_FOUND' })
    const upstream = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media`, accessToken)
    const contentType = upstream.headers.get('content-type') || file.mimeType || 'application/octet-stream'
    res.status(200).set({ 'Content-Type': contentType, 'Content-Disposition': `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${safeFilename(file.name)}"`, 'Cache-Control': 'private, no-store', ...(upstream.headers.get('content-length') ? { 'Content-Length': upstream.headers.get('content-length') } : {}) })
    Readable.fromWeb(upstream.body).pipe(res)
  } catch (error) {
    if (error.code === 'DRIVE_AUTH_REQUIRED') return res.status(401).json({ error: 'DRIVE_AUTH_REQUIRED' })
    console.error('Drive stream failed:', error.message)
    if (!res.headersSent) res.status(502).json({ error: 'TRACK_STREAM_UNAVAILABLE' })
    else res.destroy(error)
  }
}
app.get('/api/drive/preview', requireDj, streamCatalogTrack)

async function adminDjList(token) { return rpc('admin_list_djs', { p_token: token }) }
async function listFolderPermissions(accessToken) {
  const permissions = []
  let pageToken = ''
  do {
    const params = new URLSearchParams({ fields: 'nextPageToken,permissions(id,type,emailAddress,role,expirationTime,deleted,permissionDetails(inherited,inheritedFrom,role,permissionType))', pageSize: '100' })
    if (pageToken) params.set('pageToken', pageToken)
    const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(driveFolderId)}/permissions?${params}`, accessToken)
    const data = await response.json()
    permissions.push(...(data.permissions || []))
    pageToken = data.nextPageToken || ''
  } while (pageToken)
  return permissions.filter((item) => item.type === 'user' && item.emailAddress && item.role !== 'owner' && !item.deleted && !(item.permissionDetails || []).some((detail) => detail.inherited))
}
async function reconcileDjDrivePermissions(accessToken, adminToken) {
  const permissions = await listFolderPermissions(accessToken)
  const users = await adminDjList(adminToken)
  const accounts = Array.isArray(users) ? users : []
  for (const permission of permissions) {
    const dj = accounts.find((row) => row.role !== 'admin' && String(row.email || '').toLowerCase() === String(permission.emailAddress || '').toLowerCase())
    if (!dj) continue
    const planExpiry = Date.parse(dj.plan_expires_at || '')
    const active = dj.approved === true && dj.blocked !== true && dj.is_active === true && planExpiry > Date.now()
    const permissionExpiry = Date.parse(permission.expirationTime || '')
    if (!active) {
      const removed = await fetch(`${DRIVE_API}/files/${encodeURIComponent(driveFolderId)}/permissions/${encodeURIComponent(permission.id)}?supportsAllDrives=true`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } })
      if (!removed.ok && removed.status !== 404) throw new Error('Could not revoke inactive DJ Drive permission')
      continue
    }
    const boundedExpiry = Math.min(planExpiry, Date.now() + 365 * 24 * 60 * 60 * 1000)
    if (!Number.isFinite(permissionExpiry) || permissionExpiry > boundedExpiry || permission.role !== 'reader') {
      const params = new URLSearchParams({ supportsAllDrives: 'true', fields: 'id,emailAddress,role,type,expirationTime' })
      const updated = await fetch(`${DRIVE_API}/files/${encodeURIComponent(driveFolderId)}/permissions/${encodeURIComponent(permission.id)}?${params}`, { method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'reader', expirationTime: new Date(boundedExpiry).toISOString() }) })
      if (!updated.ok) throw new Error('Could not limit DJ Drive permission to active plan')
    }
  }
  return listFolderPermissions(accessToken)
}
app.get('/api/drive/folder-permissions', requireAdmin, async (req, res) => {
  if (!hasDriveCredentials()) return serverNotConfigured(res)
  try {
    const accessToken = await getDriveAccessToken()
    // A service account shared as Reader may inspect the catalog but must never
    // reconcile, grant, alter, or revoke permissions on the user's Drive folder.
    const permissions = driveCredentialMode() === 'service-account-readonly'
      ? await listFolderPermissions(accessToken)
      : await reconcileDjDrivePermissions(accessToken, String(req.headers['x-dj-session'] || ''))
    res.json({ permissions })
  } catch (error) { console.error('Drive permissions listing failed:', error.message); res.status(502).json({ error: 'DRIVE_PERMISSIONS_UNAVAILABLE' }) }
})
app.post('/api/drive/folder-permissions', requireAdmin, async (req, res) => {
  if (!hasDriveCredentials()) return serverNotConfigured(res)
  if (driveCredentialMode() === 'service-account-readonly') return res.status(403).json({ error: 'DRIVE_PERMISSION_MANAGEMENT_REQUIRES_SEPARATE_APPROVAL' })
  const email = String(req.body?.email || '').trim().toLowerCase()
  const enabled = Boolean(req.body?.enabled)
  const durationDays = Math.floor(Number(req.body?.durationDays || 30))
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'INVALID_EMAIL' })
  try {
    const accessToken = await getDriveAccessToken()
    const existing = (await listFolderPermissions(accessToken)).find((item) => String(item.emailAddress).toLowerCase() === email)
    if (!enabled) {
      if (!existing) return res.json({ ok: true, enabled: false, permission: null, message: 'No había un permiso directo que revocar.' })
      const response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(driveFolderId)}/permissions/${encodeURIComponent(existing.id)}?supportsAllDrives=true`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } })
      if (!response.ok && response.status !== 404) throw new Error('Google Drive no pudo revocar el permiso')
      return res.json({ ok: true, enabled: false, permission: null })
    }
    if (!Number.isFinite(durationDays) || durationDays < 1 || durationDays > 365) return res.status(400).json({ error: 'INVALID_DURATION_DAYS' })
    const users = await adminDjList(String(req.headers['x-dj-session'] || ''))
    const target = (Array.isArray(users) ? users : []).find((row) => String(row.email || '').toLowerCase() === email && row.role !== 'admin')
    const expiry = Date.parse(target?.plan_expires_at || '')
    const active = target && target.blocked !== true && target.approved === true && expiry > Date.now() && target.is_active !== false
    if (!active) return res.status(409).json({ error: 'DJ_PLAN_NOT_ACTIVE' })
    const requestedExpiry = Date.now() + durationDays * 24 * 60 * 60 * 1000
    const expirationTime = new Date(Math.min(requestedExpiry, expiry, Date.now() + 365 * 24 * 60 * 60 * 1000)).toISOString()
    const permissionBody = { role: 'reader', expirationTime }
    const params = new URLSearchParams({ supportsAllDrives: 'true', fields: 'id,emailAddress,role,type,expirationTime' })
    if (!existing) params.set('sendNotificationEmail', 'false')
    const endpoint = existing
      ? `${DRIVE_API}/files/${encodeURIComponent(driveFolderId)}/permissions/${encodeURIComponent(existing.id)}?${params}`
      : `${DRIVE_API}/files/${encodeURIComponent(driveFolderId)}/permissions?${params}`
    const response = await fetch(endpoint, { method: existing ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(existing ? permissionBody : { ...permissionBody, type: 'user', emailAddress: email }) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result?.error?.message || 'Google Drive rejected the permission')
    res.json({ ok: true, enabled: true, permission: result, cappedToPlanExpiry: expiry <= requestedExpiry })
  } catch (error) {
    console.error('Drive permission update failed:', error.message)
    res.status(502).json({ error: 'DRIVE_PERMISSION_UPDATE_FAILED' })
  }
})

app.use((error, _req, res, _next) => {
  console.error('Unhandled API error:', error?.message || error)
  if (!res.headersSent) res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' })
})
app.listen(port, () => console.log(`RC music_eventos developer-center API listening on port ${port}`))
