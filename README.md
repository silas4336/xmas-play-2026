# 2026 聖誕劇劇本網站

演員用的劇本 PWA：選自己的角色後，劇本中自己的台詞會被標出；有閱讀、背誦、彩排三種模式，以及排練行程。純靜態網站，可離線使用。

## 更新劇本
1. 把 `.doc` 轉成文字：`soffice --headless --convert-to 'txt:Text (encoded):UTF8' 劇本.doc`
2. `python3 tools/build_script.py 劇本.txt` → 產生 `data/script.json`
3. 場景切分在 `tools/scenes.json`（用每場第一句當 anchor），劇本改版後若有警告就更新它
4. 行程編輯 `data/schedule.json`、劇組名單編輯 `data/crew.json`
5. 改完後把 `sw.js` 的 `VERSION` 加一，手機才會更新快取

## 本機預覽
`python3 -m http.server 8000`，開 http://localhost:8000

## 部署
推到 `main` 後由 GitHub Actions 發佈到 GitHub Pages（Settings → Pages → Source 選「GitHub Actions」）。
