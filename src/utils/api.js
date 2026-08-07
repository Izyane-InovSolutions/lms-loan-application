import api from './auth'

export const getLoans = async () => {
  try {
    const response = await api.get('/loans/')
    return response.data
  } catch (error) {
    console.error('Error fetching loans:', error)
    throw error
  }
}

export const getLoanDetails = async (loanId) => {
  try {
    const response = await api.get(`/loans/${loanId}/`)
    return response.data
  } catch (error) {
    console.error('Error fetching loan details:', error)
    throw error
  }
}

export const getUserProfile = async () => {
  try {
    const response = await api.get('/users/me/')
    return response.data
  } catch (error) {
    console.error('Error fetching user profile:', error)
    throw error
  }
}

export const updateUserProfile = async (userData) => {
  try {
    const response = await api.put('/users/me/', userData)
    return response.data
  } catch (error) {
    console.error('Error updating user profile:', error)
    throw error
  }
}

export const changePassword = async (currentPassword, newPassword) => {
  try {
    const response = await api.post('/users/change-password/', {
      current_password: currentPassword,
      new_password: newPassword,
    })
    return response.data
  } catch (error) {
    console.error('Error changing password:', error)
    throw error
  }
}

export const requestLoan = async (loanData) => {
  try {
    const response = await api.post('/loans/request/', loanData)
    return response.data
  } catch (error) {
    console.error('Error requesting loan:', error)
    throw error
  }
}
