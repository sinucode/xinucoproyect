import {
  THEME_PRESETS, MUTED_COLORS, isThemeMode, resolveThemeMode, onPrimaryColor, hexLuminance, bookingSurface,
} from '../brand-theme'

describe('brand-theme', () => {
  it('presets: oscuro y claro con los colores acordados', () => {
    expect(THEME_PRESETS.dark).toEqual({ bgColor: '#080808', secondaryColor: '#1A1A1A', textColor: '#F4F4F4' })
    expect(THEME_PRESETS.light).toEqual({ bgColor: '#FFFFFF', secondaryColor: '#F3F4F6', textColor: '#111111' })
  })

  it('isThemeMode / resolveThemeMode: solo dark|light; por defecto oscuro', () => {
    expect(isThemeMode('dark')).toBe(true)
    expect(isThemeMode('light')).toBe(true)
    expect(isThemeMode('neon')).toBe(false)
    expect(isThemeMode(undefined)).toBe(false)
    expect(resolveThemeMode('light')).toBe('light')
    expect(resolveThemeMode('dark')).toBe('dark')
    expect(resolveThemeMode(undefined)).toBe('dark')
    expect(resolveThemeMode('otro')).toBe('dark')
  })

  it('muted y superficie por modo', () => {
    expect(MUTED_COLORS.light).toBe('#6B7280')
    expect(bookingSurface('light', '#F3F4F6')).toBe('#F3F4F6')
    expect(bookingSurface('dark', '#1A1A1A')).toBe('rgba(255,255,255,0.03)')
  })

  it('onPrimaryColor: texto oscuro sobre primarios claros, blanco sobre oscuros', () => {
    expect(onPrimaryColor('#C5A059')).toBe('#080808')   // dorado
    expect(onPrimaryColor('#FFFFFF')).toBe('#080808')
    expect(onPrimaryColor('#1E3A8A')).toBe('#FFFFFF')   // azul oscuro
    expect(onPrimaryColor('#DC2626')).toBe('#FFFFFF')   // rojo
    expect(onPrimaryColor('#000')).toBe('#FFFFFF')
    expect(onPrimaryColor('nope')).toBe('#080808')
  })

  it('hexLuminance acepta #RGB, #RRGGBB y #RRGGBBAA', () => {
    expect(hexLuminance('#fff')).toBeCloseTo(1, 3)
    expect(hexLuminance('#000000')).toBe(0)
    expect(hexLuminance('#FFFFFF80')).toBeCloseTo(1, 3)
    expect(hexLuminance('zzz')).toBeNull()
  })
})
