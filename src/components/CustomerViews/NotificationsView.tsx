/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useApp } from '../../context/AppContext';
import {
  Bell,
  CheckCircle2,
  Clock,
  Truck,
  Sparkles,
  AlertTriangle,
  MailCheck,
} from 'lucide-react';

export const NotificationsView: React.FC = () => {
  const { notifications, currentCompany, markNotificationAsRead, setActiveTab } = useApp();

  const myNotifications = notifications.filter(n => n.company_id === currentCompany?.id);

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'ORDER_CONFIRMED':
        return <CheckCircle2 className="w-5 h-5 text-sky-600" />;
      case 'PAYMENT_RECEIVED':
        return <Sparkles className="w-5 h-5 text-emerald-600" />;
      case 'SHIPMENT_DISPATCHED':
        return <Truck className="w-5 h-5 text-indigo-600" />;
      case 'RESTOCK_AVAILABLE':
        return <Bell className="w-5 h-5 text-amber-600" />;
      default:
        return <AlertTriangle className="w-5 h-5 text-slate-500" />;
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-900">站内通知 (In-App Notifications)</h1>
          <p className="text-xs text-slate-500">
            订单确认、到货提醒、货款到账与物流发货进度通知
          </p>
        </div>
      </div>

      <div className="p-3.5 bg-slate-100 rounded-xl text-xs text-slate-600 flex items-start gap-2">
        <MailCheck className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
        <div>
          <strong>双通道通知规范 (PRD D27 / D30):</strong> 客户重要业务通知同时生成站内通知（在此展示）
          并生成正式客户英文邮件草稿投递至业务员内部工作邮箱。业务员核验后将通过公司邮箱向您发送。
          平台不收集您的私人联系邮箱。
        </div>
      </div>

      {myNotifications.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200">
          <Bell className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <h2 className="text-sm font-bold text-slate-700">暂无新通知</h2>
          <p className="text-xs text-slate-400 mt-1">当业务员确认您的订单或补货到货时，系统将在此提醒。</p>
        </div>
      ) : (
        <div className="space-y-3">
          {myNotifications.map(notif => (
            <div
              key={notif.id}
              onClick={() => markNotificationAsRead(notif.id)}
              className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-start gap-3.5 ${
                notif.is_read
                  ? 'bg-white border-slate-200 text-slate-700'
                  : 'bg-indigo-50/40 border-indigo-200 text-slate-900 shadow-sm'
              }`}
            >
              <div className="p-2.5 rounded-xl bg-white border border-slate-100 shadow-sm shrink-0">
                {getEventIcon(notif.event_type)}
              </div>

              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold">{notif.title}</span>
                    {!notif.is_read && (
                      <span className="w-2 h-2 rounded-full bg-rose-500" />
                    )}
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono">
                    {notif.created_at}
                  </span>
                </div>

                <p className="text-xs text-slate-600 leading-relaxed">
                  {notif.message}
                </p>

                {notif.related_id && (
                  <div className="pt-1.5 flex gap-2">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setActiveTab('orders');
                      }}
                      className="text-[11px] font-semibold text-indigo-700 hover:underline"
                    >
                      查看相关订单详情 →
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
