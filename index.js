// index.js
require('dotenv').config(); // Load environment variables from .env file

const app = require('./src/app');
const logger = require('./src/utils/logger');
const { syncProducts } = require('./src/sync/productSync');

const PORT = process.env.PORT || 3000;
const SYNC_INTERVAL = parseInt(process.env.SYNC_INTERVAL_SECONDS, 10) * 1000;
const IS_SERVICE_ENABLED = process.env.SERVICE_ENABLED === 'true';

// Start the Express server
app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
  logger.info(`Service enabled: ${IS_SERVICE_ENABLED}`);
  logger.info(`Sync interval: ${SYNC_INTERVAL / 1000} seconds`);
});

// --- Background Sync Job ---
if (IS_SERVICE_ENABLED) {
  logger.info('Starting initial product sync...');
  // Run the sync job immediately on startup, then on the defined interval.
  syncProducts();
  setInterval(syncProducts, SYNC_INTERVAL);
} else {
  logger.warn('Service is disabled. The background sync job will not run.');
}

// Graceful shutdown handling
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  // Add server closing logic here if needed
  process.exit(0);
});