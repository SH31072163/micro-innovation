import { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx-js-style';

/**
 * 同步人力配置 - 管理区第8个页面
 *
 * 4个区块（从上到下）：
 * 1. 邮箱配置：3行，每行 = 邮箱输入框 + 保存 + 状态栏 + 重发
 * 2. 定时发送配置：日期下拉(6-28日) + 时间下拉(9-18时) + 保存
 * 3. 班次时间配置：4个班次的上班/下班时间 + 保存
 * 4. 手动导出：选择上月/本月，导出Excel
 */
export default function SyncHRConfig({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [emails, setEmails] = useState(['', '', '']);
  const [sendDay, setSendDay] = useState(6);
  const [sendHour, setSendHour] = useState(10);
  const [shiftTimes, setShiftTimes] = useState({
    '早班': { start: '09:00', end: '18:00' },
    '日班': { start: '08:30', end: '17:30' },
    '晚班': { start: '12:00', end: '21:00' },
    '全班': { start: '09:00', end: '21:00' },
  });
  const [emailStatus, setEmailStatus] = useState([]);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/schedule/sync-hr', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        setData(d);
        setEmails(d.emails || ['', '', '']);
        setSendDay(d.sendDay || 6);
        setSendHour(d.sendHour || 10);
        setShiftTimes(d.shiftTimes || shiftTimes);
        setEmailStatus(d.emailStatus || []);
      }
    } catch (err) {
      console.error('获取同步人力配置失败:', err);
    } finally {
      setLoading(false);
    }
  };

  // ── 保存邮箱 ──
  const handleSaveEmail = async (index) => {
    const email = (emails[index] || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      alert('邮箱格式无效');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/schedule/sync-hr', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: 'emails', emails }),
      });
      if (res.ok) {
        alert('保存成功');
        await fetchData();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || '保存失败');
      }
    } catch (err) {
      alert('保存失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── 保存定时配置 ──
  const handleSaveSchedule = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/schedule/sync-hr', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: 'schedule', sendDay, sendHour }),
      });
      if (res.ok) {
        alert('保存成功');
        await fetchData();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || '保存失败');
      }
    } catch (err) {
      alert('保存失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── 保存班次时间 ──
  const handleSaveShifts = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/schedule/sync-hr', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: 'shifts', shiftTimes }),
      });
      if (res.ok) {
        alert('保存成功');
        await fetchData();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || '保存失败');
      }
    } catch (err) {
      alert('保存失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── 重发邮件 ──
  const handleResend = async (index) => {
    setSending(true);
    try {
      const res = await fetch('/api/schedule/sync-hr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'send', emailIndex: index }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok) {
        alert('发送成功');
        await fetchData();
      } else {
        alert('发送失败');
      }
    } catch (err) {
      alert('发送失败');
    } finally {
      setSending(false);
    }
  };

  // ── 导出Excel ──
  const handleExport = async (which) => {
    setExporting(true);
    try {
      const now = new Date();
      let year, month;
      if (which === 'last') {
        year = now.getFullYear();
        month = now.getMonth(); // 0-based，上月
        if (month === 0) { month = 12; year--; }
      } else {
        year = now.getFullYear();
        month = now.getMonth() + 1; // 本月
      }

      const res = await fetch('/api/schedule/sync-hr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'export', year, month }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(result.error || '导出失败');
        return;
      }

      // 前端用 xlsx-js-style 生成文件（后端返回数据行）
      const rows = result.rows || [];
      if (rows.length === 0) {
        alert('无有效排班数据');
        return;
      }

      const header = ['序号', '工号', '姓名', '日期', '星期', '班次', '上班时间', '下班时间'];
      const aoa = [header, ...rows.map(r => [r.seq, r.employeeId, r.name, r.date, r.weekday, r.shift, r.startTime, r.endTime])];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 6 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 10 }];

      const thinBorder = {
        top: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
      };
      // 表头：深蓝底白字
      for (let c = 0; c < header.length; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
        if (cell) {
          cell.s = {
            font: { bold: true, sz: 11, color: { rgb: 'FFFFFFFF' } },
            fill: { fgColor: { rgb: 'FF1E3A5F' }, bgColor: { rgb: 'FF1E3A5F' }, patternType: 'solid' },
            alignment: { horizontal: 'center', vertical: 'center' },
            border: thinBorder,
          };
        }
      }
      // 数据行：交替行色
      const rowBg = (i) => (i % 2 === 1 ? 'FFF0F7FF' : 'FFFFFFFF');
      for (let r = 1; r < aoa.length; r++) {
        const bg = rowBg(r - 1);
        for (let c = 0; c < header.length; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (cell) {
            cell.s = {
              font: { sz: 10, color: { rgb: 'FF374151' } },
              fill: { fgColor: { rgb: bg }, patternType: 'solid' },
              alignment: { horizontal: 'center', vertical: 'center' },
              border: thinBorder,
            };
          }
        }
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '排班表');
      const fileName = `销售服务中心客服条线${year}年${month}月排班表.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (err) {
      alert('导出失败: ' + err.message);
    } finally {
      setExporting(false);
    }
  };

  // 下拉选项
  const dayOptions = Array.from({ length: 23 }, (_, i) => i + 6); // 6-28
  const hourOptions = Array.from({ length: 10 }, (_, i) => i + 9); // 9-18
  const shiftKeys = ['日班', '早班', '晚班', '全班'];

  // 导出按钮月份（动态）
  const curMonth = new Date().getMonth() + 1;
  const lastMonthDate = new Date(); lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
  const lastMonth = lastMonthDate.getMonth() + 1;

  if (loading && !data) {
    return <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>加载中...</div>;
  }

  return (
    <div>
      {/* ══════ 区块1：邮箱配置（3行） ══════ */}
      <div style={{ background: '#fff', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: '16px' }}>
        <h4 style={{ fontSize: '14px', color: '#1e3a5f', marginBottom: '16px' }}>邮箱配置</h4>
        {[0, 1, 2].map((i) => {
          const status = emailStatus[i] || {};
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '13px', color: '#6b7280', width: '40px', flexShrink: 0 }}>邮箱{i + 1}</span>
              <input
                type="text"
                value={emails[i] || ''}
                onChange={(e) => { const next = [...emails]; next[i] = e.target.value; setEmails(next); }}
                placeholder="输入邮箱地址"
                style={{ width: '240px', fontSize: '13px', border: '1px solid #ddd', borderRadius: '4px', padding: '6px 10px', flexShrink: 0 }}
              />
              <button
                className="btn-primary"
                onClick={() => handleSaveEmail(i)}
                disabled={saving}
                style={{ padding: '6px 14px', fontSize: '13px', flexShrink: 0 }}
              >保存</button>
              <span style={{
                fontSize: '12px',
                color: status.sent ? '#16a34a' : '#9ca3af',
                background: status.sent ? '#dcfce7' : '#f3f4f6',
                padding: '4px 10px',
                borderRadius: '4px',
                minWidth: '140px',
                textAlign: 'center',
                flexShrink: 0,
              }}>
                {status.sent ? `${status.sentAt}已经发送` : '当月还未发送'}
              </span>
              <button
                className="btn-secondary"
                onClick={() => handleResend(i)}
                disabled={sending}
                style={{ padding: '6px 14px', fontSize: '13px', flexShrink: 0 }}
              >重发</button>
            </div>
          );
        })}
        <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>
          定时发送和重发都是发送上个月的排班表；重发不受日期限制，当月1日至最后1日均可执行。
        </div>
      </div>

      {/* ══════ 区块2：定时发送配置 ══════ */}
      <div style={{ background: '#fff', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: '16px' }}>
        <h4 style={{ fontSize: '14px', color: '#1e3a5f', marginBottom: '16px' }}>定时发送配置</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '13px', color: '#6b7280' }}>每月</span>
          <select
            value={sendDay}
            onChange={(e) => setSendDay(parseInt(e.target.value))}
            style={{ width: '70px', fontSize: '13px', border: '1px solid #ddd', borderRadius: '4px', padding: '6px 8px', textAlign: 'center' }}
          >
            {dayOptions.map(d => <option key={d} value={d}>{d}日</option>)}
          </select>
          <select
            value={sendHour}
            onChange={(e) => setSendHour(parseInt(e.target.value))}
            style={{ width: '70px', fontSize: '13px', border: '1px solid #ddd', borderRadius: '4px', padding: '6px 8px', textAlign: 'center' }}
          >
            {hourOptions.map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
          <button
            className="btn-primary"
            onClick={handleSaveSchedule}
            disabled={saving}
            style={{ padding: '6px 16px', fontSize: '13px' }}
          >保存</button>
          <span style={{ fontSize: '12px', color: '#9ca3af' }}>
            到期自动发送上月排班表至已配置的邮箱
          </span>
        </div>
      </div>

      {/* ══════ 区块3：班次时间配置 ══════ */}
      <div style={{ background: '#fff', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: '16px' }}>
        <h4 style={{ fontSize: '14px', color: '#1e3a5f', marginBottom: '16px' }}>班次时间配置</h4>
        <table style={{ borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: '8px 16px', textAlign: 'left', color: '#6b7280' }}>班次</th>
              <th style={{ padding: '8px 16px', textAlign: 'center', color: '#6b7280' }}>上班时间</th>
              <th style={{ padding: '8px 16px', textAlign: 'center', color: '#6b7280' }}>下班时间</th>
            </tr>
          </thead>
          <tbody>
            {shiftKeys.map((key) => (
              <tr key={key} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 16px', color: '#374151', fontWeight: '600' }}>{key}</td>
                <td style={{ padding: '4px 16px', textAlign: 'center' }}>
                  <input
                    type="text"
                    value={shiftTimes[key]?.start || ''}
                    onChange={(e) => setShiftTimes({ ...shiftTimes, [key]: { ...shiftTimes[key], start: e.target.value } })}
                    placeholder="HH:MM"
                    style={{ width: '80px', fontSize: '13px', border: '1px solid #ddd', borderRadius: '4px', padding: '4px 8px', textAlign: 'center' }}
                  />
                </td>
                <td style={{ padding: '4px 16px', textAlign: 'center' }}>
                  <input
                    type="text"
                    value={shiftTimes[key]?.end || ''}
                    onChange={(e) => setShiftTimes({ ...shiftTimes, [key]: { ...shiftTimes[key], end: e.target.value } })}
                    placeholder="HH:MM"
                    style={{ width: '80px', fontSize: '13px', border: '1px solid #ddd', borderRadius: '4px', padding: '4px 8px', textAlign: 'center' }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: '12px' }}>
          <button
            className="btn-primary"
            onClick={handleSaveShifts}
            disabled={saving}
            style={{ padding: '6px 16px', fontSize: '13px' }}
          >保存</button>
        </div>
      </div>

      {/* ══════ 区块4：手动导出 ══════ */}
      <div style={{ background: '#fff', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <h4 style={{ fontSize: '14px', color: '#1e3a5f', marginBottom: '16px' }}>手动导出</h4>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            className="btn-primary"
            onClick={() => handleExport('last')}
            disabled={exporting}
            style={{ padding: '6px 16px', fontSize: '13px' }}
          >导出{lastMonth}月排班表</button>
          <button
            className="btn-primary"
            onClick={() => handleExport('current')}
            disabled={exporting}
            style={{ padding: '6px 16px', fontSize: '13px' }}
          >导出{curMonth}月排班表</button>
        </div>
      </div>
    </div>
  );
}
