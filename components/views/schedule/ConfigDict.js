import { useState, useEffect } from 'react';

/**
 * 配置数据字典 - 管理区第2个页面
 * 参照《配置_数据字典》sheet A-F列，允许增/改/删
 */
export default function ConfigDict({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('');
  const [draft, setDraft] = useState({}); // id -> { category, value, sort_order }
  const [newItem, setNewItem] = useState({ category: '', value: '', sort_order: 0 });
  const [deletedIds, setDeletedIds] = useState(new Set());

  const categories = [
    { key: 'meal_time', label: '用餐时间' },
    { key: 'shift', label: '班次' },
    { key: 'am_work_type', label: '上午工种' },
    { key: 'pm_work_type', label: '下午工种' },
    { key: 'on_machine_type', label: '上机工种' },
    { key: 'shift_meal_time', label: '日班/早班餐时' },
  ];

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch('/api/schedule/dict', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        setData(d);
        setDraft({});
        setDeletedIds(new Set());
      }
    } catch (err) {
      console.error('获取字典失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setMsg('');
    try {
      let hasError = false;

      // 更新
      for (const [id, val] of Object.entries(draft)) {
        const res = await fetch('/api/schedule/dict', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: parseInt(id), ...val }),
        });
        if (!res.ok) hasError = true;
      }

      // 删除
      for (const id of deletedIds) {
        const res = await fetch('/api/schedule/dict', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: parseInt(id) }),
        });
        if (!res.ok) hasError = true;
      }

      // 新增
      if (newItem.category && newItem.value) {
        const res = await fetch('/api/schedule/dict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(newItem),
        });
        if (!res.ok) hasError = true;
      }

      if (hasError) {
        setMsg('保存失败');
        setMsgType('error');
      } else {
        setMsg('保存成功');
        setMsgType('success');
        fetchData();
        setNewItem({ category: '', value: '', sort_order: 0 });
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
    setDeletedIds(new Set());
    setNewItem({ category: '', value: '', sort_order: 0 });
    setMsg('');
  };

  const updateDraft = (id, field, value) => {
    if (!draft[id]) {
      const orig = findOriginal(id);
      draft[id] = { ...orig };
    }
    draft[id][field] = value;
    setDraft({ ...draft });
  };

  const findOriginal = (id) => {
    for (const cat of categories) {
      const items = data?.[cat.key] || [];
      const found = items.find(item => item.id === id);
      if (found) return { category: found.category, value: found.value, sort_order: found.sort_order };
    }
    return { category: '', value: '', sort_order: 0 };
  };

  const toggleDelete = (id) => {
    const newSet = new Set(deletedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setDeletedIds(newSet);
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {categories.map(cat => (
          <div key={cat.key} style={{ background: '#fff', borderRadius: '8px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <h4 style={{ fontSize: '14px', color: '#1e3a5f', marginBottom: '12px' }}>{cat.label}</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '6px', textAlign: 'left', color: '#6b7280', fontSize: '12px' }}>值</th>
                  <th style={{ padding: '6px', textAlign: 'center', color: '#6b7280', fontSize: '12px', width: '50px' }}>排序</th>
                  <th style={{ padding: '6px', textAlign: 'center', fontSize: '12px', width: '40px' }}></th>
                </tr>
              </thead>
              <tbody>
                {(data?.[cat.key] || []).map(item => {
                  const d = draft[item.id];
                  const isDeleted = deletedIds.has(item.id);
                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6', opacity: isDeleted ? 0.5 : 1 }}>
                      <td style={{ padding: '4px 6px' }}>
                        <input type="text" value={d?.value ?? item.value}
                          onChange={e => updateDraft(item.id, 'value', e.target.value)}
                          disabled={isDeleted}
                          style={{ width: '100%', fontSize: '12px', border: '1px solid #ddd', borderRadius: '3px', padding: '3px 6px' }} />
                      </td>
                      <td style={{ padding: '4px 6px' }}>
                        <input type="number" value={d?.sort_order ?? item.sort_order}
                          onChange={e => updateDraft(item.id, 'sort_order', parseInt(e.target.value) || 0)}
                          disabled={isDeleted}
                          style={{ width: '45px', fontSize: '12px', border: '1px solid #ddd', borderRadius: '3px', padding: '3px 4px', textAlign: 'center' }} />
                      </td>
                      <td style={{ padding: '4px', textAlign: 'center' }}>
                        <button onClick={() => toggleDelete(item.id)}
                          style={{ fontSize: '11px', background: 'none', border: 'none', cursor: 'pointer', color: isDeleted ? '#16a34a' : '#dc2626' }}>
                          {isDeleted ? '恢复' : '删除'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* 新增项 */}
      <div style={{ background: '#fff', borderRadius: '8px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginTop: '16px' }}>
        <h4 style={{ fontSize: '14px', color: '#1e3a5f', marginBottom: '12px' }}>新增字典项</h4>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <select value={newItem.category}
            onChange={e => setNewItem({ ...newItem, category: e.target.value })}
            style={{ fontSize: '13px', border: '1px solid #ddd', borderRadius: '4px', padding: '6px' }}>
            <option value="">选择分类</option>
            {categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <input type="text" placeholder="值" value={newItem.value}
            onChange={e => setNewItem({ ...newItem, value: e.target.value })}
            style={{ flex: 1, fontSize: '13px', border: '1px solid #ddd', borderRadius: '4px', padding: '6px 12px' }} />
          <input type="number" placeholder="排序" value={newItem.sort_order}
            onChange={e => setNewItem({ ...newItem, sort_order: parseInt(e.target.value) || 0 })}
            style={{ width: '60px', fontSize: '13px', border: '1px solid #ddd', borderRadius: '4px', padding: '6px', textAlign: 'center' }} />
        </div>
      </div>

      {/* 操作按钮 */}
      <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
        <button className="btn-primary" onClick={handleSave} disabled={loading}>保存</button>
        <button className="btn-secondary" onClick={handleCancel} disabled={loading}>取消</button>
      </div>
    </div>
  );
}
