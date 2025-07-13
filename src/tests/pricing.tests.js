// src/tests/pricing.test.js
// This file is for unit testing the pricing calculation logic.

// Function to be tested (extract from sync.js or put in a separate utility)
const calculateG2aPrice = (cwsPrice, profit, fee) => {
  if (fee >= 1) throw new Error("Fee percentage must be less than 1 (100%)");
  if (cwsPrice < 0) throw new Error("CWS price cannot be negative");
  if (profit < 0) throw new Error("Profit cannot be negative"); // Assuming non-negative profit

  return (cwsPrice + profit) / (1 - fee);
};

describe("Pricing Calculator", () => {
  test("should correctly calculate the final price with a positive profit and typical fee", () => {
    // cwsPrice: $10, profit: $1, fee: 20% (0.2)
    // Expected: ($10 + $1) / (1 - 0.2) = $11 / 0.8 = $13.75
    expect(calculateG2aPrice(10, 1, 0.2)).toBeCloseTo(13.75);
  });

  test("should calculate correctly with zero profit", () => {
    // cwsPrice: $10, profit: $0, fee: 20% (0.2)
    // Expected: ($10 + $0) / (1 - 0.2) = $10 / 0.8 = $12.50
    expect(calculateG2aPrice(10, 0, 0.2)).toBeCloseTo(12.5);
  });

  test("should calculate correctly with a high fee", () => {
    // cwsPrice: $5, profit: $0.50, fee: 0.50 (50%)
    // Expected: ($5 + $0.50) / (1 - 0.50) = $5.50 / 0.50 = $11.00
    expect(calculateG2aPrice(5, 0.5, 0.5)).toBeCloseTo(11.0);
  });

  test("should throw an error for fee >= 1", () => {
    expect(() => calculateG2aPrice(10, 1, 1.0)).toThrow(
      "Fee percentage must be less than 1 (100%)"
    );
    expect(() => calculateG2aPrice(10, 1, 1.1)).toThrow(
      "Fee percentage must be less than 1 (100%)"
    );
  });

  test("should handle small numbers", () => {
    expect(calculateG2aPrice(0.1, 0.05, 0.01)).toBeCloseTo(0.1515);
  });
});
