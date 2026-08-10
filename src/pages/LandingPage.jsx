import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from '../styles/LandingPage.module.css'
import hero from '../assets/hero1.png'
import logo from '../assets/izyane.png'

function LandingPage() {
  const [selectedType, setSelectedType] = useState('personal')
  const navigate = useNavigate()

  return (
    <div className={styles.pageShell}>
      <main className={styles.pageContent}>
        <div className={styles.contentCard}>
          <section className={styles.heroSection}>
          <div className={styles.heroLeft}>
            <div className={styles.heroCopy}>
            <img
              src={logo}
              alt="Logo"
              className={styles.heroLogo}
            />
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
          </div>

          <div className={styles.heroRight}>
            <div className={styles.heroRightHeader}>
              <h1 className={styles.heroTitle2}>Apply for a loan today</h1>
              <span className={styles.heroLabel}>TAILORED FINANCING FOR EVERY NEED</span>
            </div>
            <img
              src={hero}
              alt="Loan application illustration"
              className={styles.heroRightImage}
            />
          </div>
          </section>
        </div>
      </main>
    </div>
  )
}

export default LandingPage
