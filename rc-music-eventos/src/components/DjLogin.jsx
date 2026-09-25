import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, Crown, Eye, EyeOff, Headphones, KeyRound, LoaderCircle, Mail, ShieldCheck, Upload } from 'lucide-react'
import { Brand, PageContainer } from './Brand'
import LanguagePicker from './LanguagePicker'
import { djLibraryStandalone, getDemoDays, getStoredDjSession, getSubscriptionPlanPrices, getSubscriptionQr, getSubscriptionYapeNumber, PENDING_RECOVERY_KEY, PENDING_TRIAL_KEY, requestAdminCodeNotification, sendEmailVerificationLink, signInDj, signOutDj, startDjTrial, submitSubscriptionProof, supabase, supabaseEnabled } from '../lib/supabase'
// Yape subscription number and plan prices are loaded from developer-controlled settings.
import { useLanguage } from '../lib/i18n'
import { PLAN_OPTIONS, mergePlanOptions, planPriceText, planUsdPriceText } from '../lib/plans'

const ADMIN_EMAIL = String(djLibraryStandalone ? (import.meta.env.VITE_DJ_LIBRARY_ADMIN_EMAIL || 'djgian7785@gmail.com') : 'djgianfrancoromerodechosica@gmail.com').trim().toLowerCase()


async function proofFileToDataUrl(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('invalid-image')
  const source = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file) })
  const image = await new Promise((resolve, reject) => { const value = new Image(); value.onload = () => resolve(value); value.onerror = reject; value.src = source })
  const maxSide = 1000; const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight)); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale)); canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
  const result = canvas.toDataURL('image/webp', 0.84)
  if (result.length > 1500000) throw new Error('image-too-large')
  return result
}

export function PlanCards({ token, email, code }) {
  const sessionToken = token || getStoredDjSession()?.token
  const currency = 'PEN'
  const rate = 1
  const [usdRate, setUsdRate] = useState(null)
  const [plans, setPlans] = useState(PLAN_OPTIONS)
  const [subscriptionQr, setSubscriptionQr] = useState('')
  const [yapeNumber, setYapeNumber] = useState('')
  const [selectedPlan, setSelectedPlan] = useState('')
  const [proofImage, setProofImage] = useState('')
  const [proofName, setProofName] = useState('')
  const [proofBusy, setProofBusy] = useState(false)
  const [proofMessage, setProofMessage] = useState('')
  useEffect(() => { fetch('https://open.er-api.com/v6/latest/PEN').then((response) => response.json()).then((data) => { const nextRate = Number(data?.rates?.USD); if (Number.isFinite(nextRate) && nextRate > 0) setUsdRate(nextRate) }).catch(() => {}) }, [])
  useEffect(() => {
    let active = true
    const loadPlanNotice = () => Promise.all([getSubscriptionQr(), getSubscriptionYapeNumber(), getSubscriptionPlanPrices()]).then(([qr, number, prices]) => { if (!active) return; setSubscriptionQr(qr); setYapeNumber(number); setPlans(mergePlanOptions(prices)) }).catch(() => {})
    loadPlanNotice()
    const timer = setInterval(loadPlanNotice, 30000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  async function selectProof(file) {
    if (!file) return
    setProofBusy(true); setProofMessage('')
    try { setProofImage(await proofFileToDataUrl(file)); setProofName(file.name) } catch { setProofMessage('No se pudo leer la imagen. Usa una foto clara y menor de 1.5 MB.') } finally { setProofBusy(false) }
  }
  async function sendProof() {
    if (!selectedPlan || !proofImage) { setProofMessage('Selecciona un plan y sube la foto del comprobante.'); return }
    setProofBusy(true); setProofMessage('')
    try {
      let currentToken = sessionToken
      if (!currentToken && email && code) {
        try { await signInDj(email, code) } catch (error) {
          currentToken = error?.access?.token || error?.access?.session_token || getStoredDjSession()?.token
          if (!currentToken && supabase) {
            const { data } = await supabase.rpc('dj_login', { p_email: email.trim().toLowerCase(), p_code: code })
            const access = Array.isArray(data) ? data[0] : data
            currentToken = access?.session_token || ''
          }
        }
      }
      if (!currentToken) { setProofMessage('Vuelve a ingresar con tu código para enviar el comprobante.'); return }
      await submitSubscriptionProof(selectedPlan, proofImage, currentToken, email, code)
      setProofMessage('Comprobante enviado. El desarrollador revisará el pago y activará tu plan. Revisa tu bandeja de correo electrónico: allí recibirás tu código de acceso único.'); setProofImage('')
    } catch { setProofMessage('No se pudo enviar el comprobante. Inténtalo nuevamente.') } finally { setProofBusy(false) }
  }
  return <div className="mt-4"><p className="mb-2 text-[11px] text-white/45">Precio principal en soles · dólar referencial actualizado</p>{subscriptionQr && <div className="mb-3 flex items-center gap-3 rounded-xl bg-white p-3 text-left text-ink"><img src={subscriptionQr} alt="QR de Yape para suscripciones" className="h-24 w-24 rounded-lg object-contain" /><div><strong className="block text-sm">Paga con Yape</strong>{yapeNumber && <span className="mt-1 block text-xs font-bold text-ink/75">Número: {yapeNumber}</span>}<span className="mt-1 block text-xs text-ink/60">Escanea el QR o usa el número y luego sube aquí tu comprobante.</span></div></div>}<div className="grid gap-2 sm:grid-cols-3">{plans.map((plan) => <button type="button" key={plan.id} onClick={() => { setSelectedPlan(plan.id); setProofMessage('') }} className={`rounded-xl border p-3 text-center transition ${selectedPlan === plan.id ? 'border-turquoise bg-turquoise/20' : 'border-turquoise/25 bg-turquoise/10 hover:border-turquoise/60'}`}><strong className="block text-sm text-turquoise">{plan.label}</strong><span className="mt-1 block text-xs text-white/70">{planPriceText(plan, currency, rate)}{usdRate ? <span className="ml-1 text-white/50">· {planUsdPriceText(plan, usdRate)}</span> : ''}</span></button>)}</div><div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-xs font-bold text-white/75">{selectedPlan ? `Plan elegido: ${plans.find((plan) => plan.id === selectedPlan)?.label}` : '1. Elige el plan que pagaste'}</p><label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-turquoise/30 bg-turquoise/10 px-3 py-2.5 text-xs font-bold text-turquoise hover:bg-turquoise/15"><Upload size={15} />{proofBusy ? 'Procesando…' : '2. Subir comprobante'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={proofBusy} onChange={(e) => { selectProof(e.target.files?.[0]); e.target.value = '' }} className="sr-only" /></label>{proofName && <span className="ml-2 text-xs text-white/50">{proofName}</span>}{proofImage && <img src={proofImage} alt="Vista previa del comprobante" className="mt-3 max-h-40 w-full rounded-lg bg-white object-contain p-1" />}<button type="button" onClick={sendProof} disabled={proofBusy || !proofImage || !selectedPlan} className="btn-primary mt-3 w-full disabled:cursor-not-allowed disabled:opacity-40">{proofBusy ? <LoaderCircle size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}3. Enviar comprobante</button>{proofMessage && <p className="mt-2 text-xs leading-5 text-turquoise">{proofMessage}</p>}</div></div>
}

export default function DjLogin({ onLogin, onBack, developerMode = false }) {
  const { t, language } = useLanguage(); const [email, setEmail] = useState(''); const [code, setCode] = useState(''); const [show, setShow] = useState(false); const [error, setError] = useState(''); const [submitting, setSubmitting] = useState(false); const [planExpired, setPlanExpired] = useState(false); const [expiredSession, setExpiredSession] = useState(null); const [showTrial, setShowTrial] = useState(false); const [trialName, setTrialName] = useState(''); const [trialEmail, setTrialEmail] = useState(''); const [trialVerificationCode, setTrialVerificationCode] = useState(''); const [trialCode, setTrialCode] = useState(''); const [trialStep, setTrialStep] = useState('details'); const [trialError, setTrialError] = useState(''); const [demoDays, setDemoDays] = useState(1); const [showRecovery, setShowRecovery] = useState(false); const [recoveryEmail, setRecoveryEmail] = useState(''); const [recoveryCode, setRecoveryCode] = useState(''); const [recoveryPassword, setRecoveryPassword] = useState(''); const [recoveryConfirm, setRecoveryConfirm] = useState(''); const [recoveryStep, setRecoveryStep] = useState('email'); const [recoveryVerified, setRecoveryVerified] = useState(false); const [recoveryMessage, setRecoveryMessage] = useState('')
  async function requestTrial(e) {
    e.preventDefault(); setTrialError('')
    try { if (!supabaseEnabled) throw new Error('SUPABASE_REQUIRED'); sessionStorage.setItem(PENDING_TRIAL_KEY, JSON.stringify({ email: trialEmail.trim().toLowerCase(), displayName: trialName.trim() })); await sendEmailVerificationLink(trialEmail); setTrialStep('verify'); setTrialError('Te enviamos un código de verificación a tu correo. Escríbelo aquí para generar tu código de acceso.') }
    catch (err) { setTrialError(err?.message === 'SUPABASE_REQUIRED' ? t('supabaseRequired') : t('trialUnavailable')) }
  }
  async function resendTrialCode() {
    setTrialError('')
    try { await sendEmailVerificationLink(trialEmail); setTrialError('Código reenviado. Revisa también Spam, Promociones o No deseado.') } catch { setTrialError('No se pudo reenviar el código. Espera un momento y vuelve a intentarlo.') }
  }
  async function generateTrial() {
    const result = await startDjTrial(trialEmail, trialName)
    sessionStorage.removeItem(PENDING_TRIAL_KEY); setTrialCode(result.generated_code); setTrialStep('done'); setEmail(trialEmail); setCode(result.generated_code); setTrialError('Correo verificado. Tu usuario ya aparece en el Centro de gestión.')
  }
  async function verifyTrial(e) {
    e.preventDefault(); setTrialError('')
    try {
      const { error } = await supabase.auth.verifyOtp({ email: trialEmail.trim().toLowerCase(), token: trialVerificationCode.trim(), type: 'email' })
      if (error) throw error
      await generateTrial()
    } catch { setTrialError('El código de verificación no es válido o ya venció. Solicita uno nuevo.') }
  }

  useEffect(() => { getDemoDays().then((days) => setDemoDays(days)).catch(() => {}) }, [])

  useEffect(() => {
    if (!supabase) return undefined
    let active = true
    const finishVerifiedTrial = async (session) => {
      try {
        const pending = JSON.parse(sessionStorage.getItem(PENDING_TRIAL_KEY) || 'null')
        if (!pending || !session?.user?.email || session.user.email.toLowerCase() !== pending.email || !session.user.email_confirmed_at) return
        if (!active) return
        setTrialEmail(pending.email); setTrialName(pending.displayName); setTrialStep('verified'); setTrialError('Correo verificado. Pulsa generar para crear tu código de acceso.')
      } catch {}
    }
    const finishRecovery = async (session) => {
      try {
        const pending = JSON.parse(sessionStorage.getItem(PENDING_RECOVERY_KEY) || 'null')
        if (!pending || !session?.user?.email || session.user.email.toLowerCase() !== pending.email || !session.user.email_confirmed_at) return
        if (!active) return
        sessionStorage.removeItem(PENDING_RECOVERY_KEY); setRecoveryEmail(pending.email); setRecoveryVerified(true); setRecoveryStep('new-password'); setRecoveryMessage('Correo verificado. Ahora define tu nueva clave de desarrollador.')
      } catch { if (active) setRecoveryMessage('No se pudo validar el correo. Vuelve a solicitar el código.') }
    }
    supabase.auth.getSession().then(({ data }) => { finishVerifiedTrial(data.session); finishRecovery(data.session) }).catch(() => {})
    const { data } = supabase.auth.onAuthStateChange((_, session) => { finishVerifiedTrial(session); finishRecovery(session) })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [])

  async function requestAdminCodeByEmail() {
    const requester = email.trim().toLowerCase()
    const subject = 'Solicitud de reenvío de código de acceso DJ'
    const body = `Hola,

Solicito que me envíen nuevamente mi código de acceso al Panel de DJ.

Correo registrado: ${requester}

Gracias.`
    if (djLibraryStandalone) await requestAdminCodeNotification(requester).catch(() => {})
    window.location.href = `mailto:${ADMIN_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  async function requestRecovery(e) {
    e.preventDefault(); setRecoveryMessage('')
    try {
      if (!supabaseEnabled || !recoveryEmail.trim()) throw new Error('invalid')
      sessionStorage.setItem(PENDING_RECOVERY_KEY, JSON.stringify({ email: recoveryEmail.trim().toLowerCase() }))
      await sendEmailVerificationLink(recoveryEmail)
      setRecoveryStep('verify'); setRecoveryMessage('Te enviamos un código de verificación. Escríbelo aquí y define tu nueva clave.')
    } catch { setRecoveryMessage('No se pudo enviar el código. Comprueba el correo e inténtalo de nuevo.') }
  }
  async function confirmRecovery(e) {
    e.preventDefault(); setRecoveryMessage('')
    if (recoveryPassword.length < 8) { setRecoveryMessage('La nueva clave debe tener al menos 8 caracteres.'); return }
    if (recoveryPassword !== recoveryConfirm) { setRecoveryMessage('Las claves no coinciden.'); return }
    try {
      if (!recoveryVerified) {
        const { error } = await supabase.auth.verifyOtp({ email: recoveryEmail.trim().toLowerCase(), token: recoveryCode.trim(), type: 'email' })
        if (error) throw error
      }
      const { error } = await supabase.rpc('dj_set_admin_code', { p_new_code: recoveryPassword })
      if (error) throw error
      setEmail(recoveryEmail.trim().toLowerCase()); setCode(recoveryPassword); setRecoveryMessage('Nueva clave guardada. El correo y la nueva clave ya quedaron cargados en el formulario de ingreso.'); setRecoveryStep('done')
    } catch { setRecoveryMessage('El código de verificación no es válido o ya venció. Solicita uno nuevo.') }
  }

  async function submit(e) {
    e.preventDefault(); if (submitting) return; setSubmitting(true); setError(''); setPlanExpired(false); setExpiredSession(null)
    try {
      if (!supabaseEnabled) throw new Error('SUPABASE_REQUIRED')
      const access = await signInDj(email, code)
      if (developerMode && access?.role !== 'admin') {
        await signOutDj(access?.token)
        throw new Error('DEVELOPER_ACCESS_REQUIRED')
      }
      if (access?.planExpired) {
        setPlanExpired(true); setExpiredSession(access); setError(djLibraryStandalone ? (language === 'en' ? 'Your plan has expired. Renew it to access the music library again.' : 'Tu plan venció. Renueva tu plan para volver a acceder a la biblioteca musical.') : t('planExpired')); return
      }
      onLogin(access)
    } catch (err) {
      if (djLibraryStandalone && err?.access && err?.message === 'DJ plan expired') {
        setPlanExpired(true); setExpiredSession(err.access); setError(djLibraryStandalone ? (language === 'en' ? 'Your plan has expired. Renew it to access the music library again.' : 'Tu plan venció. Renueva tu plan para volver a acceder a la biblioteca musical.') : t('planExpired'))
      } else {
        setError(err?.message === 'SUPABASE_REQUIRED' ? t('supabaseRequired') : err?.message === 'DEVELOPER_ACCESS_REQUIRED' ? 'Este acceso es exclusivo para el desarrollador. Ingresa con el usuario y la clave de administrador.' : err?.message === 'LOGIN_TIMEOUT' ? 'El servidor tardó demasiado en responder. Revisa la conexión y vuelve a pulsar Ingresar.' : t('loginError'))
      }
    } finally { setSubmitting(false) }
  }
  return <div className="party-page min-h-screen bg-ink bg-grid"><PageContainer className="flex min-h-screen flex-col"><div className="flex items-center justify-between"><Brand /><div className="flex items-center gap-2"><LanguagePicker /><button onClick={onBack} className="btn-secondary shrink-0 p-2.5" aria-label={t('back')} title={t('back')}><ArrowLeft size={18} /></button></div></div><div className="flex flex-1 items-center justify-center py-14"><div className="w-full max-w-md"><div className="mb-8 text-center"><div className={`mx-auto mb-5 grid h-16 w-16 place-items-center rounded-3xl ${developerMode ? 'border border-violet-300/30 bg-violet-300/15 text-violet-100' : 'bg-violet/20 text-violet-200'}`}>{developerMode ? <Crown size={30} /> : <Headphones size={30} />}</div><p className="eyebrow text-violet-200">{developerMode ? 'Acceso de desarrollador' : djLibraryStandalone ? (language === 'en' ? 'Music library access' : 'Acceso a biblioteca musical') : t('djAccess')}</p><h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">{developerMode ? 'Centro de gestión' : djLibraryStandalone ? 'PACK TODOS LOS GÉNEROS' : t('djHeading')}</h1><p className="mt-4 text-sm leading-6 text-white/55">{developerMode ? 'Ingresa con tu usuario y clave de administrador para gestionar usuarios, planes, solicitudes y precios.' : djLibraryStandalone ? (language === 'en' ? 'Sign in with your registered email and access code to open the music library.' : 'Ingresa con tu correo registrado y tu código de acceso para abrir la biblioteca musical.') : t('djDescription')}</p></div><form onSubmit={submit} className="glass rounded-[2rem] p-5 sm:p-7"><label className="mb-2 block text-sm font-semibold text-white/75">{developerMode ? 'Usuario / correo de administrador' : djLibraryStandalone ? (language === 'en' ? 'Registered email' : 'Correo registrado') : t('email')}</label><div className="relative"><Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/35" /><input autoFocus required type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(''); setPlanExpired(false) }} className="input-dark pl-11" placeholder={t('emailPlaceholder')} autoComplete="username" /></div><label className="mb-2 mt-4 block text-sm font-semibold text-white/75">{developerMode ? 'Clave de desarrollador' : djLibraryStandalone ? (language === 'en' ? 'Access code' : 'Código de acceso') : t('accessCode')}</label><div className="relative"><KeyRound size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/35" /><input required type={show ? 'text' : 'password'} value={code} onChange={(e) => { setCode(e.target.value); setError(''); setPlanExpired(false) }} className="input-dark pl-11 pr-12" placeholder={developerMode ? 'Clave de administrador' : djLibraryStandalone ? (language === 'en' ? 'Access code' : 'Código de acceso') : 'Código personal'} autoComplete="one-time-code" /><button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-white/35 hover:text-white" aria-label={show ? 'Ocultar código' : 'Mostrar código'}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>{error && <div className="mt-3 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-200"><p>{error}</p>{planExpired && <><p className="mt-3 font-semibold text-turquoise">Adquirir un plan:</p><PlanCards token={expiredSession?.token} email={email} code={code} /></>}</div>}<button type="submit" disabled={submitting} className="btn-primary mt-5 w-full disabled:cursor-wait disabled:opacity-60">{submitting ? 'Ingresando…' : djLibraryStandalone ? (language === 'en' ? 'Open music library' : 'Entrar a la biblioteca') : t('enter')} <ArrowRight size={18} /></button><div className="mt-5 flex items-center gap-2 text-xs text-white/35"><ShieldCheck size={14} className="text-violet-300" /> {djLibraryStandalone ? (language === 'en' ? 'Private access for authorized DJs.' : 'Acceso privado para DJs autorizados.') : t('codeHint')}</div></form>{email.trim() && email.trim().toLowerCase() === ADMIN_EMAIL ? <button type="button" onClick={() => { setShowRecovery(true); setRecoveryEmail(email); setRecoveryCode(''); setRecoveryPassword(''); setRecoveryConfirm(''); setRecoveryVerified(false); setRecoveryStep('email'); setRecoveryMessage('') }} className="mt-4 w-full text-xs text-white/45 underline underline-offset-4 hover:text-turquoise">¿Olvidaste tu contraseña? Recuperarla por correo</button> : email.trim() ? <button type="button" onClick={requestAdminCodeByEmail} className="mt-4 w-full text-xs text-white/45 underline underline-offset-4 hover:text-turquoise">¿Olvidaste tu código? Solicitar al administrador</button> : null}<button type="button" onClick={() => { setShowTrial(true); setTrialError(''); setTrialVerificationCode(''); setTrialCode(''); setTrialStep('details') }} className="mt-4 w-full rounded-xl border border-turquoise/30 bg-turquoise/10 px-4 py-3 text-sm font-bold text-turquoise hover:bg-turquoise/15">{language === 'en' ? `Try free demo · ${demoDays} ${demoDays === 1 ? 'day' : 'days'}` : `Probar demo gratis · ${demoDays} ${demoDays === 1 ? 'día' : 'días'}`}</button></div></div>{showRecovery && <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={() => setShowRecovery(false)}><div className="glass w-full max-w-md rounded-[2rem] p-6" onMouseDown={(e) => e.stopPropagation()}><h2 className="font-display text-2xl font-bold">Recuperar clave de desarrollador</h2><p className="mt-2 text-sm leading-6 text-white/55">Primero verifica tu correo y después podrás guardar una nueva clave.</p>{recoveryStep === 'email' && <form onSubmit={requestRecovery} className="mt-5 space-y-3"><input required type="email" value={recoveryEmail} onChange={(e) => setRecoveryEmail(e.target.value)} className="input-dark" placeholder="Correo de administrador" />{recoveryMessage && <p className="rounded-xl border border-turquoise/20 bg-turquoise/10 px-3 py-2 text-sm text-turquoise">{recoveryMessage}</p>}<button className="btn-primary w-full">Enviar código de verificación</button></form>}{recoveryStep === 'verify' && <form onSubmit={confirmRecovery} className="mt-5 space-y-3"><input required inputMode="numeric" value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} className="input-dark" placeholder="Código de verificación" aria-label="Código de verificación" /><input required minLength={8} type="password" value={recoveryPassword} onChange={(e) => setRecoveryPassword(e.target.value)} className="input-dark" placeholder="Nueva clave de desarrollador" aria-label="Nueva clave de desarrollador" /><input required minLength={8} type="password" value={recoveryConfirm} onChange={(e) => setRecoveryConfirm(e.target.value)} className="input-dark" placeholder="Repetir nueva clave" aria-label="Repetir nueva clave" />{recoveryMessage && <p className="rounded-xl border border-turquoise/20 bg-turquoise/10 px-3 py-2 text-sm text-turquoise">{recoveryMessage}</p>}<button className="btn-primary w-full">Guardar nueva clave</button></form>}{recoveryStep === 'new-password' && <form onSubmit={confirmRecovery} className="mt-5 space-y-3"><input required minLength={8} type="password" value={recoveryPassword} onChange={(e) => setRecoveryPassword(e.target.value)} className="input-dark" placeholder="Nueva clave de desarrollador" aria-label="Nueva clave de desarrollador" /><input required minLength={8} type="password" value={recoveryConfirm} onChange={(e) => setRecoveryConfirm(e.target.value)} className="input-dark" placeholder="Repetir nueva clave" aria-label="Repetir nueva clave" />{recoveryMessage && <p className="rounded-xl border border-turquoise/20 bg-turquoise/10 px-3 py-2 text-sm text-turquoise">{recoveryMessage}</p>}<button className="btn-primary w-full">Guardar nueva clave</button></form>}{recoveryStep === 'done' && <div className="mt-5 rounded-2xl border border-turquoise/30 bg-turquoise/10 p-4 text-center"><p className="text-sm text-turquoise">{recoveryMessage}</p><button type="button" onClick={() => setShowRecovery(false)} className="btn-primary mt-4 w-full">Volver al ingreso</button></div>}</div></div>}{showTrial && <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={() => setShowTrial(false)}><div className="glass w-full max-w-md rounded-[2rem] p-6" onMouseDown={(e) => e.stopPropagation()}><h2 className="font-display text-2xl font-bold">{t('demoTitle')}</h2><p className="mt-2 text-sm leading-6 text-white/55">{language === 'en' ? `Verify your email to create a demo account with full plan benefits for ${demoDays} ${demoDays === 1 ? 'day' : 'days'}.` : `Verifica tu correo para crear una cuenta demo con todos los beneficios durante ${demoDays} ${demoDays === 1 ? 'día' : 'días'}.`}</p>{trialStep === 'details' && <form onSubmit={requestTrial} className="mt-5 space-y-3"><input required value={trialName} onChange={(e) => setTrialName(e.target.value)} className="input-dark" placeholder={t('demoNamePlaceholder')} /><input required type="email" value={trialEmail} onChange={(e) => setTrialEmail(e.target.value)} className="input-dark" placeholder={t('emailPlaceholder')} />{trialError && <p className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-200">{trialError}</p>}<button className="btn-primary w-full">Enviar código de verificación</button></form>}{trialStep === 'verify' && <form onSubmit={verifyTrial} className="mt-5 space-y-3"><p className="text-xs text-white/55">Código enviado a <strong className="text-white">{trialEmail}</strong></p><input required inputMode="numeric" value={trialVerificationCode} onChange={(e) => setTrialVerificationCode(e.target.value)} className="input-dark" placeholder="Código de verificación" aria-label="Código de verificación" />{trialError && <p className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-200">{trialError}</p>}<button className="btn-primary w-full">Verificar y generar código de acceso</button><button type="button" onClick={resendTrialCode} className="w-full text-xs text-white/45 underline underline-offset-4 hover:text-turquoise">Reenviar código de verificación</button></form>}{trialStep === 'verified' && <div className="mt-5 space-y-3"><p className="rounded-xl border border-turquoise/20 bg-turquoise/10 px-3 py-2 text-sm text-turquoise">{trialError}</p><button type="button" onClick={() => generateTrial().catch(() => setTrialError('No se pudo crear la demo. Inténtalo nuevamente.'))} className="btn-primary w-full">Generar código de acceso</button></div>}{trialStep === 'done' && <div className="mt-5 rounded-2xl border border-turquoise/30 bg-turquoise/10 p-4 text-center"><p className="text-xs text-white/55">Tu código de acceso generado</p><p className="mt-2 font-mono text-3xl font-bold tracking-[.18em] text-turquoise">{trialCode}</p><p className="mt-3 text-xs text-white/55">Tu usuario ya fue registrado en el Centro de gestión y tiene acceso completo durante los días demo configurados.</p><button type="button" onClick={async () => { try { const access = await signInDj(trialEmail, trialCode); setShowTrial(false); onLogin(access) } catch { setTrialError('El demo fue creado, pero no se pudo abrir el panel automáticamente. Usa el código mostrado para ingresar.') } }} className="btn-primary mt-4 w-full">Entrar al panel con este código</button></div>}</div></div>}</PageContainer></div>
}
