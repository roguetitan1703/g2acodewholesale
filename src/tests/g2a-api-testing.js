// src/tests/g2a-api-testing.js
const axios = require("axios");
const { URLSearchParams } = require("url");
const config = require("../config");
const logger = require("../logger");

// Test configuration
const G2A_BASE_URL = config.g2a.baseUrl;
const G2A_OAUTH_TOKEN_URL = `${G2A_BASE_URL}/oauth/token`;
const G2A_SALES_V3_PREFIX = `/v3/sales`;

// Token cache for OAuth2
let g2aTokenCache = { accessToken: null, expiresAt: null };

// OAuth2 Import API Client
const getG2AAccessToken = async () => {
  if (g2aTokenCache.accessToken && g2aTokenCache.expiresAt > Date.now()) {
    return g2aTokenCache.accessToken;
  }
  logger.info("G2A Import API: Fetching new access token (OAuth2)...");
  try {
    const requestData = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.g2a.apiKey,
      client_secret: config.g2a.apiSecret,
    });
    const response = await axios.post(G2A_OAUTH_TOKEN_URL, requestData, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const { access_token, expires_in } = response.data;
    g2aTokenCache.accessToken = access_token;
    g2aTokenCache.expiresAt = Date.now() + (expires_in * 1000) - (60 * 1000);
    logger.info(`G2A Import API: Successfully fetched new token. Expires in: ${expires_in}s.`);
    return g2aTokenCache.accessToken;
  } catch (error) {
    const errData = error.response ? error.response.data : error.message;
    logger.error(`G2A Import API: Failed to fetch access token: ${JSON.stringify(errData)}`);
    throw new Error("Could not authenticate with G2A Import API.");
  }
};

const importApiClient = axios.create({ baseURL: G2A_BASE_URL });
importApiClient.interceptors.request.use(async (req) => {
  if (!req.url.includes('/oauth/token')) {
    req.headers.Authorization = `Bearer ${await getG2AAccessToken()}`;
  }
  return req;
});

// Seller API Client - trying different auth methods
const sellerApiClient = axios.create({
  baseURL: G2A_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Add request interceptor for Seller API authentication
sellerApiClient.interceptors.request.use(async (req) => {
  // Try different authentication methods for Seller API
  // Method 1: ApiKey format (most common for seller APIs)
  req.headers.Authorization = `ApiKey ${config.g2a.apiKey}:${config.g2a.apiSecret}`;
  return req;
});

// Test functions
const testImportApiGetOffers = async () => {
  logger.info("=== Testing G2A Import API (OAuth2) - All Offer Types ===");
  
  // Test different offer types and statuses
  const testCases = [
    { name: "All Active Offers", params: { page: 1, itemsPerPage: 50, active: true } },
    { name: "All Inactive Offers", params: { page: 1, itemsPerPage: 50, active: false } },
    { name: "Dropshipping Offers", params: { page: 1, itemsPerPage: 50, type: ['dropshipping'], active: true } },
    { name: "Direct Offers", params: { page: 1, itemsPerPage: 50, type: ['direct'], active: true } },
    { name: "All Offer Types", params: { page: 1, itemsPerPage: 50, type: ['dropshipping', 'direct'], active: true } },
    { name: "No Type Filter", params: { page: 1, itemsPerPage: 50 } },
  ];
  
  let totalOffersFound = 0;
  const allOffers = [];
  
  for (const testCase of testCases) {
    try {
      logger.info(`🔍 Testing: ${testCase.name}...`);
      
      const response = await importApiClient.get(`${G2A_SALES_V3_PREFIX}/offers`, {
        params: testCase.params
      });
      
      const offers = response.data.data || [];
      const totalResults = response.data.meta?.totalResults || 0;
      
      logger.info(`✅ ${testCase.name}: Found ${offers.length} offers (Total available: ${totalResults})`);
      
      if (offers.length > 0) {
        logger.info(`📋 ${testCase.name}: Offer details:`);
        offers.forEach((offer, index) => {
          logger.info(`   ${index + 1}. ID: ${offer.id}, Type: ${offer.type}, Status: ${offer.status}, Product: ${offer.product?.name || 'N/A'}`);
        });
        
        // Add to total count and all offers array
        totalOffersFound += offers.length;
        allOffers.push(...offers);
      }
      
    } catch (error) {
      logger.error(`❌ ${testCase.name}: Failed - ${error.response?.status || 'Network Error'}`);
      if (error.response) {
        logger.error(`📄 ${testCase.name}: ${JSON.stringify(error.response.data)}`);
      }
    }
  }
  
  // Summary of all offers found
  logger.info("\n" + "=".repeat(60));
  logger.info("📊 COMPREHENSIVE OFFER SUMMARY");
  logger.info("=".repeat(60));
  logger.info(`Total unique offers found: ${totalOffersFound}`);
  
  if (allOffers.length > 0) {
    // Group offers by type
    const offersByType = {};
    const offersByStatus = {};
    
    allOffers.forEach(offer => {
      // Group by type
      const type = offer.type || 'unknown';
      offersByType[type] = (offersByType[type] || 0) + 1;
      
      // Group by status
      const status = offer.status || 'unknown';
      offersByStatus[status] = (offersByStatus[status] || 0) + 1;
    });
    
    logger.info("\n📈 Offers by Type:");
    Object.entries(offersByType).forEach(([type, count]) => {
      logger.info(`   ${type}: ${count} offers`);
    });
    
    logger.info("\n📈 Offers by Status:");
    Object.entries(offersByStatus).forEach(([status, count]) => {
      logger.info(`   ${status}: ${count} offers`);
    });
    
    // Show detailed info for first few offers
    logger.info("\n📋 Detailed Offer Information (First 3 offers):");
    allOffers.slice(0, 3).forEach((offer, index) => {
      logger.info(`\n   Offer ${index + 1}:`);
      console.log(JSON.stringify(offer, null, 2));
    });
  } else {
    logger.info("❌ No offers found in any category. This could mean:");
    logger.info("   - No offers have been created yet");
    logger.info("   - Offers exist but are filtered out");
    logger.info("   - Different API endpoints are needed");
  }
  
  return { totalOffersFound, allOffers };
};

const testSellerApiGetOffers = async () => {
  logger.info("=== Testing G2A Seller API (Multiple Auth Methods) ===");
  
  // Test different authentication methods
  const authMethods = [
    { name: "ApiKey", header: `ApiKey ${config.g2a.apiKey}:${config.g2a.apiSecret}` },
    { name: "Bearer (same token)", header: `Bearer ${g2aTokenCache.accessToken}` },
    { name: "Basic Auth", header: `Basic ${Buffer.from(`${config.g2a.apiKey}:${config.g2a.apiSecret}`).toString('base64')}` },
  ];
  
  for (const method of authMethods) {
    try {
      logger.info(`🔐 Trying ${method.name} authentication...`);
      
      const response = await axios.get(`${G2A_BASE_URL}${G2A_SALES_V3_PREFIX}/offers`, {
        headers: {
          "Content-Type": "application/json",
          "Authorization": method.header,
        },
        params: { page: 1, itemsPerPage: 10, type: ['dropshipping'], active: true }
      });
      
      logger.info(`✅ Seller API (${method.name}): Successfully fetched ${response.data.data?.length || 0} offers`);
      logger.info(`📊 Seller API (${method.name}): Total offers: ${response.data.meta?.totalResults || 0}`);
      
      if (response.data.data && response.data.data.length > 0) {
        logger.info(`📋 Seller API (${method.name}): First offer details:`);
        console.log(JSON.stringify(response.data.data[0], null, 2));
      }
      
      return response.data;
    } catch (error) {
      logger.error(`❌ Seller API (${method.name}): Failed - ${error.response?.status || 'Network Error'}`);
      if (error.response) {
        logger.error(`📄 Seller API (${method.name}): ${JSON.stringify(error.response.data)}`);
      }
    }
  }
  
  throw new Error("All Seller API authentication methods failed");
};

const validateConfigOfferIds = async (allOffers) => {
  logger.info("=== Validating Config G2A Offer IDs ===");
  
  const productsConfig = require("../config/products");
  const configOfferIds = productsConfig.map(p => p.g2aOfferId);
  
  logger.info(`🔍 Checking ${configOfferIds.length} configured G2A offer IDs against ${allOffers.length} actual offers...`);
  
  const validationResults = [];
  
  for (const configProduct of productsConfig) {
    const { cwsProductId, g2aOfferId } = configProduct;
    
    // Try to find this offer ID in the actual offers
    const foundOffer = allOffers.find(offer => offer.id === g2aOfferId);
    
    if (foundOffer) {
      logger.info(`✅ FOUND: ${g2aOfferId} -> ${foundOffer.product.name}`);
      logger.info(`   📊 Price: ${foundOffer.price}, Business Price: ${foundOffer.businessPrice}`);
      logger.info(`   📦 Inventory: ${foundOffer.inventory.size} total, ${foundOffer.inventory.sold} sold`);
      logger.info(`   🎮 Product ID: ${foundOffer.product.id}`);
      
      validationResults.push({
        cwsProductId,
        g2aOfferId,
        found: true,
        offer: foundOffer,
        matchType: 'exact_id'
      });
    } else {
      // Try to find by product ID instead
      const foundByProductId = allOffers.find(offer => offer.product.id === g2aOfferId);
      
      if (foundByProductId) {
        logger.info(`✅ FOUND BY PRODUCT ID: ${g2aOfferId} -> ${foundByProductId.product.name} (Offer ID: ${foundByProductId.id})`);
        logger.info(`   📊 Price: ${foundByProductId.price}, Business Price: ${foundByProductId.businessPrice}`);
        logger.info(`   📦 Inventory: ${foundByProductId.inventory.size} total, ${foundByProductId.inventory.sold} sold`);
        
        validationResults.push({
          cwsProductId,
          g2aOfferId,
          found: true,
          offer: foundByProductId,
          matchType: 'product_id',
          actualOfferId: foundByProductId.id
        });
      } else {
        logger.warn(`❌ NOT FOUND: ${g2aOfferId} - No matching offer or product ID found`);
        
        validationResults.push({
          cwsProductId,
          g2aOfferId,
          found: false,
          matchType: 'not_found'
        });
      }
    }
  }
  
  // Summary
  logger.info("\n" + "=".repeat(60));
  logger.info("📋 CONFIG VALIDATION SUMMARY");
  logger.info("=".repeat(60));
  
  const foundCount = validationResults.filter(r => r.found).length;
  const notFoundCount = validationResults.filter(r => !r.found).length;
  const exactMatches = validationResults.filter(r => r.matchType === 'exact_id').length;
  const productIdMatches = validationResults.filter(r => r.matchType === 'product_id').length;
  
  logger.info(`✅ Found: ${foundCount}/${configOfferIds.length} offers`);
  logger.info(`❌ Not Found: ${notFoundCount}/${configOfferIds.length} offers`);
  logger.info(`🎯 Exact ID matches: ${exactMatches}`);
  logger.info(`🆔 Product ID matches: ${productIdMatches}`);
  
  if (productIdMatches > 0) {
    logger.info("\n⚠️  IMPORTANT: Some offers were found by Product ID, not Offer ID!");
    logger.info("   This means your config uses Product IDs instead of Offer IDs.");
    logger.info("   You may need to update your config or sync logic.");
  }
  
  // Show recommendations
  logger.info("\n💡 RECOMMENDATIONS:");
  if (foundCount === configOfferIds.length) {
    logger.info("   ✅ All configured offers found! Your sync should work perfectly.");
  } else if (foundCount > 0) {
    logger.info("   ⚠️  Some offers found, some missing. Check the missing ones.");
  } else {
    logger.info("   ❌ No configured offers found. Check your G2A offer IDs.");
  }
  
  return validationResults;
};

const testOAuth2TokenEndpoint = async () => {
  logger.info("=== Testing G2A OAuth2 Token Endpoint ===");
  try {
    const requestData = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.g2a.apiKey,
      client_secret: config.g2a.apiSecret,
    });
    
    const response = await axios.post(G2A_OAUTH_TOKEN_URL, requestData, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    
    logger.info("✅ OAuth2 Token: Successfully obtained token");
    logger.info(`📊 OAuth2 Token: Expires in: ${response.data.expires_in}s`);
    logger.info(`🔑 OAuth2 Token: Token type: ${response.data.token_type}`);
    
    return response.data;
  } catch (error) {
    logger.error(`❌ OAuth2 Token: Failed to obtain token: ${error.message}`);
    if (error.response) {
      logger.error(`📄 OAuth2 Token: Response status: ${error.response.status}`);
      logger.error(`📄 OAuth2 Token: Response data: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
};

const runAllTests = async () => {
  logger.info("🚀 Starting G2A API Testing Suite");
  logger.info(`🔧 Using credentials: ${config.g2a.apiKey.substring(0, 8)}...`);
  logger.info(`🌐 Base URL: ${G2A_BASE_URL}`);
  
  const results = {
    oauth2Token: null,
    importApi: null,
    sellerApi: null,
  };
  
  try {
    // Test 1: OAuth2 Token endpoint
    logger.info("\n" + "=".repeat(50));
    results.oauth2Token = await testOAuth2TokenEndpoint();
  } catch (error) {
    logger.error("OAuth2 Token test failed");
  }
  
  try {
    // Test 2: Import API (OAuth2)
    logger.info("\n" + "=".repeat(50));
    results.importApi = await testImportApiGetOffers();
    
    // Test 2.5: Validate config offer IDs
    if (results.importApi && results.importApi.allOffers) {
      logger.info("\n" + "=".repeat(50));
      results.configValidation = await validateConfigOfferIds(results.importApi.allOffers);
    }
  } catch (error) {
    logger.error("Import API test failed");
  }
  
  try {
    // Test 3: Seller API (ApiKey)
    logger.info("\n" + "=".repeat(50));
    results.sellerApi = await testSellerApiGetOffers();
  } catch (error) {
    logger.error("Seller API test failed");
  }
  
  // Summary
  logger.info("\n" + "=".repeat(50));
  logger.info("📋 TEST SUMMARY");
  logger.info("=".repeat(50));
  logger.info(`OAuth2 Token: ${results.oauth2Token ? '✅ PASS' : '❌ FAIL'}`);
  logger.info(`Import API: ${results.importApi ? '✅ PASS' : '❌ FAIL'}`);
  logger.info(`Seller API: ${results.sellerApi ? '✅ PASS' : '❌ FAIL'}`);
  
  if (results.oauth2Token && results.importApi) {
    logger.info("\n🎉 OAuth2 credentials are working for Import API!");
  } else if (results.sellerApi) {
    logger.info("\n⚠️  Only Seller API (ApiKey) is working. You need OAuth2 credentials for Import API.");
  } else {
    logger.info("\n❌ No APIs are working. Check your credentials and network connection.");
  }
  
  return results;
};

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests()
    .then(() => {
      logger.info("🏁 Testing completed");
      process.exit(0);
    })
    .catch((error) => {
      logger.error(`💥 Testing failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = {
  testImportApiGetOffers,
  testSellerApiGetOffers,
  testOAuth2TokenEndpoint,
  runAllTests,
}; 