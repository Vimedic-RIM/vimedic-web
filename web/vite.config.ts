import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Conserva los nombres de los componentes en la versión publicada: el registro de errores (errores_app)
  // dice en qué pantalla fue el fallo («En: Resumen») en vez de un nombre recortado («En: Xe»).
  esbuild: { keepNames: true },
})
