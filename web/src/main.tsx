import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// Páginas públicas (sin iniciar sesión): encuesta de satisfacción, seguimiento del servicio técnico
// carga de material de productos para proveedores y seguimiento del pedido.
const EncuestaPublica = lazy(() => import('./EncuestaPublica'))
const ServicioPublico = lazy(() => import('./ServicioPublico'))
const MaterialPublico = lazy(() => import('./MaterialPublico'))
const SeguimientoPublico = lazy(() => import('./SeguimientoPublico'))
const ruta = window.location.pathname
const esEncuesta = /^\/encuesta\/?$/.test(ruta)
const esServicio = /^\/servicio\/?$/.test(ruta)
const esMaterial = /^\/material\/?$/.test(ruta)
const esSeguimiento = /^\/seguimiento\/?$/.test(ruta)
// Enlace directo al escáner de pedidos (se puede guardar como ícono en el celular): /escanear abre la app en esa vista.
// Con ?c=<código> (botón "Registrar avance" de la página pública) busca ese pedido de una vez.
if (/^\/escanear\/?$/.test(ruta)) {
  const c = new URLSearchParams(window.location.search).get('c')
  window.history.replaceState(null, '', '/#escanear' + (c ? '/' + encodeURIComponent(c) : ''))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {esEncuesta ? <Suspense fallback={null}><EncuestaPublica /></Suspense>
      : esServicio ? <Suspense fallback={null}><ServicioPublico /></Suspense>
      : esMaterial ? <Suspense fallback={null}><MaterialPublico /></Suspense>
      : esSeguimiento ? <Suspense fallback={null}><SeguimientoPublico /></Suspense>
      : <App />}
  </StrictMode>,
)
