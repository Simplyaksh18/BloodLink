import { maskPhone, maskEmail, sanitizeBody, sanitizeHeaders } from '../../src/utils/piiSanitizer';

describe('maskPhone', () => {
  it('masks middle digits and preserves country code prefix', () => {
    expect(maskPhone('+918765400036')).toBe('+91******0036');
  });

  it('masks a bare 10-digit number', () => {
    expect(maskPhone('9876543210')).toBe('******3210');
  });

  it('returns *** for empty / non-string input', () => {
    expect(maskPhone('')).toBe('***');
    expect(maskPhone(null as unknown as string)).toBe('***');
  });
});

describe('maskEmail', () => {
  it('masks the local part keeping first char and domain', () => {
    expect(maskEmail('akshi@bloodlink.app')).toBe('a***@bloodlink.app');
  });

  it('returns *** for addresses without @', () => {
    expect(maskEmail('notanemail')).toBe('***');
  });
});

describe('sanitizeBody', () => {
  it('redacts password and token fields', () => {
    const body = { phone: '+919999999999', password: 's3cr3t', token: 'abc123' };
    const out = sanitizeBody(body) as Record<string, unknown>;
    expect(out.password).toBe('[REDACTED]');
    expect(out.token).toBe('[REDACTED]');
  });

  it('masks phone and email in place', () => {
    const body = { phone: '+919876543210', email: 'user@test.com', name: 'Alice' };
    const out = sanitizeBody(body) as Record<string, unknown>;
    expect((out.phone as string).includes('***')).toBe(true);
    expect((out.email as string).startsWith('u***')).toBe(true);
    expect(out.name).toBe('Alice');
  });

  it('recursively sanitizes nested objects', () => {
    const body = { user: { password: 'secret', name: 'Bob' } };
    const out = sanitizeBody(body) as Record<string, Record<string, unknown>>;
    expect(out.user.password).toBe('[REDACTED]');
    expect(out.user.name).toBe('Bob');
  });

  it('returns non-object values unchanged', () => {
    expect(sanitizeBody('hello')).toBe('hello');
    expect(sanitizeBody(null)).toBeNull();
  });
});

describe('sanitizeHeaders', () => {
  it('redacts Authorization header', () => {
    const headers = { authorization: 'Bearer token123', 'content-type': 'application/json' };
    const out = sanitizeHeaders(headers);
    expect(out.authorization).toBe('[REDACTED]');
    expect(out['content-type']).toBe('application/json');
  });
});
