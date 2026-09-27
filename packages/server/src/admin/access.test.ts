import { describe, expect, it } from 'vitest';
import { adminAccess, isServerMachine } from './access.js';

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
});
