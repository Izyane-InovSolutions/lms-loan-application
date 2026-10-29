import { getSetting } from './settings.js'
import { buildProducts, productFor } from '../../src/config/loanProducts.js'

/** Products as configured in Settings → Loan products (pricing, documents, collateral), built-in and added. */
export const getProducts = async () => buildProducts(await getSetting('products'))

export const getProductConfig = async (id) => (await getProducts()).find((product) => product.id === id) || null

/** The product an application was made under (its form's built-in one, for applications from before products). */
export const getApplicationProduct = async (application) => productFor(application, await getProducts())

/** The collateral types (Settings → Loan products → Collateral types), retired ones included so old pledges still read. */
export const getCollateralTypes = async () => (await getSetting('collateral')).types
