// Edge Function: contacto desde el correo del lead (botones «WhatsApp» y «Llamar»).
//   La página pública /contacto-lead/?t=<enlace firmado>&v=wa|tel la llama con POST {t, v}. Se valida la firma
//   (clave de Vault, vigencia 30 días) y se registra la gestión en el CRM con public.lead_contacto_correo:
//   Nuevo → Contactado con la observación «Se contactó mediante el correo de aviso del lead que llegó a través de…»
//   y seguimiento a 1 día. Devuelve a dónde ir: el chat de WhatsApp con el saludo sugerido o el número para llamar.
//   Sin sesión: el enlace firmado es la autorización (CLAUDE.md: páginas públicas con token → Edge Function).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { verificarContacto } from '../_shared/contactoLead.ts'
import { saludoLead, waNumero } from '../_shared/correoLeads.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const responder = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return responder({ error: 'Método no permitido.' }, 405)
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const b = await req.json().catch(() => ({})) as { t?: string; v?: string }
    const via = b.v === 'tel' ? 'tel' : 'wa'
    const { data: clave } = await admin.rpc('lead_contacto_clave')
    const x = clave ? await verificarContacto(String(clave), String(b.t || '')) : null
    if (!x) return responder({ error: 'El enlace no es válido o ya venció (dura 30 días). Abre la gestión en el CRM.' }, 400)

    const { data, error } = await admin.rpc('lead_contacto_correo', { p_lead: x.leadId, p_asesor: x.asesorId, p_via: via })
    if (error) return responder({ error: error.message }, 400)
    const d = data as { codigo: string; nombre: string; telefono: string; asesor: string; respuestas: { t: string; v: string }[]; registrado: boolean; motivo?: string; cambio?: boolean; estado: string; seguimiento?: string | null }

    const destino = via === 'wa'
      ? 'https://wa.me/' + waNumero(d.telefono) + '?text=' + encodeURIComponent(saludoLead(d.nombre, d.asesor, Array.isArray(d.respuestas) ? d.respuestas : []))
      : 'tel:' + String(d.telefono).replace(/[^\d+]/g, '')
    return responder({
      ok: true, destino, via, codigo: d.codigo, nombre: String(d.nombre || '').trim().split(/\s+/)[0] || 'el cliente',
      registrado: d.registrado, motivo: d.motivo ?? null, cambio: d.cambio === true, estado: d.estado, seguimiento: d.seguimiento ?? null,
    })
  } catch (e) {
    return responder({ error: (e as Error).message || 'Error inesperado.' }, 500)
  }
})
