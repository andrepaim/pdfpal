export const chromeHeight = 44
export function chromeOptions(platform) {
  return platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#171820', symbolColor: '#c9ccd8', height: chromeHeight } } : {}
}

/** Skip the startup document and any history entry outside this local reader. */
export function readerHistoryTarget(entries, index, offset, origin) {
  const target = index + offset
  if (!origin || target < 0 || target >= entries.length) return
  try { if (new URL(entries[target].url).origin === origin) return target } catch {}
}

export function chromeShortcut(input) {
  if (input.type !== 'keyDown') return
  const key = input.key.toLowerCase()
  if (!input.control && !input.meta && !input.alt && !input.shift) {
    if (key === 'f10') return 'menu'
    if (key === 'f11') return 'fullscreen'
  }
  if (input.alt && !input.control && !input.meta && !input.shift) {
    if (key === 'arrowleft') return 'back'
    if (key === 'arrowright') return 'forward'
  }
  if (!input.control || input.alt || input.meta) return
  if (input.shift && key === 'h') return 'home'
  if (['+','='].includes(key)) return 'zoom-in'
  if (key === '-') return 'zoom-out'
  if (input.shift) return
  return ({ k:'find', ',':'ai-settings', q:'quit', '0':'zoom-reset' })[key]
}
