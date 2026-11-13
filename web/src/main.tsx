import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// Páginas públicas (sin iniciar sesión): encuesta de satisfacción, seguimiento del servicio técnico
// y carga de material de productos para proveedores.
const EncuestaPublica = lazy(() => import('./EncuestaPublica'))
const ServicioPublico = lazy(() => import('./ServicioPublico'))
const MaterialPublico = lazy(() => import('./MaterialPublico'))
const ruta = window.location.pathname
const esEncuesta = /^\/encuesta\/?$/.test(ruta)
const esServicio = /^\/servicio\/?$/.test(ruta)
const esMaterial = /^\/material\/?$/.test(ruta)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {esEncuesta ? <Suspense fallback={null}><EncuestaPublica /></Suspense>
      : esServicio ? <Suspense fallback={null}><ServicioPublico /></Suspense>
      : esMaterial ? <Suspense fallback={null}><MaterialPublico /></Suspense>
      : <App />}
  </StrictMode>,
)
