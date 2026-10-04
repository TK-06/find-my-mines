import { describe, expect, it } from 'vitest';
import { adminAccess, clientAddress, isServerMachine } from './access.js';

/** This machine's own addresses, as os.networkInterfaces() would report them. */
const OWN = ['192.168.1.20', 'fe80::1c2b:3a4d'];

describe('isServerMachine', () => {
  it('accepts IPv4 loopback', () => {
    expect(isServerMachine('127.0.0.1', {}, OWN)).toBe(true);
  });

  it('accepts IPv6 loopback', () => {
    expect(isServerMachine('::1', {}, OWN)).toBe(true);
  });

  it('accepts IPv4-mapped loopback, which is how Node reports it on a dual-stack socket', () => {
    expect(isServerMachine('::ffff:127.0.0.1', {}, OWN)).toBe(true);
  });

  it("accepts this machine's own LAN address, for a browser on the server opening its LAN URL", () => {
    expect(isServerMachine('::ffff:192.168.1.20', {}, OWN)).toBe(true);
  });

  it('rejects another machine on the same network', () => {
    expect(isServerMachine('192.168.1.33', {}, OWN)).toBe(false);
  });

  it('rejects a missing address', () => {
    expect(isServerMachine(undefined, {}, OWN)).toBe(false);
  });

  it.each([
    'x-forwarded-for',
    'x-real-ip',
    'forwarded',
    'cf-connecting-ip',
    'true-client-ip',
    'x-client-ip',
    // VS Code port forwarding (Microsoft dev tunnels) sets X-Forwarded-Host.
    'x-forwarded-host',
    'x-forwarded-proto',
    'via',
  ])('rejects loopback traffic carrying %s, which tunnels and proxies add', (header) => {
    expect(isServerMachine('127.0.0.1', { [header]: '203.0.113.9' }, OWN)).toBe(false);
  });
});

describe('adminAccess', () => {
  const remote = { address: '198.51.100.7', headers: {}, auth: { accessToken: 'tok' } };

  it('lets the server machine in without asking the database', async () => {
    let asked = false;
    const lookup = async () => {
      asked = true;
      return 'someone';
    };
    const result = await adminAccess({ address: '127.0.0.1', headers: {}, auth: {} }, OWN, lookup);
    expect(result).toBe('server machine');
    expect(asked).toBe(false);
  });

  it('lets a remote admin account in, labelled by the account', async () => {
    const lookup = async (token: string | undefined) => (token === 'tok' ? 'owner@example.com' : null);
    expect(await adminAccess(remote, OWN, lookup)).toBe('owner@example.com');
  });

  it('refuses a remote connection whose account is not an admin', async () => {
    expect(await adminAccess(remote, OWN, async () => null)).toBeNull();
  });

  it('refuses, rather than hanging or crashing the server, when the lookup throws', async () => {
    const lookup = async (): Promise<string | null> => {
      throw new Error('database unreachable');
    };
    expect(await adminAccess(remote, OWN, lookup)).toBeNull();
  });

  it('passes no token on when the handshake token is not a string', async () => {
    let received: string | undefined = 'unset';
    const lookup = async (token: string | undefined) => {
      received = token;
      return null;
    };
    await adminAccess({ ...remote, auth: { accessToken: 42 } }, OWN, lookup);
    expect(received).toBeUndefined();
  });

  describe('with ADMIN_TOKEN', () => {
    const SECRET = 'correct-horse-battery-staple';
    const noAccount = async () => null;

    it('lets a remote connection in when its handshake carries the token', async () => {
      const withToken = { ...remote, auth: { token: SECRET } };
      expect(await adminAccess(withToken, OWN, noAccount, SECRET)).toBe('admin token');
    });

    it('refuses a wrong token', async () => {
      const wrong = { ...remote, auth: { token: 'guess' } };
      expect(await adminAccess(wrong, OWN, noAccount, SECRET)).toBeNull();
    });

    it('refuses a token that is not a string', async () => {
      const odd = { ...remote, auth: { token: { toString: () => SECRET } } };
      expect(await adminAccess(odd, OWN, noAccount, SECRET)).toBeNull();
    });

    it('never opens the console when no token is configured — an empty token is not a password', async () => {
      const empty = { ...remote, auth: { token: '' } };
      expect(await adminAccess(empty, OWN, noAccount, '')).toBeNull();
      expect(await adminAccess(remote, OWN, noAccount)).toBeNull();
    });

    it('still lets an admin account in without the token', async () => {
      const lookup = async (token: string | undefined) => (token === 'tok' ? 'owner@example.com' : null);
      expect(await adminAccess(remote, OWN, lookup, SECRET)).toBe('owner@example.com');
    });

    it('still lets the server machine in without the token', async () => {
      const local = { address: '127.0.0.1', headers: {}, auth: {} };
      expect(await adminAccess(local, OWN, noAccount, SECRET)).toBe('server machine');
    });
  });
});

describe('clientAddress', () => {
  it('is the peer for a direct connection', () => {
    expect(clientAddress('203.0.113.9', {})).toBe('203.0.113.9');
    expect(clientAddress('::ffff:192.168.1.33', {})).toBe('192.168.1.33');
  });

  it("reads Cloudflare's header when the tunnel on this machine forwarded it", () => {
    expect(clientAddress('127.0.0.1', { 'cf-connecting-ip': '198.51.100.7' })).toBe('198.51.100.7');
    expect(clientAddress('::1', { 'cf-connecting-ip': '2001:db8::5' })).toBe('2001:db8::5');
  });

  it('falls back to the first X-Forwarded-For entry from loopback', () => {
    expect(clientAddress('127.0.0.1', { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' })).toBe('198.51.100.7');
  });

  it('never believes the headers from a machine that is not this one', () => {
    expect(clientAddress('203.0.113.9', { 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '8.8.8.8' })).toBe(
      '203.0.113.9',
    );
  });

  it('ignores a header that is not an address, or sent twice', () => {
    expect(clientAddress('127.0.0.1', { 'cf-connecting-ip': '<script>' })).toBe('127.0.0.1');
    expect(clientAddress('127.0.0.1', { 'cf-connecting-ip': ['1.1.1.1', '2.2.2.2'] })).toBe('127.0.0.1');
    expect(clientAddress('127.0.0.1', { 'x-forwarded-for': 'x'.repeat(60) })).toBe('127.0.0.1');
  });

  it('says unknown for a missing address', () => {
    expect(clientAddress(undefined, {})).toBe('unknown');
  });
});
