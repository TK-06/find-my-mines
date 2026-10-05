import { describe, expect, it } from 'vitest';
import {
  CONTACT_EMAIL,
  POLICIES,
  POLICY_ORDER,
  POLICY_UPDATED,
  contactMailto,
  inlineParts,
  isPolicy,
  type Policy,
} from './policies.js';

describe('contactMailto', () => {
  it('addresses the one contact email and fills in the subject', () => {
    expect(contactMailto('Bug report')).toBe(
      'mailto:Palangtaj@gmail.com?subject=Find%20My%20Mines%3A%20Bug%20report',
    );
  });

  it('encodes characters that would otherwise end the subject early', () => {
    expect(contactMailto('Course & team')).toBe(
      'mailto:Palangtaj@gmail.com?subject=Find%20My%20Mines%3A%20Course%20%26%20team',
    );
  });
});

describe('inlineParts', () => {
  it('returns plain text as one part', () => {
    expect(inlineParts('No links here.')).toEqual([{ text: 'No links here.' }]);
  });

  it('splits out [text](href) links', () => {
    expect(inlineParts('Email [us](mailto:a@b.c) any time.')).toEqual([
      { text: 'Email ' },
      { text: 'us', href: 'mailto:a@b.c' },
      { text: ' any time.' },
    ]);
  });

  it('handles links at either end and side by side', () => {
    expect(inlineParts('[a](/x)[b](/y)')).toEqual([
      { text: 'a', href: '/x' },
      { text: 'b', href: '/y' },
    ]);
  });

  it('leaves brackets that are not a link alone', () => {
    expect(inlineParts('a [b] (c)')).toEqual([{ text: 'a [b] (c)' }]);
  });
});

describe('isPolicy', () => {
  it('knows the three policy pages and nothing else', () => {
    expect(POLICY_ORDER.every(isPolicy)).toBe(true);
    expect(isPolicy('game')).toBe(false);
    expect(isPolicy('admin')).toBe(false);
  });
});

/** Every word a page shows, links included, for checking what it claims. */
function allText(policy: Policy): string {
  return [
    policy.title,
    policy.intro,
    ...policy.sections.flatMap((s) => [s.title, ...s.blocks.flatMap((b) => (typeof b === 'string' ? [b] : b))]),
  ].join('\n');
}

describe('policy pages', () => {
  it('are the three tabs, in order', () => {
    expect(POLICY_ORDER).toEqual(['privacy', 'security', 'terms']);
    for (const id of POLICY_ORDER) expect(POLICIES[id].id).toBe(id);
  });

  it('give every section a unique, URL-safe anchor', () => {
    for (const id of POLICY_ORDER) {
      const anchors = POLICIES[id].sections.map((s) => s.id);
      expect(new Set(anchors).size).toBe(anchors.length);
      for (const anchor of anchors) expect(anchor).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('each tell people how to reach us', () => {
    for (const id of POLICY_ORDER) expect(allText(POLICIES[id])).toContain(CONTACT_EMAIL);
  });

  // The game server is moving hosts; the pages must not promise where it runs.
  it('never name a hosting provider or region for the game server', () => {
    const named = ['Render', 'Vercel', 'Railway', 'Heroku', 'Netlify', 'Cloudflare', 'AWS', 'Azure', 'DigitalOcean', 'Singapore', 'region'];
    for (const id of POLICY_ORDER) {
      const text = allText(POLICIES[id]);
      for (const word of named) expect(text).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'));
    }
  });

  // Game review saves the order of moves and where the mines were, and sends
  // typed coach questions to Groq with the game's facts. The privacy page has to say so.
  it('say what game review stores and what the coach sends', () => {
    const records = POLICIES.privacy.sections.find((s) => s.id === 'matches')!;
    const recordsText = allText({ ...POLICIES.privacy, intro: '', sections: [records] });
    expect(recordsText).toMatch(/order .*slots were opened/);
    expect(recordsText).toContain('where every mine was');
    expect(recordsText).toContain('public');

    const services = POLICIES.privacy.sections.find((s) => s.id === 'services')!;
    const servicesText = allText({ ...POLICIES.privacy, intro: '', sections: [services] });
    expect(servicesText).toContain('coach');
    expect(servicesText).toContain('Groq');
    expect(servicesText).toContain('the players’ names as shown in the game');
    expect(servicesText).toContain('are limited');
    expect(servicesText).toContain('neither your questions nor the answers are saved');
  });

  // The Fruit Fly brain panel remembers open or closed in localStorage (fmm.flyBrain).
  it('list the Fruit Fly brain panel setting among what the browser keeps', () => {
    const browser = POLICIES.privacy.sections.find((s) => s.id === 'your-browser')!;
    const browserText = allText({ ...POLICIES.privacy, intro: '', sections: [browser] });
    expect(browserText).toContain('whether the Fruit Fly brain panel is open or closed');
  });

  it('were last changed on 5 October 2026, when game review began saving replays', () => {
    expect(POLICY_UPDATED).toBe('5 October 2026');
  });
});
