export const onRequestPost: PagesFunction = async (context) => {
  try {
    const form = await context.request.formData();
    const apiKey = String(form.get("apiKey") ?? "").trim();
    const prompt = String(form.get("prompt") ?? "").trim();

    if (!apiKey) return Response.json({ error: "请先填写 OpenRouter API Key。" }, { status: 400 });
    if (!prompt) return Response.json({ error: "请先填写提示词。" }, { status: 400 });

    const files = form.getAll("images").filter((v) => v instanceof File) as File[];
    if (files.length > 10) return Response.json({ error: "参考图最多 10 张。" }, { status: 400 });

    // OpenRouter 支持把图片用 base64 data URL 方式放到 message.content 里（多模态输入）。[web:338]
    const content: any[] = [{ type: "text", text: prompt }];

    for (const f of files) {
      const ab = await f.arrayBuffer();
      const bytes = new Uint8Array(ab);
      let bin = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const b64 = btoa(bin);
      const mime = f.type || "image/png";
      content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } });
    }

    // 选一个 OpenRouter 上“支持出图”的模型。
    // 这里用 openai/gpt-5-image 作为示例（你也可以换成你账号有权限/有余额的图像模型）。[web:307]
    const model = "openai/gpt-5-image";

    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`, // OpenRouter 官方认证方式 [web:327]
        "x-title": "banana007119",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content }],
        // 有些图像模型会在返回中包含 data:image/...;base64,...，这里用“尽量兼容”的解析。
      }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return Response.json({ error: "OpenRouter 调用失败", detail: data }, { status: 500 });
    }

    const msg = data?.choices?.[0]?.message;
    const c = msg?.content;

    // 尽量从文本里抓取 data URL（不少图像模型会这样返回）[web:307]
    let dataUrl: string | null = null;
    if (typeof c === "string") {
      const m = c.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/);
      dataUrl = m ? m[0] : null;
    }

    if (!dataUrl) {
      return Response.json({
        error: "未从 OpenRouter 返回中解析到图片 data URL。可能是所选模型不返回图片，或返回结构不同。",
        raw: data,
      }, { status: 502 });
    }

    const m2 = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!m2) return Response.json({ error: "图片 data URL 解析失败。", raw: dataUrl }, { status: 502 });

    return Response.json({
      ok: true,
      provider: "openrouter",
      model,
      mimeType: m2[1],
      imageBase64: m2[2],
    });
  } catch (e) {
    return Response.json({ error: "服务端异常", detail: String(e) }, { status: 500 });
  }
};
