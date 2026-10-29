import { useEffect, useState } from 'react'
import { LOAN_PRODUCTS } from '../config/loanProducts'
import { DEFAULT_COLLATERAL_TYPES } from '../config/collateral'

/*
 * Loan products as configured in the workspace (Settings → Loan products), and the
 * collateral types applicants can pledge.
 *
 * Starts from the built-in defaults so the page renders at once, then swaps in the
 * configured values. Fetched once per page load and shared by every component.
 */

const DEFAULT_CATALOG = {
  products: LOAN_PRODUCTS,
  collateralTypes: DEFAULT_COLLATERAL_TYPES.filter((type) => !type.retired),
  loaded: false,
}

let cached = null
let pending = null
const listeners = new Set()

const load = () => {
  if (!pending) {
    pending = fetch('/api/v1/products')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then(({ products, collateralTypes }) => {
        cached = { products, collateralTypes: collateralTypes || DEFAULT_CATALOG.collateralTypes, loaded: true }
        listeners.forEach((listener) => listener(cached))
        return cached
      })
      .catch(() => {
        // Keep the defaults, but say loading is over, so a page waiting on an added
        // product stops waiting; try again on the next page load.
        pending = null
        const fallback = { ...DEFAULT_CATALOG, loaded: true }
        listeners.forEach((listener) => listener(fallback))
        return null
      })
  }
  return pending
}

/** { products, collateralTypes, loaded }: `loaded` turns true once the workspace's own answer (or a failure) is in. */
export function useProductCatalog() {
  const [catalog, setCatalog] = useState(cached || DEFAULT_CATALOG)

  useEffect(() => {
    listeners.add(setCatalog)
    if (cached) setCatalog(cached)
    else load()
    return () => listeners.delete(setCatalog)
  }, [])

  return catalog
}

/** The products applicants can apply for. */
export function useProducts() {
  return useProductCatalog().products
}

/** The collateral types applicants can pledge. */
export function useCollateralTypes() {
  return useProductCatalog().collateralTypes
}

/** One product by id, falling back to the built-in definition if it is switched off or unknown. */
export function useProduct(id) {
  const products = useProducts()
  return products.find((product) => product.id === id) || LOAN_PRODUCTS.find((product) => product.id === id)
}
