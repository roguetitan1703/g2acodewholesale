// src/services/g2a.service.js
const axios = require("axios");
const config = require("../config");
const logger = require("../logger");

const g2aApiClient = axios.create({
  baseURL: config.g2a.baseUrl,
  headers: {
    Authorization: `${config.g2a.apiKey} ${config.g2a.apiSecret}`,
    "Content-Type": "application/json",
  },
});

const updateOffer = async (offerId, price, quantity) => {
  if (config.isDryRun) {
    logger.info(
      `[DRY RUN] Simulating G2A updateOffer for Offer ID: ${offerId} -> Price: ${price}, Quantity: ${quantity}`
    );
    return { message: "Offer update simulated." };
  }
  const payload = { quantity };
  if (price !== null) {
    payload.price = price.toFixed(2);
  }
  const response = await g2aApiClient.put(`/user/offers/${offerId}`, payload);
  return response.data;
};

const addKeysToOffer = async (offerId, keys) => {
  if (config.isDryRun) {
    logger.info(
      `[DRY RUN] Simulating G2A addKeysToOffer for Offer ID: ${offerId}. Keys: [${keys.join(
        ", "
      )}]`
    );
    return { message: "Key delivery simulated." };
  }
  // NOTE: The endpoint for adding keys might be different. This is a common pattern.
  // We will need to verify this endpoint from G2A's documentation.
  const response = await g2aApiClient.post(`/user/offers/${offerId}/keys`, {
    keys,
  });
  return response.data;
};

module.exports = { updateOffer, addKeysToOffer };
