chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'TRUTHLENS_GET_SELECTION') return false

  sendResponse({
    selection: window.getSelection()?.toString() || '',
  })
  return true
})
