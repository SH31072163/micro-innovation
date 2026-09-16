import { useState, useEffect, useCallback } from 'react';

/**
 * 配置排班 - 管理区第1个页面
 * - 参照中心排班表排班区域+汇总统计区
 * - 动态天数列
 * - 含"重新排班"按钮
 * - 修改后保存生效
 * - 次月20日后不可修改
 */
export default function ConfigSchedule({ token }) {
  const [year, setYear] = useState(null);
  const [month, setMonth] = useState(null);
  const [data, setData] = useState(null);
  const [dictData, setDictData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState({}); // employee_id -> day -> { shift, meal_time, am, pm }
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState(''); // 'success' | 'error'

  const availableMonths = [];
  useEffect(() => {
    const now = new Date();
    const curY = now.getFullYear();
    const curM = now.getMonth() + 1;
    setYear(curY);
    setMonth(curM);
    fetchDict();
  }, []);

  const fetchDict = async () => {
    try {
      const res = await fetch('/api/schedule/dict', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setDictData(await res.json());
    } catch (err) { console.error('获取字典失败:', err); }
  };

  const fetchData = useCallback(async () => {
    if (!year || !month) return;
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch(`/api/schedule/manage?year=${year}&month=${month}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        setData(d);
        setEditing({});
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

  const handleReschedule = async () => {
    if (!confirm(`确认对${year}年${month}月进行重新排班？这将覆盖当前排班数据。`)) return;
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch('/api/schedule/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'reschedule', year, month }),
      });
      const result = await res.json();
      if (res.ok) {
        setMsg(`重新排班成功，共生成 ${result.totalRecords} 条记录`);
        setMsgType('success');
        fetchData();
      } else {
        setMsg(result.error || '重新排班失败');
        setMsgType('error');
      }
    } catch (err) {
      setMsg('网络错误');
      setMsgType('error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    // 收集所有编辑过的记录
    const records = [];
    for (const [empId, days] of Object.entries(editing)) {
      for (const [day, val] of Object.entries(days)) {
        records.push({
          employee_id: empId,
          day: parseInt(day),
          shift: val.shift,
          meal_time: val.meal_time,
          am_work_type: val.am_work_type,
          pm_work_type: val.pm_work_type,
        });
      }
    }

    if (records.length === 0) {
      setMsg('没有修改需要保存');
      setMsgType('error');
      return;
    }

    setLoading(true);
    setMsg('');
    try {
      const res = await fetch('/api/schedule/manage', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ year, month, records }),
      });
      const result = await res.json();
      if (res.ok) {
        setMsg(`保存成功${result.changedCount > 0 ? `，${result.changedCount}人排班有变动` : ''}`);
        setMsgType('success');
        setEditing({});
        fetchData();
      } else {
        setMsg(result.error || '保存失败');
        setMsgType('error');
      }
    } catch (err) {
      setMsg('网络错误');
      setMsgType('error');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setEditing({});
    setMsg('');
  };

  // 更新单元格
  const updateCell = (empId, day, field, value) => {
    if (!editing[empId]) editing[empId] = {};
    if (!editing[empId][day]) {
      const orig = data.records[empId]?.[day] || {};
      editing[empId][day] = { shift: orig.shift || '', meal_time: orig.meal_time || '', am_work_type: orig.am_work_type || '', pm_work_type: orig.pm_work_type || '' };
    }
    editing[empId][day][field] = value;
    setEditing({ ...editing });
  };

  // 获取当前显示值（编辑值优先）
  const getCell = (empId, day, field) => {
    if (editing[empId]?.[day]) return editing[empId][day][field] || '';
    return data?.records?.[empId]?.[day]?.[field] || '';
  };

  const weekdayNames = ['', '一', '二', '三', '四', '五', '六', '日'];

  // 可选月份
  const getMonths = () => {
    const now = new Date();
    const curY = now.getFullYear();
    const curM = now.getMonth() + 1;
    const months = [];
    for (let i = -1; i <= 1; i++) {
      const key = curY * 12 + (curM - 1) + i;
      months.push({ year: Math.floor(key / 12), month: (key % 12) + 1 });
    }
    return months;
  };

  const months = getMonths();
  const monthLabels = ['上月', '本月', '次月'];

  if (loading && !data) return <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>加载中...</div>;

  return (
    <div>
      {/* 工具栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          {months.map((m, i) => {
            const isActive = year === m.year && month === m.month;
            return (
              <button
                key={i}
                className={isActive ? 'btn-primary' : 'btn-secondary'}
                style={{ padding: '6px 14px', fontSize: '13px' }}
                onClick={() => { setYear(m.year); setMonth(m.month); }}
              >
                {monthLabels[i]} ({m.year}年{m.month}月)
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {data?.canEdit && (
            <button className="btn-primary" style={{ padding: '6px 16px', fontSize: '13px' }}
              onClick={handleReschedule} disabled={loading}>
              重新排班
            </button>
          )}
          <button className="btn-primary" style={{ padding: '6px 16px', fontSize: '13px' }}
            onClick={handleSave} disabled={loading || !data?.canEdit}>
            保存
          </button>
          <button className="btn-secondary" style={{ padding: '6px 16px', fontSize: '13px' }}
            onClick={handleCancel} disabled={loading}>
            取消
          </button>
        </div>
      </div>

      {msg && (
        <div style={{
          padding: '8px 12px', borderRadius: '4px', marginBottom: '16px', fontSize: '13px',
          background: msgType === 'success' ? '#dcfce7' : '#fee2e2',
          color: msgType === 'success' ? '#16a34a' : '#dc2626',
        }}>{msg}</div>
      )}

      {!data?.canEdit && data && (
        <div style={{ padding: '8px 12px', background: '#fffbeb', borderRadius: '4px', marginBottom: '16px', color: '#d97706', fontSize: '13px' }}>
          该月排班表已过截止日期（次月20日后），不可修改
        </div>
      )}

      {data?.isEmpty && (
        <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af', background: '#fff', borderRadius: '8px' }}>
          暂无排班数据，请点击"重新排班"生成
        </div>
      )}

      {/* 排班表编辑表格 */}
      {data && !data.isEmpty && data.employees && data.employees.length > 0 && (
        <div style={{ overflowX: 'auto', background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr>
                <th style={thStyle} rowSpan={2}>姓名</th>
                <th style={thStyle} rowSpan={2}>工号</th>
                {data.days.map((_, i) => (
                  <th key={i} style={{ ...thStyle, textAlign: 'center', padding: '2px 1px', minWidth: '55px' }}>
                    {i + 1}日
                  </th>
                ))}
              </tr>
              <tr>
                {data.weekdays.map((wd, i) => (
                  <th key={i} style={{ ...thStyle, textAlign: 'center', padding: '1px', color: wd > 5 ? '#dc2626' : '#6b7280', fontSize: '9px' }}>
                    {weekdayNames[wd]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.employees.map((emp) => (
                <tr key={emp.employee_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={tdStyle}>{emp.name}</td>
                  <td style={tdStyle}>{emp.employee_id}</td>
                  {data.days.map((_, dayIdx) => {
                    const day = dayIdx + 1;
                    const shiftVal = getCell(emp.employee_id, day, 'shift');
                    const amVal = getCell(emp.employee_id, day, 'am_work_type');
                    const pmVal = getCell(emp.employee_id, day, 'pm_work_type');
                    const isEditing = editing[emp.employee_id]?.[day];
                    return (
                      <td key={dayIdx} style={{ ...tdStyle, padding: '1px', textAlign: 'center', minWidth: '65px', background: isEditing ? '#fffde7' : '#fff' }}>
                        <select value={shiftVal}
                          onChange={e => updateCell(emp.employee_id, day, 'shift', e.target.value)}
                          style={{ width: '55px', fontSize: '10px', border: '1px solid #ddd', borderRadius: '2px', padding: '1px 2px', textAlign: 'center' }}>
                          <option value=""></option>
                          {(dictData?.['shift'] || []).map(d => <option key={d.id} value={d.value}>{d.value}</option>)}
                        </select>
                        <select value={amVal}
                          onChange={e => updateCell(emp.employee_id, day, 'am_work_type', e.target.value)}
                          style={{ width: '60px', fontSize: '9px', border: '1px solid #ddd', borderRadius: '2px', padding: '1px 2px', display: 'block', margin: '1px auto' }}>
                          <option value=""></option>
                          {(dictData?.['am_work_type'] || []).map(d => <option key={d.id} value={d.value}>{d.value}</option>)}
                        </select>
                        <select value={pmVal}
                          onChange={e => updateCell(emp.employee_id, day, 'pm_work_type', e.target.value)}
                          style={{ width: '60px', fontSize: '9px', border: '1px solid #ddd', borderRadius: '2px', padding: '1px 2px', display: 'block', margin: '1px auto' }}>
                          <option value=""></option>
                          {(dictData?.['pm_work_type'] || []).map(d => <option key={d.id} value={d.value}>{d.value}</option>)}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const thStyle = {
  padding: '6px 8px', textAlign: 'left', color: '#6b7280',
  fontWeight: '600', fontSize: '12px', background: '#f9fafb',
};
const tdStyle = {
  padding: '4px 6px', fontSize: '12px', color: '#374151', whiteSpace: 'nowrap',
};
