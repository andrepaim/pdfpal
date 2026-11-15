/** The shell owns platform policy; older Windows bridges only exposed `chrome`. */
export function desktopChromeCapabilities(bridge = window.pdfpalDesktop) {
 const legacyWindows = !!bridge?.chrome && (!bridge.platform || bridge.platform === 'win32')
 const sharedMenu = bridge?.capabilities?.sharedMenu ?? legacyWindows
 return {sharedMenu, titleBarOverlay: sharedMenu && (bridge?.capabilities?.titleBarOverlay ?? legacyWindows)}
}
