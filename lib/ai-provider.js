/**
 * AI 厂商预设配置 + 统一 OpenAI 兼容调用层
 *
 * 覆盖国内外主流厂商：OpenAI、Anthropic、Google、通义千问、DeepSeek、
 * 智谱(GLM)、Kimi、百度千帆、火山豆包、MiniMax、百川、阶跃星辰、
 * 零一万物、商汤日日新、腾讯混元、硅基流动
 *
 * 所有厂商均通过 OpenAI 兼容格式调用：
 *   POST {baseUrl}/v1/chat/completions 或自定义 URL
 *   Headers: Authorization: Bearer {apiKey}
 *   Body: { model, messages, max_tokens }
 */

// ── 厂商预设列表 ──────────────────────────────────────────
// 格式：{ value, label, defaultUrl, defaultModel, note }
// defaultUrl 填到 chat/completions 为止（不含）
const VENDORS = [
  // ── 国外 ──
  {
    value: 'openai',
    label: 'OpenAI',
    defaultUrl: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-3.5-turbo',
  },
  {
    value: 'anthropic',
    label: 'Anthropic (Claude)',
    defaultUrl: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-3-5-sonnet-20241022',
  },
  {
    value: 'google',
    label: 'Google (Gemini)',
    defaultUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent',
    defaultModel: 'gemini-1.5-flash-latest',
  },
  // ── 国内 ──
  {
    value: 'qwen',
    label: '通义千问（阿里）',
    defaultUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen-turbo',
  },
  {
    value: 'deepseek',
    label: 'DeepSeek',
    defaultUrl: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-chat',
  },
  {
    value: 'zhipu',
    label: '智谱 GLM',
    defaultUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    defaultModel: 'glm-4-flash',
  },
  {
    value: 'kimi',
    label: 'Kimi（月之暗面）',
    defaultUrl: 'https://api.moonshot.cn/v1/chat/completions',
    defaultModel: 'moonshot-v1-8k',
  },
  {
    value: 'qianfan',
    label: '百度千帆（文心一言）',
    defaultUrl: 'https://qianfan.baidubce.com/v2/chat/completions',
    defaultModel: 'ernie-tiny-8k',
  },
  {
    value: 'doubao',
    label: '火山豆包（字节）',
    defaultUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    defaultModel: 'doubao-pro-4k',
  },
  {
    value: 'minimax',
    label: 'MiniMax',
    defaultUrl: 'https://api.minimax.chat/v1/text/chatcompletion_v2',
    defaultModel: 'MiniMax-Text-01',
  },
  {
    value: 'baichuan',
    label: '百川智能',
    defaultUrl: 'https://api.baichuan-ai.com/v1/chat/completions',
    defaultModel: 'Baichuan4-Turbo',
  },
  {
    value: 'stepfun',
    label: '阶跃星辰',
    defaultUrl: 'https://api.stepfun.com/v1/chat/completions',
    defaultModel: 'step-1-flash',
  },
  {
    value: 'lingyiwanwu',
    label: '零一万物',
    defaultUrl: 'https://api.lingyiwanwu.com/v1/chat/completions',
    defaultModel: 'yi-lightning',
  },
  {
    value: 'sensetime',
    label: '商汤日日新',
    defaultUrl: 'https://api.sensenova.cn/compatible-mode/v1/chat/completions',
    defaultModel: 'SenseChat-5',
  },
  {
    value: 'hunyuan',
    label: '腾讯混元',
    defaultUrl: 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions',
    defaultModel: 'hunyuan-turbos-latest',
  },
  {
    value: 'siliconflow',
    label: '硅基流动',
    defaultUrl: 'https://api.siliconflow.cn/v1/chat/completions',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
  },
  {
    value: 'agnes',
    label: 'Agnes AI（文/图/视频）',
    defaultUrl: 'https://apihub.agnes-ai.com/v1/chat/completions',
    defaultModel: 'agnes-2.5-flash',
  },
  {
    value: 'custom',
    label: '自定义',
    defaultUrl: '',
    defaultModel: 'gpt-3.5-turbo',
  },
];

const VENDOR_MAP = {};
VENDORS.forEach(v => { VENDOR_MAP[v.value] = v; });

/**
 * 根据 vendor 获取预设信息
 */
function getVendor(vendor) {
  return VENDOR_MAP[vendor] || VENDOR_MAP['custom'];
}

/**
 * 构建请求参数（统一以 OpenAI 兼容格式调用）
 * @param {object} api - ai_apis 表行 (name, url, api_key, protocol_type, vendor, model, enabled)
 * @param {array} messages - [{role, content}, ...]
 * @param {object} options - { maxTokens }
 * @returns {object} { url, headers, body }
 */
function buildRequest(api, messages, options = {}) {
  const vendor = getVendor(api.vendor);
  // 优先用 api.url（用户显式填写），否则用厂商预设地址
  const url = api.url || vendor.defaultUrl;
  const model = api.model || vendor.defaultModel || 'gpt-3.5-turbo';
  const maxTokens = options.maxTokens || 2000;

  return {
    url,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${api.api_key}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
    }),
  };
}

/**
 * 解析 AI 响应（统一从 OpenAI 兼容格式中提取回复文本）
 * @param {object} api
 * @param {Response} response - fetch 返回的 Response 对象
 * @returns {string} 回复文本
 */
async function parseResponse(api, response) {
  const data = await response.json();

  // 标准 OpenAI 格式
  if (data.choices && data.choices[0]) {
    const choice = data.choices[0];
    if (choice.message) {
      const content = choice.message.content;
      // reasoning 模型：content 可能为空（token 全被思考过程消耗）
      if (content && content.trim()) return content;
      // 有 reasoning_content 但 content 为空 → 提示用户加大 token
      if (choice.message.reasoning_content) {
        throw new Error('模型仅返回思考内容（reasoning），回复文本为空。请增大 max_tokens 或更换非推理模型');
      }
      return content || '';
    }
    if (choice.text) return choice.text;
  }

  // 某些厂商可能会用 content 字段
  if (data.content) return data.content;

  // Google Gemini 格式（兜底）
  if (data.candidates && data.candidates[0]) {
    const parts = data.candidates[0].content?.parts;
    if (parts && parts.length > 0) return parts.map(p => p.text).join('');
  }

  throw new Error('无法解析AI响应格式');
}

/**
 * 调用 AI API（统一入口）
 * @param {object} api - ai_apis 表行
 * @param {array} messages - 消息数组
 * @param {object} options
 * @returns {string} AI 回复文本
 */
async function callAI(api, messages, options = {}) {
  const { url, headers, body } = buildRequest(api, messages, options);
  const timeout = options.timeout || 15000;
  const maxRetries = options.maxRetries ?? 0; // 默认不重试，快速失败

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      // 429 限流：等待后重试（指数退避）
      if (response.status === 429 && attempt < maxRetries) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '0', 10);
        const waitMs = (retryAfter > 0 ? retryAfter * 1000 : (attempt + 1) * 2000); // 2s 指数退避
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${errText.substring(0, 200) || response.statusText}`);
      }

      return await parseResponse(api, response);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('API 请求失败（多次重试后仍不可用）');
}

/**
 * 检测 API 可用性（发送极简请求测试）
 * @param {object} api
 * @returns {object} { available: boolean, error?: string, responseTime?: number }
 */
async function checkAvailability(api) {
  const startTime = Date.now();
  try {
    const reply = await callAI(api, [
      { role: 'user', content: '你好，请回复"OK"' },
    ], { maxTokens: 2000, timeout: 20000, maxRetries: 0 });
    const responseTime = Date.now() - startTime;
    // 如果有回复就算是可用
    if (reply && reply.trim()) {
      return { available: true, responseTime };
    }
    return { available: false, error: '空回复', responseTime };
  } catch (err) {
    const responseTime = Date.now() - startTime;
    return { available: false, error: err.message, responseTime };
  }
}

// ── Agnes AI 图片/视频生成 ──────────────────────────────────

/**
 * 从 API 配置中提取 Agnes AI 的 base URL
 * api.url 通常存储 chat/completions 端点，需截取到 /v1
 */
function getAgnesBaseUrl(api) {
  const url = api.url || 'https://apihub.agnes-ai.com/v1/chat/completions';
  if (/\/chat\/completions\/?$/.test(url)) {
    return url.replace(/\/chat\/completions\/?$/, '');
  }
  return url.replace(/\/$/, '');
}

/**
 * 意图识别：检测用户是否想生成图片
 */
function detectImageIntent(message) {
  const msg = message.trim();
  const lower = msg.toLowerCase();
  // 中文
  if (/生成.{0,6}(图|画像|图片|照片|插画)/.test(msg)) return true;
  if (/画.{0,4}(一|张|幅|个|些)/.test(msg)) return true;
  if (/^帮我画|^请画|^画一|^画个|^画张|^画幅/.test(msg)) return true;
  if (/给我.{0,4}画|帮我.{0,4}画/.test(msg)) return true;
  if (/帮我.{0,4}(生成|做|创建).{0,4}(图|画像|图片|照片|插画)/.test(msg)) return true;
  // 英文
  if (/(generate|create|make|draw|paint)\s+(me\s+)?(an?\s+)?(image|picture|drawing|painting|photo)/i.test(lower)) return true;
  return false;
}

/**
 * 意图识别：检测用户是否想生成视频
 */
function detectVideoIntent(message) {
  const msg = message.trim();
  const lower = msg.toLowerCase();
  // 中文
  if (/生成.{0,6}(视频|短片|影像|动画)/.test(msg)) return true;
  if (/做.{0,4}视频|制作.{0,4}(视频|短片|动画)/.test(msg)) return true;
  if (/帮我.{0,4}(生成|做|制作|创建).{0,4}(视频|短片|动画)/.test(msg)) return true;
  // 英文
  if (/(generate|create|make)\s+(a\s+)?(video|clip|animation|mp4)/i.test(lower)) return true;
  return false;
}

/**
 * 生成图片（Agnes AI 图片生成接口）
 * @param {object} api - ai_apis 表行（vendor=agnes）
 * @param {string} prompt - 图片描述
 * @param {object} options - { model, size, timeout }
 * @returns {object} { url } 或 { b64 }
 */
async function generateImage(api, prompt, options = {}) {
  const baseUrl = getAgnesBaseUrl(api);
  const url = `${baseUrl}/images/generations`;
  const model = options.model || 'agnes-image-2.1-flash';
  const size = options.size || '1K';
  const maxRetries = options.maxRetries || 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout || 60000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${api.api_key}`,
        },
        body: JSON.stringify({ model, prompt, size }),
        signal: controller.signal,
      });

      // 429 限流：等待后重试（指数退避）
      if (response.status === 429 && attempt < maxRetries) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '0', 10);
        const waitMs = (retryAfter > 0 ? retryAfter * 1000 : (attempt + 1) * 5000);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`图片生成失败 (HTTP ${response.status}): ${errText.substring(0, 300)}`);
      }

      const data = await response.json();
      if (data.data && data.data[0]) {
        const item = data.data[0];
        if (item.url) return { url: item.url, type: 'image' };
        if (item.b64_json) return { b64: item.b64_json, type: 'image' };
      }
      throw new Error('图片生成响应格式异常: ' + JSON.stringify(data).substring(0, 200));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('图片生成失败（多次重试后仍不可用）');
}

/**
 * 创建视频任务（Agnes AI 视频生成接口，异步）
 * @param {object} api - ai_apis 表行（vendor=agnes）
 * @param {string} prompt - 视频描述
 * @param {object} options - { model, seconds, aspectRatio, timeout }
 * @returns {object} { videoId, model }
 */
async function createVideo(api, prompt, options = {}) {
  const baseUrl = getAgnesBaseUrl(api);
  const url = `${baseUrl}/videos`;
  const model = options.model || 'agnes-video-2.5-flash';
  const maxRetries = options.maxRetries || 2;

  const body = {
    model,
    prompt,
    mode: 'text',
    seconds: options.seconds || '5',
    size: '720P',
    aspect_ratio: options.aspectRatio || '16:9',
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout || 30000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${api.api_key}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      // 429 限流：等待后重试（指数退避）
      if (response.status === 429 && attempt < maxRetries) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '0', 10);
        const waitMs = (retryAfter > 0 ? retryAfter * 1000 : (attempt + 1) * 5000);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`视频创建失败 (HTTP ${response.status}): ${errText.substring(0, 300)}`);
      }

      const data = await response.json();
      if (data.video_id) return { videoId: data.video_id, model };
      throw new Error('视频创建响应格式异常: ' + JSON.stringify(data).substring(0, 200));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('视频创建失败（多次重试后仍不可用）');
}

/**
 * 查询视频生成状态
 * @param {object} api - ai_apis 表行（vendor=agnes）
 * @param {string} videoId - 视频 ID
 * @param {string} modelName - 模型名
 * @returns {object} { status, videoUrl, progress }
 */
async function checkVideoStatus(api, videoId, modelName) {
  const baseUrl = getAgnesBaseUrl(api);
  const model = modelName || 'agnes-video-2.5-flash';
  const url = `${baseUrl}/agnesapi?video_id=${encodeURIComponent(videoId)}&model_name=${encodeURIComponent(model)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${api.api_key}`,
      },
      signal: controller.signal,
    });

    if (response.status === 429) {
      // 速率限制，不报错，返回"处理中"状态让前端继续轮询
      return { status: 'processing', videoUrl: null, progress: null };
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`视频状态查询失败 (HTTP ${response.status}): ${errText.substring(0, 300)}`);
    }

    const data = await response.json();
    return {
      status: data.status || 'unknown',
      videoUrl: data.metadata?.url || data.url || null,
      progress: data.progress || data.percent || null,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  VENDORS,
  getVendor,
  buildRequest,
  parseResponse,
  callAI,
  checkAvailability,
  detectImageIntent,
  detectVideoIntent,
  generateImage,
  createVideo,
  checkVideoStatus,
};
