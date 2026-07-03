/**
 * HTTP layer integration tests — use supertest against the Express app directly.
 * No real database required for these tests (auth guard rejects before hitting DB,
 * health endpoints have no DB dependency, error cases are handled in middleware).
 *
 * If the DB connection string is wrong the server will still boot (Prisma connects
 * lazily) and these tests will still pass.
 */

import request from 'supertest';
import app from '../../src/app';

describe('Health endpoints', () => {
  it('GET /v1/health returns 200 with ok status', async () => {
    const res = await request(app).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
  });

  it('GET /v1/health/security returns security feature flags', async () => {
    const res = await request(app).get('/v1/health/security');
    expect(res.status).toBe(200);
    expect(res.body.data.securityHeaders).toBe('enabled');
    expect(res.body.data.rateLimit).toBe('enabled');
    expect(res.body.data.auditLogging).toBe('enabled');
    expect(res.body.data.bodyLimit).toBe('1mb');
  });
});

describe('Security headers (helmet)', () => {
  it('sets X-Content-Type-Options: nosniff', async () => {
    const res = await request(app).get('/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options', async () => {
    const res = await request(app).get('/v1/health');
    expect(res.headers['x-frame-options']).toBeDefined();
  });
});

describe('404 handling', () => {
  it('returns 404 JSON for unknown routes', async () => {
    const res = await request(app).get('/v1/does-not-exist-xyz');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('Body size limit', () => {
  it('returns 413 when JSON body exceeds 1 MB', async () => {
    const bigPayload = JSON.stringify({ data: 'x'.repeat(1_100_000) });
    const res = await request(app)
      .post('/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(bigPayload);
    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
  });
});

describe('Auth guard', () => {
  it('GET /v1/donor/status without token returns 401', async () => {
    const res = await request(app).get('/v1/donor/status');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('GET /v1/notifications without token returns 401', async () => {
    const res = await request(app).get('/v1/notifications');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('GET /v1/messages without token returns 401', async () => {
    const res = await request(app).get('/v1/messages');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('CORS', () => {
  it('responds to OPTIONS preflight with 204 or 200', async () => {
    const res = await request(app)
      .options('/v1/health')
      .set('Origin', 'http://localhost:8081')
      .set('Access-Control-Request-Method', 'GET');
    expect([200, 204]).toContain(res.status);
  });
});
