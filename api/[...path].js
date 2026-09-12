import { handleRequest } from "../server.js";

// Vercel Node Serverless Function. API routes share the same provider-priority
// implementation as the Oracle Node server: KIS -> Naver -> Yahoo/fallback.
export default async function handler(req, res) {
  try {
    await handleRequest(req, res);
  } catch (error) {
    console.error("API request failed", error);
    res.status(500).json({ ok: false, error: "데이터를 불러오지 못했습니다." });
  }
}
