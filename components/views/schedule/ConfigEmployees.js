import { useState, useEffect } from 'react';

/**
 * 人员增删 - 管理区第4个页面
 * 参照《配置_人员增删》sheet，支持增/改/删（姓名和工号不能改）
 * 增删效果在"配置排班"和"配置默认规则"中只能次月生效
 * 修改信息（如邮箱）立即生效
 */
export default function ConfigEmployees({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('');
  const [emailDraft, setEmailDraft] = useState({}); // id -> email
  const [typeDraft, setTypeDraft] = useState({}); // id -> employee_type
  const [hireDateDraft, setHireDateDraft] = useState({}); // id -> { year, month }
  const [newEmp, setNewEmp] = useState({ name: '', employee_id: '', email: '', employee_type: '全职用户接待岗', hire_year: '2024', hire_month: '6' });

  const YEARS = ['2024', '2025', '2026', '2027', '2028', '2029', '2030'];
  const MONTHS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

  // hire_date 'YYYYMM' -> { year, month }
  function parseHireDate(hd) {
    if (!hd || hd.length !== 6) return { year: '2024', month: '6' };
    return { year: hd.substring(0, 4), month: String(parseInt(hd.substring(4, 6))) };
  }
  // { year, month } -> 'YYYYMM'
  function formatHireDate(year, month) {
    return year + String(month).padStart(2, '0');
  }

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch('/api/schedule/employees', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        setData(d);
        setEmailDraft({});
        setTypeDraft({});
        setHireDateDraft({});
      }
    } catch (err) {
      console.error('获取人员失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setMsg('');
    try {
      let hasError = false;

      // 更新邮箱/兼职全职/入职日期
      const EMPLOYEE_TYPES = ['全职用户接待岗', '兼职用户接待岗'];
      const changedIds = new Set([
        ...Object.keys(emailDraft).map(Number),
        ...Object.keys(typeDraft).map(Number),
        ...Object.keys(hireDateDraft).map(Number),
      ]);
      for (const id of changedIds) {
        const emp = data.find(e => e.id === id);
        if (!emp) continue;
        const email = emailDraft[id] ?? emp.email ?? '';
        const type = typeDraft[id] ?? emp.employee_type ?? EMPLOYEE_TYPES[0];
        const hd = hireDateDraft[id] ?? parseHireDate(emp.hire_date);
        const hire_date = formatHireDate(hd.year, hd.month);
        const res = await fetch('/api/schedule/employees', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id, email, employee_type: type, hire_date }),
        });
        if (!res.ok) hasError = true;
      }

      // 新增
      if (newEmp.name && newEmp.employee_id) {
        const hire_date = formatHireDate(newEmp.hire_year, newEmp.hire_month);
        const res = await fetch('/api/schedule/employees', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            name: newEmp.name,
            employee_id: newEmp.employee_id,
            email: newEmp.email,
            employee_type: newEmp.employee_type,
            hire_date,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          setMsg(err.error || '新增失败');
          setMsgType('error');
          hasError = true;
        }
      }

      if (!hasError) {
        setMsg('保存成功');
        setMsgType('success');
        alert('保存成功');
        fetchData();
        setNewEmp({ name: '', employee_id: '', email: '', employee_type: '全职用户接待岗', hire_year: '2024', hire_month: '6' });
      }
    } catch (err) {
      setMsg('网络错误');
      setMsgType('error');
      alert('保存失败：网络错误');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`确认删除员工"${name}"？删除后次月生效，不影响历史记录。`)) return;
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch('/api/schedule/employees', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setMsg('删除成功（次月生效）');
        setMsgType('success');
        alert('删除成功（次月生效）');
        fetchData();
      } else {
        const err = await res.json();
        const tip = err.error || '删除失败';
        setMsg(tip);
        setMsgType('error');
        alert(tip);
      }
    } catch (err) {
      setMsg('网络错误');
      setMsgType('error');
      alert('删除失败：网络错误');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setEmailDraft({});
    setTypeDraft({});
    setHireDateDraft({});
    setNewEmp({ name: '', employee_id: '', email: '', employee_type: '全职用户接待岗', hire_year: '2024', hire_month: '6' });
    setMsg('');
  };

  if (loading && !data) return <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>加载中...</div>;

  return (
    <div>
      {msg && (
        <div style={{
          padding: '8px 12px', borderRadius: '4px', marginBottom: '16px', fontSize: '13px',
          background: msgType === 'success' ? '#dcfce7' : '#fee2e2',
          color: msgType === 'success' ? '#16a34a' : '#dc2626',
        }}>{msg}</div>
      )}

      <div style={{ background: '#fff', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: '16px' }}>
        <h4 style={{ fontSize: '14px', color: '#1e3a5f', marginBottom: '16px' }}>员工列表</h4>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: '8px 16px', textAlign: 'left', color: '#6b7280' }}>姓名</th>
              <th style={{ padding: '8px 16px', textAlign: 'left', color: '#6b7280' }}>工号</th>
              <th style={{ padding: '8px 16px', textAlign: 'left', color: '#6b7280' }}>兼职全职</th>
              <th style={{ padding: '8px 16px', textAlign: 'left', color: '#6b7280' }}>入职日期</th>
              <th style={{ padding: '8px 16px', textAlign: 'left', color: '#6b7280' }}>邮箱</th>
              <th style={{ padding: '8px 16px', textAlign: 'center', color: '#6b7280' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {(data || []).map(emp => (
              <tr key={emp.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 16px', color: '#374151' }}>{emp.name}</td>
                <td style={{ padding: '8px 16px', color: '#6b7280' }}>{emp.employee_id}</td>
                <td style={{ padding: '4px 16px' }}>
                  <select value={typeDraft[emp.id] ?? emp.employee_type ?? '全职用户接待岗'}
                    onChange={e => setTypeDraft({ ...typeDraft, [emp.id]: e.target.value })}
                    style={{ fontSize: '12px', border: '1px solid #ddd', borderRadius: '4px', padding: '4px 8px' }}>
                    <option value="全职用户接待岗">全职用户接待岗</option>
                    <option value="兼职用户接待岗">兼职用户接待岗</option>
                    <option value="业务支撑岗">业务支撑岗</option>
                  </select>
                </td>
                <td style={{ padding: '4px 16px' }}>
                  {(() => {
                    const hd = hireDateDraft[emp.id] ?? parseHireDate(emp.hire_date);
                    return (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <select value={hd.year}
                          onChange={e => setHireDateDraft({ ...hireDateDraft, [emp.id]: { ...hd, year: e.target.value } })}
                          style={{ fontSize: '12px', border: '1px solid #ddd', borderRadius: '4px', padding: '4px 6px' }}>
                          {YEARS.map(y => <option key={y} value={y}>{y + '年'}</option>)}
                        </select>
                        <select value={hd.month}
                          onChange={e => setHireDateDraft({ ...hireDateDraft, [emp.id]: { ...hd, month: e.target.value } })}
                          style={{ fontSize: '12px', border: '1px solid #ddd', borderRadius: '4px', padding: '4px 6px' }}>
                          {MONTHS.map(m => <option key={m} value={m}>{m + '月'}</option>)}
                        </select>
                      </div>
                    );
                  })()}
                </td>
                <td style={{ padding: '4px 16px' }}>
                  <input type="text" value={emailDraft[emp.id] ?? emp.email ?? ''}
                    onChange={e => setEmailDraft({ ...emailDraft, [emp.id]: e.target.value })}
                    placeholder="邮箱"
                    style={{ width: '200px', fontSize: '12px', border: '1px solid #ddd', borderRadius: '4px', padding: '4px 8px' }} />
                </td>
                <td style={{ padding: '8px 16px', textAlign: 'center' }}>
                  <button className="btn-danger" onClick={() => handleDelete(emp.id, emp.name)}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 新增员工 */}
      <div style={{ background: '#fff', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <h4 style={{ fontSize: '14px', color: '#1e3a5f', marginBottom: '16px' }}>新增员工（次月生效）</h4>
        <div style={{ display: 'flex', gap: '12px' }}>
          <input type="text" placeholder="姓名" value={newEmp.name}
            onChange={e => setNewEmp({ ...newEmp, name: e.target.value })}
            style={{ flex: 1, fontSize: '13px', border: '1px solid #ddd', borderRadius: '4px', padding: '6px 12px' }} />
          <input type="text" placeholder="工号" value={newEmp.employee_id}
            onChange={e => setNewEmp({ ...newEmp, employee_id: e.target.value })}
            style={{ flex: 1, fontSize: '13px', border: '1px solid #ddd', borderRadius: '4px', padding: '6px 12px' }} />
          <select value={newEmp.employee_type}
            onChange={e => setNewEmp({ ...newEmp, employee_type: e.target.value })}
            style={{ flex: 1.2, fontSize: '13px', border: '1px solid #ddd', borderRadius: '4px', padding: '6px 12px' }}>
            <option value="全职用户接待岗">全职用户接待岗</option>
            <option value="兼职用户接待岗">兼职用户接待岗</option>
            <option value="业务支撑岗">业务支撑岗</option>
          </select>
          <div style={{ flex: 1.5, display: 'flex', gap: '4px' }}>
            <select value={newEmp.hire_year}
              onChange={e => setNewEmp({ ...newEmp, hire_year: e.target.value })}
              style={{ flex: 1, fontSize: '13px', border: '1px solid #ddd', borderRadius: '4px', padding: '6px 8px' }}>
              {YEARS.map(y => <option key={y} value={y}>{y + '年'}</option>)}
            </select>
            <select value={newEmp.hire_month}
              onChange={e => setNewEmp({ ...newEmp, hire_month: e.target.value })}
              style={{ flex: 1, fontSize: '13px', border: '1px solid #ddd', borderRadius: '4px', padding: '6px 8px' }}>
              {MONTHS.map(m => <option key={m} value={m}>{m + '月'}</option>)}
            </select>
          </div>
          <input type="text" placeholder="邮箱" value={newEmp.email}
            onChange={e => setNewEmp({ ...newEmp, email: e.target.value })}
            style={{ flex: 2, fontSize: '13px', border: '1px solid #ddd', borderRadius: '4px', padding: '6px 12px' }} />
        </div>
      </div>

      <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
        <button className="btn-primary" onClick={handleSave} disabled={loading}>保存</button>
        <button className="btn-secondary" onClick={handleCancel} disabled={loading}>取消</button>
      </div>
    </div>
  );
}
