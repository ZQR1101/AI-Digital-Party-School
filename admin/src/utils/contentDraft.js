const CONTENT_DRAFT_KEY = 'adminContentDraftV1'

export function saveContentDraft(storage, draft) {
  try {
    storage.setItem(CONTENT_DRAFT_KEY, JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

export function loadContentDraft(storage) {
  try {
    const value = storage.getItem(CONTENT_DRAFT_KEY)
    if (!value) return null
    const draft = JSON.parse(value)
    return draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : null
  } catch {
    return null
  }
}

export function clearContentDraft(storage) {
  try {
    storage.removeItem(CONTENT_DRAFT_KEY)
  } catch {
    // Storage can be unavailable in privacy mode; publishing should still work.
  }
}
