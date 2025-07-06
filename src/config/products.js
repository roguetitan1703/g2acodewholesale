// src/config/products.js
// This is the mapping of products to sync.
// The client will provide this information.

// Example:
// {
//   cwsProductId: "The product ID from CodesWholesale",
//   g2aOfferId: "The corresponding offer ID from her G2A account",
//   profit: 0.75, (Optional: overrides the default profit for this specific product)
// }

module.exports = [
  {
    cwsProductId: "4f783f70-2717-11e7-93ae-0242ac110002",
    g2aOfferId: "SAMPLE-G2A-OFFER-ID-MINECRAFT-123",
    // No profit specified, so it will use the default from .env
  },
  {
    cwsProductId: "another-cws-product-id-456",
    g2aOfferId: "SAMPLE-G2A-OFFER-ID-CYBERPUNK-456",
    profit: 1.25, // This product will use a specific $1.25 profit
  },
];
