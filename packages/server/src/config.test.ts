import { describe, expect, it } from 'vitest';
import { publicUrlFrom } from './config.js';

const DEFAULT = 'https://findmymines.app';

describe('publicUrlFrom', () => {
  it('defaults to findmymines.app when PUBLIC_URL is not set or is blank', () => {
    expect(publicUrlFrom(undefined)).toBe(DEFAULT);
    expect(publicUrlFrom('')).toBe(DEFAULT);
    expect(publicUrlFrom('   ')).toBe(DEFAULT);
  });

  it('takes an http or https address and drops the trailing slash', () => {
    expect(publicUrlFrom('https://example.com')).toBe('https://example.com');
    expect(publicUrlFrom('https://example.com/')).toBe('https://example.com');
    expect(publicUrlFrom('https://example.com///')).toBe('https://example.com');
    expect(publicUrlFrom('  http://localhost:3000/ ')).toBe('http://localhost:3000');
  });

  it('keeps a path the game is served under', () => {
    expect(publicUrlFrom('https://example.com/mines/')).toBe('https://example.com/mines');
  });

  it('drops a query, a fragment and a login', () => {
    expect(publicUrlFrom('https://user:secret@example.com/?a=1#top')).toBe('https://example.com');
  });

  it('refuses any other scheme', () => {
    for (const bad of ['javascript:alert(1)', 'ftp://example.com', 'data:text/html,hi', 'file:///etc/passwd']) {
      expect(publicUrlFrom(bad)).toBe(DEFAULT);
    }
  });

  it('refuses what is not a URL', () => {
    for (const bad of ['findmymines.app', 'not a url', '//example.com', '/join']) {
      expect(publicUrlFrom(bad)).toBe(DEFAULT);
    }
  });
});
