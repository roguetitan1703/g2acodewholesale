// src/order-fulfillment.js
const logger = require("./logger");
const cwsService = require("./services/codeswholesale.service");
const g2aService = require("./services/g2a.service");

const POLLING_INTERVAL_MS = 30 * 1000; // 30 seconds
const POLLING_TIMEOUT_MS = 7 * 60 * 1000; // 7 minutes

const pollForKey = async (orderId, g2aOfferId) => {
  const startTime = Date.now();
  logger.info(`Starting to poll for CWS order ${orderId}...`);

  const poll = async () => {
    if (Date.now() - startTime > POLLING_TIMEOUT_MS) {
      logger.error(
        `Polling for CWS order ${orderId} timed out after 7 minutes. Manual intervention required.`
      );
      return;
    }

    try {
      const orderDetails = await cwsService.getOrder(orderId);
      if (orderDetails.status === "COMPLETED") {
        logger.info(
          `CWS order ${orderId} is COMPLETED. Delivering keys to G2A offer ${g2aOfferId}.`
        );
        const keys = orderDetails.codes.map((c) => c.code);
        await g2aService.addKeysToOffer(g2aOfferId, keys);
        logger.info(
          `Successfully delivered ${keys.length} key(s) for order ${orderId}.`
        );
      } else if (orderDetails.status === "FULFILLING") {
        logger.info(
          `CWS order ${orderId} is still FULFILLING. Polling again in ${
            POLLING_INTERVAL_MS / 1000
          }s.`
        );
        setTimeout(poll, POLLING_INTERVAL_MS);
      } else {
        logger.error(
          `CWS order ${orderId} has failed with status: ${orderDetails.status}. Manual intervention required.`
        );
      }
    } catch (error) {
      logger.error(
        `Error while polling for CWS order ${orderId}: ${error.message}`
      );
      setTimeout(poll, POLLING_INTERVAL_MS); // Retry on error
    }
  };

  poll();
};

const handleNewG2AOrder = async (g2aOrderData) => {
  const { cwsProductId, g2aOfferId, maxPrice } = g2aOrderData;
  logger.info(`Handling new order for CWS Product ${cwsProductId}`);

  try {
    const cwsOrder = await cwsService.createOrder(cwsProductId, maxPrice);
    if (cwsOrder.status === "FULFILLING") {
      await pollForKey(cwsOrder.orderId, g2aOfferId);
    } else {
      logger.error(
        `CWS order creation for ${cwsProductId} resulted in unexpected status: ${cwsOrder.status}. Manual intervention required.`
      );
    }
  } catch (error) {
    logger.error(
      `Failed to create CWS order for ${cwsProductId}: ${error.message}. Manual intervention required.`
    );
  }
};

module.exports = { handleNewG2AOrder };
