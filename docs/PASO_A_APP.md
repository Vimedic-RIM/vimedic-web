# Paso de la app nueva a app.vimedic.com.ec

Hoy la app nueva vive en **qa.vimedic.com.ec** (Cloudflare Pages, proyecto `vimedic-qa`, rama `qa`, base **vimedic-pruebas**) y
**app.vimedic.com.ec** sigue siendo la app de Apps Script: una página en **Hostinger** que muestra la app antigua dentro de un
marco (rutas `/acceso/`, `/espacio/`, `/<módulo>/`). Revisión completa: 21-nov-2026.

## 0. Antes de empezar: qué se rompería si hoy solo se cambiara el DNS
- **No existe el proyecto de Cloudflare Pages de producción** ni el despliegue de `main` (solo hay `deploy-qa.yml`).
- `main` está en la estructura inicial: **226 commits y 125 migraciones atrás** de `qa`.
- La base **vimedic-produccion** no tiene las migraciones ni los datos de hoy (no se revisó: regla de no tocar producción).
- Inicio de sesión: Supabase Auth de pruebas solo acepta `qa.vimedic.com.ec` y `vimedic-qa.pages.dev`.
- La web pública (vimedic.com.ec) usa funciones del proyecto de **pruebas**: ofertas (Black Sales), orden del catálogo y el
  seguimiento del pedido.
- Las integraciones reales (Meta Lead Ads, Gmail, Zernio, Claude, píxeles) están conectadas en **pruebas**.
- **Datos que solo existen en pruebas**: los leads de Meta desde el 20-nov (la app antigua ya no los recibe), el material
  y las tareas de Marketing creadas en la app nueva, el orden de categorías y productos, y la configuración de integraciones.

## 1. Decisión previa
- **A (el plan de CLAUDE.md)**: producción = proyecto **vimedic-produccion**, con datos cargados del Excel final el día del
  cambio + lo que solo existe en pruebas (ver punto 3). Pruebas sigue para probar.
- **B**: usar el proyecto de pruebas como producción (ya tiene integraciones y datos). Más rápido, pero hay que limpiar los
  datos de prueba y crear otro proyecto de pruebas, porque nunca se prueba contra producción.
Lo que sigue asume **A**.

## 2. Preparar producción (antes del día)
1. **Base**: `supabase db push` enlazado a producción (crea tablas, RLS, buckets, Vault de cron y de enlaces firmados,
   pg_cron y pg_net). No subir `supabase/config.toml` de pruebas a producción: su `[auth]` es de pruebas.
2. **Edge Functions**: desplegar todas (las de `verify_jwt = false` en config.toml: meta-leads, meta-leads-poll,
   lead-contacto, ofertas-web, orden-web, pinterest-feed, crm-mensajes, google-oauth…).
   Secreto nuevo: `supabase secrets set APP_URL=https://app.vimedic.com.ec` (enlaces de los correos de leads).
3. **Supabase › Authentication** (producción): Site URL `https://app.vimedic.com.ec`; Redirect URLs `https://app.vimedic.com.ec`.
   Google como proveedor con el mismo cliente OAuth.
4. **Google Cloud** (proyecto 984059782625, cliente OAuth):
   - Orígenes de JavaScript: `https://app.vimedic.com.ec`.
   - URIs de redirección: `https://<ref-produccion>.supabase.co/auth/v1/callback` (inicio de sesión) y
     `https://<ref-produccion>.supabase.co/functions/v1/google-oauth` (Drive y Gmail).
   - La Gmail API ya está habilitada (mismo proyecto). La pantalla de consentimiento debe estar «En producción».
5. **Cloudflare Pages**: proyecto de producción (ej. `vimedic-app`) que publique `main` con secretos de **producción**
   `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` y la variable `VITE_URL_SEGUIMIENTO=https://vimedic.com.ec/seguimiento/`.
   Crear su flujo (copia de `deploy-qa.yml` para `main`). Agregar el dominio `app.vimedic.com.ec` en «Custom domains».
6. **Integraciones** (Marketing › Configuración, en producción; las claves van al Vault de producción):
   Claude, Gemini (respaldo), App de Google + «Conectar con Google» (aceptar Drive y «Enviar correo»), Zernio,
   píxel de Meta, píxel de TikTok, WhatsApp en publicaciones, **Meta Lead Ads** (token del usuario del sistema y clave
   secreta; al guardar se crea un token de verificación nuevo y queda encendida la sincronización cada 5 min).
7. **Ordenar catálogo**: quien puede ordenar se toma de `inventario_ajustes` buscando al empleado «Jonathan Ruiz»; revisar
   que exista con ese nombre en producción.

## 3. El día del cambio (en este orden)
1. Avisar al equipo: la app antigua queda solo para consulta desde esa hora. Terminar las aprobaciones pendientes que
   llegaron por correo de la app antigua (esos enlaces no funcionan en la app nueva).
2. **Datos**: cargar el Excel final (ver `MAPEO_HOJAS.md`) y pasar desde pruebas lo que solo existe ahí: leads de Meta desde
   el 20-nov (con su historial), material y tareas de Marketing, orden de categorías y productos.
3. **Meta**: en la app de Meta, la URL de devolución del webhook pasa a `https://<ref-produccion>.supabase.co/functions/v1/meta-leads`
   con el token de verificación de producción (Marketing › Configuración › Meta).
4. **Apagar en pruebas** lo que llega a clientes o asesores reales, para que no se dupliquen:
   sincronización de Meta (interruptor), correo urgente al asesor (Meta › correo apagado), WhatsApp en publicaciones.
   Zernio es la misma cuenta en las dos: no publicar desde pruebas.
5. **App antigua para consulta**: copiar el contenido actual de `app.vimedic.com.ec` en Hostinger a otro subdominio
   (ej. `antigua.vimedic.com.ec`) antes de cambiar el DNS. La app de Apps Script sigue funcionando en su URL /exec.
6. **DNS en Hostinger**: el registro `app` pasa a `CNAME → vimedic-app.pages.dev`. No tocar los registros MX.
7. Merge `qa` → `main` y publicar.
8. **Web pública** (repo vimedic-web-publico, confirmar antes de publicar):
   - `seguimiento/index.html`: `var APP = 'https://app.vimedic.com.ec'`.
   - `assets/js/ofertas-black.js` y `assets/js/orden-web.js`: cambiar `qwkziqjozfeemvjshvsp` por el ref de producción.

## 4. Revisar después del cambio
- Entrar con Google y con correo; CRM como asesor (ve solo lo suyo) y como jefe; Facturación; un enlace de seguimiento.
- Enlaces viejos: `app.vimedic.com.ec/crm/`, `/acceso/`, `/espacio/?r=inventario` abren el módulo equivalente
  (`web/src/rutasAntiguas.ts`).
- Lead de prueba de Meta → entra al CRM y llega el correo; tocar «WhatsApp» del correo abre `app.vimedic.com.ec/contacto-lead/`.
- `meta_sync_runs` tiene ejecuciones del cron cada 5 min; Marketing › Configuración › Meta dice «Conectado».
- Web pública: ofertas y orden del catálogo vienen de producción.
- Drive (Conectar con Google), Planificador (Zernio) y «Mejores horas».

## Pendientes que ya existen hoy (no son del cambio de dominio)
- `web/public/_headers`: `frame-src` solo permite la app y Supabase, así que los videos de Drive y YouTube en Marketing,
  Inventario y el visor no se ven dentro de la app. Agregar `https://drive.google.com https://www.youtube.com
  https://www.youtube-nocookie.com https://player.vimeo.com`.
- Cuando las imágenes pasen a R2: agregar `https://media.vimedic.com.ec` a `img-src` y `media-src`.

## Enlace público del seguimiento (vimedic.com.ec/seguimiento/) — HECHO el 17-nov-2026
1. ✅ `public_html/seguimiento/index.html` = `hostinger/seguimiento/index.html` (repo vimedic-web-publico, commit 7aaa263; Hostinger lo publica solo).
2. ✅ `https://vimedic.com.ec/seguimiento/?c=<código>` muestra el seguimiento de la app dentro del sitio
   (en `web/public/_headers`, /seguimiento reemplaza la CSP general para permitir frame-ancestors de vimedic.com.ec).
3. ✅ Variable de GitHub `VITE_URL_SEGUIMIENTO = https://vimedic.com.ec/seguimiento/` y qa publicado: los enlaces y QR de las guías salen con vimedic.com.ec.
4. Al pasar a producción: el punto 3.8 de arriba (cambiar `var APP`) y definir la misma variable para el despliegue de `main`.
