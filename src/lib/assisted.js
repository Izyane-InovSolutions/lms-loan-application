/*
 * "Filling in for a customer" mode for agents and RMs. Set by the workspace's New
 * application button and kept for the tab's session, because the wizard's step URLs do
 * not carry query parameters. It only takes effect while an agent or RM is signed in.
 */
export const ASSISTED_FLAG = 'los_assisted'

export const setAssistedFlag = () => {
  try {
    sessionStorage.setItem(ASSISTED_FLAG, '1')
  } catch {
    // Without storage the wizard behaves as self-service.
  }
}

export const isAssistedFlagSet = () => {
  try {
    return sessionStorage.getItem(ASSISTED_FLAG) === '1'
  } catch {
    return false
  }
}

export const clearAssistedFlag = () => {
  try {
    sessionStorage.removeItem(ASSISTED_FLAG)
  } catch {
    // Nothing to clear.
  }
}
