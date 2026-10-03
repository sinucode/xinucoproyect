import {
  canAttend, canChangeStaff, canRelease, canReserve, isForSomeoneElse, sortWaitingForBarber,
  type WalkInActor,
} from '../walk-in-permissions'

const admin: WalkInActor    = { isAdmin: true,  staffId: null }
const barber: WalkInActor   = { isAdmin: false, staffId: 'me' }
const unlinked: WalkInActor = { isAdmin: false, staffId: null }

const free      = { staff_id: null,    appointment_id: null }
const mineRes   = { staff_id: 'me',    appointment_id: 'a1' }
const minePref  = { staff_id: 'me',    appointment_id: null }
const otherRes  = { staff_id: 'other', appointment_id: 'a2' }
const otherPref = { staff_id: 'other', appointment_id: null }

describe('canAttend', () => {
  it('el admin atiende cualquiera', () => {
    for (const e of [free, mineRes, otherRes, otherPref]) expect(canAttend(admin, e)).toBe(true)
  })
  it('el barbero atiende lo suyo (reservado o pedido) y lo libre', () => {
    expect(canAttend(barber, free)).toBe(true)
    expect(canAttend(barber, mineRes)).toBe(true)
    expect(canAttend(barber, minePref)).toBe(true)
  })
  it('el barbero NO atiende lo de otro profesional', () => {
    expect(canAttend(barber, otherRes)).toBe(false)
    expect(canAttend(barber, otherPref)).toBe(false)
  })
  it('un barbero sin profesional ligado no atiende nada', () => {
    expect(canAttend(unlinked, free)).toBe(false)
  })
})

describe('canReserve', () => {
  it('el barbero aparta para sí un turno libre, no para otro ni "el mejor"', () => {
    expect(canReserve(barber, free, 'me')).toBe(true)
    expect(canReserve(barber, free, 'other')).toBe(false)
    expect(canReserve(barber, free, null)).toBe(false)
  })
  it('gestiona uno suyo (incluso traspasarlo) pero no uno de otro', () => {
    expect(canReserve(barber, mineRes, 'other')).toBe(true)
    expect(canReserve(barber, otherRes, 'me')).toBe(false)
    expect(canReserve(barber, otherPref, 'me')).toBe(false)
  })
  it('el admin puede todo', () => {
    expect(canReserve(admin, otherRes, 'me')).toBe(true)
    expect(canReserve(admin, free, null)).toBe(true)
  })
})

describe('canChangeStaff / canRelease', () => {
  it('Cambiar barbero: admin, o el turno es suyo', () => {
    expect(canChangeStaff(admin, otherRes)).toBe(true)
    expect(canChangeStaff(barber, mineRes)).toBe(true)
    expect(canChangeStaff(barber, otherRes)).toBe(false)
    expect(canChangeStaff(barber, free)).toBe(false)
  })
  it('Liberar (sin cancelar): lo suyo o lo libre; el de otro es del admin', () => {
    expect(canRelease(barber, mineRes, false)).toBe(true)
    expect(canRelease(barber, free, false)).toBe(true)
    expect(canRelease(barber, otherRes, false)).toBe(false)
    expect(canRelease(barber, otherPref, false)).toBe(false)
    expect(canRelease(admin, otherRes, false)).toBe(true)
  })
  it('Quitar de la fila: el hueco apartado de otro solo lo quita el admin', () => {
    expect(canRelease(barber, otherRes, true)).toBe(false)
    expect(canRelease(barber, otherPref, true)).toBe(true) // sin hueco: el cliente se fue
    expect(canRelease(admin, otherRes, true)).toBe(true)
  })
})

describe('isForSomeoneElse', () => {
  it('solo el barbero ve turnos "de otro"', () => {
    expect(isForSomeoneElse(barber, otherRes)).toBe(true)
    expect(isForSomeoneElse(barber, mineRes)).toBe(false)
    expect(isForSomeoneElse(barber, free)).toBe(false)
    expect(isForSomeoneElse(admin, otherRes)).toBe(false)
  })
})

describe('sortWaitingForBarber', () => {
  const q = [
    { id: '1', staff_id: 'other' },
    { id: '2', staff_id: null },
    { id: '3', staff_id: 'me' },
    { id: '4', staff_id: 'other' },
    { id: '5', staff_id: 'me' },
  ]
  it('los tuyos primero, conservando el orden de llegada dentro de cada grupo', () => {
    expect(sortWaitingForBarber(q, 'me').map((e) => e.id)).toEqual(['3', '5', '1', '2', '4'])
  })
  it('sin profesional ligado deja el orden tal cual y no muta la entrada', () => {
    expect(sortWaitingForBarber(q, null)).toBe(q)
    sortWaitingForBarber(q, 'me')
    expect(q.map((e) => e.id)).toEqual(['1', '2', '3', '4', '5'])
  })
})
