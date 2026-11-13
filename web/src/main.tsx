import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// Páginas públicas (sin iniciar sesión): encuesta de satisfacción y seguimiento del servicio técnico.
const EncuestaPublica = lazy(() => import('./EncuestaPublica'))
const ServicioPublico = lazy(() => import('./ServicioPublico'))
const ruta = window.location.pathname
const esEncuesta = /^\/encuesta\/?$/.test(ruta)
const esServicio = /^\/servicio\/?$/.test(ruta)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {esEncuesta ? <Suspense fallback={null}><EncuestaPublica /></Suspense> : esServicio ? <Suspense fallback={null}><ServicioPublico /></Suspense> : <App />}
  </StrictMode>,
)
