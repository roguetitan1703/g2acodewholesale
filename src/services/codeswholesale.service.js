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
    tokenCache.expiresAt = Date.now() + expires_in * 1000 - 60 * 1000;
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

const getProducts = async () => {
  if (config.isDryRun) {
    logger.info("[DRY RUN] Simulating CWS getProducts call.");
    return {
      items: [
        {
          id: "3d11fc79-1e20-41f4-926f-4bcca5c9a579",
          name: "Balatro (Simulated)",
          prices: [{ price: 7.3, quantity: 121 }],
        },
      ],
    };
  }
  logger.info("CWS: Fetching live products...");
  const response = await cwsApiClient.get("/products", {
    params: { limit: 500 },
  });
  logger.info(`CWS: Fetched ${response.data.items.length} products.`);
  return response.data;
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

  // THE FINAL FIX: Wrap the array in an object with an "orders" key.
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
    return {
      orderId,
      status: "COMPLETED",
      codes: [{ code: "DRY-RUN-KEY-ABC-123-XYZ" }],
    };
  }
  logger.info(`CWS: Fetching live order details for ${orderId}.`);
  const response = await cwsApiClient.get(`/orders/${orderId}`);
  logger.info(`CWS: Order ${orderId} status: ${response.data.status}`);
  return response.data;
};

module.exports = { getProducts, createOrder, getOrder };
