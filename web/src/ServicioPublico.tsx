import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { descargarInforme, TITULOS, type EquipoDoc, type OrdenDoc } from './modulos/servicioInforme'
import './estilos/encuesta.css'

/* Seguimiento público de un servicio técnico (vmServicioPublico del original).
   Página sin iniciar sesión: /servicio/?c=<código de la orden>. */
type Datos = {
  marca: string; codigo: string; tipo: string; modalidad: string; estado: string; cliente: string; producto: string; serie: string; cobertura: string
  garantia: string; garantiaHasta: string; tecnico: string; fecha: string; fechaProgramada: string | null; inicio: string | null; cierre: string | null
  conDiagnostico: boolean; huboRepuesto: boolean; cotizacion: { estado: string } | null; estadoFinal: string; proximoMantenimiento: string | null
  eventos: { fecha: string; nota: string }[]; asesor: string; contactoTelefono: string; informe: OrdenDoc | null; recepcion: OrdenDoc | null; equipo: EquipoDoc
}
type Paso = { clave: string; titulo: string; desc?: string; fecha?: string | null; estado?: 'hecho' | 'actual' | 'pendiente' }
const dmy = (v?: string | null) => { if (!v) return ''; const d = new Date(v.length === 10 ? v + 'T12:00:00' : v); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Guayaquil' }) }
const waNum = (t: string) => { const d = String(t || '').replace(/\D/g, ''); return d.length === 10 && d.startsWith('0') ? '593' + d.slice(1) : d.length >= 11 ? d : '' }

function pasosDe(d: Datos): { pasos: Paso[]; pct: number } {
  const cot = d.cotizacion, huboAprob = !!cot
  const pct = ({ Recibida: 10, Agendada: 25, 'En proceso': cot?.estado === 'Aprobada' ? 75 : d.conDiagnostico ? 55 : 45, 'Esperando aprobación': 60, 'Esperando repuesto': 70, Finalizada: 100, Cancelada: 100 } as Record<string, number>)[d.estado] ?? 10
  const pasos: Paso[] = [
    { clave: 'recibida', titulo: 'Solicitud recibida', fecha: d.fecha },
    { clave: 'agendada', titulo: d.modalidad === 'Taller' ? 'Equipo en taller' : 'Técnico asignado', desc: d.tecnico ? d.tecnico + (d.fechaProgramada ? ' · ' + dmy(d.fechaProgramada) : '') : '' },
    { clave: 'revision', titulo: d.tipo === 'Instalación' ? 'Instalación en curso' : d.tipo === 'Capacitación' ? 'Capacitación en curso' : 'Revisión técnica', fecha: d.inicio },
  ]
  if (huboAprob) pasos.push({ clave: 'aprobacion', titulo: 'Aprobación de la cotización', desc: cot!.estado === 'Pendiente' ? 'Esperando tu respuesta' : cot!.estado })
  if (d.huboRepuesto) pasos.push({ clave: 'repuesto', titulo: 'Repuestos', desc: d.estado === 'Esperando repuesto' ? 'En espera del repuesto' : 'Recibidos' })
  if (huboAprob && cot!.estado === 'Aprobada') pasos.push({ clave: 'reparacion', titulo: 'Trabajo en curso' })
  pasos.push({ clave: 'finalizada', titulo: d.estado === 'Cancelada' ? 'Servicio cancelado' : 'Servicio finalizado', fecha: d.cierre, desc: d.estadoFinal ? 'Equipo ' + d.estadoFinal.toLowerCase() : '' })
  const claves = pasos.map((p) => p.clave)
  let actual = ({ Recibida: 'recibida', Agendada: 'agendada', 'Esperando aprobación': 'aprobacion', 'Esperando repuesto': 'repuesto', Finalizada: 'finalizada', Cancelada: 'finalizada' } as Record<string, string>)[d.estado] ?? 'recibida'
  if (d.estado === 'En proceso') actual = cot?.estado === 'Aprobada' ? 'reparacion' : cot?.estado === 'Rechazada' ? 'aprobacion' : 'revision'
  let ia = Math.max(0, claves.indexOf(actual))
  if (d.estado === 'En proceso' && cot?.estado === 'Rechazada') ia = claves.indexOf('aprobacion') + 1
  const cerrada = d.estado === 'Finalizada' || d.estado === 'Cancelada'
  pasos.forEach((p, i) => { p.estado = cerrada || i < ia ? 'hecho' : i === ia ? 'actual' : 'pendiente' })
  return { pasos, pct }
}

export default function ServicioPublico() {
  const codigo = new URLSearchParams(window.location.search).get('c') ?? ''
  const [d, setD] = useState<Datos | null>(null)
  const [error, setError] = useState('')
  const [bajando, setBajando] = useState('')

  useEffect(() => {
    document.title = 'Seguimiento de tu servicio técnico'
    if (!codigo) { setError('El enlace no es válido. Ábrelo desde el mensaje que te enviamos.'); return }
    supabase.rpc('servicio_publico', { p_token: codigo }).then(({ data, error: e }) => {
      if (e) { setError(e.message || 'No pudimos cargar el servicio.'); return }
      setD(data as Datos); document.title = 'Servicio técnico | ' + (data as Datos).marca
    })
  }, [codigo])

  async function bajar(variante: 'informe' | 'recepcion') {
    if (!d) return
    const doc = variante === 'informe' ? d.informe : d.recepcion
    if (!doc) return
    setBajando(variante)
    try {
      let logo = ''
      if (d.marca !== 'FEMEDICS') { try { const b = await (await fetch('/logo-documento.png')).blob(); logo = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(b) }) } catch { /* sin logo */ } }
      await descargarInforme(doc, d.equipo, variante, logo)
    } catch { setError('No se pudo generar el documento. Inténtalo de nuevo.') }
    setBajando('')
  }

  const marca = d?.marca ?? 'VIMEDIC'
  const { pasos, pct } = d ? pasosDe(d) : { pasos: [], pct: 0 }
  const wa = d ? waNum(d.contactoTelefono) : ''
  return (
    <div className="enc">
      <header className="enc-top"><div className="enc-wrap">
        <b className="enc-marca">{marca}</b>
        <h1>Seguimiento de tu servicio técnico</h1>
        <p>{d ? <>{d.tipo} · Orden {d.codigo}</> : 'Servicio Técnico'}</p>
      </div></header>
      <main className="enc-wrap">
        {error && <div className="enc-card"><p className="enc-msg err">{error}</p></div>}
        {!error && !d && <div className="enc-card"><div className="enc-spin" aria-label="Cargando" /></div>}
        {d && (
          <div className="enc-card">
            <div className="sp-cab"><div><b>{d.producto || 'Equipo'}</b><small>{d.serie ? 'Serie ' + d.serie : ''}{d.cliente ? ' · ' + d.cliente : ''}</small></div><span className={'sp-chip' + (d.estado === 'Cancelada' ? ' gris' : d.estado === 'Finalizada' ? ' ok' : '')}>{d.estado}</span></div>
            <div className="sp-barra" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: pct + '%' }} /></div>
            <p className="sp-pct">{pct}% del servicio</p>
            <ol className="sp-pasos">{pasos.map((p, i) => (
              <li key={p.clave} className={p.estado}><span className="sp-punto">{p.estado === 'hecho' ? '✓' : i + 1}</span>
                <span className="sp-txt"><b>{p.titulo}</b>{(p.desc || p.fecha) && <small>{[p.desc, p.fecha ? dmy(p.fecha) : ''].filter(Boolean).join(' · ')}</small>}</span></li>))}</ol>

            <dl className="sp-datos">
              {d.cobertura && <><dt>Cobertura</dt><dd>{d.cobertura}</dd></>}
              {d.garantia && <><dt>Garantía</dt><dd>{d.garantia}{d.garantiaHasta ? ' · hasta ' + dmy(d.garantiaHasta) : ''}</dd></>}
              {d.tecnico && <><dt>Técnico</dt><dd>{d.tecnico}</dd></>}
              {d.fechaProgramada && d.estado !== 'Finalizada' && d.estado !== 'Cancelada' && <><dt>Fecha</dt><dd>{dmy(d.fechaProgramada)}</dd></>}
              {d.proximoMantenimiento && <><dt>Próximo mantenimiento</dt><dd>{dmy(d.proximoMantenimiento)}</dd></>}
            </dl>

            {(d.informe || d.recepcion) && <div className="sp-docs"><h4>Documentos</h4>
              {d.informe && <button type="button" className="enc-enviar" disabled={!!bajando} onClick={() => bajar('informe')}>{bajando === 'informe' ? 'Generando…' : 'Descargar ' + (TITULOS[d.tipo] || 'informe técnico').toLowerCase() + (d.informe.informeN ? ' ' + d.informe.informeN : '')}</button>}
              {d.recepcion && <button type="button" className="sp-sec" disabled={!!bajando} onClick={() => bajar('recepcion')}>{bajando === 'recepcion' ? 'Generando…' : 'Comprobante de recepción ' + (d.recepcion.recepcionN || '')}</button>}
            </div>}

            {d.eventos.length > 0 && <div className="sp-docs"><h4>Novedades</h4><ul className="sp-eventos">{[...d.eventos].reverse().map((e, i) => <li key={i}><small>{dmy(e.fecha)}</small>{e.nota}</li>)}</ul></div>}

            {wa && <a className="sp-wa" href={'https://wa.me/' + wa + '?text=' + encodeURIComponent('Hola, consulto por mi servicio técnico ' + d.codigo + (d.producto ? ' (' + d.producto + ')' : '') + '.')} target="_blank" rel="noopener noreferrer">Escribir por WhatsApp{d.asesor ? ' a ' + d.asesor : ''}</a>}
          </div>
        )}
        <p className="enc-pie">{marca} · Servicio Técnico</p>
      </main>
    </div>
  )
}
