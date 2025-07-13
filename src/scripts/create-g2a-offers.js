// src/scripts/create-g2a-offers.js
const config = require("../config");
const logger = require("../logger");
const productsToSync = require("../config/products");
const cwsService = require("../services/codeswholesale.service");
const g2aService = require("../services/g2a.service");

const createOffersForProducts = async () => {
  logger.info("🚀 Starting G2A Offer Creation Process");
  logger.info(`📋 Creating offers for ${productsToSync.length} products`);
  
  const results = [];
  
  for (const product of productsToSync) {
    try {
      logger.info(`\n--- Processing: ${product.cwsProductId} ---`);
      
      // Step 1: Get CWS product details
      logger.info(`📦 Fetching CWS product details...`);
      const cwsProduct = await cwsService.getProductDetails(product.cwsProductId);
      
      if (!cwsProduct) {
        logger.error(`❌ CWS product not found: ${product.cwsProductId}`);
        results.push({
          cwsProductId: product.cwsProductId,
          g2aProductId: product.g2aOfferId,
          status: 'failed',
          error: 'CWS product not found'
        });
        continue;
      }
      
      logger.info(`✅ CWS Product: ${cwsProduct.name}`);
      logger.info(`💰 CWS Price: ${cwsProduct.prices?.[0]?.value || 'N/A'}`);
      logger.info(`📦 CWS Stock: ${cwsProduct.quantity || 0}`);
      
      // Step 2: Calculate G2A price
      const lowestPrice = Math.min(...cwsProduct.prices.map((p) => p.value));
      const profit = product.profit || config.pricing.defaultProfit;
      const denominator = 1 - config.pricing.defaultFeePercentage;
      
      if (denominator <= 0) {
        logger.error(`❌ Invalid fee percentage: ${config.pricing.defaultFeePercentage}`);
        results.push({
          cwsProductId: product.cwsProductId,
          g2aProductId: product.g2aOfferId,
          status: 'failed',
          error: 'Invalid fee percentage'
        });
        continue;
      }
      
      const calculatedG2aPrice = (lowestPrice + profit) / denominator;
      const totalStock = cwsProduct.quantity;
      
      logger.info(`🎯 Calculated G2A Price: ${calculatedG2aPrice.toFixed(2)}`);
      logger.info(`📦 G2A Stock: ${totalStock}`);
      
      // Step 3: Create G2A offer
      logger.info(`🛠️ Creating G2A offer for product ${product.g2aOfferId}...`);
      
      // Try both formats: with and without "i" prefix
      let g2aOffer = null;
      let productIdToUse = product.g2aOfferId;
      
      // First try: Remove "i" prefix if it exists
      if (product.g2aOfferId.startsWith('i')) {
        productIdToUse = product.g2aOfferId.substring(1);
        logger.info(`🔄 Trying product ID without "i" prefix: ${productIdToUse}`);
      }
      
      try {
        g2aOffer = await g2aService.createOffer(
          productIdToUse, // Use the cleaned product ID
          calculatedG2aPrice,
          totalStock
        );
      } catch (error) {
        // If first attempt fails, try with original ID
        if (productIdToUse !== product.g2aOfferId) {
          logger.info(`🔄 First attempt failed, trying original product ID: ${product.g2aOfferId}`);
          g2aOffer = await g2aService.createOffer(
            product.g2aOfferId, // Try original ID
            calculatedG2aPrice,
            totalStock
          );
        } else {
          throw error; // Re-throw if we already tried both
        }
      }
      
      logger.info(`✅ G2A Offer Created Successfully!`);
      logger.info(`🆔 Offer ID: ${g2aOffer.id}`);
      logger.info(`💰 Price: ${g2aOffer.price}`);
      logger.info(`📦 Quantity: ${g2aOffer.quantity || g2aOffer.inventory?.size}`);
      logger.info(`📊 Status: ${g2aOffer.status}`);
      
      results.push({
        cwsProductId: product.cwsProductId,
        cwsProductName: cwsProduct.name,
        g2aProductId: product.g2aOfferId,
        g2aOfferId: g2aOffer.id,
        g2aPrice: calculatedG2aPrice,
        g2aStock: totalStock,
        status: 'success',
        offer: g2aOffer
      });
      
    } catch (error) {
      logger.error(`❌ Failed to create offer for ${product.cwsProductId}: ${error.message}`);
      results.push({
        cwsProductId: product.cwsProductId,
        g2aProductId: product.g2aOfferId,
        status: 'failed',
        error: error.message
      });
    }
  }
  
  // Summary
  logger.info("\n" + "=".repeat(60));
  logger.info("📊 OFFER CREATION SUMMARY");
  logger.info("=".repeat(60));
  
  const successCount = results.filter(r => r.status === 'success').length;
  const failCount = results.filter(r => r.status === 'failed').length;
  
  logger.info(`✅ Successful: ${successCount}/${productsToSync.length}`);
  logger.info(`❌ Failed: ${failCount}/${productsToSync.length}`);
  
  if (successCount > 0) {
    logger.info("\n🎉 Successfully Created Offers:");
    results.filter(r => r.status === 'success').forEach(result => {
      logger.info(`   ${result.cwsProductName} → Offer ID: ${result.g2aOfferId} (Price: ${result.g2aPrice})`);
    });
  }
  
  if (failCount > 0) {
    logger.info("\n❌ Failed Offers:");
    results.filter(r => r.status === 'failed').forEach(result => {
      logger.info(`   ${result.cwsProductId} → ${result.error}`);
    });
  }
  
  // Update config recommendation
  if (successCount > 0) {
    logger.info("\n💡 NEXT STEPS:");
    logger.info("1. Update your src/config/products.js with the new offer IDs:");
    logger.info("   Replace g2aOfferId with the actual offer IDs shown above");
    logger.info("2. Test the sync process with the new offer IDs");
    logger.info("3. Monitor the offers to ensure they're working correctly");
  }
  
  return results;
};

// Run if this file is executed directly
if (require.main === module) {
  createOffersForProducts()
    .then(() => {
      logger.info("🏁 Offer creation process completed");
      process.exit(0);
    })
    .catch((error) => {
      logger.error(`💥 Offer creation failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { createOffersForProducts }; 