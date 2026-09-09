import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';
import { callAI, detectImageIntent, detectVideoIntent, generateImage, createVideo } from '../../../lib/ai-provider';

/**
 * 聊天发送接口
 *
 * POST /api/chat/send
 *   { message, history }  — 纯内存会话：前端传历史消息数组
 *
 * 逻辑：
 *   1. 意图识别：检测用户是否想生成图片/视频
 *   2. 若是图片/视频需求，查找 Agnes AI API 并调用对应端点
 *   3. 否则走普通文字对话：按优先级依次尝试已启用 API
 *
 * 注意：chat 不再入库（聊天内容不持久化）
 */
export default async function handler(req, res) {
  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '未登录' });

  if (req.method !== 'POST') return res.status(405).json({ error: '方法不允许' });

  const { message, history } = req.body;
  if (!message) return res.status(400).json({ error: '缺少消息内容' });

  // ── 意图识别：检测图片/视频生成需求 ──
  // 视频优先检测（更具体），若命中视频则不再检测图片
  const wantVideo = detectVideoIntent(message);
  const wantImage = !wantVideo && detectImageIntent(message);

  if (wantImage || wantVideo) {
    try {
      // 查找 Agnes AI API（用于图片/视频生成）
      const agnesApis = await query(
        "SELECT * FROM ai_apis WHERE vendor = 'agnes' AND enabled = TRUE ORDER BY priority ASC, id ASC"
      );

      if (agnesApis.rows.length === 0) {
        return res.status(200).json({
          reply: '当前没有可用的 Agnes AI 接口。请联系管理员在"你问我答 - 管理区"中添加 Agnes AI API 配置（厂商选择 Agnes AI），并确保接口已启用且可用。',
          api: null,
          type: 'text',
        });
      }

      const agnesApi = agnesApis.rows[0];

      if (wantImage) {
        // 图片生成（同步，等待返回）
        const result = await generateImage(agnesApi, message);
        return res.status(200).json({
          reply: result.url || `data:image/png;base64,${result.b64}`,
          api: agnesApi.name,
          type: 'image',
        });
      } else {
        // 视频生成（异步：创建任务，返回 videoId 供前端轮询）
        const result = await createVideo(agnesApi, message);
        return res.status(200).json({
          reply: '视频正在生成中，请耐心等待...',
          api: agnesApi.name,
          type: 'video_pending',
          videoId: result.videoId,
          videoModel: result.model,
        });
      }
    } catch (err) {
      console.error('Image/Video generation error:', err);
      return res.status(200).json({
        reply: `生成失败：${err.message}`,
        api: null,
        type: 'text',
      });
    }
  }

  // ── 普通文字对话 ──
  const messages = [
    {
      role: 'system',
      content: '你是"销售服务中心微创新实验田"网站的智能助手。你具备以下能力：1) 文字对话与问答；2) 图片生成——当用户说"画/生成/做一张...的图/照片/插画"等时，系统会自动调用图片生成功能，你只需确认并引导用户说出想画的内容即可；3) 视频生成——当用户说"生成/制作/做一个...的视频/短片"等时，系统会自动调用视频生成功能。如果你判断用户的请求属于图片或视频生成，请直接告诉用户"好的，马上为您生成"并引导确认主题即可，由系统完成实际生成，无需再解释你是否具备该能力。',
    },
    ...(history || []).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
  ];
  messages.push({ role: 'user', content: message });

  try {
    // 获取已启用的 API，按优先级排序
    // 注意：不按 is_available 过滤——is_available 可能因瞬时限流过时，
    // 只要 enabled 就尝试，失败时逐个跳过
    const apis = await query(
      'SELECT * FROM ai_apis WHERE enabled = TRUE ORDER BY priority ASC, id ASC'
    );

    if (apis.rows.length === 0) {
      return res.status(200).json({
        reply: '当前没有可用的 AI API 接口。请联系管理员在"你问我答 - 管理区"中配置并启用 API 接口。',
        error: 'no_api',
        type: 'text',
      });
    }

    let aiReply = null;
    let usedApiName = null;
    let lastError = null;

    for (const api of apis.rows) {
      try {
        const reply = await callAI(api, messages, { maxTokens: 3000, timeout: 15000, maxRetries: 0 });
        if (reply && reply.trim()) {
          aiReply = reply;
          usedApiName = api.name;
          break;
        }
      } catch (err) {
        console.log(`API ${api.name} failed:`, err.message);
        // 不自动标记 is_available=FALSE：瞬时限流(429)等不应导致 API 永久失效
        // 记录失败原因，供最终错误提示使用
        lastError = err.message;
        // is_available 仅由管理员在管理区手动检测(check_all/test)时更新
      }
    }

    if (!aiReply) {
      const reason = lastError ? `（原因：${lastError}）` : '';
      aiReply = `AI 服务暂时不可用${reason}，请稍后重试或联系管理员检查 API 配置。`;
    }

    res.status(200).json({
      reply: aiReply,
      api: usedApiName,
      type: 'text',
    });
  } catch (err) {
    console.error('Chat send error:', err);
    res.status(500).json({ error: '服务器错误: ' + err.message });
  }
}
