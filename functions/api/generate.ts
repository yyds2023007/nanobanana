export const onRequestPost: PagesFunction = async (context) => {
  try {
    const form = await context.request.formData();
    const apiKey = String(form.get("apiKey") ?? "").trim();
    const prompt = String(form.get("prompt") ?? "").trim();

    if (!apiKey) return Response.json({ error: "请先填写 API Key。" }, { status: 400 });
    if (!prompt) return Response.json({ error: "请先填写提示词。" }, { status: 400 });

    const files = form.getAll("images").filter((v) => v instanceof File) as File[];
    if (files.length > 10) return Response.json({ error: "参考图最多 10 张。" }, { status: 400 });

    // Gemini 文档示例支持用 inlineData(base64) 传入图片 [web:24]
    const parts: any[] = [{ text: prompt }];

    for (const f of files) {
      const ab = await f.arrayBuffer();
      const bytes = new Uint8Array(ab);
      let bin = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const b64 = btoa(bin);

      parts.push({
        inlineData: {
          mimeType: f.type || "image/png",
          data: b64,
        },
      });
    }

    // Gemini API：用 x-goog-api-key 调用 generateContent [web:21]
    const model = "gemini-3-pro-image-preview";
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
      }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return Response.json({ error: "Gemini API 调用失败", detail: data }, { status: 500 });
    }

    // 返回 candidates[0].content.parts 里取 inlineData 图片 [web:21]
    const outParts = data?.candidates?.[0]?.content?.parts ?? [];
    const imgPart = outParts.find((p: any) => p?.inlineData?.data);

    if (!imgPart) {
      return Response.json({
        error: "未在返回中找到图片数据（模型可能未返回图片或被安全策略拦截）。",
        raw: data,
      }, { status: 502 });
    }

    return Response.json({
      ok: true,
      model,
      mimeType: imgPart.inlineData.mimeType || "image/png",
      imageBase64: imgPart.inlineData.data,
    });
  } catch (e) {
    return Response.json({ error: "服务端异常", detail: String(e) }, { status: 500 });
  }
};
