const request = require('supertest');
const app = require('../src/app');

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

  // Add more tests as needed for your flows
}); 