// Lightweight global toast + confirm helpers. They dispatch window events that the
// ToastHost (rendered once in App) listens for, so any module can surface feedback
// without prop drilling. Replaces native alert()/confirm(), which look jarring in
// the Android WebView and clash with the app's custom modals.

export function showToast(message, type = 'info', duration = 3200) {
  try {
    window.dispatchEvent(new CustomEvent('app-toast', { detail: { message, type, duration } }))
  } catch {}
}

let _confirmSeq = 0

// Returns a Promise<boolean> resolving to the user's choice.
export function showConfirm({
  title = '',
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
} = {}) {
  return new Promise(resolve => {
    const id = ++_confirmSeq
    const onResult = (e) => {
      if (e.detail?.id !== id) return
      window.removeEventListener('app-confirm-result', onResult)
      resolve(!!e.detail.result)
    }
    window.addEventListener('app-confirm-result', onResult)
    try {
      window.dispatchEvent(new CustomEvent('app-confirm', {
        detail: { id, title, message, confirmLabel, cancelLabel, danger },
      }))
    } catch {
      window.removeEventListener('app-confirm-result', onResult)
      resolve(false)
    }
  })
}
