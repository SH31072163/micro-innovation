import { useState, useEffect } from 'react';

export default function AdminUsers({ token, user }) {
  const [keyword, setKeyword] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [editField, setEditField] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [msg, setMsg] = useState('');
  const [resendingId, setResendingId] = useState(null); // 正在重发邮件的用户id
  const [barMsg, setBarMsg] = useState(''); // 列表页顶部提示条
  const [barMsgType, setBarMsgType] = useState(''); // 'success' | 'error'
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false); // 删除确认弹窗

  const searchUsers = async (kw) => {
    setLoading(true);
    try {
      const url = kw ? `/api/admin/users?keyword=${encodeURIComponent(kw)}` : '/api/admin/users';
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (err) {}
    setLoading(false);
  };

  useEffect(() => {
    searchUsers('');
  }, []);

  const handleRowClick = (u) => {
    setSelectedUser(u);
    setEditField(null);
    setMsg('');
  };

  const handleFreezeToggle = async () => {
    const action = selectedUser.status === 'frozen' ? 'unfreeze' : 'freeze';
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ action, userId: selectedUser.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg(data.message);
        searchUsers(keyword);
        const newStatus = action === 'freeze' ? 'frozen' : 'active';
        const newStatusText = action === 'freeze' ? '冻结' : (selectedUser.email_verified ? '正常' : '待邮箱验证');
        setSelectedUser({ ...selectedUser, status: newStatus, status_text: newStatusText });
      }
    } catch (err) {}
  };

  // 重发注册验证邮件（仅对状态=待邮箱验证的用户）
  const handleResendVerify = async (u) => {
    if (!window.confirm(`确定要向「${u.username}」的邮箱（${u.email}）重新发送注册验证邮件吗？`)) return;
    setResendingId(u.id);
    setBarMsg('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'resend_verify', userId: u.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setBarMsg(data.message);
        setBarMsgType('success');
        alert(data.message);
        searchUsers(keyword);
        if (selectedUser && selectedUser.id === u.id) setMsg(data.message);
      } else {
        setBarMsg(data.error || '重发失败');
        setBarMsgType('error');
        alert(data.error || '重发失败');
        if (selectedUser && selectedUser.id === u.id) setMsg(data.error || '重发失败');
      }
    } catch (err) {
      setBarMsg('网络错误，重发失败');
      setBarMsgType('error');
      alert('网络错误，重发失败');
    } finally {
      setResendingId(null);
    }
  };

  const handleEditSubmit = async (field) => {
    try {
      const body = { userId: selectedUser.id, field, value: editValues[field] };
      if (field === 'password' || field === 'email') {
        body.confirmPassword = editValues[`${field}_confirm`];
      }
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg(data.message);
        setEditField(null);
        setEditValues({});
        searchUsers(keyword);
      } else {
        setMsg(data.error || '修改失败');
      }
    } catch (err) {
      setMsg('网络错误');
    }
  };

  const handleDeleteUser = async () => {
    try {
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ userId: selectedUser.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setSelectedUser(null);
        setShowDeleteConfirm(false);
        setMsg('');
        searchUsers(keyword);
      } else {
        setMsg(data.error || '删除失败');
        setShowDeleteConfirm(false);
      }
    } catch (err) {
      setMsg('网络错误');
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div style={{ padding: '24px' }}>
      <h3 style={{ fontSize: '18px', color: '#1e3a5f', marginBottom: '20px' }}>手工修改</h3>

      {/* 搜索栏 */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <input className="input-field" style={{ maxWidth: '400px' }}
          placeholder="按用户名/邮箱/部门/姓名/劳动关系搜索..."
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && searchUsers(keyword)} />
        <button className="btn-primary" onClick={() => searchUsers(keyword)}>搜索</button>
      </div>

      {/* 重发结果提示条 */}
      {barMsg && (
        <div style={{
          padding: '10px 14px', borderRadius: '6px', marginBottom: '16px', fontSize: '13px',
          background: barMsgType === 'success' ? '#f0fdf4' : '#fef2f2',
          color: barMsgType === 'success' ? '#16a34a' : '#dc2626',
          border: `1px solid ${barMsgType === 'success' ? '#bbf7d0' : '#fecaca'}`,
        }}>{barMsg}</div>
      )}

      {/* 用户列表 */}
      <div style={{ background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af' }}>加载中...</div>
        ) : users.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af' }}>未找到匹配用户</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#6b7280' }}>序号</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#6b7280' }}>用户编号</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#6b7280' }}>用户名</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#6b7280' }}>姓名</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#6b7280' }}>手机号码</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#6b7280' }}>部门</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#6b7280' }}>注册日期</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#6b7280' }}>当前状态</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#6b7280' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} onClick={() => handleRowClick(u)}
                  style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f0f4ff'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '10px 16px', color: '#9ca3af' }}>{u.index}</td>
                  <td style={{ padding: '10px 16px', color: '#374151' }}>{u.user_id || '-'}</td>
                  <td style={{ padding: '10px 16px', color: '#374151' }}>{u.username}</td>
                  <td style={{ padding: '10px 16px', color: '#374151' }}>{u.real_name}</td>
                  <td style={{ padding: '10px 16px', color: '#374151' }}>{u.phone || '-'}</td>
                  <td style={{ padding: '10px 16px', color: '#374151' }}>{u.department || '-'}</td>
                  <td style={{ padding: '10px 16px', color: '#374151' }}>{u.register_date || '-'}</td>
                  <td style={{ padding: '10px 16px' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: '4px', fontSize: '12px',
                      background: u.status === 'frozen' ? '#fef2f2'
                        : (u.status_text === '待邮箱验证' ? '#fffbeb' : '#f0fdf4'),
                      color: u.status === 'frozen' ? '#dc2626'
                        : (u.status_text === '待邮箱验证' ? '#d97706' : '#16a34a'),
                    }}>{u.status_text}</span>
                  </td>
                  <td style={{ padding: '10px 16px' }} onClick={e => e.stopPropagation()}>
                    {u.status_text === '待邮箱验证' && u.email ? (
                      <button className="btn-primary" style={{ padding: '4px 12px', fontSize: '12px' }}
                        onClick={() => handleResendVerify(u)}
                        disabled={resendingId === u.id}>
                        {resendingId === u.id ? '发送中...' : '重发注册链接'}
                      </button>
                    ) : (
                      <span style={{ color: '#d1d5db' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 用户详情弹窗 */}
      {selectedUser && (
        <div className="modal-overlay" onClick={() => setSelectedUser(null)}>
          <div className="modal-box" style={{ width: '560px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '18px', color: '#1e3a5f' }}>用户详情</h3>
              <span style={{ cursor: 'pointer', fontSize: '22px', color: '#9ca3af' }} onClick={() => setSelectedUser(null)}>&times;</span>
            </div>

            {msg && <div style={{ padding: '8px 12px', background: '#eff6ff', borderRadius: '4px', marginBottom: '16px', color: '#2563eb', fontSize: '13px' }}>{msg}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* 用户名 */}
              <DetailRow label="用户名" value={selectedUser.username}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className={selectedUser.status === 'frozen' ? 'btn-success' : 'btn-danger'}
                    onClick={handleFreezeToggle}>{selectedUser.status === 'frozen' ? '解冻' : '冻结'}</button>
                  <button className="btn-danger" style={{ padding: '2px 10px', fontSize: '12px' }}
                    onClick={() => setShowDeleteConfirm(true)}>删除</button>
                </div>
              </DetailRow>

              {/* 密码 */}
              <DetailRow label="密码" value="******（已加密）">
                {editField === 'password' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '200px' }}>
                    <input className="input-field" type="password" placeholder="新密码" style={{ fontSize: '12px', padding: '4px 8px' }}
                      value={editValues.password || ''}
                      onChange={e => setEditValues({ ...editValues, password: e.target.value })} />
                    <input className="input-field" type="password" placeholder="确认新密码" style={{ fontSize: '12px', padding: '4px 8px' }}
                      value={editValues.password_confirm || ''}
                      onChange={e => setEditValues({ ...editValues, password_confirm: e.target.value })} />
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button className="btn-primary" style={{ padding: '2px 10px', fontSize: '12px' }} onClick={() => handleEditSubmit('password')}>确认</button>
                      <button className="btn-secondary" style={{ padding: '2px 10px', fontSize: '12px' }} onClick={() => setEditField(null)}>取消</button>
                    </div>
                  </div>
                ) : (
                  <button className="btn-secondary" style={{ padding: '2px 10px', fontSize: '12px' }}
                    onClick={() => { setEditField('password'); setEditValues({}); }}>修改密码</button>
                )}
              </DetailRow>

              {/* 邮箱 */}
              <DetailRow label="关联邮箱" value={selectedUser.email}>
                {editField === 'email' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '200px' }}>
                    <input className="input-field" type="email" placeholder="新邮箱" style={{ fontSize: '12px', padding: '4px 8px' }}
                      value={editValues.email || ''}
                      onChange={e => setEditValues({ ...editValues, email: e.target.value })} />
                    <input className="input-field" type="email" placeholder="确认新邮箱" style={{ fontSize: '12px', padding: '4px 8px' }}
                      value={editValues.email_confirm || ''}
                      onChange={e => setEditValues({ ...editValues, email_confirm: e.target.value })} />
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button className="btn-primary" style={{ padding: '2px 10px', fontSize: '12px' }} onClick={() => handleEditSubmit('email')}>确认</button>
                      <button className="btn-secondary" style={{ padding: '2px 10px', fontSize: '12px' }} onClick={() => setEditField(null)}>取消</button>
                    </div>
                  </div>
                ) : (
                  <button className="btn-secondary" style={{ padding: '2px 10px', fontSize: '12px' }}
                    onClick={() => { setEditField('email'); setEditValues({}); }}>修改邮箱</button>
                )}
              </DetailRow>

              {/* 姓名 */}
              <DetailRow label="姓名" value={selectedUser.real_name}>
                {editField === 'real_name' ? (
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <input className="input-field" style={{ width: '120px', fontSize: '12px', padding: '4px 8px' }}
                      value={editValues.real_name || ''}
                      onChange={e => setEditValues({ ...editValues, real_name: e.target.value })} />
                    <button className="btn-primary" style={{ padding: '2px 10px', fontSize: '12px' }} onClick={() => handleEditSubmit('real_name')}>确认</button>
                    <button className="btn-secondary" style={{ padding: '2px 10px', fontSize: '12px' }} onClick={() => setEditField(null)}>取消</button>
                  </div>
                ) : (
                  <button className="btn-secondary" style={{ padding: '2px 10px', fontSize: '12px' }}
                    onClick={() => { setEditField('real_name'); setEditValues({ real_name: selectedUser.real_name }); }}>修改</button>
                )}
              </DetailRow>

              {/* 部门 */}
              <DetailRow label="部门" value={selectedUser.department}>
                {editField === 'department' ? (
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <input className="input-field" style={{ width: '160px', fontSize: '12px', padding: '4px 8px' }}
                      value={editValues.department || ''}
                      onChange={e => setEditValues({ ...editValues, department: e.target.value })} />
                    <button className="btn-primary" style={{ padding: '2px 10px', fontSize: '12px' }} onClick={() => handleEditSubmit('department')}>确认</button>
                    <button className="btn-secondary" style={{ padding: '2px 10px', fontSize: '12px' }} onClick={() => setEditField(null)}>取消</button>
                  </div>
                ) : (
                  <button className="btn-secondary" style={{ padding: '2px 10px', fontSize: '12px' }}
                    onClick={() => { setEditField('department'); setEditValues({ department: selectedUser.department }); }}>修改</button>
                )}
              </DetailRow>

              {/* 劳动关系 */}
              <DetailRow label="劳动关系" value={selectedUser.labor_relation}>
                {editField === 'labor_relation' ? (
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <select className="input-field" style={{ fontSize: '12px', padding: '4px 8px' }}
                      value={editValues.labor_relation || ''}
                      onChange={e => setEditValues({ ...editValues, labor_relation: e.target.value })}>
                      <option value="国脉员工">国脉员工</option>
                      <option value="非国脉员工">非国脉员工</option>
                    </select>
                    <button className="btn-primary" style={{ padding: '2px 10px', fontSize: '12px' }} onClick={() => handleEditSubmit('labor_relation')}>确认</button>
                    <button className="btn-secondary" style={{ padding: '2px 10px', fontSize: '12px' }} onClick={() => setEditField(null)}>取消</button>
                  </div>
                ) : (
                  <button className="btn-secondary" style={{ padding: '2px 10px', fontSize: '12px' }}
                    onClick={() => { setEditField('labor_relation'); setEditValues({ labor_relation: selectedUser.labor_relation }); }}>修改</button>
                )}
              </DetailRow>

              {/* 手机号 */}
              <DetailRow label="手机号码" value={selectedUser.phone}>
                {editField === 'phone' ? (
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <input className="input-field" style={{ width: '140px', fontSize: '12px', padding: '4px 8px' }}
                      value={editValues.phone || ''}
                      onChange={e => setEditValues({ ...editValues, phone: e.target.value })} />
                    <button className="btn-primary" style={{ padding: '2px 10px', fontSize: '12px' }} onClick={() => handleEditSubmit('phone')}>确认</button>
                    <button className="btn-secondary" style={{ padding: '2px 10px', fontSize: '12px' }} onClick={() => setEditField(null)}>取消</button>
                  </div>
                ) : (
                  <button className="btn-secondary" style={{ padding: '2px 10px', fontSize: '12px' }}
                    onClick={() => { setEditField('phone'); setEditValues({ phone: selectedUser.phone }); }}>修改</button>
                )}
              </DetailRow>

              {/* 注册日期 */}
              <DetailRow label="注册日期" value={selectedUser.register_date} />

              {/* 当前状态（待邮箱验证时提供重发按钮） */}
              <DetailRow label="当前状态" value={
                <span style={{
                  padding: '2px 8px', borderRadius: '4px', fontSize: '12px',
                  background: selectedUser.status === 'frozen' ? '#fef2f2'
                    : (selectedUser.status_text === '待邮箱验证' ? '#fffbeb' : '#f0fdf4'),
                  color: selectedUser.status === 'frozen' ? '#dc2626'
                    : (selectedUser.status_text === '待邮箱验证' ? '#d97706' : '#16a34a'),
                }}>{selectedUser.status_text}</span>
              }>
                {selectedUser.status_text === '待邮箱验证' && selectedUser.email && (
                  <button className="btn-primary" style={{ padding: '2px 10px', fontSize: '12px' }}
                    onClick={() => handleResendVerify(selectedUser)}
                    disabled={resendingId === selectedUser.id}>
                    {resendingId === selectedUser.id ? '发送中...' : '重发注册链接'}
                  </button>
                )}
              </DetailRow>

            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {showDeleteConfirm && selectedUser && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal-box" style={{ width: '380px' }} onClick={e => e.stopPropagation()}>
            <div style={{ textAlign: 'center', paddingTop: '8px' }}>
              <div style={{ fontSize: '40px', color: '#dc2626', marginBottom: '12px' }}>&#9888;</div>
              <p style={{ fontSize: '16px', color: '#374151', marginBottom: '24px' }}>
                确定要删除账号「{selectedUser.username}」吗？<br/>删除后不可恢复！
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
                <button className="btn-danger" style={{ padding: '8px 24px', fontSize: '14px' }}
                  onClick={handleDeleteUser}>确认删除</button>
                <button className="btn-secondary" style={{ padding: '8px 24px', fontSize: '14px' }}
                  onClick={() => setShowDeleteConfirm(false)}>取消</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ width: '100px', color: '#6b7280', fontSize: '13px', flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, color: '#374151', fontSize: '14px' }}>{value || '-'}</div>
      {children && <div style={{ marginLeft: '12px' }}>{children}</div>}
    </div>
  );
}
