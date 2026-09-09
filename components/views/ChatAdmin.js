import { useState, useEffect, useRef } from 'react';

const VENDOR_OPTIONS = [
  { value: 'openai', label: 'OpenAI', defaultUrl: 'https://api.openai.com/v1/chat/completions', defaultModel: 'gpt-3.5-turbo' },
  { value: 'anthropic', label: 'Anthropic (Claude)', defaultUrl: '', defaultModel: 'claude-3-5-sonnet-20241022' },
  { value: 'google', label: 'Google (Gemini)', defaultUrl: '', defaultModel: 'gemini-1.5-flash-latest' },
  { value: 'qwen', label: '通义千问（阿里）', defaultUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', defaultModel: 'qwen-turbo' },
  { value: 'deepseek', label: 'DeepSeek', defaultUrl: 'https://api.deepseek.com/v1/chat/completions', defaultModel: 'deepseek-chat' },
  { value: 'zhipu', label: '智谱 GLM', defaultUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', defaultModel: 'glm-4-flash' },
  { value: 'kimi', label: 'Kimi（月之暗面）', defaultUrl: 'https://api.moonshot.cn/v1/chat/completions', defaultModel: 'moonshot-v1-8k' },
  { value: 'qianfan', label: '百度千帆（文心一言）', defaultUrl: 'https://qianfan.baidubce.com/v2/chat/completions', defaultModel: 'ernie-tiny-8k' },
  { value: 'doubao', label: '火山豆包（字节）', defaultUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', defaultModel: 'doubao-pro-4k' },
  { value: 'minimax', label: 'MiniMax', defaultUrl: 'https://api.minimax.chat/v1/text/chatcompletion_v2', defaultModel: 'MiniMax-Text-01' },
  { value: 'baichuan', label: '百川智能', defaultUrl: 'https://api.baichuan-ai.com/v1/chat/completions', defaultModel: 'Baichuan4-Turbo' },
  { value: 'stepfun', label: '阶跃星辰', defaultUrl: 'https://api.stepfun.com/v1/chat/completions', defaultModel: 'step-1-flash' },
  { value: 'lingyiwanwu', label: '零一万物', defaultUrl: 'https://api.lingyiwanwu.com/v1/chat/completions', defaultModel: 'yi-lightning' },
  { value: 'sensetime', label: '商汤日日新', defaultUrl: 'https://api.sensenova.cn/compatible-mode/v1/chat/completions', defaultModel: 'SenseChat-5' },
  { value: 'hunyuan', label: '腾讯混元', defaultUrl: 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions', defaultModel: 'hunyuan-turbos-latest' },
  { value: 'siliconflow', label: '硅基流动', defaultUrl: 'https://api.siliconflow.cn/v1/chat/completions', defaultModel: 'Qwen/Qwen2.5-7B-Instruct' },
  { value: 'agnes', label: 'Agnes AI（文/图/视频）', defaultUrl: 'https://apihub.agnes-ai.com/v1/chat/completions', defaultModel: 'agnes-2.5-flash' },
  { value: 'custom', label: '自定义', defaultUrl: '', defaultModel: 'gpt-3.5-turbo' },
];

function getVendorInfo(value) {
  return VENDOR_OPTIONS.find(v => v.value === value) || VENDOR_OPTIONS[VENDOR_OPTIONS.length - 1];
}

export default function ChatAdmin({ token, user }) {
  const [apis, setApis] = useState([]);
  const [vendors] = useState(VENDOR_OPTIONS);
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(null);
  const [newApi, setNewApi] = useState({ name: '', url: '', apiKey: '', priority: 0, protocolType: 'openai', vendor: 'custom', model: '' });
  const [editApi, setEditApi] = useState(null);
  const [testing, setTesting] = useState({});
  const [checkingAll, setCheckingAll] = useState(false);
  const [msg, setMsg] = useState('');
  const [testDialog, setTestDialog] = useState(null); // { api, message, reply, loading }
  const msgTimer = useRef(null);

  useEffect(() => {
    fetchApis();
  }, []);

  function showMsg(text) {
    setMsg(text);
    if (msgTimer.current) clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => setMsg(''), 5000);
  }

  const fetchApis = async () => {
    try {
      const res = await fetch('/api/admin/ai-apis', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setApis(data.apis || []);
      }
    } catch (err) {}
  };

  const handleAddApi = async () => {
    if (!newApi.name || !newApi.url || !newApi.apiKey) {
      showMsg('名称、网址、密钥不能为空');
      return;
    }
    try {
      const res = await fetch('/api/admin/ai-apis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(newApi),
      });
      const data = await res.json();
      if (res.ok) {
        showMsg('API添加成功');
        setShowAdd(false);
        setNewApi({ name: '', url: '', apiKey: '', priority: 0, protocolType: 'openai', vendor: 'custom', model: '' });
        fetchApis();
      } else {
        showMsg(data.error || '添加失败');
      }
    } catch (err) {
      showMsg('网络错误');
    }
  };

  const handleEditApi = async () => {
    if (!editApi.name || !editApi.url || !editApi.apiKey) {
      showMsg('名称、网址、密钥不能为空');
      return;
    }
    try {
      const res = await fetch('/api/admin/ai-apis', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(editApi),
      });
      const data = await res.json();
      if (res.ok) {
        showMsg('API更新成功');
        setShowEdit(null);
        setEditApi(null);
        fetchApis();
      } else {
        showMsg(data.error || '更新失败');
      }
    } catch (err) {
      showMsg('网络错误');
    }
  };

  const handleDeleteApi = async (id) => {
    if (!confirm('确定删除此API？')) return;
    await fetch(`/api/admin/ai-apis?id=${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    showMsg('API已删除');
    fetchApis();
  };

  const handleTestApi = async (id) => {
    setTesting({ ...testing, [id]: true });
    try {
      const res = await fetch('/api/admin/ai-apis', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      showMsg(`${apis.find(a => a.id === id)?.name || 'API'}: ${data.available ? '可用' : '不可用'}${data.error ? ' - ' + data.error : ''}${data.responseTime ? ' (' + data.responseTime + 'ms)' : ''}`);
      fetchApis();
    } catch (err) {
      showMsg('检测失败');
    }
    setTesting({ ...testing, [id]: false });
  };

  const handleCheckAll = async () => {
    setCheckingAll(true);
    try {
      const res = await fetch('/api/admin/ai-apis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action: 'check_all' }),
      });
      const data = await res.json();
      if (res.ok && data.results) {
        const summary = data.results.map(r => `${r.name}: ${r.available ? '可用' : '不可用'}`).join('，');
        showMsg(`批量检测完成 - ${summary}`);
        fetchApis();
      }
    } catch (err) {
      showMsg('批量检测失败');
    }
    setCheckingAll(false);
  };

  const handleToggle = async (id) => {
    try {
      const res = await fetch('/api/admin/ai-apis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action: 'toggle', id }),
      });
      if (res.ok) {
        fetchApis();
      }
    } catch (err) {}
  };

  const handleTestDialog = async () => {
    if (!testDialog.message.trim() || testDialog.loading) return;
    setTestDialog({ ...testDialog, loading: true, reply: null, error: null });
    try {
      const res = await fetch('/api/admin/ai-apis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action: 'test', id: testDialog.api.id, message: testDialog.message }),
      });
      const data = await res.json();
      if (data.success) {
        setTestDialog({ ...testDialog, loading: false, reply: data.reply });
      } else {
        setTestDialog({ ...testDialog, loading: false, error: data.error || '测试失败' });
      }
      fetchApis();
    } catch (err) {
      setTestDialog({ ...testDialog, loading: false, error: '网络错误' });
    }
  };

  const handleVendorChange = (isEdit, vendor) => {
    const info = getVendorInfo(vendor);
    if (isEdit) {
      setEditApi({ ...editApi, vendor, url: info.defaultUrl || editApi.url, model: info.defaultModel || editApi.model });
    } else {
      setNewApi({ ...newApi, vendor, url: info.defaultUrl || newApi.url, model: info.defaultModel || newApi.model });
    }
  };

  const startEdit = (api) => {
    setEditApi({ ...api, apiKey: api.api_key, protocolType: api.protocol_type || 'openai' });
    setShowEdit(api.id);
  };

  // ── API 表单组件 ──
  function ApiForm({ data, onChange, onVendorChange, onSubmit, onCancel, submitLabel }) {
    return (
      <div style={{ background: '#fff', borderRadius: '8px', padding: '20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div className="form-group">
            <label className="form-label">接口名称</label>
            <input className="input-field" value={data.name} onChange={e => onChange({ ...data, name: e.target.value })} placeholder="如：DeepSeek主接口" />
          </div>
          <div className="form-group">
            <label className="form-label">优先级（数字越小越优先）</label>
            <input className="input-field" type="number" value={data.priority} onChange={e => onChange({ ...data, priority: parseInt(e.target.value) || 0 })} />
          </div>
          <div className="form-group">
            <label className="form-label">协议类型</label>
            <select className="input-field" value={data.protocolType} onChange={e => onChange({ ...data, protocolType: e.target.value })}>
              <option value="openai">OpenAI 兼容</option>
              <option value="native">原生厂商</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">厂商</label>
            <select className="input-field" value={data.vendor} onChange={e => onVendorChange(e.target.value)}>
              {vendors.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label className="form-label">API 网址</label>
            <input className="input-field" type="url" placeholder="https://api.example.com/v1/chat/completions" value={data.url} onChange={e => onChange({ ...data, url: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">模型名</label>
            <input className="input-field" value={data.model} onChange={e => onChange({ ...data, model: e.target.value })} placeholder="如：deepseek-chat" />
          </div>
          <div className="form-group">
            <label className="form-label">API 密钥</label>
            <input className="input-field" type="password" value={data.apiKey} onChange={e => onChange({ ...data, apiKey: e.target.value })} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
          <button className="btn-secondary" onClick={onCancel}>取消</button>
          <button className="btn-primary" onClick={onSubmit}>{submitLabel}</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h3 style={{ fontSize: '18px', color: '#1e3a5f', margin: 0 }}>AI API 接口管理</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn-secondary" onClick={handleCheckAll} disabled={checkingAll} style={{ padding: '6px 16px' }}>
            {checkingAll ? '检测中...' : '批量检测'}
          </button>
          <button className="btn-primary" onClick={() => setShowAdd(!showAdd)} style={{ padding: '6px 16px' }}>+ 添加 API 接口</button>
        </div>
      </div>

      {msg && <div style={{ padding: '8px 12px', background: '#eff6ff', borderRadius: '4px', marginBottom: '16px', color: '#2563eb', fontSize: '13px' }}>{msg}</div>}

      {showAdd && (
        <ApiForm
          data={newApi}
          onChange={setNewApi}
          onVendorChange={vendor => handleVendorChange(false, vendor)}
          onSubmit={handleAddApi}
          onCancel={() => setShowAdd(false)}
          submitLabel="添加"
        />
      )}

      {showEdit && editApi && (
        <ApiForm
          data={editApi}
          onChange={setEditApi}
          onVendorChange={vendor => handleVendorChange(true, vendor)}
          onSubmit={handleEditApi}
          onCancel={() => { setShowEdit(null); setEditApi(null); }}
          submitLabel="保存"
        />
      )}

      {apis.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af', background: '#fff', borderRadius: '8px' }}>
          暂无 API 接口，请点击"添加 API 接口"
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {apis.map(api => (
            <div key={api.id} style={{
              background: '#fff', borderRadius: '8px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              opacity: api.enabled ? 1 : 0.6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '15px', fontWeight: '600', color: '#1e3a5f' }}>
                    {api.name}
                    <span style={{
                      marginLeft: '12px', fontSize: '12px', fontWeight: 'normal',
                      padding: '2px 8px', borderRadius: '12px',
                      background: api.is_available ? '#dcfce7' : '#fee2e2',
                      color: api.is_available ? '#16a34a' : '#dc2626',
                    }}>
                      {api.is_available ? '● 可用' : '● 不可用'}
                    </span>
                    <span style={{ marginLeft: '8px', fontSize: '12px', fontWeight: 'normal',
                      padding: '2px 8px', borderRadius: '12px',
                      background: api.enabled ? '#dbeafe' : '#f3f4f6',
                      color: api.enabled ? '#2563eb' : '#6b7280',
                    }}>
                      {api.enabled ? '已启用' : '已停用'}
                    </span>
                    <span style={{ marginLeft: '8px', fontSize: '12px', color: '#9ca3af' }}>优先级: {api.priority}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>
                    {getVendorInfo(api.vendor)?.label || api.vendor} | {api.model || '未指定模型'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#d1d5db', marginTop: '2px' }}>{api.url}</div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  <button className="btn-secondary" style={{ padding: '4px 12px', fontSize: '12px' }}
                    onClick={() => handleTestApi(api.id)} disabled={testing[api.id]}>
                    {testing[api.id] ? '检测中...' : '实时检测'}
                  </button>
                  <button className="btn-secondary" style={{ padding: '4px 12px', fontSize: '12px' }}
                    onClick={() => setTestDialog({ api, message: '', reply: null, error: null, loading: false })}>
                    测试对话
                  </button>
                  <button className={api.enabled ? 'btn-danger' : 'btn-primary'} style={{ padding: '4px 12px', fontSize: '12px' }}
                    onClick={() => handleToggle(api.id)}>
                    {api.enabled ? '停用' : '启用'}
                  </button>
                  <button className="btn-secondary" style={{ padding: '4px 12px', fontSize: '12px' }}
                    onClick={() => startEdit(api)}>
                    编辑
                  </button>
                  <button className="btn-danger" style={{ padding: '4px 12px', fontSize: '12px' }}
                    onClick={() => handleDeleteApi(api.id)}>
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 测试对话弹窗 */}
      {testDialog && (
        <div className="modal-overlay" onClick={() => setTestDialog(null)}>
          <div className="modal-box" style={{ width: '520px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px', color: '#1e3a5f', margin: 0 }}>测试对话 - {testDialog.api.name}</h3>
              <span style={{ cursor: 'pointer', color: '#9ca3af', fontSize: '20px' }} onClick={() => setTestDialog(null)}>x</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', marginBottom: '12px', minHeight: '120px', maxHeight: '300px', background: '#f9fafb', borderRadius: '8px', padding: '12px' }}>
              {testDialog.reply ? (
                <div style={{ fontSize: '14px', color: '#374151', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>{testDialog.reply}</div>
              ) : testDialog.error ? (
                <div style={{ fontSize: '14px', color: '#dc2626' }}>错误：{testDialog.error}</div>
              ) : testDialog.loading ? (
                <div style={{ fontSize: '14px', color: '#9ca3af', textAlign: 'center' }}>AI 正在回复...</div>
              ) : (
                <div style={{ fontSize: '14px', color: '#9ca3af', textAlign: 'center' }}>输入消息后点击发送，验证接口是否可正常对话</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input className="input-field" style={{ flex: 1 }}
                placeholder="输入测试消息..."
                value={testDialog.message}
                onChange={e => setTestDialog({ ...testDialog, message: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') handleTestDialog(); }}
                disabled={testDialog.loading} />
              <button className="btn-primary" style={{ padding: '8px 24px' }}
                onClick={handleTestDialog} disabled={testDialog.loading || !testDialog.message.trim()}>
                {testDialog.loading ? '发送中...' : '发送'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
