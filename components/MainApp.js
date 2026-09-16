import { useState, useEffect } from 'react';
import PersonalProfile from './views/PersonalProfile';
import AccountStatus from './views/AccountStatus';
import ChangePassword from './views/ChangePassword';
import ChangeEmail from './views/ChangeEmail';
import ChatMain from './views/ChatMain';
import ChatAdmin from './views/ChatAdmin';
import AdminOverview from './views/AdminOverview';
import AdminUsers from './views/AdminUsers';
import MenuManage from './views/MenuManage';
import ScheduleView from './views/schedule/ScheduleView';
import ScheduleAdmin from './views/schedule/ScheduleAdmin';

export default function MainApp({ token, user, forceChangePassword, onPasswordChanged }) {
  const [menus, setMenus] = useState([]);
  const [currentMenu, setCurrentMenu] = useState(null);
  const [expandedMenus, setExpandedMenus] = useState({});

  useEffect(() => {
    fetchMenus();
  }, []);

  useEffect(() => {
    if (menus.length > 0 && !currentMenu) {
      // 默认选中第一个有内容的菜单
      const first = menus[0];
      if (first.children && first.children.length > 0) {
        setExpandedMenus({ [first.id]: true });
        const firstChild = first.children.find(c => c.is_permitted);
        if (firstChild) setCurrentMenu(firstChild);
      } else {
        setCurrentMenu(first);
      }
    }
  }, [menus]);

  const fetchMenus = async () => {
    try {
      const res = await fetch('/api/menu/list', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMenus(data);
      }
    } catch (err) {
      console.error('获取菜单失败:', err);
    }
  };

  const toggleMenu = (menuId) => {
    setExpandedMenus(prev => ({ ...prev, [menuId]: !prev[menuId] }));
  };

  const handleMenuClick = (menu) => {
    if (menu.level === 2) {
      if (menu.children && menu.children.length > 0) {
        toggleMenu(menu.id);
      } else {
        setCurrentMenu(menu);
      }
    } else {
      setCurrentMenu(menu);
    }
  };

  const renderContent = () => {
    if (!currentMenu) {
      return <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>请选择左侧菜单</div>;
    }

    const menuKey = getMenuKey(currentMenu);
    const props = { token, user, onPasswordChanged };

    switch (menuKey) {
      case '个人设置/个人资料':
        return <PersonalProfile {...props} />;
      case '个人设置/账号状态':
        return <AccountStatus {...props} />;
      case '个人设置/修改密码':
        return <ChangePassword {...props} force={forceChangePassword} />;
      case '个人设置/修改关联邮箱':
        return <ChangeEmail {...props} />;
      case '你问我答/主聊天区':
        return <ChatMain {...props} />;
      case '你问我答/管理区':
        return <ChatAdmin {...props} />;
      case '系统管理/用户概览':
        return <AdminOverview {...props} />;
      case '系统管理/手工修改':
        return <AdminUsers {...props} />;
      case '系统管理/菜单管理':
        return <MenuManage {...props} onMenuUpdated={fetchMenus} />;
      case '排班表/中心排班表':
        return <ScheduleView {...props} />;
      case '排班表/管理区':
        return <ScheduleAdmin {...props} />;
      default:
        return <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>「{currentMenu.title}」功能开发中</div>;
    }
  };

  function getMenuKey(menu) {
    if (menu.level === 2) return menu.title;
    const parent = menus.find(m => m.id === menu.parent_id);
    return parent ? `${parent.title}/${menu.title}` : menu.title;
  }

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>
      {/* 二级标题区 - 15% */}
      <div style={{
        width: '15%',
        minWidth: '180px',
        background: '#fff',
        borderRight: '1px solid #e5e7eb',
        overflowY: 'auto',
        padding: '8px 0',
      }}>
        {menus.map(menu => (
          <div key={menu.id}>
            {/* 二级标题 */}
            <div
              onClick={() => handleMenuClick(menu)}
              style={{
                padding: '10px 16px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600',
                color: '#1e3a5f',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: currentMenu && currentMenu.parent_id === menu.id
                  ? '#eff6ff' : 'transparent',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#f0f4ff'}
              onMouseLeave={e => {
                if (!(currentMenu && currentMenu.parent_id === menu.id)) {
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              <span style={{ wordBreak: 'break-all', lineHeight: '1.4' }}>{menu.title}</span>
              {menu.children && menu.children.length > 0 && (
                <span style={{ fontSize: '10px', color: '#9ca3af', marginLeft: '4px', flexShrink: 0 }}>
                  {expandedMenus[menu.id] ? '▼' : '▶'}
                </span>
              )}
            </div>
            {/* 三级标题 */}
            {expandedMenus[menu.id] && menu.children && menu.children.map(child => {
              if (!child.is_permitted) return null;
              return (
                <div
                  key={child.id}
                  onClick={() => handleMenuClick(child)}
                  style={{
                    padding: '8px 16px 8px 32px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    color: '#4b5563',
                    background: currentMenu && currentMenu.id === child.id
                      ? '#dbeafe' : 'transparent',
                    borderLeft: currentMenu && currentMenu.id === child.id
                      ? '3px solid #2563eb' : '3px solid transparent',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f0f4ff'}
                  onMouseLeave={e => {
                    if (!(currentMenu && currentMenu.id === child.id)) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  {child.title}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* 二级展示区 - 85% */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        background: '#f9fafb',
      }}>
        {renderContent()}
      </div>

      {/* 强制修改密码弹窗 */}
      {forceChangePassword && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ width: '420px' }}>
            <h2 style={{ fontSize: '18px', color: '#dc2626', marginBottom: '12px' }}>请修改初始密码</h2>
            <p style={{ color: '#6b7280', fontSize: '13px', marginBottom: '16px' }}>
              您当前使用的是系统重置的密码，为了账号安全，请立即修改密码。
            </p>
            <ChangePasswordInline token={token} onDone={onPasswordChanged} />
          </div>
        </div>
      )}
    </div>
  );
}

function ChangePasswordInline({ token, onDone }) {
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          field: 'password',
          value: newPwd,
          oldValue: oldPwd,
          confirmPassword: confirmPwd,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        onDone();
      } else {
        setError(data.error || '修改失败');
      }
    } catch (err) {
      setError('网络错误');
    }
    setLoading(false);
  };

  return (
    <div>
      <div className="form-group">
        <label className="form-label">当前密码</label>
        <input className="input-field" type="password" value={oldPwd}
          onChange={e => setOldPwd(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">新密码 <span style={{ color: '#9ca3af', fontWeight: 'normal' }}>(6-12位，含数字+大小写字母)</span></label>
        <input className="input-field" type="password" value={newPwd}
          onChange={e => setNewPwd(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">确认新密码</label>
        <input className="input-field" type="password" value={confirmPwd}
          onChange={e => setConfirmPwd(e.target.value)} />
      </div>
      {error && <div className="error-text" style={{ marginBottom: '12px' }}>{error}</div>}
      <button className="btn-primary" style={{ width: '100%', padding: '10px' }}
        onClick={handleSubmit} disabled={loading}>
        {loading ? '提交中...' : '确认修改'}
      </button>
    </div>
  );
}
