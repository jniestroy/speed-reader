import { useState, useEffect, useRef, useCallback } from 'react'
import { getBook, getProgress, saveProgress } from '../api'
import './Reader.css'

function getORP(word) {
  const len = word.replace(/[^a-zA-Z0-9]/g, '').length || word.length
  if (len <= 1) return 0
  if (len <= 5) return 1
  if (len <= 9) return 2
  if (len <= 13) return 3
  return 4
}

function getWordDelay(word, baseInterval) {
  let multiplier = 1.0

  // Punctuation pausing
  const lastChar = word[word.length - 1]
  if ('.!?'.includes(lastChar)) {
    multiplier = 1.8
  } else if (',;:'.includes(lastChar)) {
    multiplier = 1.3
  } else if ('—–-'.includes(lastChar) && word.length > 1) {
    multiplier = 1.15
  }

  // Check for paragraph-ending punctuation followed by quotes
  if (word.length > 1) {
    const secondLast = word[word.length - 2]
    if ('.!?'.includes(secondLast) && '"\'")'.includes(lastChar)) {
      multiplier = 1.8
    }
  }

  // Word length adjustment: longer words get slightly more time
  const cleanLen = word.replace(/[^a-zA-Z0-9]/g, '').length
  if (cleanLen >= 8) {
    multiplier *= 1.0 + (cleanLen - 7) * 0.04 // +4% per char over 7
  }

  return baseInterval * multiplier
}

function Reader({ bookId, onBack }) {
  const [text, setText] = useState('')
  const [words, setWords] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [wpm, setWpm] = useState(300)
  const [hasStarted, setHasStarted] = useState(false)
  const [isDone, setIsDone] = useState(false)
  const [chapters, setChapters] = useState([])
  const [chapterIndex, setChapterIndex] = useState(0)
  const [bookTitle, setBookTitle] = useState('')
  const [loading, setLoading] = useState(!!bookId)
  const timerRef = useRef(null)
  const progressRef = useRef({ chapterIndex: 0, wordIndex: 0, wpm: 300 })

  const parseWords = useCallback((input) => {
    return input.trim().split(/\s+/).filter(w => w.length > 0)
  }, [])

  // Load book and progress
  useEffect(() => {
    if (!bookId) return
    let cancelled = false
    async function load() {
      try {
        const [book, prog] = await Promise.all([getBook(bookId), getProgress(bookId)])
        if (cancelled) return
        setBookTitle(book.title)
        setChapters(book.chapters)
        const ci = prog?.chapterIndex || 0
        const wi = prog?.wordIndex || 0
        const speed = prog?.wpm || 300
        setChapterIndex(ci)
        setWpm(speed)
        const parsed = parseWords(book.chapters[ci]?.text || '')
        setWords(parsed)
        setCurrentIndex(Math.min(wi, parsed.length - 1))
        setHasStarted(true)
        progressRef.current = { chapterIndex: ci, wordIndex: wi, wpm: speed }
      } catch (err) {
        console.error('Failed to load book:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [bookId, parseWords])

  // Auto-save progress periodically
  useEffect(() => {
    if (!bookId || !hasStarted) return
    const interval = setInterval(() => {
      saveProgress(bookId, progressRef.current).catch(() => {})
    }, 30000)
    return () => clearInterval(interval)
  }, [bookId, hasStarted])

  // Save on beforeunload
  useEffect(() => {
    if (!bookId) return
    const handler = () => {
      const data = JSON.stringify(progressRef.current)
      navigator.sendBeacon(`/api/books/${bookId}/progress`, new Blob([data], { type: 'application/json' }))
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [bookId])

  // Keep progressRef in sync
  useEffect(() => {
    progressRef.current = { chapterIndex, wordIndex: currentIndex, wpm }
  }, [chapterIndex, currentIndex, wpm])

  const loadChapter = useCallback((index) => {
    if (index < 0 || index >= chapters.length) return
    // Save progress before switching chapters
    if (bookId) saveProgress(bookId, progressRef.current).catch(() => {})
    setChapterIndex(index)
    const parsed = parseWords(chapters[index]?.text || '')
    setWords(parsed)
    setCurrentIndex(0)
    setIsPlaying(false)
    setIsDone(false)
    setHasStarted(true)
  }, [chapters, parseWords, bookId])

  const togglePlay = useCallback(() => {
    if (bookId && chapters.length > 0) {
      // Book mode
      if (isDone) {
        setCurrentIndex(0)
        setIsDone(false)
        setIsPlaying(true)
      } else {
        setIsPlaying(prev => !prev)
      }
    } else {
      // Paste mode
      if (!hasStarted) {
        const parsed = parseWords(text)
        if (parsed.length === 0) return
        setWords(parsed)
        setCurrentIndex(0)
        setHasStarted(true)
        setIsDone(false)
        setIsPlaying(true)
      } else if (isDone) {
        setCurrentIndex(0)
        setIsDone(false)
        setIsPlaying(true)
      } else {
        setIsPlaying(prev => !prev)
      }
    }
  }, [bookId, chapters.length, hasStarted, isDone, text, parseWords])

  const reset = useCallback(() => {
    setIsPlaying(false)
    setHasStarted(false)
    setCurrentIndex(0)
    setIsDone(false)
    setWords([])
    clearTimeout(timerRef.current)
  }, [])

  const stepForward = useCallback(() => {
    if (!hasStarted || words.length === 0) return
    setCurrentIndex(prev => {
      if (prev < words.length - 1) return prev + 1
      setIsDone(true)
      setIsPlaying(false)
      return prev
    })
  }, [hasStarted, words.length])

  const stepBack = useCallback(() => {
    if (!hasStarted) return
    setIsDone(false)
    setCurrentIndex(prev => Math.max(0, prev - 1))
  }, [hasStarted])

  // Timer - uses setTimeout chain for variable word delays
  useEffect(() => {
    if (!isPlaying || words.length === 0) return
    const baseInterval = 60000 / wpm
    let cancelled = false

    function scheduleNext() {
      setCurrentIndex(prev => {
        if (prev >= words.length - 1) {
          setIsPlaying(false)
          setIsDone(true)
          return prev
        }
        const nextIndex = prev + 1
        if (!cancelled) {
          const delay = getWordDelay(words[nextIndex], baseInterval)
          timerRef.current = setTimeout(scheduleNext, delay)
        }
        return nextIndex
      })
    }

    const initialDelay = getWordDelay(words[currentIndex] || '', baseInterval)
    timerRef.current = setTimeout(scheduleNext, initialDelay)

    return () => {
      cancelled = true
      clearTimeout(timerRef.current)
    }
  }, [isPlaying, wpm, words])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        setIsPlaying(false)
        stepForward()
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        setIsPlaying(false)
        stepBack()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [togglePlay, stepForward, stepBack])

  // Save progress on pause
  useEffect(() => {
    if (!isPlaying && bookId && hasStarted) {
      saveProgress(bookId, progressRef.current).catch(() => {})
    }
  }, [isPlaying, bookId, hasStarted])

  const progress = words.length > 0 ? ((currentIndex + 1) / words.length) * 100 : 0

  const getButtonLabel = () => {
    if (!hasStarted) return 'Start'
    if (isDone) return 'Restart'
    if (isPlaying) return 'Pause'
    return 'Resume'
  }

  const renderWord = () => {
    if (loading) return <span className="current-word done">Loading...</span>
    if (!hasStarted) return <span className="current-word done">Paste text below & hit Start</span>
    if (isDone) return <span className="current-word done">Done!</span>
    const word = words[currentIndex] || ''
    const orp = getORP(word)
    const before = word.slice(0, orp)
    const pivot = word[orp] || ''
    const after = word.slice(orp + 1)
    return (
      <div className="orp-word">
        <span className="orp-before">{before}</span>
        <span className="orp-pivot">{pivot}</span>
        <span className="orp-after">{after}</span>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="reader">
        <div className="display-area">
          <div className="orp-guide" />
          <span className="current-word done">Loading...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="reader">
      <div className="reader-header">
        {onBack && (
          <button className="btn-secondary btn-back" onClick={() => {
            if (bookId) saveProgress(bookId, progressRef.current).catch(() => {})
            onBack()
          }}>
            ← Library
          </button>
        )}
        <h1>{bookTitle || 'Speed Reader'}</h1>
      </div>

      {chapters.length > 0 && (
        <div className="chapter-nav">
          <button
            className="btn-secondary"
            onClick={() => loadChapter(chapterIndex - 1)}
            disabled={chapterIndex === 0}
          >
            ← Prev
          </button>
          <span className="chapter-label">
            Ch {chapterIndex + 1} / {chapters.length}
          </span>
          <button
            className="btn-secondary"
            onClick={() => loadChapter(chapterIndex + 1)}
            disabled={chapterIndex >= chapters.length - 1}
          >
            Next →
          </button>
        </div>
      )}

      <div className="display-area">
        <div className="orp-guide" />
        {renderWord()}
      </div>

      {hasStarted && (
        <>
          <div className="progress-bar-container">
            <div className="progress-bar" style={{ width: `${progress}%` }} />
          </div>
          <div className="info-row">
            <span>{currentIndex + 1} / {words.length}</span>
            <span>{wpm} WPM</span>
          </div>
        </>
      )}

      <div className="controls">
        <button
          className="btn-primary"
          onClick={togglePlay}
          disabled={!bookId && !hasStarted && text.trim().length === 0}
        >
          {getButtonLabel()}
        </button>
        {hasStarted && !bookId && (
          <button className="btn-secondary" onClick={reset}>
            Reset
          </button>
        )}
      </div>

      <div className="speed-control">
        <label>Speed:</label>
        <input
          type="range"
          min={100}
          max={1000}
          step={25}
          value={wpm}
          onChange={(e) => setWpm(Number(e.target.value))}
        />
        <span className="wpm-value">{wpm} WPM</span>
      </div>

      {!bookId && !hasStarted && (
        <div className="textarea-section">
          <textarea
            placeholder="Paste your text here..."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      )}

      <p className="hint">
        Space = play/pause &nbsp;|&nbsp; ← → = step word by word
      </p>
    </div>
  )
}

export default Reader
