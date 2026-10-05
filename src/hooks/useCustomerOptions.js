import { useEffect, useState } from 'react'

/*
 * What applicants are offered, as set by admins (Settings → Workflow). Off until the
 * server answers, so a feature an admin has switched off never flashes up.
 */
const OFF = { helpWithFinishing: false }

export function useCustomerOptions() {
  const [options, setOptions] = useState(OFF)
  useEffect(() => {
    let active = true
    fetch('/api/v1/customer-options', { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : OFF))
      .then((next) => active && setOptions({ helpWithFinishing: next?.helpWithFinishing === true }))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  return options
}
