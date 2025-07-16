// src/services/cwsApiClient.js
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

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
    try {
      const response = await cwsApi.get(`/v3/orders/${orderId}`);
      const orderData = response.data;
      if (!orderData || !orderData.products || !Array.isArray(orderData.products) || orderData.products.length === 0) {
        logger.error(`CWS Order ${orderId} missing required products array.`);
        throw new Error('CWS order response missing products array');
      }
      // Defensive: check for codes array in first product || orderData.products[0].codes.length === 0
      if (!orderData.products[0].codes || !Array.isArray(orderData.products[0].codes)) {
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