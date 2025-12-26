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

    // 处理预检请求
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // --- 鉴权 ---
    const checkAuth = (req) => {
      const auth = req.headers.get("Authorization");
      if (!auth) return false;

      // 1. 获取环境变量 (容错处理)
      const key1 = env.ADMIN_KEY || "";
      const key2 = env.ADMIN_KEYS || "";

      // 2. 合并并清洗 Key 列表
      const allowedKeys = (key1 + "," + key2)
        .replace(/，/g, ',')      // 兼容中文逗号
        .split(',')               // 分割
        .map(k => k.trim())       // 去除首尾空格
        .filter(k => k !== "");   // 去除空项

      // 3. 验证 (仅返回 true/false)
      return allowedKeys.includes(auth.trim());
    };

    // 通用 JSON 响应
    const jsonResponse = (data, status = 200) => {
      return new Response(JSON.stringify(data), {
        status: status,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    };

    try {
      // --- API 路由 ---

      // 1. 保存笔记 (POST /api/save)
      if (path === "/api/save" && request.method === "POST") {
        if (!checkAuth(request)) return jsonResponse({ error: "Unauthorized" }, 401);
        
        const body = await request.json();
        // 适配新数据库结构
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

        // 只获取未分享的私人笔记
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
        if (!env.AI) return jsonResponse({ summary: "Error: AI not configured" });

        const aiRes = await env.AI.run('@cf/qwen/qwen1.5-7b-chat-awq', {
          messages: [
            { role: "system", content: "你是一个专业的笔记助手。请用中文简明扼要地总结用户的笔记内容，提取核心要点。" },
            { role: "user", content: body.text }
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
          return jsonResponse({ error: "Link expired or not found" }, 404);
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
      // 生产环境通常不返回 e.message 以防泄露信息，但在个人使用的工具中保留以便排查系统级错误
      return jsonResponse({ error: "Internal Server Error" }, 500);
    }
  }
};
