const API = '/api';

export async function listBooks() {
  const res = await fetch(`${API}/books`);
  return res.json();
}

export async function uploadBook(file) {
  const form = new FormData();
  form.append('epub', file);
  const res = await fetch(`${API}/books`, { method: 'POST', body: form });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

export async function getBook(id) {
  const res = await fetch(`${API}/books/${id}`);
  if (!res.ok) throw new Error('Book not found');
  return res.json();
}

export async function getProgress(id) {
  const res = await fetch(`${API}/books/${id}/progress`);
  if (!res.ok) return null;
  return res.json();
}

export async function saveProgress(id, data) {
  return fetch(`${API}/books/${id}/progress`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

export async function deleteBook(id) {
  return fetch(`${API}/books/${id}`, { method: 'DELETE' });
}
