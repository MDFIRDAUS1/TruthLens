import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { jsPDF } from 'jspdf'
import { createWorker } from 'tesseract.js'
import {
  AlertCircle,
  ArrowUpRight,
  Bot,
  CalendarDays,
  Clock,
  Copy,
  Download,
  Eye,
  Filter,
  HelpCircle,
  History,
  Image as ImageIcon,
  Languages,
  Link,
  Loader2,
  Mail,
  MessageCircle,
  Newspaper,
  Pin,
  PinOff,
  Radar,
  Scale,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TrendingUp,
  Upload,
  User,
} from 'lucide-react'
import './index.css'

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000'
const historyKey = 'truthlens.history.v1'
const historyLimit = 24

const languageOptions = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'bn', label: 'Bengali' },
  { value: 'ta', label: 'Tamil' },
  { value: 'te', label: 'Telugu' },
]

const recencyOptions = [
  { value: 'day', label: '24 hours' },
  { value: 'week', label: '7 days' },
  { value: 'month', label: '30 days' },
  { value: 'quarter', label: '90 days' },
  { value: 'all', label: 'All time' },
]

const verdictFilterOptions = [
  { value: 'all', label: 'All verdicts' },
  { value: 'supported', label: 'Supported' },
  { value: 'disputed', label: 'Disputed' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'inconclusive', label: 'Inconclusive' },
]

const supportFaqs = [
  {
    question: 'How does TruthLens decide a verdict?',
    answer:
      'TruthLens searches live coverage, groups evidence into support, oppose, and mixed signals, then combines source credibility, freshness, fact-check cues, and the local model fallback.',
    keywords: ['verdict', 'decide', 'score', 'confidence', 'works', 'how'],
  },
  {
    question: 'Why can unrelated sources appear?',
    answer:
      'Screenshots and long articles can contain extra OCR or page text. TruthLens now extracts a tighter claim focus and filters out sources that do not match the topic strongly enough.',
    keywords: ['wrong', 'unrelated', 'sources', 'matching', 'irrelevant', 'accuracy'],
  },
  {
    question: 'How are the scores calculated?',
    answer:
      'Verdict confidence measures evidence separation, relevant source count, and model agreement. Source credibility averages the sources that passed relevance checks. Fake-risk looks at model signals and misinformation-style wording.',
    keywords: ['score', 'confidence', 'credibility', 'fake', 'calculated', 'breakdown'],
  },
  {
    question: 'Can I check a full article URL?',
    answer:
      'Yes. Paste the article link into Article URL, click Extract, review the pulled text, then run Analyze Claim.',
    keywords: ['url', 'article', 'link', 'extract', 'website'],
  },
  {
    question: 'Can I scan screenshots or images?',
    answer:
      'Yes. Use Upload screenshot to run OCR in your browser. The extracted text is placed into the claim box before analysis.',
    keywords: ['screenshot', 'image', 'ocr', 'photo', 'upload'],
  },
  {
    question: 'Where is my search history stored?',
    answer:
      'History, pins, feedback, and restored reports are stored locally in this browser using localStorage. They are not synced to an account.',
    keywords: ['history', 'stored', 'privacy', 'local', 'data', 'save'],
  },
  {
    question: 'What should I do with a low-confidence result?',
    answer:
      'Treat it as a caution flag. Open the sources, compare dates, check whether the claim is specific enough, and rerun with a shorter claim if needed.',
    keywords: ['low', 'confidence', 'wrong', 'uncertain', 'not enough'],
  },
  {
    question: 'How do I share a result?',
    answer:
      'After analysis, use Copy report for a plain-text summary or PDF report for a downloadable evidence report.',
    keywords: ['share', 'copy', 'pdf', 'download', 'report'],
  },
]

const clientStopWords = new Set([
  'about',
  'after',
  'also',
  'claim',
  'claims',
  'from',
  'have',
  'into',
  'more',
  'news',
  'that',
  'their',
  'this',
  'with',
  'will',
  'would',
])

const sampleClaim =
  'Paste a claim, headline, or paragraph. TruthLens will scan live coverage, weigh trusted sources, and show whether reporting supports or disputes it.'

function verdictMeta(verdict) {
  if (verdict === 'Verified' || verdict === 'Mostly true' || verdict === 'Likely supported') {
    return {
      tone: 'support',
      title: 'Coverage Supports The Claim',
      icon: <ShieldCheck size={60} color="#34d399" strokeWidth={1.5} />,
    }
  }

  if (
    verdict === 'False or debunked' ||
    verdict === 'Unsupported' ||
    verdict === 'Likely fake' ||
    verdict === 'Likely disputed'
  ) {
    return {
      tone: 'oppose',
      title: 'Coverage Pushes Back On The Claim',
      icon: <ShieldAlert size={60} color="#fb7185" strokeWidth={1.5} />,
    }
  }

  return {
    tone: 'mixed',
    title: verdict,
    icon: <Scale size={60} color="#fbbf24" strokeWidth={1.5} />,
  }
}

function verdictGroup(verdict = '') {
  const lowered = verdict.toLowerCase()
  if (/(verified|mostly true|real|supported)/.test(lowered)) return 'supported'
  if (/(false|fake|debunked|unsupported|disputed)/.test(lowered)) return 'disputed'
  if (/(mixed|context)/.test(lowered)) return 'mixed'
  return 'inconclusive'
}

function scoreTitle(key) {
  const titles = {
    verdictConfidence: 'Verdict confidence',
    sourceCredibility: 'Source credibility',
    fakeRisk: 'Fake-risk score',
  }
  return titles[key] || key
}

function normalizeHistory(items) {
  if (!Array.isArray(items)) return []
  return items.map((item) => ({
    ...item,
    pinned: Boolean(item.pinned),
    feedback: item.feedback || null,
    sourceType: item.sourceType || 'text',
  }))
}

function getInitialClaimFromUrl() {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('claim') || ''
}

function formatDate(value) {
  if (!value) return 'Date unavailable'
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function resultReportText(result) {
  if (!result) return ''
  const sources = result.sources?.length
    ? result.sources
        .map(
          (source, index) =>
            `${index + 1}. ${source.title}\n${source.source} | ${source.stance} | ${source.credibilityLabel || 'Source'}\n${source.link}`,
        )
        .join('\n\n')
    : 'No live sources were surfaced.'
  const scoreLines = result.scoreBreakdown
    ? Object.entries(result.scoreBreakdown).map(
        ([key, score]) => `- ${scoreTitle(key)}: ${Number(score.value || 0).toFixed(1)}% (${score.formula})`,
      )
    : ['- Score breakdown unavailable.']

  return [
    'TruthLens Report',
    `Claim: ${result.claim}`,
    `Verdict: ${result.verdict}`,
    `Confidence: ${result.confidence.toFixed(1)}%`,
    `Checked: ${formatDate(result.checkedAt)}`,
    '',
    `Summary: ${result.summary}`,
    '',
    'Why this verdict:',
    ...(result.explanation || ['No explanation details returned.']).map((item) => `- ${item}`),
    '',
    'Score calculation:',
    ...scoreLines,
    '',
    'Sources:',
    sources,
  ].join('\n')
}

function findSupportAnswer(message) {
  const lowered = message.toLowerCase()
  const scoredFaqs = supportFaqs
    .map((faq) => ({
      faq,
      score:
        faq.keywords.filter((keyword) => lowered.includes(keyword)).length +
        (lowered.includes(faq.question.toLowerCase().slice(0, 18)) ? 2 : 0),
    }))
    .sort((a, b) => b.score - a.score)

  if (scoredFaqs[0]?.score > 0) return scoredFaqs[0].faq.answer

  return 'I can help with verdicts, URL checks, screenshot OCR, history, sharing reports, and low-confidence results. For anything else, send the contact form and include what you were trying to check.'
}

function App() {
  const initialClaim = getInitialClaimFromUrl()
  const supportMessageCounter = useRef(1)
  const [loadedFromExtension] = useState(Boolean(initialClaim))
  const [text, setText] = useState(initialClaim)
  const [language, setLanguage] = useState('en')
  const [recency, setRecency] = useState('week')
  const [loading, setLoading] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [urlLoading, setUrlLoading] = useState(false)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(0)
  const [inputSource, setInputSource] = useState(() =>
    initialClaim ? { type: 'extension' } : { type: 'text' },
  )
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(
    initialClaim ? 'Claim loaded from the TruthLens browser extension.' : null,
  )
  const [copyStatus, setCopyStatus] = useState('')
  const [contactForm, setContactForm] = useState({
    name: '',
    email: '',
    topic: 'Result question',
    message: '',
  })
  const [contactLoading, setContactLoading] = useState(false)
  const [contactStatus, setContactStatus] = useState(null)
  const [chatInput, setChatInput] = useState('')
  const [supportMessages, setSupportMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Hi, I can answer quick questions about using TruthLens. Ask about verdicts, URLs, screenshots, history, or reports.',
    },
  ])
  const [historySearch, setHistorySearch] = useState('')
  const [historyVerdictFilter, setHistoryVerdictFilter] = useState('all')
  const [currentHistoryId, setCurrentHistoryId] = useState(null)
  const [history, setHistory] = useState(() => {
    try {
      return normalizeHistory(JSON.parse(localStorage.getItem(historyKey)) || [])
    } catch {
      return []
    }
  })

  useEffect(() => {
    if (loadedFromExtension) {
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [loadedFromExtension])

  useEffect(() => {
    if (!copyStatus) return undefined
    const timeout = window.setTimeout(() => setCopyStatus(''), 2200)
    return () => window.clearTimeout(timeout)
  }, [copyStatus])

  const saveHistory = (nextHistory) => {
    const normalized = normalizeHistory(nextHistory)
    setHistory(normalized)
    localStorage.setItem(historyKey, JSON.stringify(normalized))
  }

  const rememberResult = (analysis) => {
    const existing = history.find((item) => item.claim === analysis.claim)
    const entry = {
      id: existing?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      claim: analysis.claim,
      verdict: analysis.verdict,
      confidence: analysis.confidence,
      checkedAt: analysis.checkedAt,
      language,
      recency,
      pinned: existing?.pinned || false,
      feedback: existing?.feedback || null,
      sourceType: inputSource.type,
      sourceUrl: inputSource.url || '',
      sourceTitle: inputSource.title || '',
      result: analysis,
    }
    const nextHistory = [
      entry,
      ...history.filter((item) => item.id !== entry.id && item.claim !== analysis.claim),
    ].slice(0, historyLimit)

    saveHistory(nextHistory)
    setCurrentHistoryId(entry.id)
  }

  const restoreHistoryItem = (item) => {
    setText(item.claim)
    setLanguage(item.language || 'en')
    setRecency(item.recency || 'week')
    setInputSource({
      type: item.sourceType || 'history',
      url: item.sourceUrl || '',
      title: item.sourceTitle || '',
    })
    setResult(item.result || null)
    setCurrentHistoryId(item.id)
    setError(null)
    setNotice(item.result ? 'Report restored from local history.' : null)
  }

  const deleteHistoryItem = (id) => {
    saveHistory(history.filter((item) => item.id !== id))
    if (currentHistoryId === id) setCurrentHistoryId(null)
  }

  const togglePinHistoryItem = (id) => {
    saveHistory(
      history.map((item) => (item.id === id ? { ...item, pinned: !item.pinned } : item)),
    )
  }

  const recordFeedback = (feedback) => {
    if (!currentHistoryId) return
    saveHistory(
      history.map((item) => (item.id === currentHistoryId ? { ...item, feedback } : item)),
    )
    setCopyStatus(feedback === 'helpful' ? 'Helpful feedback saved' : 'Review feedback saved')
  }

  const askSupportBot = (message) => {
    const question = message.trim()
    if (!question) return

    const messageId = supportMessageCounter.current
    supportMessageCounter.current += 1
    const userMessage = {
      id: `support-${messageId}-user`,
      role: 'user',
      text: question,
    }
    const assistantMessage = {
      id: `support-${messageId}-assistant`,
      role: 'assistant',
      text: findSupportAnswer(question),
    }

    setSupportMessages((messages) => [...messages, userMessage, assistantMessage].slice(-8))
    setChatInput('')
  }

  const handleChatSubmit = (event) => {
    event.preventDefault()
    askSupportBot(chatInput)
  }

  const handleContactSubmit = async (event) => {
    event.preventDefault()
    setContactLoading(true)
    setContactStatus(null)

    try {
      const response = await axios.post(`${apiUrl}/contact`, contactForm)
      setContactStatus({
        tone: 'success',
        message: `Message received. Your support ticket is ${response.data.ticketId}.`,
      })
      setContactForm({
        name: '',
        email: '',
        topic: 'Result question',
        message: '',
      })
    } catch (err) {
      console.error(err)
      setContactStatus({
        tone: 'error',
        message: err.response?.data?.error || 'Unable to send your message right now.',
      })
    } finally {
      setContactLoading(false)
    }
  }

  const extractFromUrl = async () => {
    if (!urlInput.trim()) {
      setError('Paste a URL before extracting article text.')
      return
    }

    setUrlLoading(true)
    setError(null)
    setNotice(null)

    try {
      if (import.meta.env.PROD && !import.meta.env.VITE_API_URL) {
        throw new Error('VITE_API_URL is not configured for production.')
      }
      const response = await axios.post(`${apiUrl}/extract-url`, { url: urlInput.trim() })
      const extracted = response.data
      setText(`${extracted.title}\n\n${extracted.text}`)
      setInputSource({
        type: 'url',
        url: extracted.url,
        title: extracted.title,
      })
      setNotice(`Extracted ${extracted.wordCount} words from ${extracted.source}.`)
    } catch (err) {
      console.error(err)
      setError(err.response?.data?.error || 'Unable to extract text from that URL.')
    } finally {
      setUrlLoading(false)
    }
  }

  const extractFromImage = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setOcrLoading(true)
    setOcrProgress(0)
    setError(null)
    setNotice(null)

    let worker
    try {
      worker = await createWorker('eng', 1, {
        logger: (message) => {
          if (message.status === 'recognizing text') {
            setOcrProgress(Math.round((message.progress || 0) * 100))
          }
        },
      })
      const {
        data: { text: extractedText },
      } = await worker.recognize(file)
      const cleaned = extractedText.trim()

      if (!cleaned) {
        setError('No readable text was detected in that image.')
      } else {
        setText(cleaned)
        setInputSource({ type: 'image', title: file.name })
        setNotice(`Extracted text from ${file.name}.`)
      }
    } catch (err) {
      console.error(err)
      setError('Unable to read text from that image.')
    } finally {
      if (worker) await worker.terminate()
      setOcrLoading(false)
      setOcrProgress(0)
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!text.trim()) {
      setError('Paste a claim or article text before scanning.')
      return
    }

    setLoading(true)
    setError(null)
    setNotice(null)
    setResult(null)

    try {
      if (import.meta.env.PROD && !import.meta.env.VITE_API_URL) {
        throw new Error('VITE_API_URL is not configured for production.')
      }
      const response = await axios.post(`${apiUrl}/predict`, { text, language, recency })
      setResult(response.data)
      rememberResult(response.data)
    } catch (err) {
      console.error(err)
      setError(err.response?.data?.error || 'Unable to analyze the claim right now.')
    } finally {
      setLoading(false)
    }
  }

  const copyReport = async () => {
    if (!result) return
    const report = resultReportText(result)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(report)
      } else {
        const fallback = document.createElement('textarea')
        fallback.value = report
        document.body.appendChild(fallback)
        fallback.select()
        document.execCommand('copy')
        document.body.removeChild(fallback)
      }
      setCopyStatus('Report copied')
    } catch {
      setCopyStatus('Copy failed')
    }
  }

  const downloadPdfReport = () => {
    if (!result) return
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const margin = 44
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    let y = margin

    const addText = (value, size = 11, style = 'normal') => {
      doc.setFont('helvetica', style)
      doc.setFontSize(size)
      const lines = doc.splitTextToSize(value, pageWidth - margin * 2)
      lines.forEach((line) => {
        if (y > pageHeight - margin) {
          doc.addPage()
          y = margin
        }
        doc.text(line, margin, y)
        y += size + 7
      })
      y += 4
    }

    addText('TruthLens Report', 20, 'bold')
    addText(`Verdict: ${result.verdict}`, 14, 'bold')
    addText(`Confidence: ${result.confidence.toFixed(1)}% | Checked: ${formatDate(result.checkedAt)}`)
    addText(`Claim: ${result.claim}`)
    addText(`Summary: ${result.summary}`)
    addText('Why this verdict', 13, 'bold')
    ;(result.explanation || ['No explanation details returned.']).forEach((item) => {
      addText(`- ${item}`)
    })
    if (result.scoreBreakdown) {
      addText('Score calculation', 13, 'bold')
      Object.entries(result.scoreBreakdown).forEach(([key, score]) => {
        addText(`${scoreTitle(key)}: ${Number(score.value || 0).toFixed(1)}%`)
        addText(score.formula)
      })
    }
    addText('Evidence sources', 13, 'bold')
    ;(result.sources || []).slice(0, 8).forEach((source, index) => {
      addText(
        `${index + 1}. ${source.title}\n${source.source} | ${source.stance} | ${source.credibilityLabel || 'Source'}\n${source.link}`,
      )
    })

    doc.save(`truthlens-report-${Date.now()}.pdf`)
  }

  const evidence = result?.evidence || { support: 0, oppose: 0, mixed: 0 }
  const totalEvidence = evidence.support + evidence.oppose + evidence.mixed
  const supportPercent = totalEvidence ? ((evidence.support / totalEvidence) * 100).toFixed(0) : 0
  const opposePercent = totalEvidence ? ((evidence.oppose / totalEvidence) * 100).toFixed(0) : 0
  const mixedPercent = totalEvidence ? ((evidence.mixed / totalEvidence) * 100).toFixed(0) : 0

  const meta = result ? verdictMeta(result.verdict) : null
  const checkedAt = result?.checkedAt ? formatDate(result.checkedAt) : null
  const currentFeedback = history.find((item) => item.id === currentHistoryId)?.feedback || null

  const filteredHistory = useMemo(() => {
    const query = historySearch.trim().toLowerCase()
    return [...history]
      .filter((item) => {
        const matchesQuery =
          !query ||
          item.claim.toLowerCase().includes(query) ||
          item.verdict.toLowerCase().includes(query) ||
          (item.sourceTitle || '').toLowerCase().includes(query)
        const matchesVerdict =
          historyVerdictFilter === 'all' || verdictGroup(item.verdict) === historyVerdictFilter
        return matchesQuery && matchesVerdict
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return new Date(b.checkedAt || 0).getTime() - new Date(a.checkedAt || 0).getTime()
      })
  }, [history, historySearch, historyVerdictFilter])

  const historyInsights = useMemo(() => {
    const disputed = history.filter((item) => verdictGroup(item.verdict) === 'disputed')
    const supported = history.filter((item) => verdictGroup(item.verdict) === 'supported')
    const feedbackHelpful = history.filter((item) => item.feedback === 'helpful').length
    const avgConfidence = history.length
      ? history.reduce((sum, item) => sum + (item.confidence || 0), 0) / history.length
      : 0
    const words = disputed
      .flatMap((item) => item.claim.toLowerCase().match(/[a-z0-9']{4,}/g) || [])
      .filter((word) => !clientStopWords.has(word))
    const topicCounts = words.reduce((counts, word) => {
      counts[word] = (counts[word] || 0) + 1
      return counts
    }, {})
    const topics = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([word, count]) => ({ word, count }))
    const highRisk = history
      .filter(
        (item) =>
          verdictGroup(item.verdict) === 'disputed' ||
          (item.result?.riskSignals?.score || 0) >= 0.35,
      )
      .slice(0, 3)

    return {
      checked: history.length,
      disputed: disputed.length,
      supported: supported.length,
      helpful: feedbackHelpful,
      avgConfidence,
      topics,
      highRisk,
    }
  }, [history])

  return (
    <>
      <div className="bg-orb bg-orb-1"></div>
      <div className="bg-orb bg-orb-2"></div>

      <div className="app-shell">
        <div className="hero-panel">
          <div className="hero-copy">
            <div className="eyebrow">
              <Radar size={16} />
              <span>Live Evidence Engine</span>
            </div>
            <h1>TruthLens</h1>
            <p>
              Paste a claim, extract a link, or read a screenshot. TruthLens weighs live
              coverage, source credibility, and contradiction signals in one report.
            </p>
          </div>

          <div className="hero-card">
            <div className="hero-card-icon">
              <Eye size={28} color="#7dd3fc" strokeWidth={1.7} />
            </div>
            <h2>What it does</h2>
            <ul className="feature-list">
              <li>Searches live reporting around the claim</li>
              <li>Extracts article URLs and screenshot text</li>
              <li>Shows credibility, reasons, and source signals</li>
              <li>Saves reports, pins, feedback, and local trends</li>
            </ul>
          </div>
        </div>

        <div className="workspace-panel">
          <div className="glass-card">
            <form onSubmit={handleSubmit} className="analysis-form">
              <label className="textarea-label" htmlFor="claim-input">
                Claim to verify
              </label>
              <div className="input-group">
                <textarea
                  id="claim-input"
                  placeholder={sampleClaim}
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value)
                    setInputSource({ type: 'text' })
                  }}
                  disabled={loading}
                />
              </div>

              <div className="input-tools">
                <label className="url-control">
                  <span>
                    <Link size={16} />
                    Article URL
                  </span>
                  <div>
                    <input
                      type="url"
                      value={urlInput}
                      onChange={(event) => setUrlInput(event.target.value)}
                      placeholder="https://example.com/news-story"
                      disabled={urlLoading || loading}
                    />
                    <button type="button" onClick={extractFromUrl} disabled={urlLoading || loading}>
                      {urlLoading ? <Loader2 className="spinner" size={17} /> : <Search size={17} />}
                      <span>{urlLoading ? 'Extracting' : 'Extract'}</span>
                    </button>
                  </div>
                </label>

                <label className={`image-upload ${ocrLoading ? 'busy' : ''}`}>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={extractFromImage}
                    disabled={ocrLoading || loading}
                  />
                  {ocrLoading ? <Loader2 className="spinner" size={18} /> : <Upload size={18} />}
                  <span>{ocrLoading ? `Reading image ${ocrProgress}%` : 'Upload screenshot'}</span>
                  <ImageIcon size={18} />
                </label>
              </div>

              <div className="control-grid">
                <label className="select-control">
                  <span>
                    <Languages size={16} />
                    Language
                  </span>
                  <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                    {languageOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="select-control">
                  <span>
                    <CalendarDays size={16} />
                    Freshness
                  </span>
                  <select value={recency} onChange={(event) => setRecency(event.target.value)}>
                    {recencyOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <button type="submit" className="submit-btn" disabled={loading || !text.trim()}>
                {loading ? (
                  <>
                    <Loader2 className="spinner" size={22} />
                    <span>Scanning live coverage...</span>
                  </>
                ) : (
                  <>
                    <Search size={20} strokeWidth={2.5} />
                    <span>Analyze Claim</span>
                  </>
                )}
              </button>
            </form>

            {notice && (
              <div className="notice-message">
                <ShieldCheck size={20} />
                <span>{notice}</span>
              </div>
            )}

            {error && (
              <div className="error-message">
                <AlertCircle size={20} />
                <span>{error}</span>
              </div>
            )}

            {result && meta && (
              <section className={`result-panel ${meta.tone}`}>
                <div className="result-topline">
                  <div className="result-icon-wrapper">{meta.icon}</div>
                  <div className="result-heading">
                    <span className="status-pill">{result.verdict}</span>
                    <h2>{meta.title}</h2>
                    <p>{result.summary}</p>
                    <div className="result-meta-row">
                      {checkedAt && (
                        <span>
                          <Clock size={15} />
                          Checked {checkedAt}
                        </span>
                      )}
                      <span>{result.language}</span>
                      <span>{result.recency}</span>
                      {result.cacheHit && <span>cached</span>}
                    </div>
                  </div>
                </div>

                <div className="report-actions">
                  <button type="button" className="action-btn" onClick={copyReport}>
                    <Copy size={17} />
                    <span>{copyStatus === 'Report copied' ? 'Copied' : 'Copy report'}</span>
                  </button>
                  <button type="button" className="action-btn" onClick={downloadPdfReport}>
                    <Download size={17} />
                    <span>PDF report</span>
                  </button>
                  <button
                    type="button"
                    className={`action-btn ${currentFeedback === 'helpful' ? 'active' : ''}`}
                    onClick={() => recordFeedback('helpful')}
                    disabled={!currentHistoryId}
                  >
                    <ThumbsUp size={17} />
                    <span>Helpful</span>
                  </button>
                  <button
                    type="button"
                    className={`action-btn ${currentFeedback === 'needs-review' ? 'active danger' : ''}`}
                    onClick={() => recordFeedback('needs-review')}
                    disabled={!currentHistoryId}
                  >
                    <ThumbsDown size={17} />
                    <span>Needs review</span>
                  </button>
                </div>

                {copyStatus && copyStatus !== 'Report copied' && (
                  <p className="action-status">{copyStatus}</p>
                )}

                <div className="metric-grid">
                  <article className="metric-card">
                    <span className="metric-label">Verdict confidence</span>
                    <strong>{result.confidence.toFixed(1)}%</strong>
                    <div className="meter">
                      <div className="meter-fill confidence" style={{ width: `${result.confidence}%` }} />
                    </div>
                  </article>

                  <article className="metric-card">
                    <span className="metric-label">Source credibility</span>
                    <strong>{result.sourceCredibility?.average || 0}%</strong>
                    <span className="metric-subtle">{result.sourceCredibility?.label || 'No live sources'}</span>
                  </article>

                  <article className="metric-card">
                    <span className="metric-label">Supporting sources</span>
                    <strong>{evidence.support}</strong>
                    <span className="metric-subtle">{supportPercent}% of relevant coverage</span>
                  </article>

                  <article className="metric-card">
                    <span className="metric-label">Opposing sources</span>
                    <strong>{evidence.oppose}</strong>
                    <span className="metric-subtle">{opposePercent}% of relevant coverage</span>
                  </article>

                  <article className="metric-card">
                    <span className="metric-label">Mixed coverage</span>
                    <strong>{evidence.mixed}</strong>
                    <span className="metric-subtle">{mixedPercent}% of relevant coverage</span>
                  </article>
                </div>

                {result.scoreBreakdown && (
                  <div className="score-breakdown-card">
                    <div className="sources-header">
                      <div>
                        <span className="section-label">Score calculation</span>
                        <h3>What each score means</h3>
                      </div>
                      {result.searchQuality && (
                        <div className="source-meta">
                          <Search size={16} />
                          <span>
                            {result.searchQuality.relevantSources} matched, {result.searchQuality.rejectedIrrelevant} rejected
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="score-breakdown-grid">
                      {Object.entries(result.scoreBreakdown).map(([key, score]) => (
                        <article key={key} className="score-card">
                          <div className="score-card-top">
                            <span>{scoreTitle(key)}</span>
                            <strong>{Number(score.value || 0).toFixed(1)}{key === 'sourceCredibility' && score.value === 0 ? '' : '%'}</strong>
                          </div>
                          <div className="meter">
                            <div
                              className={`meter-fill ${key === 'fakeRisk' ? 'risk' : 'confidence'}`}
                              style={{ width: `${Math.min(Number(score.value || 0), 100)}%` }}
                            />
                          </div>
                          <p>{score.formula}</p>
                          <div className="score-parts">
                            {score.parts?.map((part) => (
                              <div key={`${key}-${part.label}`} className="score-part">
                                <span>{part.label}</span>
                                <strong>{typeof part.value === 'number' ? part.value.toFixed(part.value % 1 ? 1 : 0) : part.value}</strong>
                                <small>{part.detail}</small>
                              </div>
                            ))}
                          </div>
                        </article>
                      ))}
                    </div>

                    {result.searchQuality?.claimFocus && (
                      <div className="claim-focus-box">
                        <span className="section-label">Search focus</span>
                        <p>{result.searchQuality.claimFocus}</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="analysis-split">
                  <div className="claim-card">
                    <span className="section-label">Analyzed claim</span>
                    <p>{result.claim}</p>
                    <div className="query-list">
                      {result.queries?.map((query) => (
                        <span key={query} className="query-pill">
                          {query}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="claim-card compact">
                    <span className="section-label">Model fallback</span>
                    {result.modelSignal ? (
                      <>
                        <div className="signal-row">
                          <span>Classifier vote</span>
                          <strong>{result.modelSignal.label}</strong>
                        </div>
                        <div className="signal-row">
                          <span>Classifier confidence</span>
                          <strong>{result.modelSignal.confidence.toFixed(1)}%</strong>
                        </div>
                      </>
                    ) : (
                      <p>Local classifier is unavailable, so the verdict is based only on live evidence.</p>
                    )}
                    {result.fallbackUsed && (
                      <p className="fallback-note">
                        Live search returned limited results, so this answer leans more on fallback scoring.
                      </p>
                    )}
                    {result.riskSignals?.score > 0 && (
                      <div className="risk-box">
                        <span>Fake-risk score</span>
                        <strong>{(result.riskSignals.score * 100).toFixed(0)}%</strong>
                        {result.riskSignals.reasons?.length > 0 && (
                          <p>{result.riskSignals.reasons.join(', ')}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="explanation-card">
                  <span className="section-label">Why this verdict</span>
                  <ul className="explanation-list">
                    {(result.explanation || []).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div className="sources-header">
                  <div>
                    <span className="section-label">Evidence sources</span>
                    <h3>Where the verdict came from</h3>
                  </div>
                  <div className="source-meta">
                    <Newspaper size={16} />
                    <span>{result.sources.length} sources surfaced</span>
                  </div>
                </div>

                <div className="sources-grid">
                  {result.sources.length === 0 && (
                    <div className="no-sources">
                      No relevant live sources were found for this claim. The verdict is based on fallback model and risk signals.
                    </div>
                  )}
                  {result.sources.map((source) => (
                    <article key={`${source.link}-${source.title}`} className={`source-card ${source.stance}`}>
                      <div className="source-card-top">
                        <span className={`stance-badge ${source.stance}`}>{source.stance}</span>
                        <span className="strength-badge">{source.strength.toFixed(0)}% strength</span>
                        <span className="credibility-badge">
                          {source.credibilityScore?.toFixed(0) || 0}% {source.credibilityLabel || 'source'}
                        </span>
                      </div>

                      <h4>{source.title}</h4>
                      <p>{source.snippet || 'Snippet unavailable for this source.'}</p>

                      <div className="source-signals">
                        <span>{source.relevance.toFixed(0)}% relevant</span>
                        <span>{(source.sourceWeight * 100).toFixed(0)}% source</span>
                        <span>{(source.freshnessWeight * 100).toFixed(0)}% fresh</span>
                        <span>{source.bodyChecked ? 'body checked' : 'snippet only'}</span>
                        {source.factCheckSignals > 0 && <span>{source.factCheckSignals} fact-check cues</span>}
                        {source.stanceReason && <span>{source.stanceReason}</span>}
                      </div>

                      <div className="source-footer">
                        <div>
                          <span className="source-name">{source.source}</span>
                          <span className="source-date">{source.publishedAt}</span>
                        </div>
                        <a href={source.link} target="_blank" rel="noreferrer">
                          Open
                          <ArrowUpRight size={16} />
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="trends-panel">
              <div className="sources-header">
                <div>
                  <span className="section-label">Local trends</span>
                  <h3>Dashboard</h3>
                </div>
                <div className="source-meta">
                  <TrendingUp size={16} />
                  <span>{historyInsights.checked} checks</span>
                </div>
              </div>

              <div className="trend-grid">
                <article className="trend-card">
                  <span>Supported</span>
                  <strong>{historyInsights.supported}</strong>
                </article>
                <article className="trend-card danger">
                  <span>Disputed</span>
                  <strong>{historyInsights.disputed}</strong>
                </article>
                <article className="trend-card">
                  <span>Avg confidence</span>
                  <strong>{historyInsights.avgConfidence.toFixed(1)}%</strong>
                </article>
                <article className="trend-card">
                  <span>Helpful votes</span>
                  <strong>{historyInsights.helpful}</strong>
                </article>
              </div>

              <div className="trend-split">
                <div>
                  <span className="section-label">Common risk topics</span>
                  <div className="topic-list">
                    {historyInsights.topics.length === 0 ? (
                      <span className="empty-topic">No disputed-topic pattern yet.</span>
                    ) : (
                      historyInsights.topics.map((topic) => (
                        <span key={topic.word} className="topic-pill">
                          {topic.word} <em>{topic.count}</em>
                        </span>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <span className="section-label">High-risk recent checks</span>
                  <div className="risk-list">
                    {historyInsights.highRisk.length === 0 ? (
                      <span className="empty-topic">No high-risk checks saved yet.</span>
                    ) : (
                      historyInsights.highRisk.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="risk-item"
                          onClick={() => restoreHistoryItem(item)}
                        >
                          <strong>{item.verdict}</strong>
                          <span>{item.claim}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="support-panel">
              <div className="sources-header">
                <div>
                  <span className="section-label">Support</span>
                  <h3>Help center</h3>
                </div>
                <div className="source-meta">
                  <MessageCircle size={16} />
                  <span>FAQ, live chat, contact</span>
                </div>
              </div>

              <div className="faq-grid">
                {supportFaqs.map((faq) => (
                  <article key={faq.question} className="faq-card">
                    <div className="faq-icon">
                      <HelpCircle size={18} />
                    </div>
                    <h4>{faq.question}</h4>
                    <p>{faq.answer}</p>
                    <button type="button" onClick={() => askSupportBot(faq.question)}>
                      Ask chat
                      <ArrowUpRight size={15} />
                    </button>
                  </article>
                ))}
              </div>

              <div className="support-split">
                <div className="chat-card">
                  <div className="support-card-header">
                    <div>
                      <span className="section-label">Live support</span>
                      <h4>TruthLens assistant</h4>
                    </div>
                    <Bot size={22} />
                  </div>

                  <div className="chat-messages" aria-live="polite">
                    {supportMessages.map((message) => (
                      <div key={message.id} className={`chat-message ${message.role}`}>
                        <span>{message.role === 'assistant' ? <Bot size={15} /> : <User size={15} />}</span>
                        <p>{message.text}</p>
                      </div>
                    ))}
                  </div>

                  <form className="chat-form" onSubmit={handleChatSubmit}>
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(event) => setChatInput(event.target.value)}
                      placeholder="Ask about using TruthLens"
                    />
                    <button type="submit" disabled={!chatInput.trim()} aria-label="Send chat message">
                      <Send size={17} />
                    </button>
                  </form>
                </div>

                <form className="contact-card" onSubmit={handleContactSubmit}>
                  <div className="support-card-header">
                    <div>
                      <span className="section-label">Contact</span>
                      <h4>Send a support request</h4>
                    </div>
                    <Mail size={22} />
                  </div>

                  <div className="contact-grid">
                    <label>
                      <span>Name</span>
                      <input
                        type="text"
                        value={contactForm.name}
                        onChange={(event) =>
                          setContactForm((form) => ({ ...form, name: event.target.value }))
                        }
                        placeholder="Your name"
                        required
                      />
                    </label>

                    <label>
                      <span>Email</span>
                      <input
                        type="email"
                        value={contactForm.email}
                        onChange={(event) =>
                          setContactForm((form) => ({ ...form, email: event.target.value }))
                        }
                        placeholder="you@example.com"
                        required
                      />
                    </label>
                  </div>

                  <label>
                    <span>Topic</span>
                    <select
                      value={contactForm.topic}
                      onChange={(event) =>
                        setContactForm((form) => ({ ...form, topic: event.target.value }))
                      }
                    >
                      <option>Result question</option>
                      <option>Bug report</option>
                      <option>Feature request</option>
                      <option>Source correction</option>
                    </select>
                  </label>

                  <label>
                    <span>Message</span>
                    <textarea
                      value={contactForm.message}
                      onChange={(event) =>
                        setContactForm((form) => ({ ...form, message: event.target.value }))
                      }
                      placeholder="Tell us what happened or what you need."
                      required
                    />
                  </label>

                  <button type="submit" className="contact-submit" disabled={contactLoading}>
                    {contactLoading ? <Loader2 className="spinner" size={18} /> : <Send size={18} />}
                    <span>{contactLoading ? 'Sending' : 'Send message'}</span>
                  </button>

                  {contactStatus && (
                    <p className={`contact-status ${contactStatus.tone}`}>{contactStatus.message}</p>
                  )}
                </form>
              </div>
            </section>

            <section className="history-panel">
              <div className="history-header">
                <div>
                  <span className="section-label">Local history</span>
                  <h3>Recent checks</h3>
                </div>
                <div className="history-actions">
                  {history.length > 0 && (
                    <button type="button" className="ghost-btn" onClick={() => saveHistory([])}>
                      <Trash2 size={16} />
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {history.length > 0 && (
                <div className="history-controls">
                  <label className="history-search">
                    <Search size={16} />
                    <input
                      type="search"
                      value={historySearch}
                      onChange={(event) => setHistorySearch(event.target.value)}
                      placeholder="Search history"
                    />
                  </label>
                  <label className="history-filter">
                    <Filter size={16} />
                    <select
                      value={historyVerdictFilter}
                      onChange={(event) => setHistoryVerdictFilter(event.target.value)}
                    >
                      {verdictFilterOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              {history.length === 0 ? (
                <p className="empty-history">Analyzed claims will be saved in this browser.</p>
              ) : filteredHistory.length === 0 ? (
                <p className="empty-history">No saved checks match the current filter.</p>
              ) : (
                <div className="history-list">
                  {filteredHistory.map((item) => (
                    <div key={item.id} className={`history-item ${item.pinned ? 'pinned' : ''}`}>
                      <button
                        type="button"
                        className="history-pin"
                        onClick={() => togglePinHistoryItem(item.id)}
                        aria-label={item.pinned ? `Unpin search: ${item.claim}` : `Pin search: ${item.claim}`}
                        title={item.pinned ? 'Unpin search' : 'Pin search'}
                      >
                        {item.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                      </button>
                      <button
                        type="button"
                        className="history-restore"
                        onClick={() => restoreHistoryItem(item)}
                        aria-label={`Restore search: ${item.claim}`}
                      >
                        <History size={18} />
                        <span>
                          <strong>{item.verdict}</strong>
                          <small>{item.claim}</small>
                          <span className="history-badges">
                            <em>{(item.confidence || 0).toFixed(1)}%</em>
                            <b>{formatDate(item.checkedAt)}</b>
                            {item.feedback && <b>{item.feedback === 'helpful' ? 'helpful' : 'needs review'}</b>}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="history-delete"
                        onClick={() => deleteHistoryItem(item.id)}
                        aria-label={`Delete search: ${item.claim}`}
                        title="Delete search"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </>
  )
}

export default App
