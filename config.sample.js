// config.js のテンプレート。
// このファイルをコピーして config.js を作成し、実環境の値を設定してください。
// config.js は .gitignore 対象（トークンを含むためリポジトリに含めない）。
window.WORKLOG_CONFIG = {
  storageMode: "sheets",            // "sheets" | "local"
  apiBaseUrl: "https://script.google.com/macros/s/XXXXXXXX/exec",
  apiToken: "YOUR_API_TOKEN"        // gas/Code.gs の CONFIG.apiToken と一致させる
};
