const request = require('supertest');
const app = require('../src/app');

// Mock credentials for auth
const basicAuth = 'Basic ' + Buffer.from(`${process.env.OUR_API_CLIENT_ID}:${process.env.OUR_API_CLIENT_SECRET}`).toString('base64');

describe('API Endpoints', () => {
  it('GET /health should return 200 OK', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.text).toBe('OK');
  });

  it('POST /reservation without auth should return 401', async () => {
    const res = await request(app)
      .post('/reservation')
      .send([{ product_id: 123, quantity: 1 }]);
    expect(res.statusCode).toBe(401);
  });

  it('POST /order without auth should return 401', async () => {
    const res = await request(app)
      .post('/order')
      .send({ reservation_id: 'fake', g2a_order_id: 'fake' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /order/fake/inventory without auth should return 401', async () => {
    const res = await request(app)
      .get('/order/fake/inventory');
    expect(res.statusCode).toBe(401);
  });

  // --- E2E Flows ---
  let reservationId;
  let g2aOrderId = 'test-g2a-order-1';
  let testProductId = '10000068865001';
  let testProductId2 = '10000068865002';

  it('POST /reservation (multi-product) should succeed', async () => {
    const res = await request(app)
      .post('/reservation')
      .set('Authorization', basicAuth)
      .send([
        { product_id: testProductId, quantity: 1 },
        { product_id: testProductId2, quantity: 2 }
      ]);
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('reservation_id');
    expect(res.body.stock.length).toBe(2);
    reservationId = res.body.reservation_id;
  });

  it('POST /order should succeed and return 202 or 200', async () => {
    const res = await request(app)
      .post('/order')
      .set('Authorization', basicAuth)
      .send({ reservation_id: reservationId, g2a_order_id: g2aOrderId });
    expect([200, 202]).toContain(res.statusCode);
    expect(res.body).toHaveProperty('order_id');
  });

  it('GET /order/:orderId/inventory should return inventory array', async () => {
    const res = await request(app)
      .get(`/order/${g2aOrderId}/inventory`)
      .set('Authorization', basicAuth);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Inventory may be empty if codes are not ready yet
  });

  it('DELETE /reservation/:reservation_id should return 404 after use', async () => {
    const res = await request(app)
      .delete(`/reservation/${reservationId}`)
      .set('Authorization', basicAuth);
    expect([400, 404]).toContain(res.statusCode);
  });

  it('POST /reservation with insufficient stock should return 409', async () => {
    const res = await request(app)
      .post('/reservation')
      .set('Authorization', basicAuth)
      .send([{ product_id: testProductId, quantity: 999999 }]);
    expect([409, 404]).toContain(res.statusCode);
  });

  it('POST /order with expired reservation should return 410', async () => {
    const res = await request(app)
      .post('/order')
      .set('Authorization', basicAuth)
      .send({ reservation_id: 'expired-or-fake', g2a_order_id: 'fake' });
    expect(res.statusCode).toBe(410);
  });

  // Add more tests for account/file key types and error flows as needed
}); 