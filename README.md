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

## 内容深度约定

生成脚本会过滤 `今日练习与总结` 这类日程复盘文件，并清理 `学习时间`、`第几天`、`第几阶段` 等排期文案。每个正式 topic 至少包含：

- `explain`：知识全景和关键机制拆解。
- `compareTable` / `diagram` / `code`：对比边界、图示提示或代码抓手，至少一类深度卡片。
- `interviewAnswer`：面试回答模板。
- `checklist`：学完后应能说清楚的检查项。

App 每次加载最新 manifest/domain 后会按引用列表裁剪本地缓存，因此从内容平台删除并发布的 topic 会从用户本地缓存中移除。

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
