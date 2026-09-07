# AVPlayPro 云端资讯服务

1. `cd cloud/news-service && npm install`
2. 创建 D1 数据库：`npx wrangler d1 create avplay-news`，把返回的 `database_id` 填进 `wrangler.toml`。
3. 执行迁移：`npm run db:migrate`。
4. 设置密钥：`npx wrangler secret put ADMIN_TOKEN`，以及可选的 `CLIENT_TOKEN`。
5. 部署：`npm run deploy`。

通过 `PUT /api/admin/sources` 添加 RSS 或 HTML 源，需传 `X-News-Admin-Key`。客户端使用 `GET /api/news`，如设置了 `CLIENT_TOKEN` 则传 `X-News-Key`。新闻条目仅存元数据、短摘要和原文链接，不镜像正文。

示例（将地址和密钥替换为自己的）：

```bash
curl -X PUT "https://YOUR_WORKER.workers.dev/api/admin/sources" \
  -H "X-News-Admin-Key: YOUR_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  --data '{"name":"官方新闻","url":"https://example.com/feed.xml","type":"rss","refresh_minutes":120}'

curl -X POST "https://YOUR_WORKER.workers.dev/api/admin/refresh" \
  -H "X-News-Admin-Key: YOUR_ADMIN_TOKEN"
```
