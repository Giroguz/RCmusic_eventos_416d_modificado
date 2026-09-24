import { useEffect, useState } from 'react'
import { Download, Smartphone, X } from 'lucide-react'

const DISMISS_KEY = 'pack-dj-install-card-dismissed'

function isStandalone() {
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true)
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export default function PwaInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState(null)
  const [installed, setInstalled] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)
  const [ios, setIos] = useState(false)

  useEffect(() => {
    setInstalled(isStandalone())
    setIos(isIOS())
    try { setDismissed(localStorage.getItem(DISMISS_KEY) === '1') } catch {}

    const captureInstallPrompt = (event) => {
      event.preventDefault()
      setInstallPrompt(event)
    }
    const markInstalled = () => {
      setInstalled(true)
      setInstallPrompt(null)
    }
    window.addEventListener('beforeinstallprompt', captureInstallPrompt)
    window.addEventListener('appinstalled', markInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', captureInstallPrompt)
      window.removeEventListener('appinstalled', markInstalled)
    }
  }, [])

  async function install() {
    if (!installPrompt) {
      setShowInstructions((value) => !value)
      return
    }
    const prompt = installPrompt
    setInstallPrompt(null)
    await prompt.prompt()
    const choice = await prompt.userChoice.catch(() => null)
    if (choice?.outcome === 'accepted') setInstalled(true)
    else setShowInstructions(true)
  }

  function dismiss() {
    setDismissed(true)
    try { localStorage.setItem(DISMISS_KEY, '1') } catch {}
  }

  if (installed || dismissed) return null

  return <aside className="fixed bottom-4 right-4 z-[200] w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-turquoise/25 bg-[#08050df2] p-4 text-white shadow-2xl backdrop-blur-xl" role="region" aria-label="Instalar PACK DJ">
    <button type="button" onClick={dismiss} aria-label="Cerrar sugerencia de instalación" className="absolute right-3 top-3 rounded-lg p-1 text-white/45 transition hover:bg-white/10 hover:text-white"><X size={16} /></button>
    <div className="flex items-start gap-3 pr-5">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-turquoise/15 text-turquoise"><Smartphone size={19} /></div>
      <div className="min-w-0"><p className="text-sm font-bold">Instala PACK DJ</p><p className="mt-1 text-xs leading-5 text-white/60">Ten la biblioteca a mano como una app. Necesitarás internet para buscar y descargar canciones.</p></div>
    </div>
    <button type="button" onClick={install} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-turquoise px-4 py-2.5 text-xs font-extrabold text-[#08050d] transition hover:brightness-110"><Download size={15} />{installPrompt ? 'Instalar ahora' : 'Ver cómo instalar'}</button>
    {showInstructions && <p className="mt-3 rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-xs leading-5 text-white/75">{ios ? 'En Safari, toca Compartir y luego “Añadir a pantalla de inicio”.' : 'Abre el menú del navegador y elige “Instalar aplicación” o “Añadir a pantalla de inicio”.'}</p>}
  </aside>
}
