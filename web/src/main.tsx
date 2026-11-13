import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// Página pública (sin iniciar sesión): encuesta de satisfacción del cliente.
const EncuestaPublica = lazy(() => import('./EncuestaPublica'))
const esEncuesta = /^\/encuesta\/?$/.test(window.location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {esEncuesta ? <Suspense fallback={null}><EncuestaPublica /></Suspense> : <App />}
  </StrictMode>,
)
