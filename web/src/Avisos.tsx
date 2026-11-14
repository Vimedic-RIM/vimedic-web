import { useCallback, useEffect, useState } from 'react'
import { Bell, CheckCheck, X } from 'lucide-react'
import { supabase, type Perfil } from './supabase'

/* Avisos internos (tabla notificaciones): leads asignados, reasignaciones,
   novedades de Logística, Agenda, etc. Antes se guardaban pero no había dónde
   verlos. Llegan en tiempo real y se marcan como leídos al abrir el panel. */
type Aviso = { id: string; created_at: string; modulo: string | null; evento: string | null; texto: string; entidad: string | null; entidad_id: string | null; leida_en: string | null }

const DESTINO: Record<string, string> = { crm: 'crm', femedics: 'femedics', logistica: 'logistica', agenda: 'agenda', bodega: 'bodega', facturacion: 'facturacion', serviciotecnico: 'serviciotecnico', servicio_tecnico: 'serviciotecnico', importaciones: 'importaciones', marketing: 'marketing', talento_humano: 'talentohumano', miperfil: 'miperfil', solicitudes: 'solicitudes' }

export function useAvisos(perfil: Perfil) {
  const [lista, setLista] = useState<Aviso[] | null>(null)
  const cargar = useCallback(async () => {
    const { data } = await supabase.from('notificaciones').select('id,created_at,modulo,evento,texto,entidad,entidad_id,leida_en')
      .eq('para_id', perfil.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(40)
    setLista((data as Aviso[]) ?? [])
  }, [perfil.id])
  useEffect(() => {
    cargar()
    const canal = supabase.channel('avisos-' + perfil.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notificaciones', filter: 'para_id=eq.' + perfil.id }, () => cargar())
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [cargar, perfil.id])
  const sinLeer = (lista ?? []).filter((a) => !a.leida_en).length
  const marcarLeidas = useCallback(async () => {
    const ids = (lista ?? []).filter((a) => !a.leida_en).map((a) => a.id)
    if (!ids.length) return
    const ahora = new Date().toISOString()
    setLista((l) => (l ?? []).map((a) => (ids.includes(a.id) ? { ...a, leida_en: ahora } : a)))
    await supabase.from('notificaciones').update({ leida_en: ahora }).in('id', ids)
  }, [lista])
  return { lista, sinLeer, marcarLeidas, cargar }
}

export function PanelAvisos({ lista, cerrar, ir, marcarLeidas }: { lista: Aviso[] | null; cerrar: () => void; ir: (modulo: string) => void; marcarLeidas: () => void }) {
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', f); return () => document.removeEventListener('keydown', f) }, [cerrar])
  function abrir(a: Aviso) {
    const destino = DESTINO[a.modulo ?? ''] ?? ''
    if (!destino) return
    // El CRM abre directamente la gestión al llegar.
    if ((a.entidad === 'leads' || a.entidad === 'cotizaciones') && a.entidad_id) { try { sessionStorage.setItem('vm_crm_abrir', a.entidad + ':' + a.entidad_id) } catch { /* sin almacenamiento */ } }
    cerrar(); ir(destino)
  }
  return (
    <div className="vr-modal on" role="dialog" aria-modal="true" aria-label="Avisos" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="vr-caja" style={{ maxWidth: 460 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid #eef2f6' }}>
          <Bell style={{ width: 18, height: 18, color: '#055c9d' }} />
          <b style={{ fontSize: 14, color: '#0f172a' }}>Avisos</b>
          <button type="button" onClick={marcarLeidas} style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: '#055c9d', display: 'inline-flex', alignItems: 'center', gap: 4 }}><CheckCheck style={{ width: 14, height: 14 }} />Marcar leídos</button>
          <button type="button" onClick={cerrar} aria-label="Cerrar" style={{ color: '#94a3b8' }}><X style={{ width: 16, height: 16 }} /></button>
        </div>
        <div style={{ maxHeight: '65vh', overflowY: 'auto', padding: 10, display: 'grid', gap: 6 }}>
          {lista === null && <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: 20 }}>Cargando…</p>}
          {lista?.length === 0 && <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: 20 }}>No tienes avisos.</p>}
          {lista?.map((a) => (
            <button key={a.id} type="button" onClick={() => abrir(a)} style={{ textAlign: 'left', border: '1px solid ' + (a.leida_en ? '#e2e8f0' : '#a5e3ea'), background: a.leida_en ? '#fff' : '#f0fbfc', borderRadius: 12, padding: '8px 10px', cursor: DESTINO[a.modulo ?? ''] ? 'pointer' : 'default' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: '#055c9d' }}>{a.modulo ?? 'aviso'}</span>
                <span style={{ fontSize: 10, color: '#94a3b8' }}>{new Date(a.created_at).toLocaleString('es-EC', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <p style={{ fontSize: 12, color: '#334155', marginTop: 2, overflowWrap: 'anywhere' }}>{a.texto}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
