import { useState, useEffect } from 'react';

export default function MenuManage({ token, user, onMenuUpdated }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [selectedMenuIds, setSelectedMenuIds] = useState(new Set());
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/admin/menu-manage', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        setData(d);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSelectUser = (userId) => {
    setSelectedUserId(userId);
    const perms = new Set(
      data.permissions.filter(p => p.user_id === userId).map(p => p.menu_id)
    );
    setSelectedMenuIds(perms);
    setMsg('');
  };

  // 切换二级菜单勾选：联动所有子菜单
  const toggleLevel2 = (m2, children) => {
    const newSet = new Set(selectedMenuIds);
    const allChildrenSelected = children.every(c => newSet.has(c.id));
    if (allChildrenSelected) {
      // 取消：移除二级和所有三级
      newSet.delete(m2.id);
      children.forEach(c => newSet.delete(c.id));
    } else {
      // 勾选：添加所有三级（不存二级，以三级为准）
      children.forEach(c => newSet.add(c.id));
    }
    setSelectedMenuIds(newSet);
  };

  // 切换三级菜单勾选：检查是否全部三级被选
  const toggleLevel3 = (m3, parent, siblings) => {
    const newSet = new Set(selectedMenuIds);
    if (newSet.has(m3.id)) {
      newSet.delete(m3.id);
      newSet.delete(parent.id); // 有一个取消，二级也取消
    } else {
      newSet.add(m3.id);
      // 检查是否所有三级都已选
      const allSelected = siblings.every(s => newSet.has(s.id));
      if (allSelected) {
        newSet.add(parent.id);
      }
    }
    setSelectedMenuIds(newSet);
  };

  const handleSave = async () => {
    setMsg('');
    try {
      const res = await fetch('/api/admin/menu-manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ userId: selectedUserId, menuIds: Array.from(selectedMenuIds) }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg('权限设置成功');
        fetchData();
        if (onMenuUpdated) onMenuUpdated();
      } else {
        setMsg(data.error || '设置失败');
      }
    } catch (err) {
      setMsg('网络错误');
    }
  };

  const moveMenu = async (menuId, direction) => {
    const menus = [...data.menus.filter(m => m.level === 2)].sort((a, b) => a.sort_order - b.sort_order);
    const idx = menus.findIndex(m => m.id === menuId);
    if (direction === 'up' && idx <= 0) return;
    if (direction === 'down' && idx >= menus.length - 1) return;
    if (direction === 'up') {
      [menus[idx - 1], menus[idx]] = [menus[idx], menus[idx - 1]];
    } else {
      [menus[idx + 1], menus[idx]] = [menus[idx], menus[idx + 1]];
    }
    const reordered = menus.map((m, i) => ({ ...m, sort_order: i + 1 }));
    try {
      await fetch('/api/admin/menu-manage', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ menus: reordered }),
      });
      fetchData();
      if (onMenuUpdated) onMenuUpdated();
    } catch (err) {}
  };

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>加载中...</div>;

  const level2Menus = data?.menus?.filter(m => m.level === 2).sort((a, b) => a.sort_order - b.sort_order) || [];
  const level3Menus = data?.menus?.filter(m => m.level === 3) || [];

  return (
    <div style={{ padding: '24px' }}>
      <h3 style={{ fontSize: '18px', color: '#1e3a5f', marginBottom: '20px' }}>菜单管理</h3>
      {msg && <div style={{ padding: '8px 12px', background: '#eff6ff', borderRadius: '4px', marginBottom: '16px', color: '#2563eb', fontSize: '13px' }}>{msg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '20px' }}>
        {/* 用户列表 */}
        <div style={{ background: '#fff', borderRadius: '8px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: '14px', color: '#374151', marginBottom: '12px' }}>选择用户</h4>
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            {data?.users?.map(u => (
              <div key={u.id}
                onClick={() => handleSelectUser(u.id)}
                style={{
                  padding: '8px 12px', cursor: 'pointer', borderRadius: '4px', fontSize: '13px',
                  background: selectedUserId === u.id ? '#eff6ff' : 'transparent',
                  color: selectedUserId === u.id ? '#2563eb' : '#374151',
                  display: 'flex', justifyContent: 'space-between',
                }}>
                <span>{u.real_name}</span>
                <span style={{ color: '#9ca3af', fontSize: '12px' }}>{u.username}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 菜单授权 */}
        <div style={{ background: '#fff', borderRadius: '8px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          {selectedUserId ? (
            <div>
              <h4 style={{ fontSize: '14px', color: '#374151', marginBottom: '12px' }}>分配可见菜单</h4>
              <div style={{ marginBottom: '12px' }}>
                <span style={{ fontSize: '12px', color: '#9ca3af' }}>勾选该用户可以访问的菜单。"个人设置"为默认授权无需勾选。勾选二级标题等同于勾选其下所有三级标题。</span>
              </div>
              {level2Menus.map(m2 => {
                const children = level3Menus.filter(m3 => m3.parent_id === m2.id);
                const isPersonalSettings = m2.title === '个人设置';
                return (
                  <div key={m2.id} style={{ marginBottom: '16px', padding: '10px', background: isPersonalSettings ? '#f9fafb' : 'transparent', borderRadius: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
                      <label style={{ fontWeight: '600', color: '#1e3a5f', fontSize: '14px', display: 'flex', alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={isPersonalSettings || selectedMenuIds.has(m2.id)}
                          onChange={() => !isPersonalSettings && toggleLevel2(m2, children)}
                          disabled={isPersonalSettings}
                          style={{ marginRight: '6px' }}
                        />
                        {m2.title}
                      </label>
                      {isPersonalSettings && <span style={{ fontSize: '11px', color: '#9ca3af' }}>(默认授权)</span>}
                      {/* 排序按钮 */}
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
                        <button className="btn-secondary" style={{ padding: '0px 6px', fontSize: '11px' }}
                          onClick={() => moveMenu(m2.id, 'up')}>↑</button>
                        <button className="btn-secondary" style={{ padding: '0px 6px', fontSize: '11px' }}
                          onClick={() => moveMenu(m2.id, 'down')}>↓</button>
                      </div>
                    </div>
                    {children.length > 0 && (
                      <div style={{ marginLeft: '24px' }}>
                        {children.map(m3 => (
                          <label key={m3.id} style={{ display: 'block', padding: '4px 0', fontSize: '13px', color: '#4b5563' }}>
                            <input
                              type="checkbox"
                              checked={isPersonalSettings || selectedMenuIds.has(m3.id)}
                              onChange={() => !isPersonalSettings && toggleLevel3(m3, m2, children)}
                              disabled={isPersonalSettings}
                              style={{ marginLeft: 24, marginRight: '6px' }}
                            />
                            {m3.title}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              <button className="btn-primary" style={{ marginTop: '12px', padding: '8px 24px' }} onClick={handleSave}>保存权限</button>
            </div>
          ) : (
            <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>请从左侧选择一个用户</div>
          )}
        </div>
      </div>
    </div>
  );
}
