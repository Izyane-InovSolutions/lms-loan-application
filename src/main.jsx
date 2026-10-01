import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { BrandingProvider } from './components/brand/BrandingProvider'
import './index.css'
import { installErrorReporting } from './lib/reportErrors'

installErrorReporting()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrandingProvider>
      <App />
    </BrandingProvider>
  </React.StrictMode>,
)
