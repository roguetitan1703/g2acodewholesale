// src/sync.js
const config = require("./config");
const logger = require("./logger");
const productsToSync = require("./config/products");
const cwsService = require("./services/codeswholesale.service");
const g2aService = require("./services/g2a.service");

// This function will run our API diagnostic check.
const runG2ADiagnostic = async () => {
  logger.info("--- G2A DIAGNOSTIC CHECK ---");
  try {
      const g2aOffersResponse = await g2aService.getOffers();
      if (g2aOffersResponse && g2aOffersResponse.data && g2aOffersResponse.data.length > 0) {
          logger.info(`G2A DIAGNOSTIC: Authentication successful! Fetched ${g2aOffersResponse.data.length} offers. Here are the first 5:`);
          // Log the first 5 offers with their ID and Name
          const offerSummaries = g2aOffersResponse.data.slice(0, 5).map(offer => ({
              offerId: offer.id,
              productName: offer.product.name,
              status: offer.status
          }));
          console.log(JSON.stringify(offerSummaries, null, 2));

          // Now, check if any of the client's provided IDs are in this list
          const clientProvidedIDs = productsToSync.map(p => p.g2aOfferId);
          const foundOffers = g2aOffersResponse.data.filter(offer => clientProvidedIDs.includes(offer.id));
          
          if (foundOffers.length > 0) {
              logger.info(`G2A DIAGNOSTIC: Found ${foundOffers.length} of the configured offers in the G2A account.`);
          } else {
              logger.warn(`G2A DIAGNOSTIC: CRITICAL - None of the Offer IDs from your config file were found in the G2A account. The IDs provided are likely incorrect.`);
          }

      } else {
          logger.warn("G2A DIAGNOSTIC: Authentication may have succeeded, but no offers were returned from the G2A account.");
      }
  } catch (error) {
      logger.error(`G2A DIAGNOSTIC: FAILED - ${error.message}. This confirms an issue with Authentication or API access.`);
  }
  logger.info("--- END G2A DIAGNOSTIC CHECK ---");
}

const runSyncCycle = async () => {
  logger.info("--- Starting New Sync Cycle (Optimized) ---");
  
  // Run the diagnostic first (for now). We can remove this later.
  await runG2ADiagnostic();

  // Loop through each product defined in our config file
  for (const product of productsToSync) {
    try {
      logger.info(`Sync Cycle: Processing CWS Product ID: ${product.cwsProductId}`);
      const cwsProduct = await cwsService.getProductDetails(product.cwsProductId);
      if (!cwsProduct) { /* ... same as before ... */ continue; }
      const totalStock = cwsProduct.quantity;
      if (totalStock === 0 || !cwsProduct.prices || cwsProduct.prices.length === 0) { /* ... same as before ... */ continue; }
      const lowestPrice = Math.min(...cwsProduct.prices.map((p) => p.value));
      const profit = product.profit || config.pricing.defaultProfit;
      const calculatedG2aPrice = (lowestPrice + profit) / (1 - config.pricing.defaultFeePercentage);
      logger.info(`Sync Cycle: ${cwsProduct.name} (CWS: ${lowestPrice.toFixed(2)}, Stock: ${totalStock}) -> G2A Price=${calculatedG2aPrice.toFixed(2)}, Stock=${totalStock}`);
      await g2aService.updateOffer(product.g2aOfferId, calculatedG2aPrice, totalStock);
    } catch (error) {
      logger.error(`Sync Cycle: An error occurred while processing product ${product.cwsProductId}: ${error.message}`);
    }
  }
  logger.info("--- Sync Cycle Finished ---");
};
const startSyncLoop = () => {
  logger.info(
    `Sync Loop: Starting continuous sync. Cycle will run every ${config.syncInterval} minute(s).`
  );
  runSyncCycle(); // Run once immediately
  setInterval(runSyncCycle, config.syncInterval * 60 * 1000);
};

module.exports = { startSyncLoop };
