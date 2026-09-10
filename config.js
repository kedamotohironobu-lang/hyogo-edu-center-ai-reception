// 公開してよい設定のみ。APIキーやApps ScriptのURLは絶対に書かないでください。
window.RECEPTION_CONFIG = Object.freeze({
  workerBaseUrl: "https://hyogo-edu-center-ai-reception-api.kedamoto-hironobu.workers.dev", // 一般受付Workerの https://xxxxx.workers.dev を入れる（/health不要）
  maxSeconds: 600,
  waitNoticeMs: 2500,
  requestTimeoutMs: 35000
});
