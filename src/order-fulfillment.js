// src/order-fulfillment.js
const logger = require("./logger");
const cwsService = require("./services/codeswholesale.service");
const g2aService = require("./services/g2a.service");

const POLLING_INTERVAL_MS = 30 * 1000; // 30 seconds
const POLLING_TIMEOUT_MS = 7 * 60 * 1000; // 7 minutes

const pollForKey = async (orderId, g2aOfferId) => {
  const startTime = Date.now();
  logger.info(`Fulfillment: Starting to poll for CWS order ${orderId}...`);

  const poll = async () => {
    if (Date.now() - startTime > POLLING_TIMEOUT_MS) {
      logger.error(
        `Fulfillment: Polling for CWS order ${orderId} timed out after ${
          POLLING_TIMEOUT_MS / 60000
        } minutes. Manual intervention required.`
      );
      return;
    }

    try {
      const orderDetails = await cwsService.getOrder(orderId);
      if (
        orderDetails.status === "COMPLETED" &&
        orderDetails.codes &&
        orderDetails.codes.length > 0
      ) {
        logger.info(
          `Fulfillment: CWS order ${orderId} is COMPLETED. Delivering keys to G2A offer ${g2aOfferId}.`
        );
        const keys = orderDetails.codes.map((c) => c.code);
        await g2aService.addKeysToOffer(g2aOfferId, keys); // This is the call to G2A to deliver
        logger.info(
          `Fulfillment: Successfully delivered ${keys.length} key(s) for order ${orderId}.`
        );
      } else if (orderDetails.status === "FULFILLING") {
        logger.info(
          `Fulfillment: CWS order ${orderId} is still FULFILLING. Polling again in ${
            POLLING_INTERVAL_MS / 1000
          }s.`
        );
        setTimeout(poll, POLLING_INTERVAL_MS);
      } else {
        // Handle cases like order failed, cancelled, or completed but no codes
        logger.error(
          `Fulfillment: CWS order ${orderId} has non-completed status: ${orderDetails.status} or no codes found. Manual intervention required.`
        );
      }
    } catch (error) {
      logger.error(
        `Fulfillment: Error while polling for CWS order ${orderId}: ${error.message}`
      );
      // Re-schedule poll only if it hasn't timed out, to continue retrying on network errors
      if (Date.now() - startTime <= POLLING_TIMEOUT_MS) {
        setTimeout(poll, POLLING_INTERVAL_MS);
      }
    }
  };

  poll();
};

const handleNewG2AOrder = async (g2aOrderData) => {
  const { cwsProductId, g2aOfferId, maxPrice } = g2aOrderData;
  logger.info(
    `Fulfillment: Handling new order for CWS Product ${cwsProductId} for G2A offer ${g2aOfferId}`
  );

  // It's good practice to ensure maxPrice is a number and is not excessively low or zero,
  // though CWS might handle it, a check here adds robustness.
  if (typeof maxPrice !== "number" || maxPrice <= 0) {
    logger.error(
      `Fulfillment: Invalid maxPrice received for product ${cwsProductId}: ${maxPrice}. Skipping order creation.`
    );
    return;
  }

  try {
    const cwsOrder = await cwsService.createOrder(cwsProductId, maxPrice);
    if (cwsOrder && cwsOrder.orderId) {
      // Check for valid order object and ID
      if (cwsOrder.status === "FULFILLING" || cwsOrder.status === "COMPLETED") {
        // Directly completed orders are also possible
        await pollForKey(cwsOrder.orderId, g2aOfferId);
      } else {
        logger.error(
          `Fulfillment: CWS order creation for ${cwsProductId} resulted in unexpected status: ${cwsOrder.status}. Manual intervention required.`
        );
      }
    } else {
      logger.error(
        `Fulfillment: CWS order creation for ${cwsProductId} did not return a valid order ID. Manual intervention required.`
      );
    }
  } catch (error) {
    logger.error(
      `Fulfillment: Failed to create CWS order for ${cwsProductId}: ${error.message}. Manual intervention required.`
    );
  }
};

module.exports = { handleNewG2AOrder };
