import React from 'react'
import { Link } from 'react-router-dom'
import styles from '../styles/Header.module.css'
import icon from '../assets/Icon.png'

function Header() {
  return (
    <header className={styles.topbar}>
      <div className={styles.brandRow}>
        <img src={icon} alt="Icon" className={styles.brandIcon} />
        <div className={styles.brandText}>
          <div className={styles.brandTitle}>Loan Application</div>
          <div className={styles.brandSubtitle}>Limited</div>
        </div>
      </div>
      <Link to="/applications" className={styles.navLink}>
        My Applications
      </Link>
    </header>
  )
}

export default Header
