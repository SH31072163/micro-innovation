import { useState, useEffect, useRef, useCallback } from 'react';

export default function ChatMain({ token, user }) {
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(0);
  const [messagesMap, setMessagesMap] = useState({}); // { sessionId: [{role, content, type}] }
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const msgEndRef = useRef(null);

  // 30秒检测相关
  const checkIntervalRef = useRef(null);
  const lastSubmitTimeRef = useRef(null);

  // 视频轮询跟踪
  const videoPollingRef = useRef(new Set());

  useEffect(() => {
    // 初始化一个会话
    handleNewSession();
    return () => {
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messagesMap, currentSessionId]);

  const currentMessages = messagesMap[currentSessionId] || [];

  // ── 30秒自动检测（仅内部使用，不展示） ──
  const startAutoCheck = useCallback(() => {
    lastSubmitTimeRef.current = Date.now();
    if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);

    checkIntervalRef.current = setInterval(async () => {
      // 5分钟内无新提交，自动停止
      if (Date.now() - lastSubmitTimeRef.current > 5 * 60 * 1000) {
        if (checkIntervalRef.current) {
          clearInterval(checkIntervalRef.current);
          checkIntervalRef.current = null;
        }
        return;
      }

      // 静默检测所有 API 状态
      try {
        await fetch('/api/admin/ai-apis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ action: 'check_all' }),
        });
      } catch (err) {
        // 静默失败，不影响用户
      }
    }, 30000);
  }, [token]);

  // ── 视频轮询：检测 video_pending 消息并启动轮询 ──
  const startVideoPoll = useCallback((sessionId, msgIndex, videoId, videoModel) => {
    let attempts = 0;
    const maxAttempts = 60; // 最多轮询 60 次（约 8 分钟，每 8 秒一次）
    let currentDelay = 8000; // 默认 8 秒轮询间隔

    const poll = async () => {
      attempts++;
      if (attempts > maxAttempts) {
        setMessagesMap(prev => {
          const msgs = [...(prev[sessionId] || [])];
          if (msgs[msgIndex] && msgs[msgIndex].type === 'video_pending') {
            msgs[msgIndex] = { ...msgs[msgIndex], type: 'text', content: '视频生成超时（约8分钟），请稍后在管理区查看视频任务状态。' };
          }
          return { ...prev, [sessionId]: msgs };
        });
        return;
      }

      try {
        const res = await fetch('/api/chat/video-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ videoId, videoModel }),
        });
        const data = await res.json();

        if (data.status === 'completed' && data.videoUrl) {
          setMessagesMap(prev => {
            const msgs = [...(prev[sessionId] || [])];
            if (msgs[msgIndex] && msgs[msgIndex].type === 'video_pending') {
              msgs[msgIndex] = { ...msgs[msgIndex], type: 'video', content: data.videoUrl };
            }
            return { ...prev, [sessionId]: msgs };
          });
          return;
        }

        if (data.status === 'error') {
          setMessagesMap(prev => {
            const msgs = [...(prev[sessionId] || [])];
            if (msgs[msgIndex] && msgs[msgIndex].type === 'video_pending') {
              msgs[msgIndex] = { ...msgs[msgIndex], type: 'text', content: '视频生成失败：' + (data.error || '未知错误') };
            }
            return { ...prev, [sessionId]: msgs };
          });
          return;
        }

        // 仍在处理中，更新进度（如有）
        if (data.progress !== null && data.progress !== undefined) {
          setMessagesMap(prev => {
            const msgs = [...(prev[sessionId] || [])];
            if (msgs[msgIndex] && msgs[msgIndex].type === 'video_pending') {
              msgs[msgIndex] = { ...msgs[msgIndex], progress: data.progress };
            }
            return { ...prev, [sessionId]: msgs };
          });
        }

        // 继续轮询
        currentDelay = 8000;
        setTimeout(poll, currentDelay);
      } catch (err) {
        // 网络错误，延迟后重试
        currentDelay = Math.min(currentDelay * 1.5, 15000);
        setTimeout(poll, currentDelay);
      }
    };

    setTimeout(poll, 8000);
  }, [token]);

  // 监听消息变化，启动视频轮询
  useEffect(() => {
    const currentMsgs = messagesMap[currentSessionId] || [];
    currentMsgs.forEach((msg, index) => {
      if (msg.type === 'video_pending' && msg.videoId) {
        const key = `${currentSessionId}-${index}-${msg.videoId}`;
        if (!videoPollingRef.current.has(key)) {
          videoPollingRef.current.add(key);
          startVideoPoll(currentSessionId, index, msg.videoId, msg.videoModel);
        }
      }
    });
  }, [messagesMap, currentSessionId, startVideoPoll]);

  const handleNewSession = () => {
    const newId = Date.now();
    setSessions(prev => [{ id: newId, title: '新对话' }, ...prev]);
    setMessagesMap(prev => ({ ...prev, [newId]: [] }));
    setCurrentSessionId(newId);
  };

  const handleDeleteSession = (sessionId) => {
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    setMessagesMap(prev => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    if (currentSessionId === sessionId) {
      const remaining = sessions.filter(s => s.id !== sessionId);
      if (remaining.length > 0) {
        setCurrentSessionId(remaining[0].id);
      } else {
        handleNewSession();
      }
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const message = input.trim();
    const sessionId = currentSessionId;
    setInput('');
    setLoading(true);

    // 添加用户消息到界面
    setMessagesMap(prev => ({
      ...prev,
      [sessionId]: [...(prev[sessionId] || []), { role: 'user', content: message, type: 'text' }],
    }));

    // 更新会话标题
    setSessions(prev => prev.map(s => {
      if (s.id === sessionId && s.title === '新对话') {
        return { ...s, title: message.substring(0, 20) + (message.length > 20 ? '...' : '') };
      }
      return s;
    }));

    // 准备历史消息（仅包含文字消息，过滤掉图片/视频）
    const history = [...(messagesMap[sessionId] || []), { role: 'user', content: message, type: 'text' }]
      .filter(m => !m.type || m.type === 'text');

    try {
      // 前端超时 20 秒，避免用户长时间等待 "AI 正在处理..."
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ message, history }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();

      // 构建 AI 回复消息
      let aiMsg;
      if (res.ok) {
        const msgType = data.type || 'text';
        aiMsg = { role: 'assistant', content: data.reply, type: msgType };
        if (msgType === 'video_pending') {
          aiMsg.videoId = data.videoId;
          aiMsg.videoModel = data.videoModel;
        }
      } else {
        aiMsg = { role: 'assistant', content: `错误：${data.error || '请求失败'}`, type: 'text' };
      }

      // 添加 AI 回复到界面
      setMessagesMap(prev => ({
        ...prev,
        [sessionId]: [...(prev[sessionId] || []), aiMsg],
      }));

      // 启动/刷新 30秒检测
      startAutoCheck();
    } catch (err) {
      const errMsg = err.name === 'AbortError'
        ? 'AI 响应超时，请稍后重试'
        : '网络错误，请重试';
      setMessagesMap(prev => ({
        ...prev,
        [sessionId]: [...(prev[sessionId] || []), { role: 'assistant', content: errMsg, type: 'text' }],
      }));
    }

    setLoading(false);
  };

  // ── 消息渲染 ──
  function renderMessageContent(msg) {
    const isUser = msg.role === 'user';
    const msgType = msg.type || 'text';

    // 用户消息始终为文字
    if (isUser) return msg.content;

    // AI 图片消息
    if (msgType === 'image') {
      return (
        <div>
          <img src={msg.content} alt="AI 生成图片"
            style={{ maxWidth: '100%', borderRadius: '6px', display: 'block' }}
            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }}
          />
          <div style={{ display: 'none', color: '#dc2626', fontSize: '13px' }}>图片加载失败</div>
          <div style={{ marginTop: '6px', fontSize: '12px', color: '#9ca3af' }}>AI 生成图片</div>
        </div>
      );
    }

    // AI 视频消息（已完成）
    if (msgType === 'video') {
      return (
        <div>
          <video src={msg.content} controls
            style={{ maxWidth: '100%', borderRadius: '6px', display: 'block' }}
          />
          <div style={{ marginTop: '6px', fontSize: '12px', color: '#9ca3af' }}>AI 生成视频</div>
        </div>
      );
    }

    // AI 视频生成中
    if (msgType === 'video_pending') {
      const progressText = msg.progress ? `（${msg.progress}%）` : '...';
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>&#8987;</span>
          <span>视频生成中{progressText}，请耐心等待</span>
        </div>
      );
    }

    // 纯文字消息
    return msg.content;
  }

  return (
    <div style={{ height: '100%', display: 'flex', padding: '16px', gap: '12px' }}>
      {/* 会话列表（纯内存，刷新后清空） */}
      <div style={{ width: '240px', background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px', borderBottom: '1px solid #f3f4f6' }}>
          <button className="btn-primary" style={{ width: '100%', padding: '8px' }} onClick={handleNewSession}>+ 新对话</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {sessions.length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>暂无对话</div>
          ) : (
            sessions.map(s => (
              <div key={s.id}
                onClick={() => setCurrentSessionId(s.id)}
                style={{
                  padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: currentSessionId === s.id ? '#eff6ff' : 'transparent',
                  borderBottom: '1px solid #f9fafb',
                }}>
                <span style={{ fontSize: '13px', color: '#4b5563', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                <span onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id); }}
                  style={{ color: '#dc2626', fontSize: '14px', marginLeft: '8px', flexShrink: 0 }}>x</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 对话区 */}
      <div style={{ flex: 1, background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {currentMessages.length === 0 ? (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '14px', flexDirection: 'column' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>&#128172;</div>
              <div>开始一段新的对话</div>
              <div style={{ marginTop: '4px', fontSize: '12px' }}>输入您的问题，AI 将为您解答</div>
              <div style={{ marginTop: '12px', fontSize: '12px', color: '#d1d5db', maxWidth: '320px', textAlign: 'center' }}>
                支持文字对话、图片生成和视频生成<br />
                试试输入"画一张小猫的图片"或"生成一段日落的视频"
              </div>
            </div>
          ) : (
            currentMessages.map((msg, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: '12px',
              }}>
                <div style={{
                  maxWidth: '70%', padding: '10px 14px', borderRadius: '8px', fontSize: '14px', lineHeight: '1.6',
                  background: msg.role === 'user' ? '#2563eb' : '#f3f4f6',
                  color: msg.role === 'user' ? '#fff' : '#374151',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {renderMessageContent(msg)}
                </div>
              </div>
            ))
          )}
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '12px' }}>
              <div style={{ padding: '10px 14px', borderRadius: '8px', background: '#f3f4f6', color: '#9ca3af', fontSize: '14px' }}>
                AI 正在处理...
              </div>
            </div>
          )}
          <div ref={msgEndRef} />
        </div>
        <div style={{ padding: '12px 16px', borderTop: '1px solid #f3f4f6', display: 'flex', gap: '8px' }}>
          <input className="input-field" style={{ flex: 1 }}
            placeholder="输入您的问题..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            disabled={loading} />
          <button className="btn-primary" style={{ padding: '8px 24px' }}
            onClick={handleSend} disabled={loading || !input.trim()}>
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
