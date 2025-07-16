// src/services/g2aSellerApiClient.js
const axios = require('axios');
const logger = require('../utils/logger');

// Load G2A credentials from environment variables
const {
  G2A_API_KEY,
  G2A_API_SECRET,
  G2A_API_BASE_URL,
  G2A_OAUTH_TOKEN_URL,
} = process.env;

let accessToken = null;
let tokenExpiry = 0; // Unix timestamp
let tokenRefreshPromise = null;

// Create an Axios instance with base configuration for G2A
const g2aApi = axios.create({
  baseURL: G2A_API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Use an Axios interceptor to automatically attach the Bearer token to every request.
g2aApi.interceptors.request.use(async (config) => {
  if (!accessToken || Date.now() >= tokenExpiry) {
    if (!tokenRefreshPromise) {
      logger.info('G2A access token is expired or missing. Fetching a new one.');
      tokenRefreshPromise = getG2aAccessToken();
    }
    await tokenRefreshPromise;
    tokenRefreshPromise = null;
  }
  config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
}, (error) => {
  return Promise.reject(error);
});

// Fetches a new OAuth2 access token from G2A
async function getG2aAccessToken() {
  try {
    const response = await axios.post(
      G2A_OAUTH_TOKEN_URL,
      new URLSearchParams({
        'grant_type': 'client_credentials',
        'client_id': G2A_API_KEY,
        'client_secret': G2A_API_SECRET,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    accessToken = response.data.access_token;
    tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000; // Safety buffer
    logger.info('Successfully fetched and cached a new G2A access token.');
  } catch (error) {
    logger.error('CRITICAL: Failed to get G2A access token. Check credentials and G2A API status.', {
      message: error.message,
      data: error.response?.data
    });
    throw new Error('G2A authentication failed. The service cannot proceed.');
  }
}

const g2aSellerApiClient = {
  // Fetches ALL offers from the seller's G2A account, handling pagination.
  async getOffers() {
    let allOffers = [];
    let page = 1;
    let hasMorePages = true;

    logger.info('Starting to fetch all offers from G2A...');
    while (hasMorePages) {
      try {
        const response = await g2aApi.get('/v3/sales/offers', {
          params: {
            page: page,
            itemsPerPage: 100, // Fetch max items per request to reduce calls
          }
        });

        const fetchedOffers = response.data.data || [];
        if (fetchedOffers.length > 0) {
          allOffers = allOffers.concat(fetchedOffers);
          logger.info(`Fetched page ${page} of G2A offers. Total so far: ${allOffers.length}`);
        }

        // Determine if there are more pages. This logic can vary by API version.
        const meta = response.data.meta;
        if (!meta || fetchedOffers.length < meta.itemsPerPage || page * meta.itemsPerPage >= meta.totalResults) {
          hasMorePages = false;
        } else {
          page++;
        }

      } catch (error) {
        logger.error(`Error fetching G2A offers on page ${page}:`, {
          message: error.message,
          data: error.response?.data
        });
        throw error; // Stop the process if any page fails
      }
    }
    logger.info(`Finished fetching all G2A offers. Total found: ${allOffers.length}`);
    return allOffers;
  },

  // Updates a specific G2A offer's price and quantity
  async updateOffer(offerId, data) {
    let updatePayload
    try {
      updatePayload = {
        offerType: "dropshipping",
        variant: {
          inventory: { size: data.quantity },
          price: { retail: `${parseFloat(data.price.toFixed(2))}` }// Ensure price is a float with 2 decimal places
        }
      };

      const response = await g2aApi.patch(`/v3/sales/offers/${offerId}`, updatePayload);
      logger.info(`Successfully sent update for G2A offer ${offerId}: Price=${data.price.toFixed(2)}, Quantity=${data.quantity} Job ID: ${response.data.data?.jobId}`);
      return response.data;
    } catch (error) {
      logger.error(`Error updating G2A offer ${offerId}:`, {
        message: error.message,
        requestBody: updatePayload,
        response: error.response?.data
      });
      throw error;
    }
  },

  async deactivateOffer(offerId) {
    try {
      const response = await g2aApi.patch(`/v3/sales/offers/${offerId}`, {
        offerType: "dropshipping",
        variant: {
          active: false,
          // quantity: 0,
        }

      });
      logger.info(`Successfully deactivated G2A offer ${offerId}. Job ID: ${response.data.data?.jobId}`);
      return response.data;
    } catch (error) {
      logger.error(`Error deactivating G2A offer ${offerId}:`, {
        message: error.message,
        requestBody: { offerType: "dropshipping", variant: { quantity: 0 } },
        response: error.response?.data
      });
      throw error;
    }
  }
};

module.exports = g2aSellerApiClient;