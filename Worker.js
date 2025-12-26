export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });

    // 计算 Key 的 SHA-256 哈希作为 Owner ID
    const getOwnerHash = async (key) => {
      const msgBuffer = new TextEncoder().encode(key.trim());
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    };

    // 鉴权并返回 Owner ID
    const checkAuth = async (req) => {
      const auth = req.headers.get("Authorization");
      if (!auth) return null;

      const keyConfig = (env.ADMIN_KEY || "") + "," + (env.ADMIN_KEYS || "");
      const allowedKeys = keyConfig.replace(/，/g, ',').split(',').map(k => k.trim()).filter(Boolean);
      
      const userKey = auth.trim();
      if (!allowedKeys.includes(userKey)) return null;

      return await getOwnerHash(userKey);
    };

    try {
      const url = new URL(request.url);

      // 保存笔记
      if (url.pathname === "/api/save" && request.method === "POST") {
        const ownerId = await checkAuth(request);
        if (!ownerId) return jsonResponse({ error: "Unauthorized" }, 401);

        const body = await request.json();
        const isShare = body.is_share ? 1 : 0;

        await env.DB.prepare(
          "INSERT INTO notes (content, is_share, public_id, owner) VALUES (?, ?, ?, ?)"
        ).bind(body.content, isShare, body.public_id || null, ownerId).run();

        return jsonResponse({ success: true });
      }

      // 获取列表
      if (url.pathname === "/api/list" && request.method === "GET") {
        const ownerId = await checkAuth(request);
        if (!ownerId) return jsonResponse({ error: "Unauthorized" }, 401);

        const { results } = await env.DB.prepare(
          "SELECT id, content, created_at FROM notes WHERE is_share = 0 AND owner = ? ORDER BY id DESC"
        ).bind(ownerId).all();

        return jsonResponse(results);
      }

      // 删除笔记
      if (url.pathname === "/api/delete" && request.method === "POST") {
        const ownerId = await checkAuth(request);
        if (!ownerId) return jsonResponse({ error: "Unauthorized" }, 401);

        const body = await request.json();
        await env.DB.prepare("DELETE FROM notes WHERE id = ? AND owner = ?").bind(body.id, ownerId).run();

        return jsonResponse({ success: true });
      }

      // AI 总结
      if (url.pathname === "/api/ai-sum" && request.method === "POST") {
        if (!(await checkAuth(request))) return jsonResponse({ error: "Unauthorized" }, 401);

        const body = await request.json();
        if (!env.AI) return jsonResponse({ summary: "AI service not configured" });

        const aiRes = await env.AI.run('@cf/qwen/qwen1.5-7b-chat-awq', {
          messages: [
            { role: "system", content: "你是一个专业的笔记助手。请用中文简明扼要地总结用户的笔记内容。" },
            { role: "user", content: body.text }
          ]
        });
        return jsonResponse({ summary: aiRes.response });
      }

      // 阅后即焚 (公开读取)
      const shareMatch = url.pathname.match(/^\/api\/share\/([a-zA-Z0-9]+)$/);
      if (shareMatch && request.method === "GET") {
        const shareId = shareMatch[1];
        const note = await env.DB.prepare("SELECT * FROM notes WHERE public_id = ? AND is_share = 1").bind(shareId).first();
        
        if (!note) return jsonResponse({ error: "Link expired or invalid" }, 404);

        // 读取即删
        await env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(note.id).run();
        return jsonResponse({ content: note.content });
      }

      return new Response("CloudNotes API Running", { status: 200, headers: corsHeaders });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }
};
