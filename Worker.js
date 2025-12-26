export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // --- CORS 配置 (允许跨域) ---
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*", 
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    // 处理预检请求 (Browser Preflight)
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // --- 【核心修改】鉴权辅助函数 ---
    const checkAuth = (req) => {
      const auth = req.headers.get("Authorization");
      
      // 如果前端没发 Header，直接由后续逻辑拒绝
      if (!auth) return false;

      // 定义允许的 Key 列表
      let allowedKeys = [];

      // 1. 兼容原有逻辑：读取 ADMIN_KEY (单值)
      if (env.ADMIN_KEY) {
        // 确保去除首尾空格，防止复制粘贴带入空格
        const oldKey = env.ADMIN_KEY.trim();
        if (oldKey) allowedKeys.push(oldKey);
      }

      // 2. 新增逻辑：读取 ADMIN_KEYS (逗号分隔的多值)
      if (env.ADMIN_KEYS) {
        const newKeys = env.ADMIN_KEYS.split(',').map(k => k.trim()).filter(k => k !== "");
        allowedKeys = allowedKeys.concat(newKeys);
      }

      // 3. 检查当前请求的 Key 是否在允许列表中
      return allowedKeys.includes(auth);
    };

    // 通用响应辅助函数
    const jsonResponse = (data, status = 200) => {
      return new Response(JSON.stringify(data), {
        status: status,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders // 每个响应都带上 CORS 头
        }
      });
    };

    try {
      // --- API 路由 ---

      // 1. 保存笔记 (POST /api/save)
      if (path === "/api/save" && request.method === "POST") {
        if (!checkAuth(request)) return jsonResponse({ error: "Unauthorized" }, 401);
        
        const body = await request.json();
        const isShare = body.is_share ? 1 : 0;
        const publicId = body.public_id || null;
        
        await env.DB.prepare(
          "INSERT INTO notes (content, is_share, public_id) VALUES (?, ?, ?)"
        ).bind(body.content, isShare, publicId).run();

        return jsonResponse({ success: true });
      }

      // 2. 获取列表 (GET /api/list)
      if (path === "/api/list" && request.method === "GET") {
        if (!checkAuth(request)) return jsonResponse({ error: "Unauthorized" }, 401);

        const { results } = await env.DB.prepare(
          "SELECT id, content, created_at FROM notes WHERE is_share = 0 ORDER BY id DESC"
        ).all();

        return jsonResponse(results);
      }

      // 3. 删除笔记 (POST /api/delete)
      if (path === "/api/delete" && request.method === "POST") {
        if (!checkAuth(request)) return jsonResponse({ error: "Unauthorized" }, 401);
        
        const body = await request.json();
        await env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(body.id).run();
        
        return jsonResponse({ success: true });
      }

      // 4. AI 总结 (POST /api/ai-sum)
      if (path === "/api/ai-sum" && request.method === "POST") {
        if (!checkAuth(request)) return jsonResponse({ error: "Unauthorized" }, 401);

        const body = await request.json();
        const text = body.text;

        // 调用 Workers AI (使用 Qwen 1.5)
        const aiRes = await env.AI.run('@cf/qwen/qwen1.5-7b-chat-awq', {
          messages: [
            { role: "system", content: "你是一个专业的笔记助手。请用中文简明扼要地总结用户的笔记内容，提取核心要点。" },
            { role: "user", content: text }
          ]
        });

        return jsonResponse({ summary: aiRes.response });
      }

      // 5. 阅后即焚获取 (GET /api/share/:id)
      const shareMatch = path.match(/^\/api\/share\/([a-zA-Z0-9]+)$/);
      if (shareMatch && request.method === "GET") {
        const shareId = shareMatch[1];
        
        const note = await env.DB.prepare(
          "SELECT * FROM notes WHERE public_id = ? AND is_share = 1"
        ).bind(shareId).first();

        if (!note) {
          return jsonResponse({ error: "Not found or expired" }, 404);
        }

        // 读取后立即物理删除
        await env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(note.id).run();

        return jsonResponse({ content: note.content });
      }

      // 默认路由
      if (path === "/") {
        return new Response("CloudNotes API is running.", { status: 200, headers: corsHeaders });
      }

      return jsonResponse({ error: "Not Found" }, 404);

    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }
};
