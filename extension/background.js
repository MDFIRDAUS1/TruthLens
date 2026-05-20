const TRUTHLENS_APP_URL = 'http://127.0.0.1:5173/'

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'truthlens-check-selection',
    title: 'Check with TruthLens',
    contexts: ['selection'],
  })
})

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== 'truthlens-check-selection') return

  const claim = encodeURIComponent(info.selectionText || '')
  chrome.tabs.create({
    url: `${TRUTHLENS_APP_URL}?claim=${claim}`,
  })
})
