import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorPantalla, recargarPorVersionNueva } from './ErrorPantalla'
import { MODULOS } from './modulos'
import { rutaAntigua } from './rutasAntiguas'
import './styles.css'

// Páginas públicas (sin iniciar sesión): encuesta de satisfacción, seguimiento del servicio técnico
// carga de material de productos para proveedores y seguimiento del pedido.
const EncuestaPublica = lazy(() => import('./EncuestaPublica'))
const ServicioPublico = lazy(() => import('./ServicioPublico'))
const MaterialPublico = lazy(() => import('./MaterialPublico'))
const SeguimientoPublico = lazy(() => import('./SeguimientoPublico'))
// Botones «WhatsApp» y «Llamar» del correo del lead: registran el contacto en el CRM y abren el chat o la llamada.
const ContactoLead = lazy(() => import('./ContactoLead'))
// Desde el 21-nov-2026 la app vive en app.vimedic.com.ec y qa.vimedic.com.ec ya no se usa: quien lo abra pasa allá con el
// mismo enlace (también las páginas públicas: encuestas, seguimiento, material… siguen funcionando).
// Para probar cambios antes de main queda vimedic-qa.pages.dev (no se redirige).
if (window.location.hostname === 'qa.vimedic.com.ec') {
  window.location.replace('https://app.vimedic.com.ec' + window.location.pathname + window.location.search + window.location.hash)
}
// Enlaces de la app anterior (app.vimedic.com.ec/crm/, /acceso/, /espacio/…) → módulo equivalente de esta app.
const antigua = rutaAntigua(window.location.pathname, window.location.search, new Set(Object.keys(MODULOS)))
if (antigua !== null) window.history.replaceState(null, '', antigua)
const ruta = window.location.pathname
const esEncuesta = /^\/encuesta\/?$/.test(ruta)
const esServicio = /^\/servicio\/?$/.test(ruta)
const esMaterial = /^\/material\/?$/.test(ruta)
const esSeguimiento = /^\/seguimiento\/?$/.test(ruta)
const esContactoLead = /^\/contacto-lead\/?$/.test(ruta)
// Enlace directo al escáner de pedidos (se puede guardar como ícono en el celular): /escanear abre la app en esa vista.
// Con ?c=<código> (botón "Registrar avance" de la página pública) busca ese pedido de una vez.
if (/^\/escanear\/?$/.test(ruta)) {
  const c = new URLSearchParams(window.location.search).get('c')
  window.history.replaceState(null, '', '/#escanear' + (c ? '/' + encodeURIComponent(c) : ''))
}

// Versión nueva publicada mientras se trabajaba: un archivo de la versión anterior ya no existe → se recarga sola una vez.
window.addEventListener('vite:preloadError', (ev) => { if (recargarPorVersionNueva()) ev.preventDefault() })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorPantalla donde="la app">
    {esEncuesta ? <Suspense fallback={null}><EncuestaPublica /></Suspense>
      : esServicio ? <Suspense fallback={null}><ServicioPublico /></Suspense>
      : esMaterial ? <Suspense fallback={null}><MaterialPublico /></Suspense>
      : esSeguimiento ? <Suspense fallback={null}><SeguimientoPublico /></Suspense>
      : esContactoLead ? <Suspense fallback={null}><ContactoLead /></Suspense>
      : <App />}
    </ErrorPantalla>
  </StrictMode>,
)
