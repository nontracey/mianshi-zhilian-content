# 面试智练内容仓库

面试智练的公共知识内容源。App 通过 `manifest.json` 发现领域、分类、知识点和资源；新增知识不需要修改 App 代码。

## 目录

- `manifest.json`：正式内容入口。
- `staging-manifest.json`：测试内容入口。
- `domains/`：领域与分类定义。
- `topics/`：知识点 JSON。
- `schemas/`：内容 schema。
- `scripts/`：内容生成与校验脚本。

## 本地命令

```bash
npm install
npm run generate  # 需要设置 CONTENT_SOURCE_ROOT 环境变量指向原始 Markdown 目录
npm run validate
```

内容规范来自《面试智练内容格式规范》。用户侧知识结构只保留"领域 -> 分类 -> 知识点"，不使用阶段、天数或排期概念。

## 部署

内容站通过 GitHub Actions + Wrangler CLI 部署到 Cloudflare Pages。`main` push 时自动触发：

1. `npm ci && npm run validate` 校验内容
2. 准备 `dist/` 目录
3. `wrangler pages deploy dist --project-name=mianshi-zhilian-content` 部署

### 必需配置

- GitHub Secret `CLOUDFLARE_API_TOKEN`：需要 `Cloudflare Pages:Edit` 权限
- GitHub Variable `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账号 ID

正式内容入口：

```text
https://mianshi-zhilian-content.pages.dev/manifest.json
```
