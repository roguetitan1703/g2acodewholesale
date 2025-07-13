// src/services/codeswholesale.service.js
const axios = require("axios");
const { URLSearchParams } = require("url");
const config = require("../config");
const logger = require("../logger");

const CWS_AUTH_URL = `${config.cws.baseUrl}/oauth/token`;
const CWS_API_V3_URL = `${config.cws.baseUrl}/v3`;

let tokenCache = { accessToken: null, expiresAt: null };

const getAccessToken = async () => {
  if (tokenCache.accessToken && tokenCache.expiresAt > Date.now()) {
    return tokenCache.accessToken;
  }
  logger.info("CWS: Fetching new access token...");
  try {
    const requestData = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.cws.clientId,
      client_secret: config.cws.clientSecret,
    });
    const response = await axios.post(CWS_AUTH_URL, requestData, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const { access_token, expires_in } = response.data;
    tokenCache.accessToken = access_token;
    tokenCache.expiresAt = Date.now() + expires_in * 1000 - 60 * 1000; // 60s buffer
    logger.info(
      `CWS: Successfully fetched new token. Expires in: ${expires_in}s.`
    );
    return tokenCache.accessToken;
  } catch (error) {
    logger.error(
      `CWS: Failed to fetch access token: ${
        error.response ? JSON.stringify(error.response.data) : error.message
      }`
    );
    throw new Error("Could not authenticate with CodesWholesale.");
  }
};

const cwsApiClient = axios.create({ baseURL: CWS_API_V3_URL });

cwsApiClient.interceptors.request.use(async (req) => {
  req.headers.Authorization = `Bearer ${await getAccessToken()}`;
  req.headers["X-Client-Signature"] = config.cws.clientSignature;
  logger.debug(`CWS: Sending request to ${req.url}`);
  return req;
});

cwsApiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      logger.error(
        `CWS API Error: Status ${error.response.status}, Data: ${JSON.stringify(
          error.response.data
        )}`
      );
    } else {
      logger.error(`CWS API Network Error: ${error.message}`);
    }
    return Promise.reject(error);
  }
);

const getProductDetails = async (productId) => {
  if (config.isDryRun) {
    logger.info(
      `[DRY RUN] Simulating CWS getProductDetails call for ID: ${productId}`
    );
    // Simulate finding a product if it's in the client's configured list
    const clientProduct = require("../config/products").find(
      (p) => p.cwsProductId === productId
    );
    if (clientProduct) {
      return {
        productId: productId,
        name: `${clientProduct.name || "Simulated Product"} (Simulated)`,
        quantity: 100, // Simulated stock
        prices: [{ value: 10.0 + (Math.random() * 2 - 1) }], // Simulated price
      };
    }
    logger.warn(
      `[DRY RUN] Simulated product ${productId} not found in config list.`
    );
    return null; // Simulate 404 for products not in config
  }

  logger.info(`CWS: Fetching details for specific product: ${productId}...`);
  try {
    const response = await cwsApiClient.get(`/products/${productId}`);
    logger.info(`CWS: Successfully fetched details for ${response.data.name}.`);
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      logger.warn(`CWS: Product with ID ${productId} not found (404).`);
    } else {
      logger.error(
        `CWS: Failed to fetch details for product ${productId}: ${error.message}`
      );
    }
    return null;
  }
};

const createOrder = async (productId, maxPrice) => {
  if (config.isDryRun) {
    logger.info(
      `[DRY RUN] Simulating CWS createOrder for Product ID: ${productId}`
    );
    return { orderId: "SIMULATED-ORDER-ID-12345", status: "FULFILLING" };
  }
  logger.info(
    `CWS: Creating live order for product ${productId} at max price ${maxPrice}.`
  );
  const payload = {
    orders: [{ productId, maxPrice, quantity: 1 }],
  };
  const response = await cwsApiClient.post("/orders", payload);
  logger.info(
    `CWS: Order created: ${response.data[0].orderId}, Status: ${response.data[0].status}`
  );
  return response.data[0];
};

const getOrder = async (orderId) => {
  if (config.isDryRun) {
    logger.info(`[DRY RUN] Simulating CWS getOrder for Order ID: ${orderId}`);
    // Simulate occasional 'FULFILLING' before 'COMPLETED'
    const status = Math.random() < 0.8 ? "COMPLETED" : "FULFILLING";
    return {
      orderId,
      status,
      codes:
        status === "COMPLETED" ? [{ code: "DRY-RUN-KEY-ABC-123-XYZ" }] : [],
    };
  }
  logger.info(`CWS: Fetching live order details for ${orderId}.`);
  const response = await cwsApiClient.get(`/orders/${orderId}`);
  logger.info(`CWS: Order ${orderId} status: ${response.data.status}`);
  return response.data;
};

module.exports = { getProductDetails, createOrder, getOrder };
