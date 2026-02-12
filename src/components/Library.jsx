import { useState, useEffect, useRef } from 'react'
import { listBooks, uploadBook, deleteBook } from '../api'
import './Library.css'

function Library({ onSelectBook, onQuickRead }) {
  const [books, setBooks] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  const loadBooks = async () => {
    try {
      const data = await listBooks()
      setBooks(data)
    } catch {
      setError('Failed to load books')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadBooks() }, [])

  const handleUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      await uploadBook(file)
      await loadBooks()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleDelete = async (id, title) => {
    if (!confirm(`Delete "${title}"?`)) return
    await deleteBook(id)
    await loadBooks()
  }

  const getProgressText = (book) => {
    if (!book.progress) return null
    const ch = (book.progress.chapterIndex || 0) + 1
    return `Ch ${ch}/${book.chapterCount}`
  }

  return (
    <div className="library">
      <h1>Speed Reader</h1>
      <p className="subtitle">Upload an EPUB to get started</p>

      <div className="upload-area">
        <input
          ref={fileRef}
          type="file"
          accept=".epub"
          onChange={handleUpload}
          style={{ display: 'none' }}
        />
        <button
          className="btn-primary btn-upload"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Uploading...' : 'Upload EPUB'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="loading-text">Loading library...</p>
      ) : books.length === 0 ? (
        <p className="empty-text">No books yet. Upload an EPUB above!</p>
      ) : (
        <div className="book-list">
          {books.map(book => (
            <div key={book.id} className="book-card" onClick={() => onSelectBook(book.id)}>
              <div className="book-info">
                <h3 className="book-title">{book.title}</h3>
                <span className="book-meta">
                  {book.chapterCount} chapters
                  {getProgressText(book) && (
                    <> · {getProgressText(book)}</>
                  )}
                </span>
              </div>
              <button
                className="btn-delete"
                onClick={(e) => { e.stopPropagation(); handleDelete(book.id, book.title) }}
                title="Delete"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <button className="btn-secondary btn-quick" onClick={onQuickRead}>
        Quick Read (paste text)
      </button>
    </div>
  )
}

export default Library
