import { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import PersonalModal from './PersonalModal';

/**
 * 中心排班表 - 展示区
 * - 年份/月份选择器（仅上月/本月/次月）
 * - 表格形式（行=员工按工号排序，列=日期，单元格=班次+工种）
 * - 动态天数列
 * - 点击姓名/工号弹出个人弹窗
 */
export default function ScheduleView({ token }) {
  const [year, setYear] = useState(null);
  const [month, setMonth] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [modalEmployee, setModalEmployee] = useState(null);

  // 可选月份（上月/本月/次月）
  const [availableMonths, setAvailableMonths] = useState([]);

  useEffect(() => {
    const now = new Date();
    const curY = now.getFullYear();
    const curM = now.getMonth() + 1;
    const months = [];
    for (let i = -1; i <= 1; i++) {
      const key = curY * 12 + (curM - 1) + i;
      months.push({ year: Math.floor(key / 12), month: (key % 12) + 1 });
    }
    setAvailableMonths(months);
    setYear(curY);
    setMonth(curM);
  }, []);

  const fetchData = useCallback(async () => {
    if (!year || !month) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/schedule/view?year=${year}&month=${month}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        // API 返回 days 为数字，转为数组供 .map() 使用
        if (typeof d.days === 'number') {
          d.days = Array.from({ length: d.days }, (_, i) => i + 1);
        }
        setData(d);
      }
    } catch (err) {
      console.error('获取排班表失败:', err);
    } finally {
      setLoading(false);
    }
  }, [year, month, token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Excel 导出 ──
  const exportToExcel = useCallback(() => {
    if (!data || data.isEmpty || !data.employees) return;

    const wsData = [];
    // days 可能已被转为数组，统一取天数
    const days = Array.isArray(data.days) ? data.days.length : data.days;
    const weekdays = data.weekdays;
    const wdNames = ['', '一', '二', '三', '四', '五', '六', '日'];

    // 标题行
    wsData.push([`${data.year}年${data.month}月 中心排班表`]);
    wsData.push([]);

    // 日期行
    const dateRow = ['姓名', '工号'];
    for (let d = 1; d <= days; d++) dateRow.push(`${d}日`);
    wsData.push(dateRow);

    // 星期行
    const weekRow = ['', ''];
    for (let i = 0; i < days; i++) weekRow.push(`周${wdNames[weekdays[i]]}`);
    wsData.push(weekRow);

    // 员工数据行
    for (const emp of data.employees) {
      const empRecords = data.records[emp.employee_id] || {};
      const row = [emp.name, emp.employee_id];
      for (let d = 1; d <= days; d++) {
        const rec = empRecords[d];
        if (!rec) {
          row.push('');
        } else {
          const am = (rec.am_work_type || '').replace('AM', '') || '';
          const pm = (rec.pm_work_type || '').replace('PM', '') || '';
          row.push(`${rec.shift}\n${rec.meal_time || ''}\n${am}\n${pm}`);
        }
      }
      wsData.push(row);
    }

    // 创建工作簿
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    // 合并标题行
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: days + 1 } },
      { s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }, // 姓名合并两行
      { s: { r: 1, c: 1 }, e: { r: 2, c: 1 } }, // 工号合并两行
    ];
    // 列宽
    ws['!cols'] = [
      { wch: 10 }, { wch: 12 },
      ...Array(days).fill({ wch: 14 }),
    ];
    XLSX.utils.book_append_sheet(wb, ws, '中心排班表');

    const fileName = `中心排班表_${data.year}年${data.month}月.xlsx`;
    XLSX.writeFile(wb, fileName);
  }, [data]);

  const weekdayNames = ['', '一', '二', '三', '四', '五', '六', '日'];
  const shiftColors = {
    '日班': '#e3f2fd', '早班': '#fff8e1', '晚班': '#f3e5f5',
    '全班': '#e8f5e9', '休': '#f5f5f5', '假': '#ffebee',
  };

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h3 style={{ fontSize: '18px', color: '#1e3a5f', margin: 0 }}>中心排班表</h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {availableMonths.map((m, i) => {
            const labels = ['上月', '本月', '次月'];
            const isActive = year === m.year && month === m.month;
            return (
              <button
                key={i}
                className={isActive ? 'btn-primary' : 'btn-secondary'}
                style={{ padding: '6px 14px', fontSize: '13px' }}
                onClick={() => { setYear(m.year); setMonth(m.month); }}
              >
                {labels[i]} ({m.year}年{m.month}月)
              </button>
            );
          })}
          {data && !data.isEmpty && (
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); exportToExcel(); }}
              style={{ marginLeft: '12px', fontSize: '13px', color: '#2563eb', textDecoration: 'underline', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              导出Excel
            </a>
          )}
        </div>
      </div>

      {loading && <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>加载中...</div>}

      {data && data.isEmpty && (
        <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af', background: '#fff', borderRadius: '8px' }}>
          {data.message || '暂无排班数据'}
        </div>
      )}

      {data && !data.isEmpty && data.employees && data.employees.length > 0 && (
        <div style={{ overflowX: 'auto', background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '12px', minWidth: '100%' }}>
            <thead>
              {/* 日期行 */}
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={headerStyle} rowSpan={2}>姓名</th>
                <th style={headerStyle} rowSpan={2}>工号</th>
                {data.days.map((_, i) => (
                  <th key={i} style={{ ...headerStyle, textAlign: 'center', padding: '4px 2px' }}>
                    {i + 1}日
                  </th>
                ))}
              </tr>
              {/* 星期行 */}
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                {data.weekdays.map((wd, i) => (
                  <th key={i} style={{
                    ...headerStyle,
                    textAlign: 'center', padding: '2px 2px',
                    color: wd > 5 ? '#dc2626' : '#6b7280',
                    fontSize: '10px',
                  }}>
                    {weekdayNames[wd]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.employees.map((emp, empIdx) => {
                const empRecords = data.records[emp.employee_id] || {};
                const empStats = (data.stats && data.stats[emp.employee_id]) || {};
                return (
                  <tr key={emp.employee_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ ...cellStyle, cursor: 'pointer', color: '#2563eb', textDecoration: 'underline' }}
                      onClick={() => setModalEmployee(emp)}>
                      {emp.name}
                    </td>
                    <td style={{ ...cellStyle, cursor: 'pointer', color: '#2563eb' }}
                      onClick={() => setModalEmployee(emp)}>
                      {emp.employee_id}
                    </td>
                    {data.days.map((_, dayIdx) => {
                      const day = dayIdx + 1;
                      const rec = empRecords[day];
                      if (!rec) {
                        return <td key={dayIdx} style={{ ...cellStyle, background: '#fafafa', textAlign: 'center' }}>-</td>;
                      }
                      const bg = shiftColors[rec.shift] || '#fff';
                      const amShort = (rec.am_work_type || '').replace('AM', '') || '-';
                      const pmShort = (rec.pm_work_type || '').replace('PM', '') || '-';
                      return (
                        <td key={dayIdx} style={{ ...cellStyle, background: bg, textAlign: 'center', padding: '2px 2px', minWidth: '60px' }}>
                          <div style={{ fontSize: '10px', fontWeight: '600' }}>{rec.shift}</div>
                          <div style={{ fontSize: '9px', color: '#6b7280' }}>{rec.meal_time}</div>
                          <div style={{ fontSize: '9px' }}>{amShort}</div>
                          <div style={{ fontSize: '9px' }}>{pmShort}</div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 个人弹窗 */}
      {modalEmployee && (
        <PersonalModal
          employee={modalEmployee}
          year={year}
          month={month}
          token={token}
          onClose={() => setModalEmployee(null)}
        />
      )}
    </div>
  );
}

const headerStyle = {
  padding: '8px 10px',
  textAlign: 'left',
  color: '#6b7280',
  fontWeight: '600',
  fontSize: '13px',
  background: '#f9fafb',
  position: 'sticky',
  top: 0,
  zIndex: 1,
};

const cellStyle = {
  padding: '4px 8px',
  fontSize: '13px',
  color: '#374151',
  whiteSpace: 'nowrap',
};
