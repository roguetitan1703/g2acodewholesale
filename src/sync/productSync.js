// src/sync/productSync.js
const cwsApiClient = require('../services/cwsApiClient');
const g2aSellerApiClient = require('../services/g2aSellerApiClient');
const productsToSync = require('../config/product');
const logger = require('../utils/logger');
// const fs = require('fs');
// const path = require('path');

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
    const cwsIdsNeeded = productsToSync.map(p => p.cwsProductId);
    const cwsProductsArr = await cwsApiClient.getProductsBatch(cwsIdsNeeded);
    // 2. Loop through each product defined in our configuration file
    for (const product of productsToSync) {
      try {
        const { cwsProductId, g2aProductId, profit } = product;
        // 3. Find the corresponding G2A offer ID using the G2A product ID
        const g2aOfferId = g2aProductToOfferMap.get(g2aProductId);
        if (!g2aOfferId) {
          logger.warn(`Product with G2A ID ${product.g2aProductId} is configured but has no active offer on G2A. Skipping.`);
          continue;
        }

        // 4. Fetch live data from CodesWholesale
        const cwsProduct = cwsProductsArr.get(cwsProductId);

        if (!cwsProduct || cwsProduct.quantity === 0) {
          logger.info(`CWS ${cwsProductId} out of stock; deactivating G2A ${g2aOfferId}`);
          await g2aSellerApiClient.deactivateOffer(g2aOfferId);
          continue;
        }

        /* ---------- In stock ⇒ compute price & update ---------- */
        const g2aQuantity = cwsProduct.quantity;
        const cwsCost = cwsProduct.prices?.[0]?.value ?? 0;
        const desiredProfit = profit ?? DEFAULT_FIXED_PROFIT;

        const g2aPrice = (cwsCost + desiredProfit) / (1 - DEFAULT_G2A_FEE_PERCENTAGE);

        await g2aSellerApiClient.updateOffer(g2aOfferId, {
          price: g2aPrice,
          quantity: g2aQuantity,
        });

      } catch (error) {
        // This catch block handles errors for a SINGLE product, allowing the loop to continue
        logger.error(`Failed to sync product with CWS ID ${product.cwsProductId}. Error: ${error.message}. Moving to next product.`);
      }
    }
    // Update each product with the current G2A offer ID
    // const updatedProducts = productsToSync.map(product => {
    //   const updatedOfferId = g2aProductToOfferMap.get(product.g2aProductId);
    //   return {
    //     ...product,
    //     g2aOfferId: updatedOfferId || product.g2aOfferId, // fallback to existing if not found
    //   };
    // });

    // // Save updated array back to product.json
    // const configPath = path.join(__dirname, '../config/product.json');

    // fs.writeFileSync(configPath, JSON.stringify(updatedProducts, null, 2));
    // logger.info('Updated product.json with latest G2A offer IDs.');

  } catch (error) {
    // This catch block handles critical errors for the ENTIRE sync job (e.g., G2A API is down)
    logger.error(`--- CRITICAL ERROR during Product Sync Job: ${error.message} ---`);
  }

  logger.info('--- Finished Product Sync Job ---');
}

module.exports = { syncProducts };