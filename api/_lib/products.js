import { getSetting } from './settings.js'
import { buildProducts } from '../../src/config/loanProducts.js'

/** Products with the pricing configured in Settings → Loan products. */
export const getProducts = async () => buildProducts(await getSetting('products'))

export const getProductConfig = async (loanType) => (await getProducts()).find((product) => product.id === loanType) || null
