// src/tests/pricing.test.js
const calculateG2aPrice = (cwsPrice, profit, fee) => {
  return (cwsPrice + profit) / (1 - fee);
};

describe("Pricing Calculator", () => {
  test("should correctly calculate the final price", () => {
    // cwsPrice: 10, profit: 1, fee: 20% (0.2)
    // Expected: (10 + 1) / (1 - 0.2) = 11 / 0.8 = 13.75
    expect(calculateG2aPrice(10, 1, 0.2)).toBeCloseTo(13.75);
  });
});
