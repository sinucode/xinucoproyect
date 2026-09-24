import { BARBERIA_URL } from '@xinuco/utils'

/**
 * verticals.ts — Registro de verticales de Xinuco. Agregar aquí cada vertical nueva.
 */
export interface Vertical {
  id:          string
  name:        string
  description: string
  consoleUrl:  string
}

export const VERTICALS: Vertical[] = [
  {
    id:          'barberia',
    name:        'Barbería',
    description: 'Barberías y peluquerías: agenda, caja, staff y reservas en línea.',
    consoleUrl:  `${BARBERIA_URL}/adminbarberia`,
  },
]
