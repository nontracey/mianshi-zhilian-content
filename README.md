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
npm run generate
npm run validate
```

内容规范来自《面试智练内容格式规范》。用户侧知识结构只保留“领域 -> 分类 -> 知识点”，不使用阶段、天数或排期概念。
