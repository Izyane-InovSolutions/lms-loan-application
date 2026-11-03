import { getSetting } from './settings.js'
import { buildProducts, productFor } from '../../src/config/loanProducts.js'
import { buildCollateralCatalog } from '../../src/config/collateral.js'

/** Products as configured in Settings → Loan products (pricing, documents, collateral), built-in and added. */
export const getProducts = async () => buildProducts(await getSetting('products'))

export const getProductConfig = async (id) => (await getProducts()).find((product) => product.id === id) || null

/** The product an application was made under (its form's built-in one, for applications from before products). */
export const getApplicationProduct = async (application) => productFor(application, await getProducts())

/** The collateral types and items (Settings → Loan products), retired ones included so old pledges still read. */
export const getCollateralCatalog = async () => buildCollateralCatalog(await getSetting('collateral'))
