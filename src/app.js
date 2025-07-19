// src/app.js
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
// Defensive import to ensure logger.info is always available
let logger, requestLogger;
try {
  ({ logger, requestLogger } = require('./utils/logger'));
  if (!logger || !logger.info) throw new Error('logger.info missing');
} catch (e) {
  logger = require('./utils/logger');
  requestLogger = logger.requestLogger;
}
const productsToSync = require('./config/product');
const cwsApiClient = require('./services/cwsApiClient');
const fulfillmentService = require('./order-fulfillment/fullfillment');
const productRoutes = require('./routes/productRoutes');
const app = express();
app.use(express.json()); // Middleware to parse JSON bodies
// Log all incoming requests to a separate file (move to top)
app.use((req, res, next) => {
  // Skip logging for unwanted endpoints
  if (req.originalUrl === '/g2a-webhook/new-order') {
    return next();
  }
  const requestLog = {
    method: req.method,
    url: req.originalUrl,
    headers: req.headers,
    body: req.body,
    ip: req.ip,
    timestamp: new Date().toISOString()
  };
  // requestLogger.info(requestLog); // File logging commented out
  console.log('[REQUEST LOG]', JSON.stringify(requestLog, null, 2));
  next();
});

// --- Database Setup ---
// Connect to the SAME database file used by fulfillment.js to ensure data consistency.
const db = new Database(path.join(process.cwd(), 'orders.db'));
logger.info('Database connection established for app routes.');

// Create the 'reservations' table if it doesn't exist.
db.exec(`
  CREATE TABLE IF NOT EXISTS reservations (
    reservation_id TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL, -- Storing as Unix timestamp (milliseconds)
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
// Create the 'reservation_items' table to store products per reservation.
db.exec(`
  CREATE TABLE IF NOT EXISTS reservation_items (
    reservation_id TEXT NOT NULL,
    g2a_product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    PRIMARY KEY (reservation_id, g2a_product_id),
    FOREIGN KEY (reservation_id) REFERENCES reservations(reservation_id) ON DELETE CASCADE
  );
`);

// Add a table to store orders and their products/codes
// Orders table: maps G2A order to CWS order
// Order items table: stores product, quantity, and codes

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    g2a_order_id TEXT PRIMARY KEY,
    cws_order_id TEXT NOT NULL,
    status TEXT NOT NULL,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS order_items (
    g2a_order_id TEXT NOT NULL,
    g2a_product_id TEXT NOT NULL,
    cws_product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    codes TEXT, -- JSON array of codes
    PRIMARY KEY (g2a_order_id, g2a_product_id),
    FOREIGN KEY (g2a_order_id) REFERENCES orders(g2a_order_id) ON DELETE CASCADE
  );
`);

// Prepare database statements for reservations for performance and security.
const insertReservationStmt = db.prepare(
  'INSERT INTO reservations (reservation_id, expires_at) VALUES (?, ?)'
);
const insertReservationItemStmt = db.prepare(
  'INSERT INTO reservation_items (reservation_id, g2a_product_id, quantity) VALUES (?, ?, ?)'
);
const getReservationStmt = db.prepare('SELECT * FROM reservations WHERE reservation_id = ?');
const getReservationItemsStmt = db.prepare('SELECT * FROM reservation_items WHERE reservation_id = ?');
const deleteReservationStmt = db.prepare('DELETE FROM reservations WHERE reservation_id = ?');
const deleteExpiredReservationsStmt = db.prepare('DELETE FROM reservations WHERE expires_at < ?');

const insertOrderStmt = db.prepare(
  'INSERT INTO orders (g2a_order_id, cws_order_id, status) VALUES (?, ?, ?)'
);
const updateOrderStatusStmt = db.prepare(
  'UPDATE orders SET status = ?, error_message = ? WHERE g2a_order_id = ?'
);
const insertOrderItemStmt = db.prepare(
  'INSERT INTO order_items (g2a_order_id, g2a_product_id, cws_product_id, quantity, codes) VALUES (?, ?, ?, ?, ?)'
);
const updateOrderItemCodesStmt = db.prepare(
  'UPDATE order_items SET codes = ? WHERE g2a_order_id = ? AND g2a_product_id = ?'
);
const getOrderStmt = db.prepare('SELECT * FROM orders WHERE g2a_order_id = ?');
const getOrderItemsStmt = db.prepare('SELECT * FROM order_items WHERE g2a_order_id = ?');


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
    return next();
  }
  logger.warn('Auth Middleware: Invalid credentials provided.');
  return res.status(401).send({ code: 'AUTH02', message: 'Invalid credentials' });
};


// --- API Endpoints for G2A to Call ---

// Health Check Endpoints (Required by G2A contract)
app.get('/health', (req, res) => {
  logger.info('Health check endpoint was hit.');
  res.status(200).send('OK');
});
app.get('/healthcheck', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    // Token is present (G2A will validate it on their side)
    return res.status(204).send();
  }
  // Missing or invalid token
  return res.status(401).json({
    code: 'unauthorized',
    message: 'Missing or invalid access token'
  });
});
// --- OAuth2 Token Endpoint (POST only, per docs) ---
const { URLSearchParams } = require('url');
app.post('/oauth/token', express.urlencoded({ extended: false }), (req, res) => {
  const { grant_type, client_id, client_secret } = req.body;
  // Validate required fields
  if (grant_type !== 'client_credentials' || !client_id || !client_secret) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Missing or invalid parameters.' });
  }
  // (Optional) Validate client_id/client_secret if you want to restrict
  // Return a real-looking random token
  res.status(200).json({
    access_token: uuidv4(),
    token_type: 'bearer',
    expires_in: 3600
  });
});
// --- OAuth2 Token Endpoint (GET, for G2A compatibility) ---
app.get('/oauth/token', (req, res) => {
  const { grant_type, client_id, client_secret } = req.query;
  if (grant_type !== 'client_credentials' || !client_id || !client_secret) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Missing or invalid parameters.' });
  }
  res.status(200).json({
    access_token: uuidv4(),
    token_type: 'bearer',
    expires_in: 3600
  });
});
// Notifications endpoint for G2A
app.post('/notifications', g2aAuthMiddleware, (req, res) => {
  logger.info('Received notification from G2A:', req.body);
  // For now, just acknowledge receipt. In production, you may want to process/store notifications.
  res.status(204).send();
});
// G2A will call this to reserve stock before the customer pays.
app.post('/reservation', g2aAuthMiddleware, async (req, res) => {
  try {
    const reservationProducts = req.body; // Expecting an array
    if (!Array.isArray(reservationProducts) || reservationProducts.length === 0) {
      return res.status(400).send({ message: 'Request body must be a non-empty array.' });
    }
    // Check all products for mapping and stock
    const stockResults = [];
    for (const { product_id, quantity } of reservationProducts) {
      const mapping = productsToSync.find(p => p.g2aProductId === product_id.toString());
      if (!mapping) {
        logger.warn(`Reservation failed: No mapping found for G2A Product ID ${product_id}`);
        return res.status(404).send({ message: `Product ${product_id} not configured for dropshipping.` });
      }
      const cwsProduct = await cwsApiClient.getProduct(mapping.cwsProductId);
      if (!cwsProduct || cwsProduct.quantity < quantity) {
        logger.warn(`Reservation failed: Not enough stock on CWS for product ${mapping.cwsProductId}.`);
        return res.status(409).send({ message: `Insufficient stock for product ${product_id}.` });
      }
      stockResults.push({ product_id, inventory_size: cwsProduct.quantity });

    }
    const reservationId = uuidv4();
    const expiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes
    insertReservationStmt.run(reservationId, expiresAt);
    for (const { product_id, quantity } of reservationProducts) {
      insertReservationItemStmt.run(reservationId, product_id.toString(), quantity);
    }
    logger.info(`Reservation successful. ID: ${reservationId}. Stored in database.`);
    res.status(200).json({ reservation_id: reservationId, stock: stockResults });
  } catch (error) {
    logger.error('Error during reservation:', error);
    res.status(500).send({ message: 'Internal Server Error' });
  }
});

// G2A will call this endpoint to release (delete) an active reservation.
app.delete('/reservation/:reservation_id', g2aAuthMiddleware, (req, res) => {
  const reservationId = req.params.reservation_id;
  const reservation = getReservationStmt.get(reservationId);
  if (!reservation) {
    logger.warn(`Release reservation failed: Reservation ${reservationId} not found.`);
    return res.status(404).json({ code: 'NOT_FOUND', message: 'Reservation not found.' });
  }
  // If reservation is expired or already used (not ACTIVE), treat as bad request
  if (reservation.status !== 'ACTIVE' || Date.now() > reservation.expires_at) {
    logger.warn(`Release reservation failed: Reservation ${reservationId} is expired or not active.`);
    return res.status(400).json({ code: 'INVALID', message: 'Reservation is expired or not active.' });
  }
  deleteReservationStmt.run(reservationId);
  logger.info(`Reservation ${reservationId} released (deleted).`);
  return res.status(204).send();
});


// G2A will call this after the customer successfully pays.
app.post('/order', g2aAuthMiddleware, async (req, res) => {
  const { reservation_id, g2a_order_id } = req.body;

  // 1️⃣ Validate reservation
  const reservation = getReservationStmt.get(reservation_id);
  if (!reservation || Date.now() > reservation.expires_at) {
    deleteReservationStmt.run(reservation_id);
    return res.status(410).json({ message: 'Reservation expired or not found.' });
  }

  const reservationItems = getReservationItemsStmt.all(reservation_id);

  // 2️⃣ Map G2A items to CWS items and validate stock
  let cwsItems;
  try {
    cwsItems = await Promise.all(
      reservationItems.map(async ({ g2a_product_id, quantity }) => {
        const mapping = productsToSync.find(p => p.g2aProductId === g2a_product_id);
        if (!mapping) throw new Error(`Missing internal mapping for G2A product ${g2a_product_id}`);

        const cwsProduct = await cwsApiClient.getProduct(mapping.cwsProductId);
        if (!cwsProduct || cwsProduct.quantity < quantity) {
          throw new Error(`Insufficient stock for product ${mapping.cwsProductId}`);
        }

        return {
          productId: mapping.cwsProductId,
          g2aProduct: g2a_product_id,
          quantity,
          price: cwsProduct.prices[0].value,
        };
      })
    );
  } catch (error) {
    return res.status(502).json({ message: 'Product availability error', detail: error.message });
  }

  // 3️⃣ Place order with supplier (CWS)
  let cwsOrder;
  try {
    cwsOrder = await cwsApiClient.placeOrder(
      cwsItems.map(({ productId, price, quantity }) => ({ productId, price, quantity })),
      g2a_order_id.toString()
    );
  } catch (error) {
    return res.status(502).json({ message: 'Supplier order failed', detail: error.message });
  }

  // 4️⃣ Merge additional info from cwsItems into cwsOrder.products
  for (const item of cwsOrder.products) {
    const match = cwsItems.find(ci => ci.productId === item.productId);
    if (!match) return res.status(500).json({ message: `Internal error: unmatched productId ${item.productId}` });

    item.g2aProduct = match.g2aProduct;
    item.quantity = match.quantity;
  }

  // 5️⃣ Write to DB in transaction
  try {
    const commit = db.transaction((order, items) => {
      insertOrderStmt.run(g2a_order_id, order.orderId, 'POLLING_CWS');

      for (const item of items) {
        if (!item.g2aProduct || !item.productId || !item.quantity) {
          throw new Error('Missing required order item fields.');
        }

        const codes = item.codes?.length ? JSON.stringify(item.codes) : null;

        insertOrderItemStmt.run(
          g2a_order_id,
          item.g2aProduct,
          item.productId,
          item.quantity,
          codes
        );
      }

      deleteReservationStmt.run(reservation_id);
    });

    commit(cwsOrder, cwsOrder.products);
  } catch (error) {
    return res.status(500).json({ message: 'Database write failed.', detail: error.message });
  }

  // 6️⃣ Respond to client
  const isInstant = cwsOrder.status === 'Completed' &&
    cwsOrder.products.every(p => Array.isArray(p.codes) && p.codes.length > 0);

  return res.status(isInstant ? 200 : 202).json({
    order_id: g2a_order_id,
    message: isInstant
      ? 'Order completed and codes are available.'
      : 'Order accepted and is being processed.'
  });
});


// G2A will call this endpoint to retrieve the key(s) for the customer.
app.get('/order/:orderId/inventory', g2aAuthMiddleware, async (req, res) => {
  const g2aOrderId = parseFloat(req.params.orderId);
  logger.info(`Received inventory request for G2A Order ID: ${g2aOrderId}`);

  // Get the order and items from the database
  const order = getOrderStmt.get(g2aOrderId);
  if (!order) {
    logger.warn(`Inventory request for unknown G2A Order ID: ${g2aOrderId}`);
    return res.status(404).send({ message: 'Order not found.' });
  }
  if (order.status === 'FAILED') {
    logger.warn(`Inventory request for a FAILED G2A Order ID: ${g2aOrderId}`);
    return res.status(500).json({ message: `Fulfillment for this order has failed. Reason: ${order.error_message}` });
  }
  const orderItems = getOrderItemsStmt.all(g2aOrderId);
  // Build the response for each product
  const response = orderItems.map(item => {
    let inventory = [];
    if (item.codes) {
      try {
        const codesArr = JSON.parse(item.codes);
        inventory = codesArr.map(codeObj => {
          // Support text, account, and file types
          if (codeObj.codeType === 'CODE_TEXT' || !codeObj.codeType) {
            return {
              id: uuidv4(),
              kind: 'text',
              value: codeObj.code || codeObj.value || codeObj
            };
          } else if (codeObj.codeType === 'CODE_ACCOUNT') {
            return {
              id: uuidv4(),
              kind: 'account',
              value: codeObj.code || codeObj.value || codeObj,
              // Optionally add more account fields if present
              username: codeObj.username,
              password: codeObj.password,
              email: codeObj.email,
              emailPassword: codeObj.emailPassword,
              optional: codeObj.optional
            };
          } else if (codeObj.codeType === 'CODE_FILE') {
            return {
              id: uuidv4(),
              kind: 'file',
              value: codeObj.code || codeObj.value || codeObj,
              filename: codeObj.filename,
              links: codeObj.links
            };
          } else {
            // Default fallback
            return {
              id: uuidv4(),
              kind: 'text',
              value: codeObj.code || codeObj.value || codeObj
            };
          }
        });
      } catch (e) {
        logger.error(`Failed to parse codes for order item: ${e.message}`);
      }
    }
    return {
      product_id: parseInt(item.g2a_product_id, 10),
      inventory_size: inventory.length,
      inventory
    };
  });
  res.status(200).json(response);
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

// --- 404 Handler (for unknown routes) ---
app.use((req, res, next) => {
  res.status(404).json({ error: 'Not Found', message: 'The requested resource was not found.' });
});

// --- Centralized Error Handler (for uncaught errors) ---
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

module.exports = app;