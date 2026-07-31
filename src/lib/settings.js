const KEY = 'wigglegram-editor-settings'

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {}
  } catch {
    return {}
  }
}

export function saveSettings(partial) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadSettings(), ...partial }))
  } catch {
    // storage unavailable — fine, settings just won't persist
  }
}
