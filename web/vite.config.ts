import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Conserva los nombres de los componentes en la versión publicada: el registro de errores (errores_app)
  // dice en qué pantalla fue el fallo («En: Resumen») en vez de un nombre recortado («En: Xe»).
  esbuild: { keepNames: true },
  build: {
    rollupOptions: {
      output: {
        // React y Supabase en archivos propios: casi nunca cambian, así el navegador los conserva entre publicaciones
        // (antes iban dentro de index-*.js, que cambia en cada publicación, y se volvían a bajar ~360 kB cada vez).
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react'
          if (/[\\/]node_modules[\\/](@supabase|iceberg-js)[\\/]/.test(id)) return 'vendor-supabase'
          return undefined
        },
      },
    },
  },
})
