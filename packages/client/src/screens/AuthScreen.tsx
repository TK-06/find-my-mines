import { CLASSIC_PRESET, STARTING_ELO } from '@fmm/shared';
import { useState } from 'react';
import { authEnabled, oauthProviders, supabase, type OAuthProvider } from '../auth/supabase.js';

interface Props {
  /** Continue without an account. Always available, always one click. */
  onGuest: (nickname: string) => void;
  connected: boolean;
}

type Tab = 'guest' | 'signin' | 'signup';

/**
 * Sign in, or don't.
 *
 * "Play as guest" is deliberately the first tab and a single click: a grader
 * must never need an account to see the game.
 */
export function AuthScreen({ onGuest, connected }: Props) {
  const [tab, setTab] = useState<Tab>('guest');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** An address waiting on its confirmation email, so it can be re-sent. */
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);

  async function withSupabase(action: () => Promise<{ error: { message: string } | null }>) {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: failure } = await action();
    setBusy(false);
    if (failure) setError(failure.message);
  }

  const signIn = () =>
    withSupabase(async () => {
      const result = await supabase!.auth.signInWithPassword({ email, password });
      if (result.error?.message.toLowerCase().includes('not confirmed')) {
        setUnconfirmed(email);
        return { error: { message: 'Confirm your email first. Use the link we sent, or resend it below.' } };
      }
      return result;
    });

  const signUp = () =>
    withSupabase(async () => {
      const result = await supabase!.auth.signUp({
        email,
        password,
        options: {
          data: { username: nickname.trim() || undefined },
          // Without this the confirmation link uses Supabase's Site URL, which
          // defaults to localhost. The origin must also be in Supabase's
          // Redirect URLs allow-list, or Supabase falls back to the Site URL.
          emailRedirectTo: window.location.origin,
        },
      });
      if (result.error) return { error: { message: explainAuthError(result.error.message) } };

      // Supabase answers an already-registered address with a fake success
      // and sends nothing (so strangers cannot probe which emails exist). The
      // tell is a user with no identities.
      if (result.data.user && result.data.user.identities?.length === 0) {
        setUnconfirmed(email);
        return {
          error: {
            message:
              'That email already has an account. Sign in instead. If it was never confirmed, resend the email below.',
          },
        };
      }

      if (!result.data.session) {
        setUnconfirmed(email);
        setNotice(`Confirmation email sent to ${email}. Check your inbox and spam folder.`);
      }
      return result;
    });

  const resend = () =>
    withSupabase(async () => {
      const result = await supabase!.auth.resend({
        type: 'signup',
        email: unconfirmed ?? email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (result.error) return { error: { message: explainAuthError(result.error.message) } };
      setNotice(`Sent again to ${unconfirmed ?? email}. Check your inbox and spam folder.`);
      return result;
    });

  const oauth = (provider: OAuthProvider) =>
    withSupabase(() =>
      supabase!.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin },
      }),
    );

  return (
    <div className="center-screen">
      <div className="card join-card">
        <h2>Find My Mines</h2>
        <p>
          {CLASSIC_PRESET.rows}×{CLASSIC_PRESET.cols} grid · {CLASSIC_PRESET.mineCount} mines ·
          everyone starts at {STARTING_ELO} Elo
        </p>

        {authEnabled && (
          <div className="tab-row">
            <button className={tab === 'guest' ? '' : 'ghost'} onClick={() => setTab('guest')}>
              Guest
            </button>
            <button className={tab === 'signin' ? '' : 'ghost'} onClick={() => setTab('signin')}>
              Sign in
            </button>
            <button className={tab === 'signup' ? '' : 'ghost'} onClick={() => setTab('signup')}>
              Sign up
            </button>
          </div>
        )}

        {tab === 'guest' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (nickname.trim()) onGuest(nickname.trim());
            }}
          >
            <input
              type="text"
              value={nickname}
              maxLength={20}
              autoFocus
              placeholder="Pick a nickname"
              onChange={(e) => setNickname(e.target.value)}
            />
            <button className="wide" type="submit" disabled={!nickname.trim() || !connected}>
              {connected ? 'Play as guest' : 'Connecting…'}
            </button>
            <p className="muted" style={{ marginBottom: 0 }}>
              Guests play everything. Ratings just aren’t saved between visits.
            </p>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (tab === 'signin') void signIn();
              else void signUp();
            }}
          >
            {tab === 'signup' && (
              <input
                type="text"
                value={nickname}
                maxLength={20}
                placeholder="Username"
                onChange={(e) => setNickname(e.target.value)}
              />
            )}
            <input
              type="email"
              value={email}
              placeholder="Email"
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              type="password"
              value={password}
              placeholder="Password"
              autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button className="wide" type="submit" disabled={busy || !email || !password}>
              {busy ? 'Working…' : tab === 'signin' ? 'Sign in' : 'Create account'}
            </button>

            {/* Hidden until the provider is actually configured — see supabase.ts. */}
            {oauthProviders.length > 0 && (
              <div className="oauth-row">
                {oauthProviders.map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    className="ghost"
                    disabled={busy}
                    onClick={() => void oauth(provider)}
                  >
                    {provider === 'google' ? 'Google' : 'GitHub'}
                  </button>
                ))}
              </div>
            )}
          </form>
        )}

        {error && <p className="form-error">{error}</p>}
        {notice && <p className="muted form-notice">{notice}</p>}
        {unconfirmed && tab !== 'guest' && (
          <button type="button" className="ghost wide" disabled={busy} onClick={() => void resend()}>
            Resend confirmation email
          </button>
        )}
        {!authEnabled && (
          <p className="muted" style={{ marginBottom: 0 }}>
            Accounts are off — no Supabase configuration found.
          </p>
        )}
      </div>
    </div>
  );
}

/** Supabase's auth errors, rewritten to say what to do next. */
function explainAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('rate limit')) {
    return 'Too many emails sent in the last hour. Wait a while and try again, or play as a guest for now.';
  }
  if (m.includes('not authorized')) {
    return 'This address can’t receive sign-up emails yet. The project’s email sender only reaches team members until a custom email service is set up.';
  }
  return message;
}
