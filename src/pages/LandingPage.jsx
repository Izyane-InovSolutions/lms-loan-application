import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from '../styles/LandingPage.module.css'
import hero from '../assets/hero1.png'
import logo from '../assets/izyane.png'
import footerLogo from '../assets/izyane-black.svg'

function LandingPage() {
  const [selectedType, setSelectedType] = useState('personal')
  const [showResumeModal, setShowResumeModal] = useState(false)
  const [phoneNumber, setPhoneNumber] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [generatedOtp, setGeneratedOtp] = useState('')
  const [otpError, setOtpError] = useState('')
  const navigate = useNavigate()

  const resetResumeFlow = () => {
    setPhoneNumber('')
    setOtpSent(false)
    setOtpCode('')
    setGeneratedOtp('')
    setOtpError('')
  }

  const handleResumeModalClose = () => {
    setShowResumeModal(false)
    resetResumeFlow()
  }

  const handleSendOtp = () => {
    const normalizedPhone = phoneNumber.replace(/\s+/g, '')

    if (!/^0\d{9}$/.test(normalizedPhone)) {
      setOtpError('Enter a valid Zambian phone number starting with 0.')
      return
    }

    const sixDigitOtp = String(Math.floor(100000 + Math.random() * 900000))
    setGeneratedOtp(sixDigitOtp)
    setOtpSent(true)
    setOtpError('')
  }

  const handleResendOtp = () => {
    const sixDigitOtp = String(Math.floor(100000 + Math.random() * 900000))
    setGeneratedOtp(sixDigitOtp)
    setOtpCode('')
    setOtpError('')
  }

  const handleOtpVerify = () => {
    if (!otpCode.trim()) {
      setOtpError('Enter the OTP sent to your phone.')
      return
    }

    if (otpCode.trim() !== generatedOtp) {
      setOtpError('The OTP entered is incorrect. Please try again.')
      return
    }

    setShowResumeModal(false)
    resetResumeFlow()
    navigate('/apply', { state: { type: selectedType } })
  }

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
                  Choose between Business Loan and Personal Loan to start a newapplication. Our streamlined process guides you through each step and helps you submit documents securely, so you can complete your request faster.
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

                <button
                  type="button"
                  className={styles.resumeButton}
                  onClick={() => setShowResumeModal(true)}
                >
                  Resume Application
                </button>
              </div>
            </div>

            <div className={styles.heroRight}>
              <div className={styles.heroRightHeader}>
                <h1 className={styles.heroTitle2}>Apply for a loan today</h1>
                <span className={styles.heroLabel}>Anytitime, anywhere and everywhere</span>
                <span className={styles.heroLabel}>TAILORED FINANCING FOR EVERY NEED</span>
                <span className={styles.heroLabel}>quick, easy and secure</span>
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

      {showResumeModal ? (
        <div className={styles.resumeModalOverlay} onClick={handleResumeModalClose}>
          <div className={styles.resumeModal} onClick={(event) => event.stopPropagation()}>
            <div className={styles.resumeModalHeader}>
              <h2>Resume Application</h2>
              <button
                type="button"
                className={styles.closeButton}
                onClick={handleResumeModalClose}
                aria-label="Close resume modal"
              >
                ×
              </button>
            </div>

            {!otpSent ? (
              <>
                <label className={styles.resumeFieldWrap}>
                  <span>Phone number</span>
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(event) => setPhoneNumber(event.target.value)}
                    placeholder="e.g. 0977123456"
                    className={styles.resumeInput}
                    maxLength={10}
                  />
                </label>

                {otpError ? <p className={styles.resumeError}>{otpError}</p> : null}

                <button type="button" className={styles.primaryAction} onClick={handleSendOtp}>
                  Receive OTP
                </button>
              </>
            ) : (
              <>
                <p className={styles.resumeHint}>Enter the 6-digit OTP sent to {phoneNumber}</p>
                <label className={styles.resumeFieldWrap}>
                  <span>OTP</span>
                  <input
                    type="text"
                    value={otpCode}
                    onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Enter OTP"
                    className={styles.resumeInput}
                    maxLength={6}
                  />
                </label>

                {otpError ? <p className={styles.resumeError}>{otpError}</p> : null}

                <div className={styles.resumeActions}>
                  <button type="button" className={styles.secondaryAction} onClick={handleResendOtp}>
                    Resend OTP
                  </button>
                  <button type="button" className={styles.primaryAction} onClick={handleOtpVerify}>
                    Verify OTP
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      <footer className={styles.footer}>
        <span className={styles.footerText}>Powered by</span>
        <img
          src={footerLogo}
          alt="Powered by Izyane"
          className={styles.footerLogo}
        />
      </footer>
    </div>
  )
}

export default LandingPage
