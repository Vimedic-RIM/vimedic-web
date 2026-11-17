# Paso de la app nueva a app.vimedic.com.ec

Hoy la app nueva vive en **qa.vimedic.com.ec** (Cloudflare Pages, proyecto `vimedic-qa`, rama `qa`, base **vimedic-pruebas**) y
**app.vimedic.com.ec** sigue siendo la app de Apps Script. Lista de lo que hay que hacer el día del cambio.

## Lo que ya está preparado en el código
- Las Edge Functions aceptan cualquier dominio (CORS `*`): no hay que tocarlas por el cambio de dominio.
- La política de seguridad (`web/public/_headers`) permite cualquier proyecto `*.supabase.co`: sirve igual con la base de producción.
- Los enlaces internos (proformas, agenda, escáner) usan el dominio desde el que se abre la app: cambian solos.
- El enlace del **seguimiento del pedido** que se envía al cliente sale con `VITE_URL_SEGUIMIENTO` (vimedic.com.ec/seguimiento/), no con el dominio de la app.

## El día del cambio (en este orden)
1. **Base de producción (vimedic-produccion)**: aplicar las migraciones (`supabase db push` enlazado a producción), desplegar las
   Edge Functions con sus secretos (Drive, R2, Zernio, Meta, Contífico) y cargar los datos del Excel (ver `MAPEO_HOJAS.md`).
2. **Supabase › Authentication** (producción): Site URL `https://app.vimedic.com.ec` y en Redirect URLs `https://app.vimedic.com.ec`.
   En Google Cloud (cliente OAuth) agregar `https://app.vimedic.com.ec` en "Orígenes de JavaScript autorizados".
3. **Cloudflare Pages**: proyecto de producción (ej. `vimedic-app`) que publique la rama `main` con los secretos
   `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` **de producción**. En "Custom domains" agregar `app.vimedic.com.ec`.
4. **DNS en Hostinger**: el registro `app` pasa a ser `CNAME → vimedic-app.pages.dev` (Cloudflare lo indica al agregar el dominio).
   No tocar los registros MX.
5. **Webhooks externos** (Zernio / Meta / Pinterest): apuntar a las Edge Functions del proyecto de producción.
6. **Seguimiento del pedido**: en `public_html/seguimiento/index.html` del sitio (copia de `hostinger/seguimiento/index.html`)
   cambiar `var APP = 'https://qa.vimedic.com.ec'` por `'https://app.vimedic.com.ec'`.
7. Merge `qa` → `main` y publicar. Revisar inicio de sesión, CRM, Facturación y un enlace de seguimiento.

## Enlace público del seguimiento (vimedic.com.ec/seguimiento/)
1. Subir `hostinger/seguimiento/index.html` a `public_html/seguimiento/index.html` del sitio vimedic.com.ec.
2. Comprobar que `https://vimedic.com.ec/seguimiento/?c=<código de un pedido>` muestra el seguimiento.
3. En GitHub › Settings › Secrets and variables › Actions › **Variables**: `VITE_URL_SEGUIMIENTO = https://vimedic.com.ec/seguimiento/`
   y volver a publicar qa. Desde ese momento los enlaces y los QR de las guías salen con vimedic.com.ec.
