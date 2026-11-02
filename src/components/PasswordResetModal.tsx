/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { ShieldCheck, Lock, AlertCircle, KeyRound } from 'lucide-react';

export const PasswordResetModal: React.FC = () => {
  const { currentCustomerUser, completePasswordReset, switchRole } = useApp();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  if (!currentCustomerUser || !currentCustomerUser.must_change_password) {
    return null;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match. Please re-enter.');
      return;
    }

    completePasswordReset(newPassword);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-slate-200">
        <div className="p-6 bg-slate-900 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold">First sign-in: set a password</h2>
              <p className="text-xs text-slate-300">
                Account: <span className="font-mono font-semibold">{currentCustomerUser.username}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-800 text-xs leading-relaxed flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
            <div>
              The administrator issued a one-time temporary password.
              <strong>Set a new password before browsing stock or placing orders.</strong>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                New password (minimum 8 characters)
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Enter your new password"
                  className="w-full h-11 pl-10 pr-3 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                  required
                />
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Confirm new password
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Enter the password again"
                  className="w-full h-11 pl-10 pr-3 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                  required
                />
                <ShieldCheck className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              </div>
            </div>

            {error && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg">
                {error}
              </div>
            )}

            <div className="pt-2 flex flex-col gap-2">
              <button
                type="submit"
                className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                <span>Save password and continue</span>
              </button>

              <button
                type="button"
                onClick={() => switchRole('customer', 'user-001a')}
                className="text-xs text-slate-500 hover:text-slate-800 py-2 transition-colors"
              >
                Cancel and switch to demo account AK000123A
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
