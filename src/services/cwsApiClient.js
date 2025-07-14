// src/services/cwsApiClient.js
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

// --- Simulation Mode Setup ---
const CWS_SIMULATION_MODE = process.env.CWS_SIMULATION_MODE === 'true';
if (CWS_SIMULATION_MODE) {
  logger.warn('--- CWS SIMULATION MODE IS ENABLED ---');
  logger.warn('No real orders will be placed on CodesWholesale. Mock data will be used for placeOrder and getOrder.');
}
// ----------------------------

// Load credentials from environment variables
const {
  CWS_CLIENT_ID,
  CWS_CLIENT_SECRET,
  CWS_CLIENT_SIGNATURE,
  CWS_API_BASE_URL,
  CWS_OAUTH_TOKEN_URL,
} = process.env;

let accessToken = null;
let tokenExpiry = 0; // Unix timestamp for when the token expires
let tokenRefreshPromise = null;

// Create an Axios instance with base configuration for CWS
const cwsApi = axios.create({
  baseURL: CWS_API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor to automatically attach the Bearer token and handle token refresh
cwsApi.interceptors.request.use(async (config) => {
  if (!accessToken || Date.now() >= tokenExpiry) {
    if (!tokenRefreshPromise) {
      logger.info('CWS access token is expired or missing. Fetching a new one.');
      tokenRefreshPromise = getCwsAccessToken();
    }
    await tokenRefreshPromise;
    tokenRefreshPromise = null;
  }
  config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
}, (error) => {
  return Promise.reject(error);
});

// Fetches a new OAuth2 access token from CodesWholesale
async function getCwsAccessToken() {
  try {
    const response = await axios.post(
      CWS_OAUTH_TOKEN_URL,
      new URLSearchParams({
        'grant_type': 'client_credentials',
        'client_id': CWS_CLIENT_ID,
        'client_secret': CWS_CLIENT_SECRET,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    accessToken = response.data.access_token;
    tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000; // Subtract 60 seconds for buffer
    logger.info('Successfully fetched new CWS access token.');
  } catch (error) {
    logger.error('CRITICAL: Failed to get CWS access token. Check credentials.', {
      message: error.message,
      data: error.response?.data
    });
    throw new Error('CWS authentication failed. The service cannot proceed.');
  }
}

// --- Internal Store for Simulated Order States ---
const simulatedOrderStates = new Map(); // Key: orderId, Value: { status: string, key: string|null, pollCount: number }

// --- Utility for Generating Mock Product Data (for simulation, if needed) ---
// This is a simple mock database, adjust as needed for comprehensive simulation testing
const mockProducts = new Map();
// Load your example products from config only once if needed for mock data
// Using require here for simplicity, typically you might pass this as a dependency if complex
const exampleConfigProducts = require('../config/products'); 

exampleConfigProducts.forEach(prod => {
  mockProducts.set(prod.cwsProductId, {
    productId: prod.cwsProductId,
    name: `Mock ${prod.cwsProductId.substring(0, 8)}`,
    quantity: 50, // Always available in simulation
    prices: [{ value: 10.00 }], // Fixed price for simulation
    cwsCost: 10.00
  });
});

const requiredEnvVars = [
  'CWS_CLIENT_ID',
  'CWS_CLIENT_SECRET',
  'CWS_API_BASE_URL',
  'CWS_OAUTH_TOKEN_URL',
  'G2A_API_KEY',
  'G2A_API_SECRET',
  'G2A_API_BASE_URL',
  'G2A_OAUTH_TOKEN_URL',
];
const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
if (missingVars.length > 0) {
  console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

const cwsApiClient = {
  /**
   * Fetches details for multiple products in a single batch request.
   * This is the PREFERRED method for the sync job.
   * @param {string[]} productIds - An array of CWS Product ID strings.
   * @returns {Promise<Map<string, object>>} A promise that resolves to a Map where the key is the productId and the value is the product data object.
   */
  async getProductsBatch(productIds) {
    // --- SIMULATION GUARD ---
    if (CWS_SIMULATION_MODE) {
      logger.info(`[SIMULATION] getProductsBatch called for ${productIds.length} products.`);
      const productMap = new Map();
      productIds.forEach(id => {
        const mockProduct = mockProducts.get(id);
        if (mockProduct) {
          productMap.set(id, mockProduct);
        } else {
          // If a product from config is not in mockProducts, simulate it as not found/out of stock.
          productMap.set(id, { productId: id, quantity: 0, prices: [], cwsCost: 0 }); 
        }
      });
      return productMap;
    }
    // --- END SIMULATION GUARD ---

    if (!productIds || productIds.length === 0) return new Map();
    const productIdsString = productIds.join(',');
    try {
      const response = await cwsApi.get('/v3/products', { params: { productIds: productIdsString } });
      logger.info(`Successfully fetched batch of ${response.data.items.length} CWS products.`);
      const productMap = new Map();
      for (const product of response.data.items) {
        if (!product.prices || product.prices.length === 0) {
          logger.error(`CWS Product ${product.productId} in batch has no price entries.`);
          continue;
        }
        product.cwsCost = product.prices[0].value;
        productMap.set(product.productId, product);
      }
      return productMap;
    } catch (error) {
      logger.error(`Error fetching CWS products batch:`, { message: error.message, data: error.response?.data });
      throw error;
    }
  },
  
  /**
   * Fetches a single product's details from CWS.
   * This is kept for individual lookups (like in the reservation/order flow).
   */
  async getProduct(productId) {
    // --- SIMULATION GUARD ---
    if (CWS_SIMULATION_MODE) {
        logger.info(`[SIMULATION] getProduct called for ID: ${productId}.`);
        return mockProducts.get(productId) || null; // Return null if not found in mock db
    }
    // --- END SIMULATION GUARD ---

    try {
      const response = await cwsApi.get(`/v3/products/${productId}`);
      const productData = response.data;
      if (!productData || !productData.prices || productData.prices.length === 0) {
        logger.error(`CWS Product ${productId} missing required fields or has no price entries.`);
        return null;
      }
      productData.cwsCost = productData.prices[0].value;
      return productData;
    } catch (error) {
      if (error.response?.status === 404) return null;
      logger.error(`Error fetching CWS product ${productId}:`, { message: error.message, data: error.response?.data });
      throw error;
    }
  },

  /**
   * Places an order on CodesWholesale.
   * @param {Array<{productId: string, maxPrice: number, quantity: number}>} items - Array of products to order.
   * @param {string} clientOrderId - Optional. A unique order identifier from the client's side (e.g., G2A Order ID).
   *                                 Used for the 'orderId' field in CWS request body.
   */
  async placeOrder(items, clientOrderId = uuidv4()) { // Added clientOrderId parameter
    const requestBody = {
      allowPreOrder: true, // As per CWS docs, allow pre-orders for dropshipping
      orderId: clientOrderId, // Use G2A order ID as CWS clientOrderId
      products: items.map(item => ({ // Map to the structure CWS expects
        productId: item.productId,
        price: item.maxPrice, // This maps to the 'price' field in CWS docs
        quantity: item.quantity
      }))
    };

    // --- SIMULATION GUARD ---
    if (CWS_SIMULATION_MODE) {
      const mockCwsOrderId = uuidv4();
      logger.info(`[SIMULATION] Placing mock CWS order for: ${items.map(i => i.productId).join(', ')}. Mock Order ID: ${mockCwsOrderId}`);
      
      // Store initial state for polling simulation
      simulatedOrderStates.set(mockCwsOrderId, {
        status: 'FULFILLING', // CWS often returns FULFILLING initially
        key: `MOCK-KEY-${mockCwsOrderId.substring(0, 8)}`, // Mock key
        pollCount: 0 // Counter for polling attempts
      });

      return {
        orderId: mockCwsOrderId,
        status: 'FULFILLING',
        clientOrderId: requestBody.orderId,
        totalPrice: items[0].maxPrice,
        products: [{ productId: items[0].productId, quantity: 1 }]
      };
    }
    // --- END SIMULATION GUARD ---

    try {
      const response = await cwsApi.post('/v3/orders', requestBody); // Send the correctly structured requestBody
      logger.info(`Successfully placed CWS order. CWS Order ID: ${response.data.orderId}. Client Order ID: ${response.data.clientOrderId}`);
      return response.data;
    } catch (error) {
      logger.error(`Error placing CWS order:`, { 
        message: error.message, 
        requestBody: requestBody, // Log the actual request body sent
        response: error.response?.data 
      });
      throw error;
    }
  },

  /**
   * Fetches the status and details of a specific CWS order.
   */
  async getOrder(orderId) {
    // --- SIMULATION GUARD ---
    if (CWS_SIMULATION_MODE) {
      let orderState = simulatedOrderStates.get(orderId);
      if (!orderState) {
        logger.warn(`[SIMULATION] getOrder called for unknown mock order ID: ${orderId}. Returning 404 simulation.`);
        // Simulate a 404 error
        const error = new Error(`Simulated 404: Order ${orderId} not found.`);
        error.response = { status: 404, data: { message: "Simulated Not Found" } };
        throw error;
      }

      orderState.pollCount++;
      logger.info(`[SIMULATION] getOrder called for mock order ID: ${orderId}. Poll Count: ${orderState.pollCount}.`);

      if (orderState.pollCount < 2) { // Simulate 'FULFILLING' for the first few polls (adjust as needed)
        orderState.status = 'FULFILLING';
        simulatedOrderStates.set(orderId, orderState); // Update state
        return { orderId: orderId, status: 'FULFILLING', products: [] };
      } else { // Simulate 'COMPLETED' after enough polls
        orderState.status = 'COMPLETED';
        simulatedOrderStates.set(orderId, orderState); // Update state
        return {
          orderId: orderId,
          status: 'COMPLETED',
          products: [{
            productId: 'mock-product-id', // Placeholder, not strictly used by fulfillment.js logic
            codes: [{ code: orderState.key, codeId: uuidv4(), codeType: 'TEXT' }]
          }]
        };
      }
    }
    // --- END SIMULATION GUARD ---

    try {
      const response = await cwsApi.get(`/v3/orders/${orderId}`);
      const orderData = response.data;
      if (!orderData || !orderData.products || !Array.isArray(orderData.products) || orderData.products.length === 0) {
        logger.error(`CWS Order ${orderId} missing required products array.`);
        throw new Error('CWS order response missing products array');
      }
      // Defensive: check for codes array in first product
      if (!orderData.products[0].codes || !Array.isArray(orderData.products[0].codes) || orderData.products[0].codes.length === 0) {
        logger.error(`CWS Order ${orderId} missing codes array in first product.`);
        throw new Error('CWS order response missing codes array');
      }
      return orderData;
    } catch (error) {
      logger.error(`Error fetching CWS order ${orderId}:`, { message: error.message, data: error.response?.data });
      throw error;
    }
  },
};

module.exports = cwsApiClient;