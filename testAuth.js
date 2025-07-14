// testAuth.js
require('dotenv').config(); // Load environment variables
const cwsApiClient = require('./src/services/cwsApiClient');
const g2aSellerApiClient = require('./src/services/g2aSellerApiClient');
const logger = require('./src/utils/logger'); // Ensure logger is initialized

async function testClients() {
  logger.info('--- Testing CodesWholesale API Client ---');
  try {
    await cwsApiClient.getProduct('c08e582f-edef-4936-86eb-2b1775711557');
    logger.info('CodesWholesale client authenticated successfully and made a test call.');
  } catch (error) {
    logger.error('CodesWholesale client test failed:', error.message);
  }

  logger.info('\n--- Testing G2A Seller API Client ---');
  try {
    // This will trigger token fetching and attempt to get offers
    const offers = await g2aSellerApiClient.getOffers();
    logger.info(`G2A Seller client authenticated successfully and fetched ${offers.length} offers.`);
  } catch (error) {
    logger.error('G2A Seller client test failed:', error.message);
  }
}

testClients();