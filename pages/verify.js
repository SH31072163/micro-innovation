import Head from 'next/head';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

export default function VerifyPage() {
  const router = useRouter();
  const { token } = router.query;
  const [status, setStatus] = useState('loading'); // loading | ready | success | error
  const [message, setMessage] = useState('');
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;
    if (!token) {
      setStatus('error');
      setMessage('缺少验证参数，请通过邮件中的链接访问此页面。');
      return;
    }
    // GET 请求检查 token 有效性（不执行验证）
    fetch(`/api/auth/verify?token=${encodeURIComponent(token)}`)
      .then(res => res.json())
      .then(data => {
        if (data.valid) {
          setStatus('ready');
        } else {
          setStatus('error');
          setMessage(data.error || '验证链接无效');
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('网络错误，请稍后重试。');
      });
  }, [router.isReady, token]);

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus('success');
        setMessage(data.message || '邮箱验证成功！');
      } else {
        setStatus('error');
        setMessage(data.error || '验证失败');
      }
    } catch (err) {
      setStatus('error');
      setMessage('网络错误，请稍后重试。');
    }
    setVerifying(false);
  };

  const cardStyle = {
    maxWidth: '480px',
    margin: '80px auto',
    padding: '40px',
    textAlign: 'center',
    background: '#fff',
    borderRadius: '12px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
  };

  const btnStyle = {
    padding: '12px 40px',
    fontSize: '16px',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 'bold',
  };

  return (
    <>
      <Head>
        <title>邮箱验证 - 微创新实验田</title>
      </Head>
      <div style={{ minHeight: '100vh', background: '#f0f4f8' }}>
        {status === 'loading' && (
          <div style={cardStyle}>
            <p style={{ color: '#6b7280', fontSize: '16px' }}>正在检查验证链接...</p>
          </div>
        )}

        {status === 'ready' && (
          <div style={cardStyle}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#9993;</div>
            <h2 style={{ fontSize: '22px', color: '#1e3a5f', marginBottom: '12px' }}>
              邮箱验证确认
            </h2>
            <p style={{ color: '#6b7280', fontSize: '15px', marginBottom: '28px', lineHeight: '1.6' }}>
              请点击下方按钮完成邮箱验证。<br/>
              验证成功后即可使用该账号登录系统。
            </p>
            <button
              style={{ ...btnStyle, background: '#2563eb', color: '#fff' }}
              onClick={handleVerify}
              disabled={verifying}
            >
              {verifying ? '验证中...' : '确认验证'}
            </button>
          </div>
        )}

        {status === 'success' && (
          <div style={cardStyle}>
            <div style={{ fontSize: '48px', marginBottom: '16px', color: '#16a34a' }}>&#10004;</div>
            <h2 style={{ fontSize: '22px', color: '#16a34a', marginBottom: '12px' }}>
              验证成功！
            </h2>
            <p style={{ color: '#6b7280', fontSize: '15px', marginBottom: '28px' }}>
              {message}
            </p>
            <a href="/" style={{ ...btnStyle, background: '#2563eb', color: '#fff', textDecoration: 'none', display: 'inline-block' }}>
              前往登录
            </a>
          </div>
        )}

        {status === 'error' && (
          <div style={cardStyle}>
            <div style={{ fontSize: '48px', marginBottom: '16px', color: '#dc2626' }}>&#9888;</div>
            <h2 style={{ fontSize: '22px', color: '#dc2626', marginBottom: '12px' }}>
              验证失败
            </h2>
            <p style={{ color: '#6b7280', fontSize: '15px', marginBottom: '28px' }}>
              {message}
            </p>
            <a href="/" style={{ ...btnStyle, background: '#6b7280', color: '#fff', textDecoration: 'none', display: 'inline-block' }}>
              返回首页
            </a>
          </div>
        )}
      </div>
    </>
  );
}
