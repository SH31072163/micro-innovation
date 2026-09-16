import Head from 'next/head';
import { useState, useEffect } from 'react';
import LoginPanel from '../components/LoginPanel';
import MainApp from '../components/MainApp';

export default function Home() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [showLogin, setShowLogin] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [forceChangePassword, setForceChangePassword] = useState(false);

  useEffect(() => {
    const savedToken = sessionStorage.getItem('token');
    const savedUser = sessionStorage.getItem('user');
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
    }
  }, []);

  const handleLoginSuccess = (token, user) => {
    sessionStorage.setItem('token', token);
    sessionStorage.setItem('user', JSON.stringify(user));
    setToken(token);
    setUser(user);
    setShowLogin(false);
    if (user.force_change_password) {
      setForceChangePassword(true);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    setToken(null);
    setUser(null);
  };

  return (
    <>
      <Head>
        <title>销售服务中心微创新实验田</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', paddingBottom: '40px' }}>
        {/* 一级标题区 */}
        <div style={{
          minHeight: '48px',
          flexShrink: 0,
          background: 'linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          zIndex: 10,
        }}>
          <div style={{ fontSize: '20px', fontWeight: 'bold', letterSpacing: '1px' }}>
            销售服务中心微创新实验田
          </div>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
            {token ? (
              <>
                <span style={{ fontSize: '13px', opacity: 0.9 }}>
                  欢迎，{user?.real_name || user?.username}
                </span>
                <a onClick={handleLogout} style={{ cursor: 'pointer', fontSize: '14px', opacity: 0.9, hover: { opacity: 1 } }}>
                  退出
                </a>
                <a onClick={() => setShowContact(true)} style={{ cursor: 'pointer', fontSize: '14px', opacity: 0.9 }}>
                  联系管理员
                </a>
              </>
            ) : (
              <>
                <a onClick={() => { setShowLogin(false); setShowRegister(true); }} style={{ cursor: 'pointer', fontSize: '14px', opacity: 0.9 }}>注册</a>
                <a onClick={() => { setShowRegister(false); setShowLogin(true); }} style={{ cursor: 'pointer', fontSize: '14px', opacity: 0.9 }}>登录</a>
                <a onClick={() => setShowContact(true)} style={{ cursor: 'pointer', fontSize: '14px', opacity: 0.9 }}>联系管理员</a>
              </>
            )}
          </div>
        </div>

        {/* 一级展示区 */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {token && user ? (
            <MainApp token={token} user={user} forceChangePassword={forceChangePassword} 
              onPasswordChanged={() => setForceChangePassword(false)} />
          ) : (
            <div style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              background: 'linear-gradient(180deg, #f0f4ff 0%, #e0e7ff 100%)',
            }}>
              <div style={{
                textAlign: 'center',
                padding: '40px 60px',
                background: '#fff',
                borderRadius: '12px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
              }}>
                <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#1e3a5f', marginBottom: '12px' }}>
                  销售服务中心微创新实验田
                </div>
                <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '24px' }}>
                  创新驱动力 · 实践出真知
                </div>
                <button className="btn-primary" style={{ fontSize: '16px', padding: '10px 40px' }}
                  onClick={() => setShowLogin(true)}>
                  登 录
                </button>
                <div style={{ marginTop: '12px' }}>
                  <a style={{ color: '#2563eb', cursor: 'pointer', fontSize: '13px' }}
                    onClick={() => setShowRegister(true)}>
                    没有账号？点击注册
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 弹窗 */}
      {showLogin && (
        <LoginPanel
          type="login"
          onClose={() => setShowLogin(false)}
          onLoginSuccess={handleLoginSuccess}
          onSwitchRegister={() => { setShowLogin(false); setShowRegister(true); }}
          onSwitchForgot={() => { setShowLogin(false); setShowForgot(true); }}
        />
      )}
      {showRegister && (
        <LoginPanel
          type="register"
          onClose={() => setShowRegister(false)}
          onLoginSuccess={handleLoginSuccess}
          onSwitchLogin={() => { setShowRegister(false); setShowLogin(true); }}
        />
      )}
      {showForgot && (
        <LoginPanel
          type="forgot"
          onClose={() => setShowForgot(false)}
          onSwitchLogin={() => { setShowForgot(false); setShowLogin(true); }}
        />
      )}
      {showContact && (
        <LoginPanel
          type="contact"
          onClose={() => setShowContact(false)}
        />
      )}
    </>
  );
}
