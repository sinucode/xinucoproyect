import { createRefreshScheduler, realtimeBackoffMs } from '@/lib/realtime-throttle'

describe('createRefreshScheduler', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  it('coalesce una ráfaga de eventos en un solo refresh tras el debounce', () => {
    const onRefresh = jest.fn()
    const s = createRefreshScheduler({ debounceMs: 600, minIntervalMs: 2000, onRefresh })
    s.trigger()
    jest.advanceTimersByTime(300)
    s.trigger()
    jest.advanceTimersByTime(300)
    s.trigger()
    expect(onRefresh).not.toHaveBeenCalled()
    jest.advanceTimersByTime(599)
    expect(onRefresh).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('no refresca más de una vez dentro del intervalo mínimo', () => {
    const onRefresh = jest.fn()
    const s = createRefreshScheduler({ debounceMs: 600, minIntervalMs: 2000, onRefresh })
    s.trigger()
    jest.advanceTimersByTime(600)
    expect(onRefresh).toHaveBeenCalledTimes(1)

    // Nuevo evento 400 ms después: debe esperar hasta completar 2 s desde el último refresh (1600 ms más)
    jest.advanceTimersByTime(400)
    s.trigger()
    jest.advanceTimersByTime(1599)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(1)
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })

  it('pasado el intervalo mínimo vuelve a usar solo el debounce', () => {
    const onRefresh = jest.fn()
    const s = createRefreshScheduler({ debounceMs: 600, minIntervalMs: 2000, onRefresh })
    s.trigger()
    jest.advanceTimersByTime(600)
    jest.advanceTimersByTime(5000)
    s.trigger()
    jest.advanceTimersByTime(600)
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })

  it('cancel descarta el refresh pendiente', () => {
    const onRefresh = jest.fn()
    const s = createRefreshScheduler({ debounceMs: 600, minIntervalMs: 2000, onRefresh })
    s.trigger()
    s.cancel()
    jest.advanceTimersByTime(5000)
    expect(onRefresh).not.toHaveBeenCalled()
  })
})

describe('realtimeBackoffMs', () => {
  it('crece exponencialmente y se topa en 30 s', () => {
    expect(realtimeBackoffMs(0)).toBe(1000)
    expect(realtimeBackoffMs(1)).toBe(2000)
    expect(realtimeBackoffMs(3)).toBe(8000)
    expect(realtimeBackoffMs(10)).toBe(30000)
  })
})
