import { describe, expect, it } from 'vitest';
import { anon, createTestUser } from './helpers';
import { prisma } from '../../src/server/db';
import { findValidSession, hashToken } from '../../src/server/services/session';

describe('core HTTP behaviour', () => {
  it('reports health without leaking configuration', async () => {
    const res = await anon().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok' });
    expect(JSON.stringify(res.body)).not.toMatch(/postgres|password|secret/i);
  });

  it('sets security headers', async () => {
    const res = await anon().get('/api/health');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('rejects unauthenticated access to private endpoints', async () => {
    for (const path of ['/api/dashboard', '/api/foods', '/api/settings', '/api/reminders', '/api/export']) {
      const res = await anon().get(path);
      expect(res.status, path).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('rejects state-changing requests without a matching CSRF token', async () => {
    const { token } = await createTestUser();
    const noHeader = await anon().post('/api/water').set('Cookie', `mf_session=${token}; mf_csrf=abc`).send({});
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.error.code).toBe('CSRF_FAILED');
    const mismatch = await anon()
      .post('/api/water')
      .set('Cookie', `mf_session=${token}; mf_csrf=abc`)
      .set('X-CSRF-Token', 'xyz')
      .send({});
    expect(mismatch.status).toBe(403);
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const { api } = await createTestUser();
    const res = await api.get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('stores only hashed session tokens and expires sessions', async () => {
    const { token, user } = await createTestUser();
    const row = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.tokenHash).toBe(hashToken(token));
    expect(row.tokenHash).not.toContain(token);
    await prisma.session.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await findValidSession(token)).toBeNull();
  });

  it('rejects malformed JSON with a 400', async () => {
    const { api } = await createTestUser();
    const res = await api.post('/api/water').set('Content-Type', 'application/json').send('{"bad json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_JSON');
  });
});
