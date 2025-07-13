// src/services/g2a.service.js
const axios = require("axios");
const { URLSearchParams } = require("url");
const config = require("../config");
const logger = require("../logger");

const G2A_BASE_URL = config.g2a.baseUrl;
const G2A_OAUTH_TOKEN_URL = `${G2A_BASE_URL}/oauth/token`;
const G2A_SALES_V3_PREFIX = `/v3/sales`;

let g2aTokenCache = { accessToken: null, expiresAt: null };

const getG2AAccessToken = async () => {
  if (g2aTokenCache.accessToken && g2aTokenCache.expiresAt > Date.now()) {
    return g2aTokenCache.accessToken;
  }
  logger.info("G2A: Fetching new access token (OAuth2)...");
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
    logger.info(`G2A: Successfully fetched new token. Expires in: ${expires_in}s.`);
    return g2aTokenCache.accessToken;
  } catch (error) {
    logger.error(`G2A: Failed to fetch access token: ${error.response ? JSON.stringify(error.response.data) : error.message}`);
    throw new Error("Could not authenticate with G2A.");
  }
};

const g2aApiClient = axios.create({ baseURL: G2A_BASE_URL });

g2aApiClient.interceptors.request.use(async (req) => {
  if (!req.url.includes('/oauth/token')) {
    req.headers.Authorization = `Bearer ${await getG2AAccessToken()}`;
  }
  logger.debug(`G2A: Sending request to ${req.method} ${req.url}`);
  return req;
});

g2aApiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      const requestUrl = error.config.url || 'N/A';
      logger.error(`G2A API Error: Status ${error.response.status}, URL: ${requestUrl}, Data: ${JSON.stringify(error.response.data).substring(0, 200)}...`);
    } else {
      logger.error(`G2A API Network Error: ${error.message}`);
    }
    return Promise.reject(error);
  }
);

const updateOffer = async (offerId, price, quantity) => {
  if (config.isDryRun) {
    logger.info(`[DRY RUN] Simulating G2A updateOffer for Offer ID: ${offerId} -> Price: ${price}, Quantity: ${quantity}`);
    return { message: "Offer update simulated." };
  }
  logger.info(`G2A: Sending update for Offer ID: ${offerId}. Price: ${price ? price.toFixed(2) : 'N/A'}, Quantity: ${quantity}`);
  const payload = {
    offerType: "dropshipping",
    variant: {
      quantity: quantity,
      price: price ? parseFloat(price.toFixed(2)) : undefined,
    }
  };
  try {
    const response = await g2aApiClient.patch(`${G2A_SALES_V3_PREFIX}/offers/${offerId}`, payload);
    logger.info(`G2A: Successfully updated offer ${offerId}.`);
    return response.data;
  } catch (error) {
    logger.error(`G2A: Failed to update offer ${offerId}: ${error.message}`);
    throw error;
  }
};

const addKeysToOffer = async (offerId, keys) => {
    // ... function remains the same
};

const createOffer = async (productId, price, quantity) => {
  if (config.isDryRun) {
    logger.info(`[DRY RUN] Simulating G2A createOffer for Product ID: ${productId} -> Price: ${price}, Quantity: ${quantity}`);
    return { 
      message: "Offer creation simulated.",
      jobId: `simulated-job-${Date.now()}`,
      status: "accepted"
    };
  }
  
  logger.info(`G2A: Creating new dropshipping offer for Product ID: ${productId}. Price: ${price ? price.toFixed(2) : 'N/A'}, Quantity: ${quantity}`);
  
  const payload = {
    offerType: "dropshipping",
    variants: [
      {
        price: {
          retail: price ? price.toFixed(2) : undefined,
          business: price ? (price * 0.95).toFixed(2) : undefined // Business price is typically lower
        },
        productId: productId,
        active: true,
        inventory: {
          size: quantity || 0
        },
        visibility: "all"
      }
    ]
  };
  
  try {
    const response = await g2aApiClient.post(`${G2A_SALES_V3_PREFIX}/offers`, payload);
    logger.info(`G2A: Successfully submitted offer creation job ${response.data.data.jobId} for product ${productId}.`);
    return {
      jobId: response.data.data.jobId,
      status: "accepted",
      message: "Offer creation job submitted successfully"
    };
  } catch (error) {
    logger.error(`G2A: Failed to create offer for product ${productId}: ${error.message}`);
    if (error.response) {
      logger.error(`G2A: Response data: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
};

// --- NEW DIAGNOSTIC FUNCTION ---
const getOffers = async () => {
    logger.info(`G2A DIAGNOSTIC: Attempting to fetch offers list...`);
    try {
        const response = await g2aApiClient.get(`${G2A_SALES_V3_PREFIX}/offers`, {
            params: { page: 1, itemsPerPage: 100 } // Fetch the first 100 offers
        });
        logger.info(`G2A DIAGNOSTIC: Successfully fetched ${response.data.data.length} offers. Total offers available: ${response.data.meta.totalResults}`);
        return response.data;
    } catch (error) {
        logger.error(`G2A DIAGNOSTIC: Failed to fetch offers list: ${error.message}`);
        throw error; // Re-throw to be caught by the sync cycle
    }
};

// --- JOB STATUS CHECKING FUNCTION ---
const getJobStatus = async (jobId) => {
  if (config.isDryRun) {
    logger.info(`[DRY RUN] Simulating G2A getJobStatus for Job ID: ${jobId}`);
    return { 
      data: {
        jobId: jobId,
        status: "complete",
        elements: [
          {
            resourceId: `simulated-offer-${Date.now()}`,
            resourceType: "offer",
            status: "complete",
            code: null,
            message: null
          }
        ]
      }
    };
  }
  
  logger.info(`G2A: Checking job status for Job ID: ${jobId}`);
  
  try {
    const response = await g2aApiClient.get(`/v3/jobs/${jobId}`);
    logger.info(`G2A: Job ${jobId} status: ${response.data.data.status}`);
    
    // Log details about each element in the job
    if (response.data.data.elements && response.data.data.elements.length > 0) {
      response.data.data.elements.forEach((element, index) => {
        logger.info(`G2A: Job element ${index + 1}: ${element.resourceType} ${element.resourceId} - Status: ${element.status}`);
        if (element.code || element.message) {
          logger.warn(`G2A: Job element ${index + 1} has issues - Code: ${element.code}, Message: ${element.message}`);
        }
      });
    }
    
    return response.data;
  } catch (error) {
    logger.error(`G2A: Failed to check job status for ${jobId}: ${error.message}`);
    if (error.response) {
      logger.error(`G2A: Response data: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
};

module.exports = { updateOffer, addKeysToOffer, createOffer, getOffers, getJobStatus };