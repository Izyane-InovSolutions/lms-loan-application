import { useEffect, useState } from 'react'
import { LOAN_PRODUCTS } from '../config/loanProducts'

/*
 * Loan products with the pricing configured in the workspace (Settings → Loan products).
 *
 * Starts from the built-in defaults so the page renders at once, then swaps in the
 * configured values. Fetched once per page load and shared by every component.
 */

let cached = null
let pending = null
const listeners = new Set()

const load = () => {
  if (!pending) {
    pending = fetch('/api/v1/products')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then(({ products }) => {
        cached = products
        listeners.forEach((listener) => listener(products))
        return products
      })
      .catch(() => {
        // Keep the defaults; try again on the next page load.
        pending = null
        return null
      })
  }
  return pending
}

export function useProducts() {
  const [products, setProducts] = useState(cached || LOAN_PRODUCTS)

  useEffect(() => {
    listeners.add(setProducts)
    if (cached) setProducts(cached)
    else load()
    return () => listeners.delete(setProducts)
  }, [])

  return products
}

/** One product by id, falling back to the built-in definition if it is switched off or unknown. */
export function useProduct(id) {
  const products = useProducts()
  return products.find((product) => product.id === id) || LOAN_PRODUCTS.find((product) => product.id === id)
}
