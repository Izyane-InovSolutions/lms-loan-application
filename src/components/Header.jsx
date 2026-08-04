import React from 'react'
import styles from '../styles/Header.module.css'

function Header() {
  return (
    <header className={styles.topbar}>
      <div className={styles.brandRow}>
        <div className={styles.brandMark}>LP</div>
        <div className={styles.brandText}>
          <div className={styles.brandTitle}>LP Loan Application</div>
          <div className={styles.brandSubtitle}>Limited</div>
        </div>
      </div>
    </header>
  )
}

export default Header
