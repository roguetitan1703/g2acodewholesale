// src/scripts/manage-g2a-offers.js
const { createOffer, getJobStatus } = require("../services/g2a.service");
const cwsService = require("../services/codeswholesale.service");
const productsToSync = require("../config/products");
const config = require("../config");
const logger = require("../logger");

// Store job IDs from offer creation
let pendingJobIds = [];

const createOffersForProducts = async () => {
  logger.info("=== Creating G2A Offers for Configured Products ===");
  
  for (const product of productsToSync) {
    try {
      logger.info(`\n--- Processing Product: ${product.cwsProductId} ---`);
      
      // Get CWS product details
      const cwsProduct = await cwsService.getProductDetails(product.cwsProductId);
      if (!cwsProduct) {
        logger.warn(`Skipping ${product.cwsProductId}: Could not fetch CWS product details`);
        continue;
      }
      
      if (cwsProduct.quantity === 0) {
        logger.warn(`Skipping ${product.cwsProductId}: No stock available`);
        continue;
      }
      
      if (!cwsProduct.prices || cwsProduct.prices.length === 0) {
        logger.warn(`Skipping ${product.cwsProductId}: No pricing information`);
        continue;
      }
      
      // Calculate G2A price
      const lowestPrice = Math.min(...cwsProduct.prices.map(p => p.value));
      const profit = product.profit || config.pricing.defaultProfit;
      const calculatedG2aPrice = (lowestPrice + profit) / (1 - config.pricing.defaultFeePercentage);
      
      logger.info(`Product: ${cwsProduct.name}`);
      logger.info(`CWS Price: ${lowestPrice.toFixed(2)}, Stock: ${cwsProduct.quantity}`);
      logger.info(`Calculated G2A Price: ${calculatedG2aPrice.toFixed(2)}`);
      
      // Try both product ID formats
      const productIdFormats = [
        product.cwsProductId, // Original format
        product.cwsProductId.replace(/^i/, '') // Without 'i' prefix
      ];
      
      let offerCreated = false;
      
      for (const productIdFormat of productIdFormats) {
        try {
          logger.info(`Attempting to create offer with Product ID: ${productIdFormat}`);
          
          const result = await createOffer(productIdFormat, calculatedG2aPrice, cwsProduct.quantity);
          
          if (result.jobId) {
            logger.info(`✅ Offer creation job submitted successfully!`);
            logger.info(`Job ID: ${result.jobId}`);
            logger.info(`Status: ${result.status}`);
            
            pendingJobIds.push({
              jobId: result.jobId,
              productId: product.cwsProductId,
              productName: cwsProduct.name,
              price: calculatedG2aPrice,
              quantity: cwsProduct.quantity
            });
            
            offerCreated = true;
            break; // Success, no need to try other format
          }
        } catch (error) {
          logger.warn(`Failed to create offer with Product ID ${productIdFormat}: ${error.message}`);
          // Continue to try the other format
        }
      }
      
      if (!offerCreated) {
        logger.error(`❌ Failed to create offer for product ${product.cwsProductId} with any product ID format`);
      }
      
    } catch (error) {
      logger.error(`Error processing product ${product.cwsProductId}: ${error.message}`);
    }
  }
  
  logger.info(`\n=== Offer Creation Complete ===`);
  logger.info(`Total jobs submitted: ${pendingJobIds.length}`);
  
  if (pendingJobIds.length > 0) {
    console.log("\n📋 Job IDs for status checking:");
    pendingJobIds.forEach((job, index) => {
      console.log(`${index + 1}. Job ID: ${job.jobId}`);
      console.log(`   Product: ${job.productName} (${job.productId})`);
      console.log(`   Price: ${job.price.toFixed(2)}, Quantity: ${job.quantity}`);
    });
  }
};

const checkAllJobStatuses = async () => {
  logger.info("=== Checking All Job Statuses ===");
  
  if (pendingJobIds.length === 0) {
    logger.warn("No pending jobs to check. Run offer creation first.");
    return;
  }
  
  const results = {
    completed: [],
    failed: [],
    pending: []
  };
  
  for (const jobInfo of pendingJobIds) {
    try {
      logger.info(`\n--- Checking Job: ${jobInfo.jobId} ---`);
      const result = await getJobStatus(jobInfo.jobId);
      
      const jobData = {
        ...jobInfo,
        status: result.data.status,
        elements: result.data.elements || []
      };
      
      if (result.data.status === "complete") {
        const successfulOffers = result.data.elements.filter(
          element => element.status === "complete" && element.resourceType === "offer" && !element.code
        );
        
        const failedOffers = result.data.elements.filter(
          element => element.status === "complete" && element.resourceType === "offer" && element.code
        );
        
        if (successfulOffers.length > 0) {
          jobData.offerIds = successfulOffers.map(offer => offer.resourceId);
          results.completed.push(jobData);
        }
        
        if (failedOffers.length > 0) {
          jobData.errors = failedOffers.map(offer => ({
            code: offer.code,
            message: offer.message
          }));
          results.failed.push(jobData);
        }
      } else {
        results.pending.push(jobData);
      }
      
    } catch (error) {
      logger.error(`Failed to check job ${jobInfo.jobId}: ${error.message}`);
      results.failed.push({
        ...jobInfo,
        error: error.message
      });
    }
  }
  
  // Display results
  console.log("\n=== Job Status Summary ===");
  
  if (results.completed.length > 0) {
    console.log(`\n✅ Completed Jobs (${results.completed.length}):`);
    results.completed.forEach(job => {
      console.log(`  - ${job.productName} (${job.productId})`);
      console.log(`    Job ID: ${job.jobId}`);
      console.log(`    Offer IDs: ${job.offerIds.join(', ')}`);
    });
  }
  
  if (results.failed.length > 0) {
    console.log(`\n❌ Failed Jobs (${results.failed.length}):`);
    results.failed.forEach(job => {
      console.log(`  - ${job.productName} (${job.productId})`);
      console.log(`    Job ID: ${job.jobId}`);
      if (job.errors) {
        job.errors.forEach(error => {
          console.log(`    Error: ${error.code} - ${error.message}`);
        });
      }
      if (job.error) {
        console.log(`    Error: ${job.error}`);
      }
    });
  }
  
  if (results.pending.length > 0) {
    console.log(`\n⏳ Pending Jobs (${results.pending.length}):`);
    results.pending.forEach(job => {
      console.log(`  - ${job.productName} (${job.productId})`);
      console.log(`    Job ID: ${job.jobId}`);
      console.log(`    Status: ${job.status}`);
    });
  }
  
  return results;
};

const checkSpecificJob = async (jobId) => {
  logger.info(`=== Checking Specific Job: ${jobId} ===`);
  
  try {
    const result = await getJobStatus(jobId);
    
    console.log(`\nJob Status: ${result.data.status}`);
    
    if (result.data.elements && result.data.elements.length > 0) {
      console.log("\nElements:");
      result.data.elements.forEach((element, index) => {
        console.log(`  ${index + 1}. ${element.resourceType}: ${element.resourceId}`);
        console.log(`     Status: ${element.status}`);
        if (element.code) {
          console.log(`     Code: ${element.code}`);
        }
        if (element.message) {
          console.log(`     Message: ${element.message}`);
        }
        console.log("");
      });
    }
    
    return result;
  } catch (error) {
    logger.error(`Failed to check job ${jobId}: ${error.message}`);
    throw error;
  }
};

// Main execution function
const main = async () => {
  const args = process.argv.slice(2);
  const command = args[0];
  
  switch (command) {
    case 'create':
      await createOffersForProducts();
      break;
      
    case 'check':
      await checkAllJobStatuses();
      break;
      
    case 'check-specific':
      const jobId = args[1];
      if (!jobId) {
        console.error("Usage: node manage-g2a-offers.js check-specific <jobId>");
        process.exit(1);
      }
      await checkSpecificJob(jobId);
      break;
      
    case 'create-and-check':
      await createOffersForProducts();
      console.log("\nWaiting 30 seconds before checking job statuses...");
      setTimeout(async () => {
        await checkAllJobStatuses();
      }, 30000);
      break;
      
    default:
      console.log("G2A Offer Management Script");
      console.log("\nUsage:");
      console.log("  node manage-g2a-offers.js create              - Create offers for all configured products");
      console.log("  node manage-g2a-offers.js check               - Check status of all pending jobs");
      console.log("  node manage-g2a-offers.js check-specific <id> - Check status of a specific job");
      console.log("  node manage-g2a-offers.js create-and-check    - Create offers then check status after 30s");
      break;
  }
};

// Run the script
if (require.main === module) {
  main().catch(error => {
    logger.error(`Script failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { createOffersForProducts, checkAllJobStatuses, checkSpecificJob }; 