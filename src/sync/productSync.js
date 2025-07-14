// src/sync/productSync.js
const cwsApiClient = require('../services/cwsApiClient');
const g2aSellerApiClient = require('../services/g2aSellerApiClient');
const productsToSync = require('../config/products.js');
const logger = require('../utils/logger');

// Load pricing rules from environment variables
const DEFAULT_FIXED_PROFIT = parseFloat(process.env.DEFAULT_FIXED_PROFIT);
const DEFAULT_G2A_FEE_PERCENTAGE = parseFloat(process.env.DEFAULT_G2A_FEE_PERCENTAGE);

/**
 * The main synchronization function.
 * Fetches all G2A offers, then iterates through configured products to update price and stock.
 */
async function syncProducts() {
  // Check the master switch to see if the service is paused
  if (process.env.SERVICE_ENABLED !== 'true') {
    logger.info('Sync job skipped because SERVICE_ENABLED is not true.');
    return;
  }

  logger.info('--- Starting Product Sync Job ---');

  try {
    // 1. Get all of the client's offers from G2A to build a dynamic mapping
    const allG2aOffers = await g2aSellerApiClient.getOffers();
    const g2aProductToOfferMap = new Map();
    allG2aOffers.forEach(offer => {
      if (offer.product && offer.product.id) {
        g2aProductToOfferMap.set(offer.product.id, offer.id);
      }
    });

    if (g2aProductToOfferMap.size === 0) {
      logger.warn('No active G2A offers found. Sync job will not update any products.');
      return;
    }
    
    // 2. Loop through each product defined in our configuration file
    for (const product of productsToSync) {
      try {
        // 3. Find the corresponding G2A offer ID using the G2A product ID
        const g2aOfferId = g2aProductToOfferMap.get(product.g2aProductId);
        if (!g2aOfferId) {
          logger.warn(`Product with G2A ID ${product.g2aProductId} is configured but has no active offer on G2A. Skipping.`);
          continue;
        }

        // 4. Fetch live data from CodesWholesale
        const cwsProduct = await cwsApiClient.getProduct(product.cwsProductId);
        
        let g2aQuantity, g2aPrice;

        if (!cwsProduct || cwsProduct.quantity === 0) {
          // If CWS product is not found (delisted) or out of stock, set G2A stock to 0
          g2aQuantity = 0;
        //   g2aPrice = 9999; // Do not set a high price for inactive offers to avoid accidental sales
          logger.info(`CWS product ${product.cwsProductId} is out of stock or delisted. Setting G2A offer ${g2aOfferId} quantity to 0.`);
        } else {
          // If the product is in stock, calculate price and get quantity
          g2aQuantity = cwsProduct.quantity;
          const cwsCost = cwsProduct.prices[0].value;

          // 6. Calculate the final G2A selling price
          const desiredProfit = product.profit || DEFAULT_FIXED_PROFIT;
          g2aPrice = (cwsCost + desiredProfit) / (1 - DEFAULT_G2A_FEE_PERCENTAGE);
        }


        // 7. Update the G2A offer with the new price and quantity
        // check if quanity is 0 then deactive the offer
        if (g2aQuantity === 0) {
          await g2aSellerApiClient.deactivateOffer(g2aOfferId);
        } else {
          await g2aSellerApiClient.updateOffer(g2aOfferId, {
            price: g2aPrice,
            quantity: g2aQuantity
          });
        }

      } catch (error) {
        // This catch block handles errors for a SINGLE product, allowing the loop to continue
        logger.error(`Failed to sync product with CWS ID ${product.cwsProductId}. Error: ${error.message}. Moving to next product.`);
      }
    }

  } catch (error) {
    // This catch block handles critical errors for the ENTIRE sync job (e.g., G2A API is down)
    logger.error(`--- CRITICAL ERROR during Product Sync Job: ${error.message} ---`);
  }
  
  logger.info('--- Finished Product Sync Job ---');
}

module.exports = { syncProducts };