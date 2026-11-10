import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import { applyTheme, savedTheme } from './theme'

// Тема применяется до первой отрисовки, чтобы окно не мигало тёмным
applyTheme(savedTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
