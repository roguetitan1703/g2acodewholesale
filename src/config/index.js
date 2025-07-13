// src/config/index.js
require("dotenv").config();

const parseBoolean = (value) => value === "true";

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || "development",
  isDryRun: parseBoolean(process.env.DRY_RUN || "true"),
  syncInterval: parseInt(process.env.SYNC_INTERVAL_MINUTES, 10) || 5,

  cws: {
    clientId: process.env.CWS_CLIENT_ID,
    clientSecret: process.env.CWS_CLIENT_SECRET,
    clientSignature: process.env.CWS_CLIENT_SIGNATURE,
    baseUrl: process.env.CWS_API_BASE_URL,
  },
  g2a: {
    // These are now the Client ID and Client Secret for the G2A Seller (Integration) API
    apiKey: process.env.G2A_API_KEY, // Mapped to Client ID
    apiSecret: process.env.G2A_API_SECRET, // Mapped to Client Secret
    baseUrl: process.env.G2A_API_BASE_URL, // e.g., https://api.g2a.com
  },
  pricing: {
    defaultProfit: parseFloat(process.env.DEFAULT_FIXED_PROFIT) || 0.5,
    defaultFeePercentage:
      parseFloat(process.env.DEFAULT_G2A_FEE_PERCENTAGE) || 0.12,
  },
};
