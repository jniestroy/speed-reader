import { useState } from 'react'
import Library from './components/Library'
import Reader from './components/Reader'

function App() {
  const [view, setView] = useState('library')
  const [currentBookId, setCurrentBookId] = useState(null)

  if (view === 'reader') {
    return (
      <Reader
        bookId={currentBookId}
        onBack={() => { setView('library'); setCurrentBookId(null) }}
      />
    )
  }

  return (
    <Library
      onSelectBook={(id) => { setCurrentBookId(id); setView('reader') }}
      onQuickRead={() => { setCurrentBookId(null); setView('reader') }}
    />
  )
}

export default App
