import axios from 'axios'

const API_URL = '/api'

// Create axios instance with credentials
const api = axios.create({
  baseURL: API_URL,
  withCredentials: true, // Send cookies with requests for session-based auth
})

export const login = async (email, password) => {
  try {
    const response = await api.post('/login/', {
      email,
      password,
    })
    if (response.data) {
      sessionStorage.setItem('user', JSON.stringify(response.data))
      return { success: true, data: response.data }
    }
  } catch (error) {
    const errorMsg = error.response?.data?.detail || 'Login failed'
    return { success: false, error: errorMsg }
  }
}

export const logout = () => {
  sessionStorage.removeItem('user')
}

export const isAuthenticated = () => {
  return sessionStorage.getItem('user') !== null
}

export const getUser = () => {
  const user = sessionStorage.getItem('user')
  return user ? JSON.parse(user) : null
}

export default api
