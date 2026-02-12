import { useState, useEffect, useRef, useCallback } from 'react'
import { getBook, getProgress, saveProgress } from '../api'
import './Reader.css'

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
    clearInterval(timerRef.current)
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

  // Timer
  useEffect(() => {
    if (isPlaying && words.length > 0) {
      const interval = 60000 / wpm
      timerRef.current = setInterval(() => {
        setCurrentIndex(prev => {
          if (prev >= words.length - 1) {
            setIsPlaying(false)
            setIsDone(true)
            clearInterval(timerRef.current)
            return prev
          }
          return prev + 1
        })
      }, interval)
    }
    return () => clearInterval(timerRef.current)
  }, [isPlaying, wpm, words.length])

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

  const displayWord = () => {
    if (loading) return 'Loading...'
    if (!hasStarted) return 'Paste text below & hit Start'
    if (isDone) return 'Done!'
    return words[currentIndex] || ''
  }

  if (loading) {
    return (
      <div className="reader">
        <div className="display-area">
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
        <span className={`current-word${isDone ? ' done' : ''}${!hasStarted ? ' done' : ''}`}>
          {displayWord()}
        </span>
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
