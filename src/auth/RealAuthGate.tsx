import React, { useEffect, useState } from 'react';
import { LockKeyhole, LogOut, ShieldCheck } from 'lucide-react';
import {
  AuthApiError,
  changePassword,
  getSession,
  login,
  logout,
  type AuthUserDto,
} from './api';
import { RealWorkspace } from '../real/RealWorkspace';

function errorMessage(error: unknown): string {
  if (error instanceof AuthApiError) return error.message;
  return error instanceof Error ? error.message : 'The request failed.';
}

const inputClass =
  'w-full h-11 px-3 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff681e]';

export const RealAuthGate: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState<AuthUserDto | null>(null);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    let cancelled = false;
    getSession()
      .then(session => {
        if (!cancelled) setUser(session);
      })
      .catch(err => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const session = await login(username.trim(), password);
      setUser(session);
      setPassword('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match. / 两次输入的新密码不一致。');
      return;
    }
    setBusy(true);
    try {
      const session = await changePassword(currentPassword, newPassword);
      setUser(session);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    setError('');
    try {
      await logout();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUser(null);
      setUsername('');
      setPassword('');
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#f8f8f6] text-xs text-slate-500">
        Checking session… / 正在检查会话…
      </div>
    );
  }

  const internal = user?.type === 'internal';

  if (user && !user.mustChangePassword) {
    return <RealWorkspace user={user} onSignOut={handleLogout} />;
  }

  return (
    <div className="min-h-screen bg-[#f8f8f6] text-[#151515] flex flex-col">
      <header className="bg-[#171717] text-white px-5 sm:px-8 py-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold tracking-[2px] uppercase text-[#ff843f]">
            AOKING Direct · Phase 4B-02
          </div>
          <div className="text-lg font-extrabold tracking-tight">Account & access</div>
        </div>
        {user && (
          <button
            type="button"
            onClick={handleLogout}
            disabled={busy}
            className="min-h-[42px] px-4 rounded-xl border border-white/20 text-xs font-semibold flex items-center gap-2 hover:bg-white/10 disabled:opacity-50"
          >
            <LogOut className="w-4 h-4" />
            {internal ? 'Sign out / 退出登录' : 'Sign out'}
          </button>
        )}
      </header>

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-8 sm:py-12">
        {!user && (
          <section
            data-testid="real-auth-login"
            className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-5"
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-[#fff1e8] text-[#ff681e] grid place-items-center">
                <LockKeyhole className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold">Sign in</h1>
                <p className="text-xs text-slate-500">
                  Customer accounts use AK usernames. Internal users use their work email.
                </p>
              </div>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <label className="block text-xs font-semibold text-slate-700">
                Username or email
                <input
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                  className={`${inputClass} mt-1 font-mono`}
                  autoComplete="username"
                  required
                />
              </label>
              <label className="block text-xs font-semibold text-slate-700">
                Password
                <input
                  type="password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  className={`${inputClass} mt-1`}
                  autoComplete="current-password"
                  required
                />
              </label>
              {error && (
                <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={busy}
                className="w-full h-12 rounded-xl bg-[#ff681e] text-white text-sm font-bold hover:bg-[#ed5610] disabled:opacity-50"
              >
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Internal users: use your internal email. / 内部用户：请使用内部邮箱登录。
            </p>
          </section>
        )}

        {user && user.mustChangePassword && (
          <section
            data-testid="real-auth-change-password"
            className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-5"
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-700 grid place-items-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold">
                  {internal ? 'Set a new password / 设置新密码' : 'Set a new password'}
                </h1>
                <p className="text-xs text-slate-500">
                  Your initial password must be changed before business access.
                </p>
              </div>
            </div>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <label className="block text-xs font-semibold text-slate-700">
                Current password / 当前密码
                <input
                  type="password"
                  value={currentPassword}
                  onChange={event => setCurrentPassword(event.target.value)}
                  className={`${inputClass} mt-1`}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label className="block text-xs font-semibold text-slate-700">
                New password / 新密码
                <input
                  type="password"
                  value={newPassword}
                  onChange={event => setNewPassword(event.target.value)}
                  className={`${inputClass} mt-1`}
                  autoComplete="new-password"
                  required
                />
                <span className="block mt-1 text-[10px] font-normal text-slate-400">
                  At least 12 characters with a letter and a number.
                </span>
              </label>
              <label className="block text-xs font-semibold text-slate-700">
                Confirm new password / 确认新密码
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={event => setConfirmPassword(event.target.value)}
                  className={`${inputClass} mt-1`}
                  autoComplete="new-password"
                  required
                />
              </label>
              {error && (
                <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={busy}
                className="w-full h-12 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save password / 保存密码'}
              </button>
            </form>
          </section>
        )}

      </main>

      <footer className="text-center py-6 text-[10px] text-slate-400 border-t border-slate-200 bg-white">
        AOKING DIRECT · ACCOUNT & ACCESS · DEMO INFRASTRUCTURE
      </footer>
    </div>
  );
};
