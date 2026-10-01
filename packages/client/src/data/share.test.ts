import { describe, expect, it } from 'vitest';
import { lineShareUrl, roomLink, shareDetails } from './share.js';

describe('roomLink', () => {
  it('points at /join/CODE on the page’s own origin', () => {
    expect(roomLink('https://findmymines.example', 'ABCD')).toBe('https://findmymines.example/join/ABCD');
    expect(roomLink('http://localhost:5173', 'q7k2')).toBe('http://localhost:5173/join/Q7K2');
  });

  it('never doubles the slash when the origin ends in one', () => {
    expect(roomLink('https://findmymines.example/', 'ABCD')).toBe('https://findmymines.example/join/ABCD');
  });
});

describe('lineShareUrl', () => {
  it('hands LINE the link, encoded, on its share page', () => {
    const link = 'https://findmymines.example/join/ABCD';
    expect(lineShareUrl(link)).toBe(
      'https://social-plugins.line.me/lineit/share?url=https%3A%2F%2Ffindmymines.example%2Fjoin%2FABCD',
    );
  });

  it('keeps characters that would otherwise break the query string', () => {
    const url = new URL(lineShareUrl('http://host/join/ABCD?x=1&y=2#top'));
    expect(url.searchParams.get('url')).toBe('http://host/join/ABCD?x=1&y=2#top');
  });
});

describe('shareDetails', () => {
  it('names the room and its code for the phone’s share sheet', () => {
    const details = shareDetails('Friday night', 'ABCD', 'https://x.example/join/ABCD');
    expect(details.url).toBe('https://x.example/join/ABCD');
    expect(details.title).toBe('Find My Mines');
    expect(details.text).toContain('Friday night');
    expect(details.text).toContain('ABCD');
  });

  it('still reads well for a room without a name', () => {
    expect(shareDetails('   ', 'ABCD', 'https://x.example/join/ABCD').text).toBe(
      'Join my Find My Mines game — room code ABCD.',
    );
  });
});
