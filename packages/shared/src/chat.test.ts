import { describe, expect, it } from 'vitest';
import { CHAT_MAX_LENGTH, cleanChatText } from './chat.js';

/** Length in code points — what the cap counts, so one emoji is one. */
const codePoints = (text: string): number => Array.from(text).length;

describe('cleanChatText', () => {
  it('rejects anything that is not a string', () => {
    for (const raw of [undefined, null, 42, true, {}, ['hi'], { text: 'hi' }]) expect(cleanChatText(raw)).toBeNull();
  });

  it('keeps an ordinary line as it is', () => {
    expect(cleanChatText('nice move, gg')).toBe('nice move, gg');
    expect(cleanChatText('ระเบิดอยู่ไหน 🤔')).toBe('ระเบิดอยู่ไหน 🤔');
  });

  it('turns newlines and tabs into single spaces', () => {
    expect(cleanChatText('one\ntwo\r\nthree\tfour')).toBe('one two three four');
  });

  it('turns other control characters into spaces', () => {
    expect(cleanChatText('a\u0000b\u0007c\u001bd\u007fe\u009bf')).toBe('a b c d e f');
  });

  it('collapses runs of whitespace', () => {
    expect(cleanChatText('so     many     spaces')).toBe('so many spaces');
  });

  it('trims both ends', () => {
    expect(cleanChatText('   hello \n\t')).toBe('hello');
  });

  it('is null when nothing is left to send', () => {
    expect(cleanChatText('')).toBeNull();
    expect(cleanChatText('    ')).toBeNull();
    expect(cleanChatText('\n\t\r\u0000\u0007')).toBeNull();
  });

  it(`caps a long line at ${CHAT_MAX_LENGTH} characters`, () => {
    expect(cleanChatText('a'.repeat(CHAT_MAX_LENGTH + 50))).toBe('a'.repeat(CHAT_MAX_LENGTH));
    expect(cleanChatText('a'.repeat(CHAT_MAX_LENGTH))).toBe('a'.repeat(CHAT_MAX_LENGTH));
  });

  it('counts an emoji as one character and never splits it', () => {
    const emoji = cleanChatText('😀'.repeat(CHAT_MAX_LENGTH + 10))!;
    expect(codePoints(emoji)).toBe(CHAT_MAX_LENGTH);
    expect(emoji).toBe('😀'.repeat(CHAT_MAX_LENGTH));

    // The cut falls exactly where a surrogate pair begins in UTF-16 terms.
    const mixed = cleanChatText('a'.repeat(CHAT_MAX_LENGTH - 1) + '💣💣')!;
    expect(mixed).toBe('a'.repeat(CHAT_MAX_LENGTH - 1) + '💣');
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(loneSurrogate.test(mixed)).toBe(false);
  });

  it('counts the cap after cleaning, so leading spaces do not eat it', () => {
    expect(cleanChatText(' '.repeat(50) + 'b'.repeat(CHAT_MAX_LENGTH))).toBe('b'.repeat(CHAT_MAX_LENGTH));
  });

  it('does not end on a space left by the cut', () => {
    expect(cleanChatText('a'.repeat(CHAT_MAX_LENGTH - 1) + ' tail')).toBe('a'.repeat(CHAT_MAX_LENGTH - 1));
  });
});
