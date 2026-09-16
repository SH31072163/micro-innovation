import { useState, useEffect } from 'react';

/**
 * 个人排班弹窗 - 3个标签页
 * 1. 个人月度排班表（日历式）
 * 2. 个人排班汇总统计（13项）
 * 3. 个人月度目标（工作量+上机时间）
 *
 * 每个标签页底部都有"把本表格通过邮件发送"按钮
 */
export default function PersonalModal({ employee, year, month, token, onClose }) {
  const [tab, setTab] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState(null); // { type, success, msg }

  useEffect(() => {
    fetchData();
  }, [employee, year, month]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/schedule/view?year=${year}&month=${month}&employee_id=${employee.employee_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        setData(d);
      }
    } catch (err) {
      console.error('获取个人排班失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const sendEmail = async (type) => {
    setSendingEmail(true);
    setEmailStatus(null);
    try {
      const res = await fetch('/api/schedule/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ year, month, employee_id: employee.employee_id, type }),
      });
      const result = await res.json();
      if (res.ok) {
        setEmailStatus({ type, success: true, msg: `已发送至 ${result.to}` });
      } else {
        setEmailStatus({ type, success: false, msg: result.error || '发送失败' });
      }
    } catch (err) {
      setEmailStatus({ type, success: false, msg: err.message });
    } finally {
      setSendingEmail(false);
    }
  };

  // 邮件发送按钮
  function EmailButton({ type, label }) {
    const isThis = emailStatus && emailStatus.type === type;
    return (
      <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button
          onClick={() => sendEmail(type)}
          disabled={sendingEmail}
          style={{
            padding: '6px 16px',
            fontSize: '13px',
            fontWeight: '600',
            color: '#fff',
            background: sendingEmail ? '#9ca3af' : '#2563eb',
            border: 'none',
            borderRadius: '4px',
            cursor: sendingEmail ? 'not-allowed' : 'pointer',
          }}
        >
          {sendingEmail ? '发送中...' : `把本表格通过邮件发送`}
        </button>
        {isThis && emailStatus.success && (
          <span style={{ fontSize: '12px', color: '#16a34a' }}>✓ {emailStatus.msg}</span>
        )}
        {isThis && !emailStatus.success && (
          <span style={{ fontSize: '12px', color: '#dc2626' }}>✗ {emailStatus.msg}</span>
        )}
      </div>
    );
  }

  const weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ width: '720px', maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
        {/* 标题栏 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '16px', color: '#1e3a5f' }}>
            {employee.name} ({employee.employee_id}) - {year}年{month}月
          </h2>
          <button onClick={onClose} style={{ fontSize: '20px', color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}>x</button>
        </div>

        {/* 标签栏 */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: '2px solid #e5e7eb' }}>
          {['个人月度排班表', '个人排班汇总统计', '个人月度目标'].map((t, i) => (
            <button
              key={i}
              onClick={() => setTab(i)}
              style={{
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: tab === i ? '600' : 'normal',
                color: tab === i ? '#2563eb' : '#6b7280',
                background: tab === i ? '#eff6ff' : 'transparent',
                borderBottom: tab === i ? '2px solid #2563eb' : '2px solid transparent',
                marginBottom: '-2px',
                borderRadius: '4px 4px 0 0',
                cursor: 'pointer',
                border: 'none',
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {loading && <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>加载中...</div>}

        {!loading && data && tab === 0 && (
          <div>
            <CalendarTab data={data} />
            <EmailButton type="calendar" label="个人月度排班表" />
          </div>
        )}
        {!loading && data && tab === 1 && (
          <div>
            <StatsTab data={data} />
            <EmailButton type="stats" label="个人排班汇总统计" />
          </div>
        )}
        {!loading && data && tab === 2 && (
          <div>
            <GoalsTab data={data} />
            <EmailButton type="goals" label="个人月度目标" />
          </div>
        )}
      </div>
    </div>
  );
}

// ── 标签1: 个人月度排班表（日历式） ──
function CalendarTab({ data }) {
  const { days, weekdays, personalRecords } = data;
  const shiftColors = {
    '日班': '#e3f2fd', '早班': '#fff8e1', '晚班': '#f3e5f5',
    '全班': '#e8f5e9', '休': '#f5f5f5', '假': '#ffebee',
  };
  const weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  // 构建日历布局：5行7列
  // 第1行从1号开始，按周一到周日排列
  const calendar = [];
  let currentDay = 1;
  for (let week = 0; week < 6 && currentDay <= days; week++) {
    const row = [];
    for (let dow = 0; dow < 7; dow++) {
      if (currentDay > days) {
        row.push(null);
      } else {
        // dow=0 对应周一
        const wd = weekdays[currentDay - 1];
        if (dow === wd - 1) {
          row.push(currentDay);
          currentDay++;
        } else {
          row.push(null);
        }
      }
    }
    calendar.push(row);
  }

  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
        <thead>
          <tr>
            {weekdayNames.map((name, i) => (
              <th key={i} style={{
                padding: '6px', textAlign: 'center', color: '#6b7280',
                fontWeight: '600', fontSize: '12px', background: '#f9fafb',
                borderBottom: '1px solid #e5e7eb',
              }}>{name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {calendar.map((row, ri) => (
            <tr key={ri}>
              {row.map((day, ci) => {
                if (!day) return <td key={ci} style={{ border: '1px solid #e5e7eb', height: '60px', background: '#fafafa' }} />;
                const rec = personalRecords[day];
                const bg = rec ? (shiftColors[rec.shift] || '#fff') : '#fff';
                const amShort = rec ? (rec.am_work_type || '').replace('AM', '') : '';
                const pmShort = rec ? (rec.pm_work_type || '').replace('PM', '') : '';
                return (
                  <td key={ci} style={{
                    border: '1px solid #e5e7eb', height: '60px', background: bg,
                    padding: '4px', verticalAlign: 'top', textAlign: 'center',
                  }}>
                    <div style={{ fontWeight: '600', fontSize: '12px' }}>{day}日</div>
                    {rec && (
                      <>
                        <div style={{ fontSize: '10px', fontWeight: '600' }}>{rec.shift}</div>
                        <div style={{ fontSize: '9px', color: '#6b7280' }}>{rec.meal_time}</div>
                        <div style={{ fontSize: '9px' }}>{amShort}</div>
                        <div style={{ fontSize: '9px' }}>{pmShort}</div>
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 标签2: 个人排班汇总统计 ──
function StatsTab({ data }) {
  const { stats } = data;
  if (!stats) return <div style={{ textAlign: 'center', color: '#9ca3af', padding: '20px' }}>暂无数据</div>;

  const items = [
    ['实际上机天数', stats.onMachineDays], ['请假天数', stats.leaveDays],
    ['语音天数', stats.voiceDays], ['工单留邮天数', stats.ticketDays],
    ['IM文字天数', stats.imDays], ['质检天数', stats.qaDays],
    ['外呼天数', stats.outboundDays], ['专项任务天数', stats.specialTaskDays],
    ['拨测体验天数', stats.testDays], ['代值班天数', stats.dutyDays],
    ['日班天数', stats.dayShiftDays], ['早班天数', stats.earlyShiftDays],
    ['晚班天数', stats.lateShiftDays],
  ];

  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: '#6b7280' }}>统计项</th>
            <th style={{ padding: '10px 16px', textAlign: 'right', color: '#6b7280' }}>天数</th>
          </tr>
        </thead>
        <tbody>
          {items.map(([label, val], i) => (
            <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '8px 16px', color: '#374151' }}>{label}</td>
              <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: '600', color: '#1e3a5f' }}>{val}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 标签3: 个人月度目标 ──
function GoalsTab({ data }) {
  const { stats, goals } = data;
  if (!stats || !goals) return <div style={{ textAlign: 'center', color: '#9ca3af', padding: '20px' }}>暂无数据</div>;

  return (
    <div>
      <h4 style={{ fontSize: '14px', color: '#374151', marginBottom: '12px' }}>{data.month}月排班记录</h4>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginBottom: '20px' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
            <th style={{ padding: '8px 16px', textAlign: 'left', color: '#6b7280' }}>工种</th>
            <th style={{ padding: '8px 16px', textAlign: 'right', color: '#6b7280' }}>天数</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['语音天数', stats.voiceDays], ['工单留邮天数', stats.ticketDays],
            ['IM文字天数', stats.imDays], ['外呼调研天数', stats.outboundDays],
            ['拨测体验天数', stats.testDays], ['质检天数', stats.qaDays],
          ].map(([label, val], i) => (
            <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '8px 16px', color: '#374151' }}>{label}</td>
              <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: '600' }}>{val}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4 style={{ fontSize: '14px', color: '#374151', marginBottom: '12px' }}>{data.month}月需完成绩效考核目标</h4>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
            <th style={{ padding: '8px 16px', textAlign: 'left', color: '#6b7280' }}>考核项</th>
            <th style={{ padding: '8px 16px', textAlign: 'right', color: '#6b7280' }}>目标值</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
            <td style={{ padding: '8px 16px', color: '#374151' }}>工作量</td>
            <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: '600', color: '#2563eb' }}>{goals.workload}</td>
          </tr>
          <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
            <td style={{ padding: '8px 16px', color: '#374151' }}>语音上机时间</td>
            <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: '600', color: '#2563eb' }}>{goals.voiceMachineTime}</td>
          </tr>
          <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
            <td style={{ padding: '8px 16px', color: '#374151' }}>IM上机时间</td>
            <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: '600', color: '#2563eb' }}>{goals.imMachineTime}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: '12px', fontSize: '11px', color: '#9ca3af', lineHeight: '1.6' }}>
        备注：语音/IM文字/外呼调研/工单留邮/质检 目标90件/天，拨测体验目标72件/天；语音/IM文字 目标7.5小时/天
      </div>
    </div>
  );
}
