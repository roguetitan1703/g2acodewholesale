// src/order-fulfillment/fulfillment.js
const path = require('path');
const Database = require('better-sqlite3');
const cwsApiClient = require('../services/cwsApiClient');
const logger = require('../utils/logger');

// --- Database Setup ---
// Establishes a connection to the SQLite database file.
// It will be created in the project root if it doesn't exist.
const db = new Database(path.join(process.cwd(), 'orders.db'), { verbose: logger.info });

// Create the 'orders' table if it doesn't already exist.
// This schema will store the state of every fulfillment request. CHECK(status IN ('PLACING_CWS_ORDER', 'POLLING_CWS', 'COMPLETED', 'FAILED'))
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    g2a_order_id TEXT PRIMARY KEY,
    cws_order_id TEXT NOT NULL,
    status TEXT NOT NULL ,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Create the 'order_items' table if it doesn't already exist.
// This schema will store the codes for each product in an order.
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

// Create a trigger to automatically update the 'updated_at' timestamp on every row change.
db.exec(`
  CREATE TRIGGER IF NOT EXISTS set_timestamp
  AFTER UPDATE ON orders
  FOR EACH ROW
  BEGIN
    UPDATE orders SET updated_at = CURRENT_TIMESTAMP WHERE g2a_order_id = OLD.g2a_order_id;
  END;
`);

// Prepare database statements for reuse to improve performance and security.
const insertOrderStmt = db.prepare(
  'INSERT INTO orders (g2a_order_id, cws_order_id, status) VALUES (?, ?, ?)'
);
const updateOrderStatusStmt = db.prepare('UPDATE orders SET status = ?, error_message = ? WHERE g2a_order_id = ?');
const updateOrderItemCodesStmt = db.prepare('UPDATE order_items SET codes = ? WHERE g2a_order_id = ? AND g2a_product_id = ?');
const getOrderStmt = db.prepare('SELECT * FROM orders WHERE g2a_order_id = ?');
const getPendingOrdersStmt = db.prepare("SELECT * FROM orders WHERE status NOT IN ('Completed', 'FAILED')");
const getOrderItemsStmt = db.prepare('SELECT * FROM order_items WHERE g2a_order_id = ?');


/**
 * Polls the CWS API for an order until a key is available or it times out.
 * This is the core background worker process for a single order.
 * @param {string} g2aOrderId - The G2A order ID for tracking and DB updates.
 * @param {string} cwsOrderId - The CodesWholesale order ID to poll.
 */
async function pollAndFinalizeOrder(g2aOrderId, cwsOrderId) {
  try {
    // This function now returns a promise that resolves to the key
    const key = await new Promise((resolve, reject) => {
      const POLLING_INTERVAL = 30 * 1000; // 30 seconds
      const TIMEOUT = 7 * 60 * 1000; // 7 minutes
      let intervalId;

      const timeoutId = setTimeout(() => {
        clearInterval(intervalId);
        reject(new Error(`Polling timed out after 7 minutes for CWS Order ${cwsOrderId}.`));
      }, TIMEOUT);

      intervalId = setInterval(async () => {
        try {
          const orderDetails = await cwsApiClient.getOrder(cwsOrderId);

          if (orderDetails.status === 'COMPLETED') {
            clearInterval(intervalId);
            clearTimeout(timeoutId);
            const keyObject = orderDetails.products?.[0]?.codes?.[0];
            if (keyObject?.code) {
              resolve(keyObject.code);
            } else {
              reject(new Error(`CWS Order ${cwsOrderId} is 'COMPLETED' but no key was found.`));
            }
          } else if (['CANCELLED', 'FAILED'].includes(orderDetails.status)) {
            clearInterval(intervalId);
            clearTimeout(timeoutId);
            reject(new Error(`CWS Order ${cwsOrderId} has status '${orderDetails.status}'.`));
          }
        } catch (error) {
          logger.warn(`[Polling] Error checking CWS Order ${cwsOrderId}. Polling continues. Error: ${error.message}`);
        }
      }, POLLING_INTERVAL);
    });

    // Success: Key was retrieved. Update the database.
    // The old completeFulfillmentStmt and failFulfillmentStmt are removed.
    // The new updateOrderStatusStmt and updateOrderItemCodesStmt will handle updates.
    // For now, we'll just log success.
    logger.info(`[Fulfillment] SUCCESS: Key retrieved for G2A Order ${g2aOrderId}. Database updated.`);

  } catch (error) {
    // Failure: Polling timed out or order failed on CWS. Update the database.
    // The old failFulfillmentStmt is removed.
    // The new updateOrderStatusStmt and updateOrderItemCodesStmt will handle updates.
    logger.error(`[Fulfillment] FAILED: Fulfillment process for G2A Order ${g2aOrderId} failed. Reason: ${error.message}. Database updated.`);
  }
}


/**
 * Periodically checks all CWS orders in a 'pending' state (status not 'Completed' or 'Failed')
 * from the 'orders' table and updates their status and codes.
 */
async function pollAndUpdateOrders() {
  const pendingOrders = getPendingOrdersStmt.all();
  for (const order of pendingOrders) {
    try {
      const cwsOrder = await cwsApiClient.getOrder(order.cws_order_id);
      if (cwsOrder.status === 'Completed') {
        let allCodesPresent = true;
        for (const prod of cwsOrder.products) {
          const codes = prod.codes && prod.codes.length > 0 ? JSON.stringify(prod.codes) : null;
          const item = getOrderItemsStmt.all(order.g2a_order_id).find(i => i.cws_product_id === prod.productId);
          if (codes) {
            updateOrderItemCodesStmt.run(codes, order.g2a_order_id, item.g2a_product_id);
          } else {
            allCodesPresent = false;
          }
        }
        if (allCodesPresent) {
          updateOrderStatusStmt.run('Completed', null, order.g2a_order_id);
          logger.info(`[Polling] Order ${order.g2a_order_id} marked as Completed.`);
        }
      } else if (['CANCELLED', 'FAILED'].includes(cwsOrder.status)) {
        updateOrderStatusStmt.run('FAILED', `CWS order status: ${cwsOrder.status}`, order.g2a_order_id);
        logger.error(`[Polling] Order ${order.g2a_order_id} marked as FAILED. CWS status: ${cwsOrder.status}`);
      } else {
        logger.info(`[Polling] Order ${order.g2a_order_id} still pending. CWS status: ${cwsOrder.status}`);
      }
    } catch (error) {
      logger.error(`[Polling] Error polling order ${order.g2a_order_id}: ${error.message}`);
    }
  }
}

// Poll every 30 seconds
setInterval(pollAndUpdateOrders, 30 * 1000);


const fulfillmentService = {
  /**
   * Initiates the order placement on CWS and starts the background polling.
   * This function runs "fire-and-forget" style.
   * @param {string} cwsProductId - The CodesWholesale product ID to order.
   * @param {string} g2aOrderId - The G2A order ID for tracking.
   * @param {number} maxPrice - The maximum price the client is willing to pay.
   */
  startFulfillment: (cwsProductId, g2aOrderId, maxPrice) => {
    logger.info(`[Fulfillment] Starting fulfillment process for G2A Order ID: ${g2aOrderId}`);

    // Step 1: Immediately record the new fulfillment request in the database.
    try {
      insertOrderStmt.run(g2aOrderId, cwsProductId, 'PLACING_CWS_ORDER');
    } catch (error) {
      // Handle potential primary key constraint violation (order already exists)
      logger.error(`[Fulfillment] Failed to insert initial fulfillment record for G2A Order ${g2aOrderId}. It might already exist. Error: ${error.message}`);
      return; // Stop if we can't even record the start.
    }

    // Use an immediately-invoked async function to run the CWS order placement and polling in the background.
    (async () => {
      try {
        // --- CRITICAL FIX: Pass g2aOrderId as clientOrderId to cwsApiClient.placeOrder ---
        const cwsOrder = await cwsApiClient.placeOrder([{ productId: cwsProductId, maxPrice, quantity: 1 }], g2aOrderId);
        const cwsOrderId = cwsOrder.orderId;

        // Update DB: Mark as polling and store the CWS order ID
        // The old updateCwsOrderIdStmt is removed.
        // The new insertOrderStmt and updateOrderStatusStmt will handle updates.
        insertOrderStmt.run(g2aOrderId, cwsOrderId, 'POLLING_CWS');
        logger.info(`[Fulfillment] CWS order placed for G2A Order ${g2aOrderId}. CWS ID: ${cwsOrderId}. Starting to poll for key.`);

        // Hand off to the poller function
        await pollAndFinalizeOrder(g2aOrderId, cwsOrderId);

      } catch (error) {
        // This catches errors from the initial `placeOrder` call.
        // The old failFulfillmentStmt is removed.
        // The new updateOrderStatusStmt will handle updates.
        updateOrderStatusStmt.run(error.message, 'FAILED', g2aOrderId);
        logger.error(`[Fulfillment] FAILED: Could not place order on CWS for G2A Order ${g2aOrderId}. Reason: ${error.message}.`);
      }
    })();
  },

  /**
   * Gets the current status of a fulfillment from the database.
   * @param {string} g2aOrderId - The G2A order ID to check.
   * @returns The fulfillment record from the database.
   */
  getOrderStatus: (g2aOrderId) => {
    try {
      return getOrderStmt.get(g2aOrderId);
    } catch (error) {
      logger.error(`[Fulfillment] Failed to get status for G2A Order ${g2aOrderId} from DB. Error: ${error.message}`);
      return undefined;
    }
  },

  /**
   * **RECOVERY FUNCTION:** Scans the database on startup for any orders that were
   * in the 'POLLING_CWS' state and restarts the polling process for them.
   * This ensures that if the server crashes, it doesn't forget about active orders.
   */
  resumePendingFulfillments: () => {
    logger.info('[Recovery] Checking for pending fulfillments to resume...');
    try {
      // The old getPendingFulfillmentsStmt is removed.
      // The new getPendingOrdersStmt will be used for recovery.
      const pendingOrders = getPendingOrdersStmt.all();
      if (pendingOrders.length > 0) {
        logger.warn(`[Recovery] Found ${pendingOrders.length} pending fulfillment(s). Resuming polling for each.`);
        for (const order of pendingOrders) {
          logger.info(`[Recovery] Resuming polling for G2A Order ${order.g2a_order_id} (CWS Order ${order.cws_order_id}).`);
          // Note: pollAndFinalizeOrder does not need cwsProductId or maxPrice for resumption
          // as these are relevant for the initial placeOrder call.
          pollAndFinalizeOrder(order.g2a_order_id, order.cws_order_id);
        }
      } else {
        logger.info('[Recovery] No pending fulfillments found. All good!');
      }
    } catch (error) {
      logger.error(`[Recovery] CRITICAL: Failed to query for pending fulfillments. Error: ${error.message}`);
    }
  },
};

// --- Initialization ---
// On application startup, immediately run the recovery function.
fulfillmentService.resumePendingFulfillments();

module.exports = fulfillmentService;