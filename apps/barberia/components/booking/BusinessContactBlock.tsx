// components/booking/BusinessContactBlock.tsx — datos de contacto en la página pública de reservas.
// Server Component, compacto y sin desbordes a 375 px. Todo campo vacío se oculta.

import { MapPin, Clock, MessageCircle, Instagram, TriangleAlert } from 'lucide-react'
import { businessTodayISODate } from '@/lib/agenda-time'
import { summarizeOperatingHours } from '@/lib/business-hours'
import { closureNotices } from '@/lib/business-closures'
import { instagramUrl, isValidMapsUrl, whatsappLink } from '@/lib/business-profile'

export interface PublicContactData {
  address?:           string | null
  city?:              string | null
  whatsapp?:          string | null
  phone?:             string | null
  instagram?:         string | null
  maps_url?:          string | null
  operating_hours?:   unknown
  upcoming_closures?: { from: string; to: string; reason: string }[] | null
}

const linkCls = 'underline underline-offset-2 font-semibold'

export function BusinessContactBlock({ data }: { data: PublicContactData }) {
  const place = [data.address?.trim(), data.city?.trim()].filter(Boolean).join(', ')
  const mapsUrl = data.maps_url && isValidMapsUrl(data.maps_url) ? data.maps_url : null
  const wa = whatsappLink(data.whatsapp)
  const ig = data.instagram ? instagramUrl(data.instagram) : null
  const hours = summarizeOperatingHours(data.operating_hours)
  const notices = closureNotices(data.upcoming_closures, businessTodayISODate(), 14)

  if (!place && !wa && !ig && !hours && !data.phone && notices.length === 0) return null

  return (
    <section
      aria-label="Información del negocio"
      className="w-full max-w-xl mx-auto mb-6 rounded-2xl p-4 flex flex-col gap-3 text-sm"
      style={{ background: 'var(--surface-color, rgba(255,255,255,0.03))', border: '1px solid var(--border-color)' }}
    >
      {notices.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {notices.map(n => (
            <p
              key={n}
              role="status"
              className="flex items-start gap-2 text-xs rounded-lg px-3 py-2 text-amber-400 bg-amber-400/10"
            >
              <TriangleAlert size={13} className="shrink-0 mt-0.5" />
              <span className="min-w-0 break-words">{n}</span>
            </p>
          ))}
        </div>
      )}

      {place && (
        <div className="flex items-start gap-2.5 min-w-0">
          <MapPin size={15} className="shrink-0 mt-0.5" style={{ color: 'var(--primary-color)' }} />
          <p className="text-xinuco-text min-w-0 break-words">
            {place}
            {mapsUrl && (
              <>
                {' · '}
                <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className={linkCls} style={{ color: 'var(--primary-color)' }}>
                  Cómo llegar
                </a>
              </>
            )}
          </p>
        </div>
      )}

      {hours && (
        <div className="flex items-start gap-2.5 min-w-0">
          <Clock size={15} className="shrink-0 mt-0.5" style={{ color: 'var(--primary-color)' }} />
          <p className="text-xinuco-text min-w-0 break-words">{hours}</p>
        </div>
      )}

      {(wa || ig || data.phone) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold"
              style={{ background: 'var(--primary-color)', color: 'var(--bg-color)' }}
            >
              <MessageCircle size={13} />
              WhatsApp
            </a>
          )}
          {data.phone && (
            <a
              href={`tel:+${/^3\d{9}$/.test(data.phone) ? '57' : ''}${data.phone}`}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold text-xinuco-text"
              style={{ border: '1px solid var(--border-color)' }}
            >
              Llamar
            </a>
          )}
          {ig && (
            <a
              href={ig}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold text-xinuco-text"
              style={{ border: '1px solid var(--border-color)' }}
            >
              <Instagram size={13} />
              @{data.instagram}
            </a>
          )}
        </div>
      )}
    </section>
  )
}
