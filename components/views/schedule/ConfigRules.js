import { useState, useEffect } from 'react';

/**
 * 配置默认规则 - 管理区第6个页面
 * 参照《配置_排班规则》sheet
 * 每月C列填>0的浮点数（1位小数）
 * D列复选工种（至少1最多全选）
 * 可上机工作日复选周一至周五（至少1最多全选）
 */
export default function ConfigRules({ token }) {
  const [year, setYear] = useState(null);
  const [month, setMonth] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('');
  const [draft, setDraft] = useState({}); // employee_id -> { default_on_machine_days, allowed_work_types, allowed_weekdays }

  const allWorkTypes = ['拨测体验', '语音', '工单留邮', '文字IM', '外呼调研', '代值班', '质检'];
  const weekdayOptions = [
    { value: 1, label: '周一' }, { value: 2, label: '周二' }, { value: 3, label: '周三' },
    { value: 4, label: '周四' }, { value: 5, label: '周五' },
  ];

  useEffect(() => {
    const now = new Date();
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
  }, []);

  useEffect(() => {
    if (year && month) fetchData();
  }, [year, month]);

  const fetchData = async () => {
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch(`/api/schedule/rules?year=${year}&month=${month}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        setData(d);
        setDraft({});
      }
    } catch (err) {
      console.error('获取默认规则失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setMsg('');
    try {
      const rules = Object.entries(draft).map(([empId, val]) => ({
        employee_id: empId,
        ...val,
      }));

      // 也包含未修改的已有规则
      if (data?.rules) {
        for (const r of data.rules) {
          if (!draft[r.employee_id]) {
            rules.push({
              employee_id: r.employee_id,
              default_on_machine_days: r.default_on_machine_days,
              allowed_work_types: r.allowed_work_types,
              allowed_weekdays: r.allowed_weekdays,
            });
          }
        }
      }

      const res = await fetch('/api/schedule/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ year, month, rules }),
      });
      const result = await res.json();
      if (res.ok) {
        setMsg('保存成功');
        setMsgType('success');
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
    setDraft({});
    setMsg('');
  };

  const updateDraft = (empId, field, value) => {
    if (!draft[empId]) {
      const orig = data?.rules?.find(r => r.employee_id === empId);
      draft[empId] = {
        default_on_machine_days: orig?.default_on_machine_days || 0,
        allowed_work_types: orig?.allowed_work_types || [],
        allowed_weekdays: orig?.allowed_weekdays || [],
      };
    }
    draft[empId][field] = value;
    setDraft({ ...draft });
  };

  const getDays = (empId) => {
    if (draft[empId]) return draft[empId].default_on_machine_days;
    const orig = data?.rules?.find(r => r.employee_id === empId);
    return orig?.default_on_machine_days || 0;
  };

  const getWorkTypes = (empId) => {
    if (draft[empId]) return draft[empId].allowed_work_types;
    const orig = data?.rules?.find(r => r.employee_id === empId);
    return orig?.allowed_work_types || [];
  };

  const getWeekdays = (empId) => {
    if (draft[empId]) return draft[empId].allowed_weekdays;
    const orig = data?.rules?.find(r => r.employee_id === empId);
    return orig?.allowed_weekdays || [];
  };

  const toggleWorkType = (empId, wt) => {
    const current = getWorkTypes(empId);
    const newVal = current.includes(wt) ? current.filter(t => t !== wt) : [...current, wt];
    updateDraft(empId, 'allowed_work_types', newVal);
  };

  const toggleWeekday = (empId, wd) => {
    const current = getWeekdays(empId);
    const newVal = current.includes(wd) ? current.filter(d => d !== wd) : [...current, wd];
    updateDraft(empId, 'allowed_weekdays', newVal);
  };

  // 月份选择
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
      {/* 月份选择 */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {months.map((m, i) => {
          const isActive = year === m.year && month === m.month;
          return (
            <button key={i} className={isActive ? 'btn-primary' : 'btn-secondary'}
              style={{ padding: '6px 14px', fontSize: '13px' }}
              onClick={() => { setYear(m.year); setMonth(m.month); }}>
              {monthLabels[i]} ({m.year}年{m.month}月)
            </button>
          );
        })}
      </div>

      {msg && (
        <div style={{
          padding: '8px 12px', borderRadius: '4px', marginBottom: '16px', fontSize: '13px',
          background: msgType === 'success' ? '#dcfce7' : '#fee2e2',
          color: msgType === 'success' ? '#16a34a' : '#dc2626',
        }}>{msg}</div>
      )}

      <div style={{ background: '#fff', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: '8px 10px', textAlign: 'left', color: '#6b7280' }}>姓名</th>
              <th style={{ padding: '8px 10px', textAlign: 'center', color: '#6b7280' }}>默认上机天数</th>
              <th style={{ padding: '8px 10px', textAlign: 'left', color: '#6b7280' }}>可承接的上机工种</th>
              <th style={{ padding: '8px 10px', textAlign: 'left', color: '#6b7280' }}>可上机工作日</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rules || []).map((rule) => (
              <tr key={rule.employee_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 10px', color: '#374151' }}>
                  {rule.name}
                  <div style={{ fontSize: '11px', color: '#9ca3af' }}>{rule.employee_id}</div>
                </td>
                <td style={{ padding: '4px 10px', textAlign: 'center' }}>
                  <input type="number" step="0.1" min="0.1"
                    value={getDays(rule.employee_id)}
                    onChange={e => updateDraft(rule.employee_id, 'default_on_machine_days', parseFloat(e.target.value) || 0)}
                    style={{ width: '60px', fontSize: '12px', border: '1px solid #ddd', borderRadius: '4px', padding: '4px 8px', textAlign: 'center' }} />
                </td>
                <td style={{ padding: '4px 10px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {allWorkTypes.map(wt => {
                      const checked = getWorkTypes(rule.employee_id).includes(wt);
                      return (
                        <label key={wt} style={{
                          fontSize: '11px', padding: '2px 6px',
                          background: checked ? '#dbeafe' : '#f3f4f6',
                          borderRadius: '3px', cursor: 'pointer',
                          color: checked ? '#2563eb' : '#6b7280',
                        }}>
                          <input type="checkbox" checked={checked}
                            onChange={() => toggleWorkType(rule.employee_id, wt)}
                            style={{ display: 'none' }} />
                          {wt}
                        </label>
                      );
                    })}
                  </div>
                </td>
                <td style={{ padding: '4px 10px' }}>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {weekdayOptions.map(wd => {
                      const checked = getWeekdays(rule.employee_id).includes(wd.value);
                      return (
                        <label key={wd.value} style={{
                          fontSize: '11px', padding: '2px 6px',
                          background: checked ? '#dbeafe' : '#f3f4f6',
                          borderRadius: '3px', cursor: 'pointer',
                          color: checked ? '#2563eb' : '#6b7280',
                        }}>
                          <input type="checkbox" checked={checked}
                            onChange={() => toggleWeekday(rule.employee_id, wd.value)}
                            style={{ display: 'none' }} />
                          {wd.label}
                        </label>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
        <button className="btn-primary" onClick={handleSave} disabled={loading}>保存</button>
        <button className="btn-secondary" onClick={handleCancel} disabled={loading}>取消</button>
      </div>
    </div>
  );
}
