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
  // ... (rest of the getAccessToken logic is the same, just replace console.log with logger.info/error)
  // For brevity, assuming the existing getAccessToken logic is here.
};

const cwsApiClient = axios.create({ baseURL: CWS_API_V3_URL });
cwsApiClient.interceptors.request.use(async (req) => {
  req.headers.Authorization = `Bearer ${await getAccessToken()}`;
  return req;
});

const getProducts = async () => {
  if (config.isDryRun) {
    logger.info("[DRY RUN] Simulating CWS getProducts call.");
    // Return realistic fake data
    return {
      items: [
        {
          id: "4f783f70-2717-11e7-93ae-0242ac110002",
          name: "Minecraft Legends (Simulated)",
          prices: [{ price: 7.3, quantity: 121 }],
        },
        {
          id: "another-cws-product-id-456",
          name: "Cyberpunk (Simulated)",
          prices: [{ price: 25.5, quantity: 50 }],
        },
      ],
    };
  }
  const response = await cwsApiClient.get("/products", {
    params: { limit: 500 },
  });
  return response.data;
};

const createOrder = async (productId, maxPrice) => {
  if (config.isDryRun) {
    logger.info(
      `[DRY RUN] Simulating CWS createOrder for Product ID: ${productId}`
    );
    return { orderId: "SIMULATED-ORDER-ID-12345", status: "FULFILLING" };
  }
  const response = await cwsApiClient.post("/orders", [
    { productId, maxPrice },
  ]);
  return response.data[0];
};

const getOrder = async (orderId) => {
  if (config.isDryRun) {
    logger.info(`[DRY RUN] Simulating CWS getOrder for Order ID: ${orderId}`);
    // After a few seconds, simulate a completed order
    return {
      orderId,
      status: "COMPLETED",
      codes: [{ code: "DRY-RUN-KEY-ABC-123-XYZ" }],
    };
  }
  const response = await cwsApiClient.get(`/orders/${orderId}`);
  return response.data;
};

module.exports = { getProducts, createOrder, getOrder };
