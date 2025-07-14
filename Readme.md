# G2A Code Wholesale Integration Backend

## Absolute Requirements (Scope & Working)
- **Sync product stock and price** from CodesWholesale (CWS) to G2A offers.
- **Expose API endpoints** for G2A Merchant API contract (reservation, order, inventory delivery).
- **Handle inbound G2A calls**: reserve stock, create order, deliver keys.
- **Persist all reservations and fulfillments** (SQLite).
- **Support multiple key delivery per order.**
- **Robust error handling, input validation, and logging.**

## Current Technical Implementation
- **Node.js/Express backend** (no frontend).
- **CWS and G2A API clients** with OAuth2, token refresh, and error handling.
- **Product sync job**: fetches CWS product data, updates G2A offers (price/stock), deactivates out-of-stock offers.
- **Reservation/order/fulfillment logic**: persists all state, recovers on restart.
- **API endpoints**: `/health`, `/reservation`, `/order`, `/order/:orderId/inventory`.
- **Test suite**: Jest + Supertest for endpoint validation.

## What Needs Attention / To Be Taken Care Of
- **G2A inbound contract**: All endpoints must match G2A's required request/response formats and error codes.
- **Multiple key delivery**: Fulfillment and inventory endpoints must support delivering multiple keys per order (array of keys, not just one).
- **CWS order creation**: CWS may fulfill orders instantly; polling logic must handle both instant and delayed fulfillment.
- **Defensive coding**: All external API responses must be validated for required fields before use.
- **Offer auto-creation**: If a product is missing as a G2A offer, log and optionally create it.
- **Environment variable validation**: App fails fast if misconfigured.

---

## Endpoint-by-Endpoint Breakdown

### 1. `GET /health`
- **Purpose**: Health check for G2A contract.
- **Returns**: `200 OK` with body `OK`.
- **No auth required.**

### 2. `POST /reservation`
- **Purpose**: G2A reserves stock before customer payment.
- **Auth**: Basic Auth (client ID/secret from env).
- **Request**: Array of `{ product_id, quantity }`.
- **Flow**:
  - Validate auth and input.
  - Map G2A product ID to CWS product ID.
  - Fetch product data from CWS (live or cached).
  - If enough stock, create reservation (DB, 30 min expiry), return reservation ID and current stock.
  - If not enough stock, return 409.
- **Response**: `{ reservation_id, stock: [{ product_id, inventory_size }] }`
- **Error Codes**: 401 (auth), 404 (product), 409 (stock), 500 (server)

### 3. `POST /order`
- **Purpose**: G2A confirms order after payment.
- **Auth**: Basic Auth.
- **Request**: `{ reservation_id, g2a_order_id }`
- **Flow**:
  - Validate auth and input.
  - Lookup reservation (DB), check expiry.
  - Map to CWS product ID.
  - Place CWS order (using reservation, pass G2A order ID as clientOrderId).
  - Start fulfillment: poll CWS for completion, store keys in DB.
  - Respond 202 immediately; fulfillment runs in background.
- **Response**: `{ order_id, message }`
- **Error Codes**: 401, 410 (reservation expired), 500

### 4. `GET /order/:orderId/inventory`
- **Purpose**: G2A fetches keys for a completed order.
- **Auth**: Basic Auth.
- **Flow**:
  - Lookup fulfillment by G2A order ID (DB).
  - If status is COMPLETED and keys are present, return all keys in required format (array, with kind, id, value).
  - If status is FAILED, return 500 with error message.
  - If not ready, return 200 with empty array.
- **Response**: Array of inventory objects:
  ```json
  [
    {
      "product_id": 123,
      "inventory_size": 1,
      "inventory": [
        { "id": "uuid", "kind": "text", "value": "KEY-XXXX" },
        ...
      ]
    }
  ]
  ```
- **Error Codes**: 401, 404 (order), 500 (failed fulfillment)

---

## Data Handling & Flows

### Product Sync
- Loads product config, fetches CWS data (batch or single), updates G2A offers.
- If CWS product is out of stock, deactivates G2A offer.
- Price is calculated: `g2aPrice = (cwsCost + profit) / (1 - feePercent)`

### Reservation
- Reservation is created in DB with expiry.
- Only one reservation per product per request.
- Expired reservations are cleaned up hourly.

### Order & Fulfillment
- On order, reservation is validated and removed.
- CWS order is placed; G2A order ID is used as clientOrderId.
- Fulfillment is tracked in DB: status, CWS order ID, keys, errors.
- Polls CWS for completion; on success, stores all keys.
- On restart, resumes polling for any incomplete fulfillments.

### Inventory Delivery
- When G2A requests inventory, DB is checked for fulfillment.
- If completed, all keys are returned in required format (supporting multiple keys).
- If not ready, returns empty array.
- If failed, returns error.

---

## G2A Merchant API Inbound Implementation
- All endpoints match G2A contract for request/response and error codes.
- Auth is enforced as per G2A requirements.
- Handles reservation, order, and inventory flows as described above.
- Multiple key delivery is supported (array of keys per order).
- Defensive coding: all external data is validated before use.

---

## CWS Order Creation
- Orders are placed via `/v3/orders` with correct structure.
- CWS may fulfill instantly or with delay; polling logic handles both.
- All keys from CWS response are stored and delivered.

---

## Testing
- Jest + Supertest tests for all main endpoints (success and error cases).
- Manual test script for API client authentication.

---

## Summary
- This backend is a robust, production-ready bridge between G2A and CodesWholesale.
- All flows are persisted, validated, and logged.
- Multiple key delivery, error handling, and contract compliance are core.
- No overengineering—just a solid, maintainable, and correct implementation.