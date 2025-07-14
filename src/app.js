// src/app.js
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const logger = require('./utils/logger');
const productsToSync = require('./config/product');
const cwsApiClient = require('./services/cwsApiClient');
const fulfillmentService = require('./order-fulfillment/fullfillment');
const productRoutes = require('./routes/productRoutes');
const app = express();
app.use(express.json()); // Middleware to parse JSON bodies

// --- Database Setup ---
// Connect to the SAME database file used by fulfillment.js to ensure data consistency.
const db = new Database(path.join(process.cwd(), 'orders.db'));
logger.info('Database connection established for app routes.');

// Create the 'reservations' table if it doesn't exist.
// This table will store active reservations and their expiry times.
db.exec(`
  CREATE TABLE IF NOT EXISTS reservations (
    reservation_id TEXT PRIMARY KEY,
    g2a_product_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL, -- Storing as Unix timestamp (milliseconds)
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Prepare database statements for reservations for performance and security.
const insertReservationStmt = db.prepare(
  'INSERT INTO reservations (reservation_id, g2a_product_id, expires_at) VALUES (?, ?, ?)'
);
const getReservationStmt = db.prepare('SELECT * FROM reservations WHERE reservation_id = ?');
const deleteReservationStmt = db.prepare('DELETE FROM reservations WHERE reservation_id = ?');
const deleteExpiredReservationsStmt = db.prepare('DELETE FROM reservations WHERE expires_at < ?');


// --- Authentication Middleware for G2A's Inbound Calls ---
const g2aAuthMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    logger.warn('Auth Middleware: Missing or malformed Authorization header');
    return res.status(401).send({ code: 'AUTH01', message: 'No or invalid Authorization header' });
  }

  // G2A contract expects credentials. We will use Basic Auth.
  const b64auth = authHeader.split(' ')[1];
  const [clientId, clientSecret] = Buffer.from(b64auth, 'base64').toString().split(':');

  if (clientId === process.env.OUR_API_CLIENT_ID && clientSecret === process.env.OUR_API_CLIENT_SECRET) {
    return next(); // Credentials are valid, proceed to the route handler.
  }

  logger.warn('Auth Middleware: Invalid credentials provided.');
  return res.status(401).send({ code: 'AUTH02', message: 'Invalid credentials' });
};


// --- API Endpoints for G2A to Call ---

// Health Check Endpoint (Required by G2A contract)
app.get('/health', (req, res) => {
  logger.info('Health check endpoint was hit.');
  res.status(200).send('OK');
});

app.use('/api/products', productRoutes);
// G2A will call this to reserve stock before the customer pays.
app.post('/reservation', g2aAuthMiddleware, async (req, res) => {
  try {
    // G2A sends an array, so we access the first element.
    const { product_id, quantity } = req.body[0];
    logger.info(`Received reservation request for G2A Product ID: ${product_id}, Quantity: ${quantity}`);

    const mapping = productsToSync.find(p => p.g2aProductId === product_id.toString());
    if (!mapping) {
      logger.warn(`Reservation failed: No mapping found for G2A Product ID ${product_id}`);
      return res.status(404).send({ message: 'Product not configured for dropshipping.' });
    }

    const cwsProduct = await cwsApiClient.getProduct(mapping.cwsProductId);
    if (!cwsProduct || cwsProduct.quantity < quantity) {
      logger.warn(`Reservation failed: Not enough stock on CWS for product ${mapping.cwsProductId}.`);
      return res.status(409).send({ message: 'Insufficient stock.' }); // 409 Conflict is appropriate here
    }

    const reservationId = uuidv4();
    const expiresAt = Date.now() + 30 * 60 * 1000; // Reservation valid for 30 minutes

    // Store the reservation in the database instead of an in-memory map.
    insertReservationStmt.run(reservationId, product_id.toString(), expiresAt);

    logger.info(`Reservation successful. ID: ${reservationId}. Stored in database.`);
    res.status(200).json({ reservation_id: reservationId, stock: [{ product_id, inventory_size: cwsProduct.quantity }] });

  } catch (error) {
    logger.error('Error during reservation:', error);
    res.status(500).send({ message: 'Internal Server Error' });
  }
});


// G2A will call this after the customer successfully pays.
app.post('/order', g2aAuthMiddleware, async (req, res) => {
  try {
    const { reservation_id, g2a_order_id } = req.body;
    logger.info(`Received order creation request for G2A Order ID: ${g2a_order_id} with Reservation ID: ${reservation_id}`);

    // Retrieve the reservation from the database.
    const reservation = getReservationStmt.get(reservation_id);
    if (!reservation || Date.now() > reservation.expires_at) {
      // If the reservation doesn't exist or has expired, reject the order.
      logger.warn(`Order creation failed: Invalid or expired reservation ID ${reservation_id}`);
      deleteReservationStmt.run(reservation_id); // Clean up the expired reservation
      return res.status(410).send({ message: 'Reservation expired or not found.' }); // 410 Gone is appropriate
    }

    const mapping = productsToSync.find(p => p.g2aProductId === reservation.g2a_product_id);
    if (!mapping) {
      logger.error(`CRITICAL: Reservation ${reservation_id} exists but mapping for G2A Product ID ${reservation.g2a_product_id} is gone.`);
      return res.status(500).send({ message: 'Internal configuration error.' });
    }

    // As a final check, get the current lowest price from CWS to pass as maxPrice.
    const cwsProduct = await cwsApiClient.getProduct(mapping.cwsProductId);
    if (!cwsProduct) {
      logger.error(`CRITICAL: CWS Product ${mapping.cwsProductId} disappeared between reservation and order.`);
      return res.status(500).send({ message: 'Supplier product is no longer available.' });
    }
    const maxPrice = cwsProduct.prices[0].value

    // Start the fulfillment process in the background. DO NOT await this call.
    fulfillmentService.startFulfillment(mapping.cwsProductId, g2a_order_id.toString(), maxPrice);

    // Clean up the used reservation from the database to prevent reuse.
    deleteReservationStmt.run(reservation_id);

    // Respond immediately to G2A that we've accepted the order.
    logger.info(`Order for G2A ID ${g2a_order_id} accepted. Fulfillment running in background.`);
    res.status(202).json({ order_id: g2a_order_id.toString(), message: 'Order accepted and is being processed.' });

  } catch (error) {
    logger.error('Error during order creation:', error);
    res.status(500).send({ message: 'Internal Server Error' });
  }
});


// G2A will call this endpoint to retrieve the key for the customer.
app.get('/order/:orderId/inventory', g2aAuthMiddleware, (req, res) => {
  const g2aOrderId = req.params.orderId;
  logger.info(`Received inventory request for G2A Order ID: ${g2aOrderId}`);

  // Get the latest status from the database via the fulfillment service.
  const fulfillmentRecord = fulfillmentService.getOrderStatus(g2aOrderId);

  if (!fulfillmentRecord) {
    logger.warn(`Inventory request for unknown G2A Order ID: ${g2aOrderId}`);
    return res.status(404).send({ message: 'Order not found.' });
  }

  if (fulfillmentRecord.status === 'COMPLETED' && fulfillmentRecord.key) {
    logger.info(`Responding with key for G2A Order ID: ${g2aOrderId}`);

    const mapping = productsToSync.find(p => p.cwsProductId === fulfillmentRecord.cws_product_id);
    const g2aProductId = mapping ? mapping.g2aProductId : 'unknown';

    // Respond in the format G2A expects
    res.status(200).json([
      {
        product_id: parseInt(g2aProductId, 10), // G2A may expect an integer for product_id
        inventory_size: 1,
        inventory: [
          {
            id: uuidv4(), // A unique ID for this specific key delivery instance
            kind: 'text', // Assuming text keys
            value: fulfillmentRecord.key,
          }
        ]
      }
    ]);
  } else if (fulfillmentRecord.status === 'FAILED') {
    logger.warn(`Inventory request for a FAILED G2A Order ID: ${g2aOrderId}`);
    res.status(500).json({ message: `Fulfillment for this order has failed. Reason: ${fulfillmentRecord.error_message}` });
  } else {
    logger.info(`Key not yet ready for G2A Order ID: ${g2aOrderId}. Current status: ${fulfillmentRecord.status}`);
    // Key is not ready yet; respond with an empty inventory array as per G2A contract.
    res.status(200).json([]);
  }
});

// --- Self-Maintenance for Expired Reservations ---
function cleanupExpiredReservations() {
  const now = Date.now();
  try {
    const result = deleteExpiredReservationsStmt.run(now);
    if (result.changes > 0) {
      logger.info(`[Maintenance] Cleaned up ${result.changes} expired reservation(s).`);
    }
  } catch (error) {
    logger.error(`[Maintenance] Error during cleanup of expired reservations: ${error.message}`);
  }
}

// Run the cleanup job periodically (e.g., every hour)
setInterval(cleanupExpiredReservations, 60 * 60 * 1000);

module.exports = app;