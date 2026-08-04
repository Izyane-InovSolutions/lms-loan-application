import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/Header'
import styles from '../styles/LandingPage.module.css'

function LandingPage() {
  const [selectedType, setSelectedType] = useState('personal')
  const navigate = useNavigate()

  return (
    <div className={styles.pageShell}>
      <Header />

      <main className={styles.pageContent}>
        <section className={styles.heroSection}>
          <div className={styles.heroCopy}>
            <span className={styles.heroLabel}>TAILORED FINANCING FOR EVERY NEED</span>
            <h1 className={styles.heroTitle}>Loan Application</h1>
            <p className={styles.heroText}>
              Choose between Business Loan and Personal Loan application journeys. Our streamlined process guides you through each step and helps you submit documents securely, so you can complete your request faster.
            </p>

            <div className={styles.toggleGroup}>
              <button
                type="button"
                className={`${styles.toggleButton} ${selectedType === 'personal' ? styles.active : ''}`}
                onClick={() => {
                  setSelectedType('personal')
                  navigate('/apply', { state: { type: 'personal' } })
                }}
              >
                Personal Loan
              </button>
              <button
                type="button"
                className={`${styles.toggleButton} ${selectedType === 'business' ? styles.active : ''}`}
                onClick={() => {
                  setSelectedType('business')
                  navigate('/apply', { state: { type: 'business' } })
                }}
              >
                Business Loan
              </button>
            </div>
          </div>

          <div className={styles.imageFrame}>
            <img
              src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1500&q=80"
              alt="Loan application illustration"
              className={styles.heroImage}
            />
          </div>
        </section>
      </main>
    </div>
  )
}

export default LandingPage
