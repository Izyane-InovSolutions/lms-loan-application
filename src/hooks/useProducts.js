import { useEffect, useState } from 'react'
import { DEFAULT_LOAN_TYPES, LOAN_PRODUCTS } from '../config/loanProducts'
import { DEFAULT_COLLATERAL_CATALOG, activeCatalog } from '../config/collateral'

/*
 * Loan products as configured in the workspace (Settings → Loan products), and the
 * collateral applicants can pledge (active types and items, src/config/collateral.js).
 *
 * Starts from the built-in defaults so the page renders at once, then swaps in the
 * configured values. Fetched once per page load and shared by every component.
 */

const DEFAULT_CATALOG = {
  products: LOAN_PRODUCTS,
  loanTypes: DEFAULT_LOAN_TYPES,
  collateralCatalog: activeCatalog(DEFAULT_COLLATERAL_CATALOG),
  loaded: false,
}

let cached = null
let pending = null
const listeners = new Set()

const load = () => {
  if (!pending) {
    pending = fetch('/api/v1/products')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then(({ products, loanTypes, collateralCatalog }) => {
        cached = { products, loanTypes: loanTypes || DEFAULT_CATALOG.loanTypes, collateralCatalog: collateralCatalog || DEFAULT_CATALOG.collateralCatalog, loaded: true }
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

/** { products, loanTypes, collateralCatalog, loaded }: `loaded` turns true once the workspace's own answer (or a failure) is in. */
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

/** The collateral applicants can pledge: { types, items }. */
export function useCollateralCatalog() {
  return useProductCatalog().collateralCatalog
}

/** One product by id, falling back to the built-in definition if it is switched off or unknown. */
export function useProduct(id) {
  const products = useProducts()
  return products.find((product) => product.id === id) || LOAN_PRODUCTS.find((product) => product.id === id)
}
