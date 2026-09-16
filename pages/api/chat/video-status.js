import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';
import { checkVideoStatus } from '../../../lib/ai-provider';

/**
 * 视频状态轮询接口
 *
 * POST /api/chat/video-status
 *   { videoId, videoModel }
 *
 * 返回视频生成状态，完成后包含视频 URL
 */
export default async function handler(req, res) {
  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '未登录' });

  if (req.method !== 'POST') return res.status(405).json({ error: '方法不允许' });

  const { videoId, videoModel } = req.body;
  if (!videoId) return res.status(400).json({ error: '缺少 videoId' });

  try {
    // 查找 Agnes AI API
    const agnesApis = await query(
      "SELECT * FROM ai_apis WHERE vendor = 'agnes' AND enabled = TRUE AND is_available = TRUE ORDER BY priority ASC, id ASC LIMIT 1"
    );

    if (agnesApis.rows.length === 0) {
      return res.status(200).json({ status: 'error', error: '没有可用的 Agnes AI 接口' });
    }

    const agnesApi = agnesApis.rows[0];
    const result = await checkVideoStatus(agnesApi, videoId, videoModel);

    res.status(200).json({
      status: result.status,
      videoUrl: result.videoUrl,
      progress: result.progress,
    });
  } catch (err) {
    console.error('Video status check error:', err);
    res.status(200).json({ status: 'error', error: err.message });
  }
}
