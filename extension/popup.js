const TRUTHLENS_APP_URL = 'http://127.0.0.1:5173/'
const claimInput = document.querySelector('#claim')
const openButton = document.querySelector('#open')
const statusText = document.querySelector('#status')

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab?.id) return

  chrome.tabs.sendMessage(tab.id, { type: 'TRUTHLENS_GET_SELECTION' }, (response) => {
    if (chrome.runtime.lastError) return
    if (response?.selection) claimInput.value = response.selection
  })
})

openButton.addEventListener('click', () => {
  const claim = claimInput.value.trim()
  if (!claim) {
    statusText.textContent = 'Paste or highlight a claim first.'
    return
  }

  chrome.tabs.create({
    url: `${TRUTHLENS_APP_URL}?claim=${encodeURIComponent(claim)}`,
  })
})
