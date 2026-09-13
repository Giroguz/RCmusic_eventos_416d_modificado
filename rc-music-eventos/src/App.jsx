import { useEffect, useRef, useState } from 'react'
import HomeScreen from './components/HomeScreen'
import JoinEvent from './components/JoinEvent'
import AttendeeApp from './components/AttendeeApp'
import DjLogin from './components/DjLogin'
import DjApp from './components/DjApp'
import AdminPanel from './components/AdminPanel'
import { getEvents, saveEvents } from './lib/storage'
import { getStoredDjSession, supabaseEnabled, ensureAnonymousSession, setRequestStatus } from './lib/supabase'

const HISTORY_KEY = 'rcMusicScreen'
const ROUTE_STACK_KEY = 'rcMusicRouteStack'
function readRouteStack() { try { const value = JSON.parse(sessionStorage.getItem(ROUTE_STACK_KEY) || 'null'); return Array.isArray(value) && value.length ? value : [{ screen: 'home', activeEvent: null }] } catch { return [{ screen: 'home', activeEvent: null }] } }
function writeRouteStack(stack) { try { sessionStorage.setItem(ROUTE_STACK_KEY, JSON.stringify(stack.slice(-20))) } catch {} }
function routeHash(screen) { return `#${screen || 'home'}` }

export default function App() {
  const [screen, setScreen] = useState(() => { try { return window.location.hash.slice(1) || 'home' } catch { return 'home' } })
  const screenRef = useRef(screen)
  const [activeEvent, setActiveEvent] = useState(() => { try { return window.location.hash.slice(1) === 'attendee' ? window.history.state?.activeEvent || null : null } catch { return null } })
  const [developerLogin, setDeveloperLogin] = useState(false)
  const [djSession, setDjSession] = useState(() => getStoredDjSession())
  const [developerSession, setDeveloperSession] = useState(null)

  useEffect(() => { screenRef.current = screen }, [screen])
  useEffect(() => { getEvents(); if (supabaseEnabled) ensureAnonymousSession().catch(() => {}); try { if (sessionStorage.getItem('rc_pending_recovery_v1')) setScreen('dj-login') } catch {} }, [])
  useEffect(() => { if (screen === 'dj') { try { localStorage.removeItem('rc_drive_return_screen') } catch {} } }, [screen])

  useEffect(() => {
    const current = window.history.state
    const currentScreen = screenRef.current || 'home'
    const currentEvent = activeEvent || null
    const savedRoutes = readRouteStack(); const savedLast = savedRoutes.at(-1)
    const stack = savedLast?.screen === currentScreen ? savedRoutes : [{ screen: currentScreen, activeEvent: currentEvent }]
    const routeTrail = Array.isArray(current?.routeTrail) && current.routeTrail.length ? current.routeTrail : stack
    writeRouteStack(routeTrail)
    if (!current?.[HISTORY_KEY]) window.history.replaceState({ ...current, [HISTORY_KEY]: true, screen: currentScreen, activeEvent: currentEvent, routeTrail, routeIndex: routeTrail.length - 1, appRoot: routeTrail.length === 1 }, '', routeHash(currentScreen))
    const syncRouteFromHistory = (event) => {
      const state = event?.state || window.history.state
      if (state?.[HISTORY_KEY]) { const trail = Array.isArray(state.routeTrail) && state.routeTrail.length ? state.routeTrail : readRouteStack(); writeRouteStack(trail); setScreen(state.screen || screenRef.current || 'home'); setActiveEvent(state.activeEvent || null); return }
      const hashScreen = window.location.hash.slice(1)
      if (hashScreen) { setScreen(hashScreen); setActiveEvent(null); writeRouteStack([{ screen: hashScreen, activeEvent: null }]) }
    }
    window.addEventListener('popstate', syncRouteFromHistory)
    return () => window.removeEventListener('popstate', syncRouteFromHistory)
  }, [])

  function navigate(nextScreen, nextEvent = null) {
    const current = window.history.state
    if (current?.[HISTORY_KEY] && current.screen === nextScreen && current.activeEvent?.id === nextEvent?.id) return
    const currentTrail = Array.isArray(current?.routeTrail) && current.routeTrail.length ? current.routeTrail : [{ screen: current?.screen || screenRef.current || 'home', activeEvent: current?.activeEvent || null }]
    const nextTrail = [...currentTrail, { screen: nextScreen, activeEvent: nextEvent || null }]
    writeRouteStack(nextTrail)
    window.history.pushState({ ...(current || {}), [HISTORY_KEY]: true, screen: nextScreen, activeEvent: nextEvent || null, routeTrail: nextTrail, routeIndex: nextTrail.length - 1, appRoot: false }, '', routeHash(nextScreen))
    setActiveEvent(nextEvent || null); setScreen(nextScreen)
  }

  function completeLogin(nextScreen, nextEvent = null) {
    const current = window.history.state
    const trail = Array.isArray(current?.routeTrail) && current.routeTrail.length ? current.routeTrail : readRouteStack()
    const withoutLogin = trail.at(-1)?.screen === 'dj-login' ? trail.slice(0, -1) : trail
    const baseTrail = withoutLogin.length ? withoutLogin : [{ screen: 'home', activeEvent: null }]
    const nextTrail = [...baseTrail, { screen: nextScreen, activeEvent: nextEvent || null }]
    writeRouteStack(nextTrail)
    window.history.replaceState({ ...(current || {}), [HISTORY_KEY]: true, screen: nextScreen, activeEvent: nextEvent || null, routeTrail: nextTrail, routeIndex: nextTrail.length - 1, appRoot: false }, '', routeHash(nextScreen))
    setActiveEvent(nextEvent || null); setScreen(nextScreen)
  }

  function goBack() {
    const current = window.history.state
    if (!current?.[HISTORY_KEY]) return
    const trail = Array.isArray(current.routeTrail) && current.routeTrail.length ? current.routeTrail : readRouteStack()
    if (trail.length <= 1) return
    // A login screen can remain as a browser entry in sessions created by an
    // older build. Never expose it as the destination when leaving the DJ panel.
    const previousIndex = trail.length - 2
    const skipLogin = trail[previousIndex]?.screen === 'dj-login' && previousIndex > 0
    window.history.go(skipLogin ? -2 : -1)
  }

  async function updateEvent(nextEvent) {
    const previous = activeEvent
    if (supabaseEnabled && previous && !previous.localOnly) { const previousById = Object.fromEntries((previous.requests || []).map((request) => [request.id, request])); for (const request of nextEvent.requests || []) { const oldRequest = previousById[request.id]; if (oldRequest && oldRequest.status !== request.status) await setRequestStatus(request.id, request.status) } } else { saveEvents(getEvents().map((event) => event.id === nextEvent.id ? nextEvent : event)) }
    setActiveEvent(nextEvent)
    if (window.history.state?.[HISTORY_KEY]) window.history.replaceState({ ...window.history.state, activeEvent: nextEvent }, '', window.location.href)
  }

  if (screen === 'attendee-join') return <JoinEvent onBack={goBack} onJoin={(event) => navigate('attendee', event)} />
  if (screen === 'attendee' && activeEvent) return <AttendeeApp event={activeEvent} onUpdate={updateEvent} onExit={goBack} />
  if (screen === 'dj-login') return <DjLogin developerMode={developerLogin} onBack={goBack} onLogin={(access) => { if (developerLogin) { setDeveloperSession(access); completeLogin('developer') } else { setDjSession(access); completeLogin('dj') } }} />
  if (screen === 'developer' && developerSession) return <AdminPanel session={developerSession} onClose={goBack} />
  if (screen === 'dj') return <DjApp session={djSession} onExit={goBack} />
  return <HomeScreen onAttendee={() => navigate('attendee-join')} onDj={() => { setDeveloperLogin(false); navigate('dj-login') }} />
}
