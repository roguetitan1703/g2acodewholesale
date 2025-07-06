// src/sync.js
const config = require("./config");
const logger = require("./logger");
const productsToSync = require("./config/products");
const cwsService = require("./services/codeswholesale.service");
const g2aService = require("./services/g2a.service");

const runSyncCycle = async () => {
  logger.info("--- Starting New Sync Cycle ---");
  try {
    const cwsProductList = await cwsService.getProducts();

    for (const product of productsToSync) {
      const cwsProduct = cwsProductList.items.find(
        (p) => p.id === product.cwsProductId
      );

      if (!cwsProduct) {
        logger.warn(
          `Product ${product.cwsProductId} from config not found in CWS price list. Skipping.`
        );
        continue;
      }

      const availableStock = cwsProduct.prices.filter((p) => p.quantity > 0);
      const totalStock = availableStock.reduce((sum, p) => sum + p.quantity, 0);

      if (totalStock === 0) {
        logger.info(
          `Product ${cwsProduct.name} is out of stock. Setting G2A quantity to 0.`
        );
        await g2aService.updateOffer(product.g2aOfferId, null, 0);
        continue;
      }

      const lowestPrice = Math.min(...availableStock.map((p) => p.price));
      const profit = product.profit || config.pricing.defaultProfit;
      const calculatedG2aPrice =
        (lowestPrice + profit) / (1 - config.pricing.defaultFeePercentage);

      logger.info(
        `Syncing ${cwsProduct.name}: G2A Price=${calculatedG2aPrice.toFixed(
          2
        )}, Stock=${totalStock}`
      );
      await g2aService.updateOffer(
        product.g2aOfferId,
        calculatedG2aPrice,
        totalStock
      );
    }
  } catch (error) {
    logger.error(`An error occurred during sync cycle: ${error.message}`);
  }
  logger.info("--- Sync Cycle Finished ---");
};

const startSyncLoop = () => {
  logger.info(
    `Starting continuous sync. Cycle will run every ${config.syncInterval} minute(s).`
  );
  runSyncCycle(); // Run once immediately
  setInterval(runSyncCycle, config.syncInterval * 60 * 1000);
};

module.exports = { startSyncLoop };
