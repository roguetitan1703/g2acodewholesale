// src/config/products.js
// This is the mapping of products to sync.
// The client will provide this information.

module.exports = [
  {
    cwsProductId: "3d11fc79-1e20-41f4-926f-4bcca5c9a579", // Balatro CodesWholesale ID
    g2aOfferId: "i10000503618004", // Balatro G2A Offer ID
    // No profit specified, so it will use the default from .env
  },
  // Remove old sample products if no longer needed, or keep for reference
  // {
  //     cwsProductId: "4f783f70-2717-11e7-93ae-0242ac110002",
  //     g2aOfferId: "SAMPLE-G2A-OFFER-ID-MINECRAFT-123",
  // },
  // {
  //     cwsProductId: "another-cws-product-id-456",
  //     g2aOfferId: "SAMPLE-G2A-OFFER-ID-CYBERPUNK-456",
  //     profit: 1.25,
  // },
];
