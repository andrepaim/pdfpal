/** True inside the Mac desktop app. The preload bridge reports the platform; the browser reader has no bridge. */
export const isMacDesktop = () => window.pdfpalDesktop?.platform === 'darwin'

/**
 * Shortcut hints shown in the window chrome. Windows keeps its existing labels. On a Mac the application
 * menu's accelerators handle these keys (see desktop/src/chrome.mjs macShortcuts), shown with Mac symbols.
 */
export function shortcutHints(mac: boolean) {
  return mac ? {
    menu: '', back: '⌘[', forward: '⌘]', find: '⌘K', findKey: '⌘K', home: '⇧⌘H', ai: '⌘,',
    zoomIn: '⌘+', zoomOut: '⌘−', zoomReset: '⌘0', fullscreen: '⌃⌘F', quit: '⌘Q',
  } : {
    menu: 'F10', back: 'Alt+Left', forward: 'Alt+Right', find: 'Ctrl+K', findKey: 'Ctrl K', home: 'Ctrl Shift H', ai: 'Ctrl ,',
    zoomIn: 'Ctrl +', zoomOut: 'Ctrl −', zoomReset: 'Ctrl 0', fullscreen: 'F11', quit: 'Ctrl Q',
  }
}
