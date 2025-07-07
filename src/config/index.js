// src/config/index.js
require("dotenv").config();

const parseBoolean = (value) => value === "true";

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || "development",
  isDryRun: parseBoolean(process.env.DRY_RUN),
  syncInterval: parseInt(process.env.SYNC_INTERVAL_MINUTES, 10),

  cws: {
    clientId: process.env.CWS_CLIENT_ID,
    clientSecret: process.env.CWS_CLIENT_SECRET,
    clientSignature: process.env.CWS_CLIENT_SIGNATURE, // <--- ADD THIS LINE
    baseUrl: process.env.CWS_API_BASE_URL, // <--- CHANGE THIS TO USE THE .env VARIABLE
  },
  g2a: {
    apiKey: process.env.G2A_API_KEY,
    apiSecret: process.env.G2A_API_SECRET,
    baseUrl: process.env.G2A_API_BASE_URL,
  },
  pricing: {
    defaultProfit: parseFloat(process.env.DEFAULT_FIXED_PROFIT),
    defaultFeePercentage: parseFloat(process.env.DEFAULT_G2A_FEE_PERCENTAGE),
  },
};
