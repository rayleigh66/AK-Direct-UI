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
      setError('新密码长度至少需要 8 位字符');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致，请重新输入');
      return;
    }

    completePasswordReset(newPassword);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="p-6 bg-slate-900 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold">首次登录安全改密</h2>
              <p className="text-xs text-slate-300">
                账户: <span className="font-mono font-semibold">{currentCustomerUser.username}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-800 text-xs leading-relaxed flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
            <div>
              根据 AOKING Direct 安全风控规范（PRD D26 / T31），管理员发放的为一次性临时密码，
              <strong>首次登录必须设置正式密码</strong>后方可访问现货订购、查看库存与下单。
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                设置新正式密码 (至少 8 位)
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="请输入您的正式密码"
                  className="w-full h-11 pl-10 pr-3 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                  required
                />
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                确认新正式密码
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="再次输入以确认"
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
                <span>保存正式密码并进入商城</span>
              </button>

              <button
                type="button"
                onClick={() => switchRole('customer', 'user-001a')}
                className="text-xs text-slate-500 hover:text-slate-800 py-2 transition-colors"
              >
                取消并切换回默认账号 (AK000123A)
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
