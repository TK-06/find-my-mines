import { readFileSync } from 'node:fs';
import type { RoomConfig, RoomSummary } from '@fmm/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  PROFILE_CACHE_MAX,
  PROFILE_CACHE_MS,
  PROFILE_LOOKUP_TIMEOUT_MS,
  PROFILE_SLOW_MS,
  ProfileLookup,
  cleanPreviewText,
  escapeHtml,
  linkKind,
  previewFor,
  profilePreview,
  renderPreview,
  roomPreview,
  type PreviewLookups,
  type ProfileSummary,
} from './preview.js';

const room = (over: Partial<RoomSummary> = {}, config: Partial<RoomConfig> = {}): RoomSummary => ({
  id: 'K7QX',
  name: 'Friday night',
  hostNickname: 'Alice',
  config: { rows: 6, cols: 6, mineCount: 11, maxPlayers: 2, mode: 'casual', ...config },
  playerCount: 1,
  spectatorCount: 0,
  status: 'waiting',
  createdAt: 0,
  joinable: true,
  ...over,
});

const palangpon: ProfileSummary = { username: 'palangpon', elo: 1240, gamesPlayed: 57 };

describe('linkKind', () => {
  it('reads a room code from a share link, in capitals whatever the case', () => {
    expect(linkKind('/join/k7qx')).toEqual({ kind: 'room', code: 'K7QX' });
    expect(linkKind('/join/K7QX')).toEqual({ kind: 'room', code: 'K7QX' });
    expect(linkKind('/join/K7QX/')).toEqual({ kind: 'room', code: 'K7QX' });
    expect(linkKind('/join/K7QX///')).toEqual({ kind: 'room', code: 'K7QX' });
  });

  it('is not a room link unless the path is exactly /join/<4 letters or digits>', () => {
    expect(linkKind('/join')).toBeNull();
    expect(linkKind('/join/')).toBeNull();
    expect(linkKind('/join/K7Q')).toBeNull();
    expect(linkKind('/join/K7QXY')).toBeNull();
    expect(linkKind('/join/K7QX/extra')).toBeNull();
    expect(linkKind('/join/K7_X')).toBeNull();
    expect(linkKind('/join/K7%20X')).toBeNull();
    expect(linkKind('/joined/K7QX')).toBeNull();
    expect(linkKind('/x/join/K7QX')).toBeNull();
  });

  it('reads a username from a profile link and decodes it', () => {
    expect(linkKind('/u/palangpon')).toEqual({ kind: 'profile', name: 'palangpon' });
    expect(linkKind('/u/palangpon/')).toEqual({ kind: 'profile', name: 'palangpon' });
    expect(linkKind('/u/Mine%20Hunter')).toEqual({ kind: 'profile', name: 'Mine Hunter' });
    expect(linkKind('/u/%E0%B8%AA%E0%B8%A1%E0%B8%8A%E0%B8%B2%E0%B8%A2')).toEqual({
      kind: 'profile',
      name: 'สมชาย',
    });
  });

  it('trims the name, and refuses one that is empty, too long, or has a broken escape', () => {
    expect(linkKind('/u/%20pad%20')).toEqual({ kind: 'profile', name: 'pad' });
    expect(linkKind('/u/%20%20')).toBeNull();
    expect(linkKind('/u/a'.padEnd(3 + 20, 'a'))).toEqual({ kind: 'profile', name: 'a'.repeat(20) });
    expect(linkKind('/u/'.padEnd(3 + 21, 'a'))).toBeNull();
    expect(linkKind('/u/%E0%A4%A')).toBeNull();
    expect(linkKind('/u/%')).toBeNull();
  });

  it('is not a profile link with nothing or more after /u/<name>', () => {
    expect(linkKind('/u')).toBeNull();
    expect(linkKind('/u/')).toBeNull();
    expect(linkKind('/u/a/b')).toBeNull();
    expect(linkKind('/user/palangpon')).toBeNull();
  });

  it('ignores every other page', () => {
    for (const path of ['/', '/profile', '/games', '/ranks', '/puzzle', '/privacy', '/admin', '/anything/else']) {
      expect(linkKind(path)).toBeNull();
    }
  });
});

describe('roomPreview', () => {
  it('names the room, its host, board, seats and state', () => {
    expect(roomPreview(room())).toEqual({
      title: 'Join "Friday night" · Find My Mines',
      description: "Alice's room · casual · 6×6 board, 11 mines · 1 of 2 players · waiting to start",
    });
  });

  it('says whether the room is ranked', () => {
    expect(roomPreview(room({}, { mode: 'ranked' })).description).toContain('· ranked ·');
  });

  it('counts players with no limit, and says one mine in the singular', () => {
    const open = roomPreview(room({ playerCount: 3 }, { maxPlayers: null, mineCount: 1 })).description;
    expect(open).toContain('1 mine ·');
    expect(open).toContain('3 players ·');
    expect(open).not.toContain(' of ');
    expect(roomPreview(room({ playerCount: 1 }, { maxPlayers: null })).description).toContain('1 player ·');
  });

  it('says how far along the room is', () => {
    expect(roomPreview(room({ status: 'playing' })).description).toContain('match in progress');
    expect(roomPreview(room({ status: 'ended' })).description).toContain('match finished');
  });

  it('mentions that a room asks to join', () => {
    expect(roomPreview(room({}, { joinByRequest: true })).description).toMatch(/· ask to join$/);
    expect(roomPreview(room()).description).not.toContain('ask to join');
  });

  it('copes with a room nobody hosts, and with a name that is only control characters', () => {
    const text = roomPreview(room({ hostNickname: '—', name: '\u0000\u0007' }));
    expect(text.description.startsWith('A room · ')).toBe(true);
    expect(text.title).toBe('Join "Untitled room" · Find My Mines');
  });

  it('gives a room that is gone a generic invitation', () => {
    const text = roomPreview(undefined);
    expect(text.title).toBe("You're invited to a game of Find My Mines");
    expect(text.description).toMatch(/multiplayer Minesweeper/i);
  });

  it('gives a private room the same card as a gone one, with none of its details', () => {
    const secret = room({ name: 'Secret lair', hostNickname: 'Zed' }, { private: true, rows: 9, cols: 9 });
    const card = roomPreview(secret);
    expect(card).toEqual(roomPreview(undefined));
    expect(JSON.stringify(card)).not.toMatch(/Secret|Zed|9×9/);
  });
});

describe('profilePreview', () => {
  it('says the name, the rating and the games', () => {
    expect(profilePreview(palangpon)).toEqual({
      title: 'palangpon · Find My Mines',
      description: '1,240 Elo · 57 ranked games. Challenge them on Find My Mines.',
    });
  });

  it('puts thousands separators on big numbers and handles one game and none', () => {
    expect(profilePreview({ username: 'a', elo: 2500, gamesPlayed: 1200 })?.description).toContain(
      '2,500 Elo · 1,200 ranked games.',
    );
    expect(profilePreview({ username: 'a', elo: 812, gamesPlayed: 1 })?.description).toContain('1 ranked game.');
    expect(profilePreview({ username: 'a', elo: 800, gamesPlayed: 0 })?.description).toContain(
      'no ranked games yet.',
    );
  });

  it('has no card for a player who was not found', () => {
    expect(profilePreview(null)).toBeNull();
  });
});

describe('previewFor', () => {
  const lookups = (over: Partial<PreviewLookups> = {}): PreviewLookups => ({
    room: () => undefined,
    profile: async () => null,
    ...over,
  });

  it('builds a room card and the canonical /join/CODE path, asking for the code in capitals', async () => {
    const asked: string[] = [];
    const card = await previewFor(
      '/join/k7qx',
      lookups({
        room: (code) => {
          asked.push(code);
          return room();
        },
      }),
    );
    expect(asked).toEqual(['K7QX']);
    expect(card).toEqual({ ...roomPreview(room()), path: '/join/K7QX' });
  });

  it('gives a missing or private room the generic invitation, still on its own path', async () => {
    expect(await previewFor('/join/ZZZZ', lookups())).toEqual({ ...roomPreview(undefined), path: '/join/ZZZZ' });
    const secret = room({}, { private: true });
    expect(await previewFor('/join/K7QX', lookups({ room: () => secret }))).toEqual({
      ...roomPreview(undefined),
      path: '/join/K7QX',
    });
  });

  it('builds a profile card from the database name, and the /u/ path encodes it', async () => {
    const asked: string[] = [];
    const card = await previewFor(
      '/u/Mine%20Hunter',
      lookups({
        profile: async (name) => {
          asked.push(name);
          return { username: 'Mine Hunter', elo: 900, gamesPlayed: 3 };
        },
      }),
    );
    expect(asked).toEqual(['Mine Hunter']);
    expect(card).toEqual({ ...profilePreview({ username: 'Mine Hunter', elo: 900, gamesPlayed: 3 }), path: '/u/Mine%20Hunter' });
  });

  it('shows what the database says, not what the link says', async () => {
    const card = await previewFor(
      '/u/PALANGPON',
      lookups({ profile: async () => palangpon }),
    );
    expect(card?.title).toBe('palangpon · Find My Mines');
    expect(card?.path).toBe('/u/palangpon');
  });

  it('sends the default card (null) for an unknown player and never echoes the name', async () => {
    expect(await previewFor('/u/nobody-here', lookups())).toBeNull();
  });

  it('sends null for every other path and does not look anything up', async () => {
    const room = vi.fn();
    const profile = vi.fn();
    for (const path of ['/', '/ranks', '/join/xx', '/u/', '/u/%E0%A4%A']) {
      expect(await previewFor(path, { room, profile })).toBeNull();
    }
    expect(room).not.toHaveBeenCalled();
    expect(profile).not.toHaveBeenCalled();
  });

  it('does not look up a profile for a room link, or a room for a profile link', async () => {
    const roomLookup = vi.fn(() => undefined);
    const profileLookup = vi.fn(async () => null);
    await previewFor('/join/K7QX', { room: roomLookup, profile: profileLookup });
    await previewFor('/u/alice', { room: roomLookup, profile: profileLookup });
    expect(roomLookup).toHaveBeenCalledTimes(1);
    expect(profileLookup).toHaveBeenCalledTimes(1);
  });
});

describe('escapeHtml and cleanPreviewText', () => {
  it('escapes the five characters that matter in HTML', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('does not escape twice', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('replaces control characters and line breaks with a space, and tidies the rest', () => {
    const LS = String.fromCharCode(0x2028);
    const PS = String.fromCharCode(0x2029);
    expect(cleanPreviewText(`a\nb\tc\u0000d\u007fe\u0085f${LS}g${PS}h`)).toBe('a b c d e f g h');
    expect(cleanPreviewText('  two   spaces  ')).toBe('two spaces');
  });

  it('drops the bidirectional overrides outright', () => {
    const [rlo, pdf, lri, pdi] = [0x202e, 0x202c, 0x2066, 0x2069].map((code) => String.fromCharCode(code));
    expect(cleanPreviewText(`abc${rlo}def${pdf}${lri}x${pdi}`)).toBe('abcdefx');
  });

  it('leaves ordinary text — Thai, emoji, punctuation — alone', () => {
    expect(cleanPreviewText('ห้องเล่น 💣 #1 (fun)')).toBe('ห้องเล่น 💣 #1 (fun)');
  });
});

describe('renderPreview', () => {
  const template = [
    '<head>',
    '<title>Find My Mines</title>',
    '<meta name="description" content="Default description." />',
    '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#eef0f2" />',
    '<meta property="og:site_name" content="Find My Mines" />',
    '<meta property="og:title" content="Default title" />',
    '<meta property="og:description" content="Default description." />',
    '<meta property="og:url" content="https://findmymines.app/" />',
    '<meta property="og:image" content="https://findmymines.app/og-image.png" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    '<meta name="twitter:title" content="Default title" />',
    '<meta name="twitter:description" content="Default description." />',
    '<meta name="twitter:image" content="https://findmymines.app/og-image.png" />',
    '</head>',
  ].join('\n');
  const meta = { title: 'Join "Friday night" · Find My Mines', description: 'Alice\'s room · 1 of 2 players', path: '/join/K7QX' };

  it('swaps the title, description and url on every tag that carries them', () => {
    const page = renderPreview(template, meta, 'https://findmymines.app');
    expect(page).toContain('<title>Join &quot;Friday night&quot; · Find My Mines</title>');
    expect(page).toContain('<meta name="description" content="Alice&#39;s room · 1 of 2 players" />');
    expect(page).toContain('<meta property="og:title" content="Join &quot;Friday night&quot; · Find My Mines" />');
    expect(page).toContain('<meta property="og:description" content="Alice&#39;s room · 1 of 2 players" />');
    expect(page).toContain('<meta property="og:url" content="https://findmymines.app/join/K7QX" />');
    expect(page).toContain('<meta name="twitter:title" content="Join &quot;Friday night&quot; · Find My Mines" />');
    expect(page).toContain('<meta name="twitter:description" content="Alice&#39;s room · 1 of 2 players" />');
    expect(page).not.toContain('Default');
  });

  it('leaves everything else exactly as built', () => {
    const page = renderPreview(template, meta, 'https://findmymines.app');
    for (const kept of [
      '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#eef0f2" />',
      '<meta property="og:site_name" content="Find My Mines" />',
      '<meta property="og:image" content="https://findmymines.app/og-image.png" />',
      '<meta name="twitter:card" content="summary_large_image" />',
      '<meta name="twitter:image" content="https://findmymines.app/og-image.png" />',
    ]) {
      expect(page).toContain(kept);
    }
    expect(page.split('\n')).toHaveLength(template.split('\n').length);
  });

  it('builds the url from the configured address, never from anything else', () => {
    expect(renderPreview(template, meta, 'http://localhost:3000')).toContain(
      'content="http://localhost:3000/join/K7QX"',
    );
  });

  it('escapes a hostile room name everywhere it lands', () => {
    const hostile = {
      title: 'Join "<script>alert(1)</script>" · Find My Mines',
      description: `"><img src=x onerror=alert('1')> & more`,
      path: '/join/K7QX',
    };
    const page = renderPreview(template, hostile, 'https://findmymines.app');
    expect(page).not.toContain('<script>');
    expect(page).not.toContain('<img');
    expect(page).not.toMatch(/content="[^"]*"[^/>]*onerror/);
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page).toContain('&quot;&gt;&lt;img src=x onerror=alert(&#39;1&#39;)&gt; &amp; more');
    // The tags are still well formed: same number of tags, each still closed.
    expect(page.match(/<meta /g)).toHaveLength(template.match(/<meta /g)!.length);
    expect(page.match(/<meta [^>]*\/>/g)).toHaveLength(template.match(/<meta /g)!.length);
  });

  it('strips control characters from what it writes', () => {
    const page = renderPreview(template, { title: 'a\u0000b\nc', description: 'x\u0007y\r\nz', path: '/join/K7QX' }, 'https://x.test');
    expect(page).toContain('<title>a b c</title>');
    expect(page).toContain('content="x y z"');
    expect(page.replace(/\n/g, '')).not.toMatch(/[\u0000-\u001f]/);
  });

  it('reads no replacement pattern into a name', () => {
    const page = renderPreview(template, { title: "$& $1 $' $$", description: '$`', path: '/u/x' }, 'https://x.test');
    expect(page).toContain('<title>$&amp; $1 $&#39; $$</title>');
    expect(page).toContain('content="$`"');
  });

  it('leaves a template without these tags alone', () => {
    const bare = '<html><head><title>Hi</title></head></html>';
    expect(renderPreview(bare, meta, 'https://x.test')).toBe(
      '<html><head><title>Join &quot;Friday night&quot; · Find My Mines</title></head></html>',
    );
    expect(renderPreview('<p>no head</p>', meta, 'https://x.test')).toBe('<p>no head</p>');
  });

  it('works on the real index.html: every tag it rewrites is there, once', () => {
    const real = readFileSync(new URL('../../client/index.html', import.meta.url), 'utf8');
    const probe = { title: 'PROBE-TITLE', description: 'PROBE-DESCRIPTION', path: '/join/ABCD' };
    const page = renderPreview(real, probe, 'https://probe.test');

    expect(page.match(/PROBE-TITLE/g)).toHaveLength(3); // <title>, og:title, twitter:title
    expect(page.match(/PROBE-DESCRIPTION/g)).toHaveLength(3); // description, og, twitter
    expect(page.match(/https:\/\/probe\.test\/join\/ABCD/g)).toHaveLength(1);
    expect(page).toMatch(/<title>PROBE-TITLE<\/title>/);
    expect(page).toMatch(/<meta name="description" content="PROBE-DESCRIPTION" \/>/);
    expect(page).toMatch(/<meta property="og:url" content="https:\/\/probe\.test\/join\/ABCD" \/>/);

    // And what the swap must not touch is still the site's.
    expect(page).toContain('<meta property="og:image" content="https://findmymines.app/og-image.png" />');
    expect(page).toContain('<meta property="og:image:width" content="1200" />');
    expect(page).toContain('<meta property="og:image:height" content="630" />');
    expect(page).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(page).toContain('content="#eef0f2"');
    expect(page).toContain('content="#111315"');
  });
});

describe('ProfileLookup', () => {
  /** A fetch that is answered by hand, so timing is the test's to control. */
  function manual() {
    const calls: { name: string; settle: (value: ProfileSummary | null) => void; fail: (error: unknown) => void }[] = [];
    const fetchProfile = vi.fn(
      (name: string) =>
        new Promise<ProfileSummary | null>((resolve, reject) => {
          calls.push({ name, settle: resolve, fail: reject });
        }),
    );
    return { calls, fetchProfile };
  }

  /** Lets queued promise callbacks run. */
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('asks the database once, then answers from memory for a minute', async () => {
    let now = 1_000;
    const fetchProfile = vi.fn(async () => palangpon);
    const lookup = new ProfileLookup(fetchProfile, 1500, () => now);

    expect(await lookup.get('palangpon')).toEqual(palangpon);
    now += PROFILE_CACHE_MS - 1;
    expect(await lookup.get('palangpon')).toEqual(palangpon);
    expect(fetchProfile).toHaveBeenCalledTimes(1);

    now += 1;
    expect(await lookup.get('palangpon')).toEqual(palangpon);
    expect(fetchProfile).toHaveBeenCalledTimes(2);
  });

  it('remembers that nobody has a name too, so guessing names cannot hammer the database', async () => {
    const fetchProfile = vi.fn(async () => null);
    const lookup = new ProfileLookup(fetchProfile);
    expect(await lookup.get('ghost')).toBeNull();
    expect(await lookup.get('ghost')).toBeNull();
    expect(fetchProfile).toHaveBeenCalledTimes(1);
  });

  it('keeps names apart', async () => {
    const fetchProfile = vi.fn(async (name: string) => ({ username: name, elo: 800, gamesPlayed: 0 }));
    const lookup = new ProfileLookup(fetchProfile);
    expect((await lookup.get('a'))?.username).toBe('a');
    expect((await lookup.get('A'))?.username).toBe('A');
    expect(fetchProfile).toHaveBeenCalledTimes(2);
  });

  it('shares one lookup between requests for the same name that arrive together', async () => {
    const { calls, fetchProfile } = manual();
    const lookup = new ProfileLookup(fetchProfile);

    const first = lookup.get('palangpon');
    const second = lookup.get('palangpon');
    const third = lookup.get('someone-else');
    await flush();
    expect(fetchProfile).toHaveBeenCalledTimes(2);

    calls.find((c) => c.name === 'palangpon')!.settle(palangpon);
    calls.find((c) => c.name === 'someone-else')!.settle(null);
    expect(await first).toEqual(palangpon);
    expect(await second).toEqual(palangpon);
    expect(await third).toBeNull();
  });

  it('gives up after the timeout with no profile, and does not ask again for a little while', async () => {
    vi.useFakeTimers();
    try {
      const { fetchProfile } = manual();
      const lookup = new ProfileLookup(fetchProfile);

      const slow = lookup.get('palangpon');
      await vi.advanceTimersByTimeAsync(PROFILE_LOOKUP_TIMEOUT_MS);
      expect(await slow).toBeNull();

      // Right after, the visitor behind it does not wait again.
      expect(await lookup.get('palangpon')).toBeNull();
      expect(fetchProfile).toHaveBeenCalledTimes(1);

      // Once the short memory of the slowness has passed, the database is tried afresh.
      await vi.advanceTimersByTimeAsync(PROFILE_SLOW_MS);
      void lookup.get('palangpon');
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchProfile).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the late answer when it does arrive', async () => {
    vi.useFakeTimers();
    try {
      const { calls, fetchProfile } = manual();
      const lookup = new ProfileLookup(fetchProfile);

      const slow = lookup.get('palangpon');
      await vi.advanceTimersByTimeAsync(PROFILE_LOOKUP_TIMEOUT_MS);
      expect(await slow).toBeNull();

      calls[0]!.settle(palangpon);
      await vi.advanceTimersByTimeAsync(0);
      expect(await lookup.get('palangpon')).toEqual(palangpon);
      expect(fetchProfile).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a failing lookup as no player and never rejects', async () => {
    const lookup = new ProfileLookup(async () => {
      throw new Error('database down');
    });
    await expect(lookup.get('palangpon')).resolves.toBeNull();

    const throwsSync = new ProfileLookup(() => {
      throw new Error('boom');
    });
    await expect(throwsSync.get('palangpon')).resolves.toBeNull();
  });

  it('keeps at most the limit, forgetting the oldest answer first', async () => {
    const fetchProfile = vi.fn(async (name: string) => ({ username: name, elo: 800, gamesPlayed: 0 }));
    const lookup = new ProfileLookup(fetchProfile, 1500, Date.now, 3);

    for (const name of ['a', 'b', 'c', 'd']) await lookup.get(name);
    expect(lookup.size).toBe(3);
    expect(fetchProfile).toHaveBeenCalledTimes(4);

    // b, c and d are remembered; a, the oldest, went.
    await lookup.get('b');
    await lookup.get('c');
    await lookup.get('d');
    expect(fetchProfile).toHaveBeenCalledTimes(4);
    await lookup.get('a');
    expect(fetchProfile).toHaveBeenCalledTimes(5);
  });

  it('defaults to 500 answers', () => {
    expect(PROFILE_CACHE_MAX).toBe(500);
    expect(PROFILE_CACHE_MS).toBe(60_000);
    expect(PROFILE_LOOKUP_TIMEOUT_MS).toBe(1500);
  });
});
