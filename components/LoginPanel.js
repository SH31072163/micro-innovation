import { useState } from 'react';

export default function LoginPanel({ type, onClose, onLoginSuccess, onSwitchRegister, onSwitchLogin, onSwitchForgot }) {
  const [loading, setLoading] = useState(false);

  // 登录状态
  const [loginData, setLoginData] = useState({ username: '', password: '', mathAnswer: '' });
  const [mathQuestion, setMathQuestion] = useState(() => generateMath());
  const [loginError, setLoginError] = useState('');

  // 注册状态
  const [regData, setRegData] = useState({
    username: '', password: '', confirmPassword: '', email: '',
    phone: '', real_name: '', department: '', labor_relation: '',
  });
  const [regError, setRegError] = useState('');
  const [regSuccess, setRegSuccess] = useState('');

  // 忘记密码状态
  const [forgotStep, setForgotStep] = useState(1); // 1=输入用户名, 2=确认发送
  const [forgotUsername, setForgotUsername] = useState('');
  const [forgotMaskedEmail, setForgotMaskedEmail] = useState('');
  const [forgotError, setForgotError] = useState('');
  const [forgotMsg, setForgotMsg] = useState('');

  // 联系管理员
  const [contactData, setContactData] = useState({ subject: '', content: '' });
  const [contactMsg, setContactMsg] = useState('');

  function generateMath() {
    const a = Math.floor(Math.random() * 9) + 1;
    const b = Math.floor(Math.random() * 9) + 1;
    return { a, b, answer: a + b, display: `${a} + ${b} = ?` };
  }

  const handleLogin = async () => {
    setLoading(true);
    setLoginError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginData.username,
          password: loginData.password,
          mathAnswer: loginData.mathAnswer,
          mathExpected: mathQuestion.answer,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        onLoginSuccess(data.token, data.user);
      } else {
        setLoginError(data.error || '登录失败');
        setMathQuestion(generateMath());
        setLoginData({ ...loginData, mathAnswer: '' });
      }
    } catch (err) {
      setLoginError('网络错误，请重试');
    }
    setLoading(false);
  };

  const handleRegister = async () => {
    setLoading(true);
    setRegError('');
    setRegSuccess('');
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(regData),
      });
      const data = await res.json();
      if (res.ok) {
        setRegSuccess(data.message);
      } else {
        setRegError(data.error || '注册失败');
      }
    } catch (err) {
      setRegError('网络错误，请重试');
    }
    setLoading(false);
  };

  const handleForgotCheck = async () => {
    setLoading(true);
    setForgotError('');
    try {
      const res = await fetch(`/api/auth/forgot-password?username=${encodeURIComponent(forgotUsername)}`);
      const data = await res.json();
      if (res.ok) {
        setForgotMaskedEmail(data.maskedEmail);
        setForgotStep(2);
      } else {
        setForgotError(data.error || '查询失败');
      }
    } catch (err) {
      setForgotError('网络错误，请重试');
    }
    setLoading(false);
  };

  const handleForgotSend = async () => {
    setLoading(true);
    setForgotError('');
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: forgotUsername }),
      });
      const data = await res.json();
      if (res.ok) {
        setForgotMsg(data.message);
      } else {
        setForgotError(data.error || '操作失败');
      }
    } catch (err) {
      setForgotError('网络错误，请重试');
    }
    setLoading(false);
  };

  const handleContact = async () => {
    setLoading(true);
    try {
      const token = sessionStorage.getItem('token');
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify(contactData),
      });
      const data = await res.json();
      if (res.ok) {
        setContactMsg(data.message);
      } else {
        setContactMsg(data.error || '发送失败');
      }
    } catch (err) {
      setContactMsg('网络错误');
    }
    setLoading(false);
  };

  const titles = {
    login: '登录',
    register: '注册',
    forgot: '忘记密码',
    contact: '联系管理员',
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box fade-in" onClick={e => e.stopPropagation()} style={{ width: type === 'register' ? '520px' : type === 'contact' ? '520px' : '420px' }}>
        {/* 标题栏 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '20px', color: '#1e3a5f' }}>{titles[type]}</h2>
          <span style={{ cursor: 'pointer', fontSize: '22px', color: '#9ca3af' }} onClick={onClose}>&times;</span>
        </div>

        {/* 登录表单 */}
        {type === 'login' && (
          <div>
            <div className="form-group">
              <label className="form-label">用户名</label>
              <input className="input-field" type="text" placeholder="请输入用户名"
                value={loginData.username}
                onChange={e => setLoginData({ ...loginData, username: e.target.value })}
                onKeyDown={e => e.key === 'Enter' && handleLogin()} />
            </div>
            <div className="form-group">
              <label className="form-label">密码</label>
              <input className="input-field" type="password" placeholder="请输入密码"
                value={loginData.password}
                onChange={e => setLoginData({ ...loginData, password: e.target.value })}
                onKeyDown={e => e.key === 'Enter' && handleLogin()} />
            </div>
            <div className="form-group">
              <label className="form-label">验证码</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '16px', fontWeight: 'bold', color: '#2563eb', background: '#eff6ff', padding: '6px 12px', borderRadius: '4px', border: '1px solid #bfdbfe' }}>
                  {mathQuestion.display}
                </span>
                <input className="input-field" type="text" placeholder="计算结果"
                  style={{ width: '120px' }}
                  value={loginData.mathAnswer}
                  onChange={e => setLoginData({ ...loginData, mathAnswer: e.target.value })}
                  onKeyDown={e => e.key === 'Enter' && handleLogin()} />
                <a style={{ fontSize: '12px', color: '#2563eb', cursor: 'pointer' }}
                  onClick={() => setMathQuestion(generateMath())}>换一题</a>
              </div>
            </div>
            {loginError && <div className="error-text" style={{ marginBottom: '12px' }}>{loginError}</div>}
            <button className="btn-primary" style={{ width: '100%', padding: '10px' }}
              onClick={handleLogin} disabled={loading}>
              {loading ? '登录中...' : '登 录'}
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', fontSize: '13px' }}>
              <a style={{ color: '#2563eb', cursor: 'pointer' }} onClick={onSwitchRegister}>注册</a>
              <a style={{ color: '#2563eb', cursor: 'pointer' }} onClick={onSwitchForgot}>忘记密码</a>
            </div>
          </div>
        )}

        {/* 注册表单 */}
        {type === 'register' && (
          <div>
            {regSuccess ? (
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <div style={{ fontSize: '40px', marginBottom: '12px' }}>&#10003;</div>
                <div style={{ color: '#16a34a', fontSize: '16px', marginBottom: '8px' }}>提交注册申请成功！</div>
                <div style={{ color: '#6b7280', fontSize: '13px', lineHeight: '1.8' }}>{regSuccess}</div>
                <button className="btn-primary" style={{ marginTop: '20px' }}
                  onClick={onSwitchLogin}>前往登录</button>
              </div>
            ) : (
              <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                <div className="form-group">
                  <label className="form-label">用户名 <span style={{ color: '#9ca3af', fontWeight: 'normal' }}>(6-20位，数字/下划线/英文)</span></label>
                  <input className="input-field" type="text"
                    value={regData.username}
                    onChange={e => setRegData({ ...regData, username: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">密码 <span style={{ color: '#9ca3af', fontWeight: 'normal' }}>(6-12位，含数字+大小写字母)</span></label>
                  <input className="input-field" type="password"
                    value={regData.password}
                    onChange={e => setRegData({ ...regData, password: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">确认密码</label>
                  <input className="input-field" type="password"
                    value={regData.confirmPassword}
                    onChange={e => setRegData({ ...regData, confirmPassword: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">关联邮箱</label>
                  <input className="input-field" type="email"
                    value={regData.email}
                    onChange={e => setRegData({ ...regData, email: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">手机号码</label>
                  <input className="input-field" type="tel"
                    value={regData.phone}
                    onChange={e => setRegData({ ...regData, phone: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">姓名 <span style={{ color: '#9ca3af', fontWeight: 'normal' }}>(2-4个汉字)</span></label>
                  <input className="input-field" type="text"
                    value={regData.real_name}
                    onChange={e => setRegData({ ...regData, real_name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">部门</label>
                  <input className="input-field" type="text"
                    value={regData.department}
                    onChange={e => setRegData({ ...regData, department: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">劳动关系</label>
                  <select className="input-field"
                    value={regData.labor_relation}
                    onChange={e => setRegData({ ...regData, labor_relation: e.target.value })}>
                    <option value="">请选择</option>
                    <option value="国脉员工">国脉员工</option>
                    <option value="非国脉员工">非国脉员工</option>
                  </select>
                </div>
                {regError && <div className="error-text" style={{ marginBottom: '12px' }}>{regError}</div>}
                <button className="btn-primary" style={{ width: '100%', padding: '10px' }}
                  onClick={handleRegister} disabled={loading}>
                  {loading ? '提交中...' : '注 册'}
                </button>
                <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '13px' }}>
                  已有账号？<a style={{ color: '#2563eb', cursor: 'pointer' }} onClick={onSwitchLogin}>去登录</a>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 忘记密码表单 */}
        {type === 'forgot' && (
          <div>
            {forgotMsg ? (
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <div style={{ fontSize: '40px', marginBottom: '12px' }}>&#9993;</div>
                <div style={{ color: '#16a34a', fontSize: '16px', marginBottom: '8px' }}>{forgotMsg}</div>
                <button className="btn-primary" style={{ marginTop: '20px' }}
                  onClick={onSwitchLogin}>前往登录</button>
              </div>
            ) : forgotStep === 1 ? (
              <div>
                <p style={{ color: '#6b7280', marginBottom: '16px', fontSize: '13px' }}>
                  请输入您的用户名，系统将显示您注册时关联的邮箱。
                </p>
                <div className="form-group">
                  <label className="form-label">用户名</label>
                  <input className="input-field" type="text" placeholder="请输入用户名"
                    value={forgotUsername}
                    onChange={e => setForgotUsername(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleForgotCheck()} />
                </div>
                {forgotError && <div className="error-text" style={{ marginBottom: '12px' }}>{forgotError}</div>}
                <button className="btn-primary" style={{ width: '100%', padding: '10px' }}
                  onClick={handleForgotCheck} disabled={loading}>
                  {loading ? '查询中...' : '确 认'}
                </button>
              </div>
            ) : (
              <div>
                <p style={{ color: '#374151', marginBottom: '16px', fontSize: '13px' }}>
                  您注册时关联的邮箱为：<strong style={{ color: '#2563eb' }}>{forgotMaskedEmail}</strong>
                </p>
                <p style={{ color: '#6b7280', marginBottom: '16px', fontSize: '13px' }}>
                  系统将向该邮箱发送一封包含重置后密码的邮件，请查收后使用新密码登录。
                </p>
                {forgotError && <div className="error-text" style={{ marginBottom: '12px' }}>{forgotError}</div>}
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button className="btn-secondary" style={{ flex: 1, padding: '10px' }}
                    onClick={() => { setForgotStep(1); setForgotError(''); }}>返回</button>
                  <button className="btn-primary" style={{ flex: 1, padding: '10px' }}
                    onClick={handleForgotSend} disabled={loading}>
                    {loading ? '发送中...' : '确认发送'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 联系管理员表单 */}
        {type === 'contact' && (
          <div>
            {contactMsg ? (
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <div style={{ fontSize: '40px', marginBottom: '12px' }}>&#10003;</div>
                <div style={{ color: '#16a34a', fontSize: '16px' }}>{contactMsg}</div>
                <button className="btn-primary" style={{ marginTop: '20px' }}
                  onClick={onClose}>关闭</button>
              </div>
            ) : (
              <div>
                <div className="form-group">
                  <label className="form-label">主题</label>
                  <input className="input-field" type="text" placeholder="请输入主题"
                    value={contactData.subject}
                    onChange={e => setContactData({ ...contactData, subject: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">内容</label>
                  <textarea className="input-field" rows={5} placeholder="请输入您要反馈的内容"
                    style={{ resize: 'vertical' }}
                    value={contactData.content}
                    onChange={e => setContactData({ ...contactData, content: e.target.value })} />
                </div>
                <button className="btn-primary" style={{ width: '100%', padding: '10px' }}
                  onClick={handleContact} disabled={loading}>
                  {loading ? '发送中...' : '发送邮件'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
