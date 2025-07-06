// src/config/index.js
require("dotenv").config();

// Helper to parse boolean from string
const parseBoolean = (value) => value === "true";

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || "development",
  isDryRun: parseBoolean(process.env.DRY_RUN),
  syncInterval: parseInt(process.env.SYNC_INTERVAL_MINUTES, 10),

  cws: {
    clientId: process.env.CWS_CLIENT_ID,
    clientSecret: process.env.CWS_CLIENT_SECRET,
    baseUrl: "https://api.codeswholesale.com",
  },
  g2a: {
    apiKey: process.env.G2A_API_KEY,
    apiSecret: process.env.G2A_API_SECRET,
    baseUrl: "https://api.g2a.com",
  },
  pricing: {
    defaultProfit: parseFloat(process.env.DEFAULT_FIXED_PROFIT),
    defaultFeePercentage: parseFloat(process.env.DEFAULT_G2A_FEE_PERCENTAGE),
  },
};
