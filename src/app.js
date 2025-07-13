// src/app.js
const express = require("express");
const config = require("./config");
const logger = require("./logger");
const { startSyncLoop } = require("./sync.js");
const { handleNewG2AOrder } = require("./order-fulfillment.js");

const app = express();
app.use(express.json());

app.get("/health", (req, res) => {
  res
    .status(200)
    .json({ status: "ok", node_env: config.nodeEnv, dry_run: config.isDryRun });
});

app.post("/g2a-webhook/new-order", (req, res) => {
  // IMPORTANT: In production, you MUST validate this request (e.g., with a secret key or IP whitelist)
  // to ensure it's actually from G2A and not a malicious source.
  logger.info("Received new order notification from G2A webhook.");

  const orderData = req.body; // Expects { cwsProductId, g2aOfferId, maxPrice }
  handleNewG2AOrder(orderData);

  // Respond to G2A immediately so they don't retry the webhook.
  res.status(200).json({ message: "Order received and is being processed." });
});

// src/app.js -> startServer function
const startServer = async () => {
  logger.info(`Application starting in ${config.nodeEnv} mode...`);

  // G2A authentication is now handled statically in the g2aApiClient header, no token call needed on startup.
  // CWS authentication is handled by its interceptor for on-demand token refresh.

  startSyncLoop(); // Start the continuous price/stock sync

  app.listen(config.port, () => {
    logger.info(`Server is running on http://localhost:${config.port}`);
  });
};
startServer();
