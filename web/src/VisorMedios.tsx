import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, ExternalLink, Video, X } from 'lucide-react'
import { imagen } from './modulos/inventarioUtil'

/* Visor de fotos y videos a pantalla completa (galería del producto en Marketing › Biblioteca e Inventario).
   Flechas o deslizar para pasar, miniaturas abajo, Esc o tocar fuera para cerrar. Se dibuja sobre todo
   (portal en <body>) y con estilos propios, así sirve igual dentro de cualquier módulo. */
export type MedioVisor = { tipo: 'imagen' | 'video'; url: string; descripcion?: string | null }

/** YouTube, Vimeo o Drive → reproductor embebido; null = archivo de video directo (mp4/webm). */
export function videoEmbebido(url: string): string | null {
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{6,})/)
  if (yt) return 'https://www.youtube-nocookie.com/embed/' + yt[1] + '?autoplay=1&rel=0'
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  if (vm) return 'https://player.vimeo.com/video/' + vm[1] + '?autoplay=1'
  const dr = /drive\.google\.com/.test(url) ? url.match(/\/d\/([-\w]{20,})/)?.[1] || url.match(/[?&]id=([-\w]{20,})/)?.[1] : null
  if (dr) return 'https://drive.google.com/file/d/' + dr + '/preview'
  return null
}
const miniVideo = (url: string) => { const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{6,})/); return m ? `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg` : '' }

const BTN: React.CSSProperties = { display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: 999, border: 0, background: 'rgba(255,255,255,.12)', color: '#fff', cursor: 'pointer', flexShrink: 0 }

export function VisorMedios({ medios, inicio = 0, cerrar }: { medios: MedioVisor[]; inicio?: number; cerrar: () => void }) {
  const [i, setI] = useState(Math.min(Math.max(0, inicio), Math.max(0, medios.length - 1)))
  const n = medios.length, m = medios[i]
  const ir = (d: number) => setI((x) => (x + d + n) % n)
  const toque = useRef<number | null>(null)

  useEffect(() => {
    // Captura en window: Esc cierra solo el visor (no la ficha que está debajo).
    const f = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); cerrar() }
      else if (e.key === 'ArrowRight' && n > 1) { e.stopPropagation(); setI((x) => (x + 1) % n) }
      else if (e.key === 'ArrowLeft' && n > 1) { e.stopPropagation(); setI((x) => (x - 1 + n) % n) }
    }
    window.addEventListener('keydown', f, true)
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', f, true); document.body.style.overflow = antes }
  }, [n, cerrar])
  if (!m) return null

  const emb = m.tipo === 'video' ? videoEmbebido(m.url) : null
  const original = m.tipo === 'imagen' ? imagen(m.url, 2400) || m.url : m.url
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Vista ampliada"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(6,14,28,.94)', display: 'flex', flexDirection: 'column', color: '#fff', fontFamily: 'Inter, system-ui, sans-serif' }}
      onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}
      onTouchStart={(e) => { toque.current = e.touches[0]?.clientX ?? null }}
      onTouchEnd={(e) => { const x0 = toque.current; toque.current = null; const dx = (e.changedTouches[0]?.clientX ?? 0) - (x0 ?? 0); if (x0 != null && n > 1 && Math.abs(dx) > 50) ir(dx < 0 ? 1 : -1) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700, opacity: 0.85, flexShrink: 0 }}>{n > 1 ? `${i + 1} / ${n}` : ''}</span>
        <span style={{ fontSize: 13, opacity: 0.85, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.descripcion || ''}</span>
        <a href={original} target="_blank" rel="noopener noreferrer" style={{ ...BTN, textDecoration: 'none' }} title={m.tipo === 'imagen' ? 'Abrir la imagen original' : 'Abrir el video'} aria-label="Abrir el original"><ExternalLink size={18} /></a>
        <button type="button" style={BTN} onClick={cerrar} title="Cerrar (Esc)" aria-label="Cerrar"><X size={20} /></button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '0 8px' }}
        onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
        {n > 1 && <button type="button" style={BTN} onClick={() => ir(-1)} aria-label="Anterior" title="Anterior (←)"><ChevronLeft size={24} /></button>}
        <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
          {m.tipo === 'video'
            ? (emb
                ? <iframe key={emb} src={emb} title={m.descripcion || 'Video'} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen style={{ width: 'min(100%, 1100px)', aspectRatio: '16 / 9', maxHeight: '100%', border: 0, borderRadius: 10, background: '#000' }} />
                : <video key={m.url} src={m.url} controls autoPlay playsInline style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 10, background: '#000' }} />)
            : <img key={m.url} src={imagen(m.url, 1800) || m.url} alt={m.descripcion || ''} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 6, background: '#fff', boxShadow: '0 20px 60px -20px #000' }} />}
        </div>
        {n > 1 && <button type="button" style={BTN} onClick={() => ir(1)} aria-label="Siguiente" title="Siguiente (→)"><ChevronRight size={24} /></button>}
      </div>
      {n > 1 && (
        <div style={{ display: 'flex', gap: 6, padding: '10px 14px 14px', overflowX: 'auto', justifyContent: n > 8 ? 'flex-start' : 'center', flexShrink: 0 }}>
          {medios.map((x, k) => {
            const mini = x.tipo === 'imagen' ? imagen(x.url, 160) : miniVideo(x.url)
            return (
              <button key={k} type="button" onClick={() => setI(k)} aria-label={`Ver ${k + 1}`}
                style={{ width: 56, height: 56, flexShrink: 0, borderRadius: 8, overflow: 'hidden', padding: 0, cursor: 'pointer', background: '#1e293b', display: 'grid', placeItems: 'center', border: k === i ? '2px solid #fff' : '2px solid transparent', opacity: k === i ? 1 : 0.6 }}>
                {mini ? <img src={mini} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Video size={18} color="#cbd5e1" />}
              </button>
            )
          })}
        </div>
      )}
    </div>,
    document.body,
  )
}
