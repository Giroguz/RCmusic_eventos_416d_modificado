import { LogOut, Music2, Radio } from 'lucide-react'
import { djLibraryStandalone } from '../lib/supabase'
import rcMusicLogo from '../assets/1788413537933-832c4ec7.jpg'
import { useLanguage } from '../lib/i18n'
import LanguagePicker from './LanguagePicker'

export function Brand({ compact = false }) {
  const { t } = useLanguage()
  if (djLibraryStandalone) return (
    <div className="flex items-center gap-3">
      <div className="neon-orb grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full border border-turquoise/30 bg-ink p-1 text-turquoise shadow-glow">
        <Music2 size={30} strokeWidth={2.2} aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="font-display text-xl font-extrabold leading-tight tracking-[.02em] text-white sm:text-2xl" aria-label="PACK TODOS LOS GÉNEROS">PACK</p>
        {!compact && <p className="mt-1 text-[10px] font-semibold uppercase tracking-[.14em] text-white/45">TODOS LOS GÉNEROS · BIBLIOTECA DJ</p>}
      </div>
    </div>
  )
  return (
    <div className="flex items-center gap-3">
      <div className="neon-orb grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full border border-neon/30 bg-white p-1 shadow-glow">
        <img src={rcMusicLogo} alt="R&C music" className="h-full w-full rounded-full object-contain" />
      </div>
      <div className="min-w-0">
        <p className="brand-wordmark" aria-label="RCmusic_eventos"><span className="brand-wordmark__rc">RC</span><span className="brand-wordmark__music">music</span><span className="brand-wordmark__events">_eventos</span></p>
        {!compact && <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[.17em] text-white/40"><Radio size={10} /> {t('liveRequestsLabel')}</p>}
      </div>
    </div>
  )
}

export function AppShell({ children, onHome, right }) {
  const { t } = useLanguage()
  return (
    <div className="app-shell min-h-screen overflow-x-hidden bg-ink bg-grid">
      <header className="sticky top-0 isolate border-b border-neon/10 bg-[#08050d]/75 backdrop-blur-xl" style={{ zIndex: 10000 }}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3 sm:flex-nowrap sm:gap-3 sm:px-6 sm:py-4 lg:px-8">
          <div className="flex w-full min-w-0 items-center sm:w-auto">
            <button onClick={onHome} aria-label={t('home')} className="shrink-0"><Brand compact /></button>
          </div>
          <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:ml-auto sm:w-auto"><LanguagePicker compact />{right}<button onClick={onHome} className="btn-secondary shrink-0 p-2.5" aria-label={t('back')} title={t('back')}><LogOut size={17} /></button></div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="mx-auto max-w-6xl px-4 py-8 text-center text-xs text-white/30 sm:px-6 lg:px-8">RC music_eventos · {t('footerTagline')}</footer>
    </div>
  )
}

export function PageContainer({ children, className = '' }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8 ${className}`}>{children}</div>
}
