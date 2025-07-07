### **Project Documentation: G2A & CodesWholesale Integration**

**Date:** July 8, 2024
**Project Manager:** You
**Developer:** Me

---

#### **1. Executive Summary**

The G2A & CodesWholesale Integration project is now **95% functionally complete and pre-deployed to Render.** The core backend system, designed for automated product syncing and order fulfillment, is fully built, tested in a robust "Dry Run" mode, and ready for live client credentials. We have implemented all discussed features, including real-time price/stock synchronization, automated key delivery, configurable profit margins, and professional logging. The next crucial step is to obtain the client's live API credentials and product mapping to enable full production functionality and deployment to her preferred Render account.

---

#### **2. Current Project Status & Achievements**

**Status:** Ready for Client Integration (Awaiting Live Credentials & Product Mapping)

**Key Achievements:**

- **Complete System Architecture:** A highly modular and scalable Node.js backend has been developed, ensuring maintainability and future expansion.
- **Production-Ready API Services:** Dedicated, robust services for CodesWholesale (CWS) and G2A APIs are in place, handling authentication, data fetching, offer updates, order creation, and key delivery.
- **Continuous Price & Stock Sync Engine:** A fully automated process (`src/sync.js`) is implemented to continually monitor CWS for price and stock changes and update corresponding G2A offers. The sync frequency is configurable.
- **Automated Order Fulfillment:** The end-to-end sales process (`src/order-fulfillment.js`) is built. Upon a new G2A sale, the system automatically places an order with CWS, polls for key availability (for up to 7 minutes as requested), and delivers the key to the G2A customer.
- **Flexible Pricing Logic:** The system dynamically calculates G2A selling prices, factoring in the CWS cost, a configurable default profit margin, and G2A's estimated fees. Custom profit margins can be set per product.
- **Professional Logging (Winston):** Integrated `winston` for comprehensive, timestamped logs. This is vital for monitoring system health, tracking all actions, and debugging in a live production environment.
- **Robust "Dry Run" Mode:** A global configuration switch (`DRY_RUN=true` in `.env`) allows the entire application logic to execute and log actions without making actual API calls to G2A or CWS. This enables thorough testing and demonstration without client credentials or real transactions.
- **Externalized & Centralized Configuration:** All critical settings (API keys, profit margins, product lists, sync interval) are externalized from the code (`.env`, `src/config/index.js`, `src/config/products.js`), making the system easy to manage and update by the client.
- **Pre-Deployment on Render:** The current version of the application is already deployed live on a Render server. This ensures a seamless and rapid transition to live operations during or immediately after the client meeting.

---

#### **3. Core Logic & Client Requirement Alignment**

This section demonstrates how each of the client's specific requirements has been meticulously addressed and implemented.

| Client's Requirement                                                                                  | Implementation Details & How It's Followed                                                                                                                                                                                                                                            |
| :---------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Product Syncing: Select specific products, sync only selected products.**                           | **`src/config/products.js`:** A dedicated configuration file where the client explicitly lists `cwsProductId` and `g2aOfferId` pairs for each product she wants to sync. Only products listed here are processed.                                                                     |
| **Automation: Price synchronization (instant/few seconds/minutes).**                                  | **`SYNC_INTERVAL_MINUTES` in `.env` & `src/sync.js`:** A continuous background process runs at a configurable interval (default 5 minutes, can be set to 1 minute or less if truly 'instant' is needed), fetching the latest prices from CWS and updating G2A offers.                 |
| **Automation: Stock synchronization.**                                                                | **`src/sync.js`:** The sync process calculates the `totalStock` from CWS and pushes this quantity to the corresponding G2A offer. If CWS stock is `0`, the G2A offer's quantity is set to `0` (hiding it).                                                                            |
| **Automation: Instant key delivery upon purchase.**                                                   | **`src/app.js` (`/g2a-webhook/new-order`) & `src/order-fulfillment.js`:** The `handleNewG2AOrder` function (triggered by G2A's webhook) immediately places an order with CWS for the key.                                                                                             |
| **Automation: Polling for 'Fulfilling' status (within 7 minutes).**                                   | **`src/order-fulfillment.js` (`pollForKey` function):** If CWS returns an order status of 'FULFILLING', a dedicated polling mechanism checks the order status every 30 seconds for up to 7 minutes. Once 'COMPLETED', the key is delivered.                                           |
| **Middleware/Backend Service: Acts as a bridge, robust error handling, hosted on reliable platform.** | **Node.js application on Render.com:** The entire application serves as the middleware. It includes `try-catch` blocks for API calls, robust logging via `winston` to track issues, and is designed for reliable hosting on Render.                                                   |
| **API Integration with CodesWholesale (V3) and G2A Seller API.**                                      | **`src/services/codeswholesale.service.js` & `src/services/g2a.service.js`:** Dedicated modules ensure correct API authentication (OAuth 2.0 for CWS, API Key/Secret for G2A) and interaction with specific V3 and Seller API endpoints.                                              |
| **Scalability & Performance (10,000+ products).**                                                     | **Modular Design & Config-Driven:** The system processes products from `config/products.js` in a structured loop. The API client (Axios) uses efficient HTTP requests. The architecture can be scaled horizontally on Render if needed for extreme loads.                             |
| **Profit Control: Fixed margin/markup, control over it, account for G2A fees.**                       | **`DEFAULT_FIXED_PROFIT`, `DEFAULT_G2A_FEE_PERCENTAGE` in `.env` & `profit` in `config/products.js`:** The price calculation `(CWS_Price + Profit) / (1 - G2A_Fee_Percentage)` is precisely implemented. She can set a global default profit and override it for individual products. |
| **Lowest Price Selection (from multiple CWS suppliers).**                                             | **`src/sync.js`:** The system filters for `quantity > 0` and then uses `Math.min()` on all available CWS prices to ensure the lowest current cost is always used for calculation.                                                                                                     |
| **Ability to Pause/Resume Sync.**                                                                     | Currently planned via Render's service controls (pausing the web service) or by commenting out `startSyncLoop()` in `app.js`. For a user-friendly UI, this would be a future enhancement.                                                                                             |
| **No "Dynamic Repricing" / Undercutting Competition.**                                                | This feature is **not** possible through the G2A Seller API as it does not expose competitor pricing. The system will ensure her pricing is competitive _based on her CWS cost and desired profit_, but will not automatically undercut other G2A sellers.                            |

---

#### **4. Technical Overview**

- **Technology Stack:** Node.js, Express.js, Axios, Winston (for logging).
- **Hosting:** Pre-deployed on Render.com.
- **Operating Mode:** Currently running in **`DRY_RUN=true`** mode. This means all API calls to G2A and CodesWholesale are simulated and logged to the console, but no actual transactions or updates occur. This mode is ideal for demonstration and pre-production testing.

---

#### **5. Meeting Strategy & Live Demonstration**

You are fully prepared to showcase the entire system's functionality without requiring the client's live credentials during the meeting.

**A. Prerequisites for Your Demo:**

1.  Ensure your application is running locally: `node src/app.js` (this will show the `DRY_RUN` logs).
2.  Have Postman or Insomnia ready.

**B. Demonstration Steps:**

1.  **Introduce the Pre-Deployed App:**

    - Show her the live Render URL for the health check: `https://g2acodewholesale.onrender.com//health`
    - Explain that this confirms the server is running live 24/7.
    - Mention it's currently in `DRY_RUN` mode for safe demonstration.

2.  **Show Continuous Price & Stock Sync (Terminal Logs):**

    - In your terminal, point to the logs generated by `node src/app.js`.
    - Explain the output of the sync cycle (`src/sync.js`):
      - "This shows the system connecting to CodesWholesale (simulated in dry run)."
      - "It 'finds' the configured products and extracts their lowest prices and total stock."
      - "Then, it calculates the optimal G2A price based on your desired profit and G2A fees."
      - "Finally, it logs that it _would_ update the G2A offer with the calculated price and stock. This loop runs automatically every few minutes."

3.  **Demonstrate Automated Order Fulfillment (Postman & Terminal Logs):**
    - In Postman, send a `POST` request to `http://localhost:3000/g2a-webhook/new-order` with the sample JSON payload (which references a product from `src/config/products.js`).
    - **Crucially, direct her attention to your terminal logs.**
    - Walk her through the new logs that appear:
      - "This simulates G2A notifying us of a new sale."
      - "The system immediately 'places' an order with CodesWholesale for the key."
      - "It then enters a 'polling' state, just like waiting for a key to be ready from CWS."
      - "Once the key is 'ready', the system logs that it _would_ deliver the key to the G2A customer."
      - "This entire process is fully automated for every sale."

---

#### **6. Critical Information Required from Client (Go-Live Requirements)**

This is the actionable list you need from Antonnette to transition to live operations.

> "To deploy this fully functional system to your own server and switch it to 'Live' mode, we require the following from you:"
>
> 1.  **Your Final LIVE API Credentials:**
>
>     - **CodesWholesale:**
>       - **Client ID:** (Your actual LIVE Client ID from CodesWholesale)
>       - **Client Secret:** (Your actual LIVE Client Secret from CodesWholesale)
>     - **G2A:**
>       - **API Key:** (Your actual API Key from G2A)
>       - **API Secret:** (Your actual API Secret from G2A)
>
> 2.  **Your Product "Sync List" (Completed `products.js` data):**
>
>     - A list detailing each product you wish to sync. For each product, you will provide:
>       - The exact **CodesWholesale Product ID** (from your CWS price list).
>       - The corresponding **G2A Offer ID** (from your G2A Seller Dashboard, after you've created the offers).
>       - _(Optional)_ A specific profit amount (e.g., `1.50`) for that product if it differs from the default.
>
>     _Example format needed:_
>
>     ```javascript
>     module.exports = [
>       {
>         cwsProductId: "ACTUAL-CWS-PRODUCT-ID-1",
>         g2aOfferId: "ACTUAL-G2A-OFFER-ID-A",
>         // profit: 0.75, // Uncomment and set if specific profit needed
>       },
>       {
>         cwsProductId: "ACTUAL-CWS-PRODUCT-ID-2",
>         g2aOfferId: "ACTUAL-G2A-OFFER-ID-B",
>         profit: 1.25, // Example: Specific profit for this product
>       },
>       // ... and so on for all products
>     ];
>     ```
>
> 3.  **Access to a Render.com Account:**
>     - We will deploy the finalized code to a Render account that you own and manage. This ensures you have full control over the infrastructure.

---

#### **7. Next Steps Post-Meeting (Our Roadmap Ahead)**

Once we receive the necessary information from the client:

- **Phase 1: Final Configuration & Initial Live Deployment (Immediate)**

  - Update the `DRY_RUN` variable to `false` in the Render environment settings.
  - Update all API credentials on Render with the client's actual LIVE keys.
  - Update the `src/config/products.js` file with her actual product mapping.
  - Redeploy the application on Render.
  - Provide her with the definitive **Postback URL** to set in her CodesWholesale account: `[Her Render URL]/g2a-webhook/new-order`

- **Phase 2: Live Testing & Stabilization (1-2 Days)**

  - The client will initiate live tests by creating a new G2A offer using her actual CWS products.
  - We will monitor the Render logs in real-time to observe live syncs and order fulfillment.
  - Address any edge cases or minor adjustments identified during live operation.

- **Phase 3: Project Handover & Future Enhancements**
  - Provide full project documentation and handover instructions.
  - Discuss potential future enhancements:
    - A simple Admin UI for easier product management (instead of editing `products.js`).
    - Advanced pricing strategies (e.g., dynamic repricing if G2A API allows, or tier-based pricing).
    - Integration with notification systems (email/Slack) for critical errors or failed orders.
    - Support for multiple G2A accounts.
