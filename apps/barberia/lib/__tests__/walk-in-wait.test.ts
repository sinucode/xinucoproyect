import { estimateWaits, businessNowAsUtcMs, type StaffStatusNow } from '../walk-in-wait'

const NOW = Date.UTC(2026, 8, 29, 14, 0, 0) // 2:00 p. m. local (como UTC)
const at = (minsFromNow: number) => new Date(NOW + minsFromNow * 60_000).toISOString()

const st = (id: string, status: StaffStatusNow['status'], busyMins?: number): StaffStatusNow => ({
  id,
  full_name: id,
  status,
  busy_until: busyMins === undefined ? null : at(busyMins),
  customer_name: null,
})

describe('estimateWaits', () => {
  it('returns unavailable when nobody is working now', () => {
    const r = estimateWaits(
      [{ id: 'w1', staff_id: null }],
      [st('a', 'off'), st('b', 'break'), st('c', 'time_off')],
      NOW,
    )
    expect(r.available).toBe(false)
    expect(r.minutesById).toEqual({})
  })

  it('returns unavailable with no staff at all', () => {
    expect(estimateWaits([{ id: 'w1', staff_id: null }], [], NOW).available).toBe(false)
  })

  it('a free barber attends the first client now, the second waits for the first service', () => {
    const r = estimateWaits(
      [
        { id: 'w1', staff_id: null, duration_minutes: 40 },
        { id: 'w2', staff_id: null },
      ],
      [st('a', 'free')],
      NOW,
    )
    expect(r.minutesById).toEqual({ w1: 0, w2: 40 })
  })

  it('uses busy_until for busy barbers and picks the earliest-free one', () => {
    const r = estimateWaits(
      [
        { id: 'w1', staff_id: null, duration_minutes: 30 },
        { id: 'w2', staff_id: null, duration_minutes: 30 },
        { id: 'w3', staff_id: null },
      ],
      [st('a', 'busy', 20), st('b', 'busy', 5)],
      NOW,
    )
    // w1 -> b (5), b libre a los 35; w2 -> a (20), a libre a los 50; w3 -> b (35)
    expect(r.minutesById).toEqual({ w1: 5, w2: 20, w3: 35 })
  })

  it('ignores off/break/time_off barbers when distributing', () => {
    const r = estimateWaits(
      [{ id: 'w1', staff_id: null }, { id: 'w2', staff_id: null }],
      [st('a', 'busy', 10), st('b', 'off'), st('c', 'break')],
      NOW,
    )
    expect(r.minutesById).toEqual({ w1: 10, w2: 40 })
  })

  it('respects a preassigned barber when available', () => {
    const r = estimateWaits(
      [{ id: 'w1', staff_id: 'a' }],
      [st('a', 'busy', 25), st('b', 'free')],
      NOW,
    )
    expect(r.minutesById.w1).toBe(25)
  })

  it('falls back to any barber when the preassigned one is not working', () => {
    const r = estimateWaits(
      [{ id: 'w1', staff_id: 'a' }],
      [st('a', 'off'), st('b', 'free')],
      NOW,
    )
    expect(r.minutesById.w1).toBe(0)
  })

  it('treats an overdue busy_until as free now and rounds partial minutes up', () => {
    const r = estimateWaits(
      [{ id: 'w1', staff_id: null }],
      [{ ...st('a', 'busy'), busy_until: at(-10) }],
      NOW,
    )
    expect(r.minutesById.w1).toBe(0)
    const r2 = estimateWaits(
      [{ id: 'w1', staff_id: null }],
      [{ ...st('a', 'busy'), busy_until: new Date(NOW + 90_000).toISOString() }],
      NOW,
    )
    expect(r2.minutesById.w1).toBe(2)
  })
})

describe('businessNowAsUtcMs', () => {
  it('shifts a UTC instant by the Bogotá offset (UTC-5)', () => {
    expect(businessNowAsUtcMs(new Date('2026-09-29T19:00:00Z'))).toBe(Date.UTC(2026, 8, 29, 14, 0, 0))
  })
})
