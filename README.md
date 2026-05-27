# 面试智练内容仓库

面试智练的公共知识内容源。App 通过 `manifest.json` 发现领域、分类、知识点和资源；新增知识不需要修改 App 代码。

## 目录

- `manifest.json`：正式内容入口。
- `staging-manifest.json`：测试内容入口。
- `draft-manifest.json`：草稿内容入口。
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

## 内容更新流程

### ⚠️ 重要：更新内容后必须更新版本号

App 通过 `manifest.json` 中的 `contentVersion` 字段检测内容是否有更新。如果修改了内容但没有更新版本号，App 会继续使用本地缓存的旧内容！

### 更新步骤

1. **修改内容**（知识点、分类、领域等）
2. **更新版本号**（必须！）
3. **验证内容**：`npm run validate`
4. **提交并推送**

### 更新版本号

修改 `manifest.json`、`staging-manifest.json`、`draft-manifest.json` 中的 `contentVersion`：

```json
{
  "schemaVersion": "1.0.0",
  "contentVersion": "2026.05.28",  // ← 改为今天的日期
  ...
}
```

或使用脚本批量更新：

```bash
# 更新所有 manifest 的版本号
python3 -c "
import json
from datetime import date
version = date.today().strftime('%Y.%m.%d')
for f in ['manifest.json', 'staging-manifest.json', 'draft-manifest.json']:
    try:
        with open(f, 'r') as file:
            data = json.load(file)
        data['contentVersion'] = version
        with open(f, 'w') as file:
            json.dump(data, file, ensure_ascii=False, indent=2)
        print(f'已更新 {f} -> {version}')
    except Exception as e:
        print(f'跳过 {f}: {e}')
"
```

### App 缓存机制

```dart
// App 启动时检查内容版本
final remoteVersion = _manifest?['contentVersion'];
final localVersion = await _storage.load('content_version');

if (remoteVersion != localVersion) {
  // 版本不同，清除缓存并重新加载
  _topics = {};
  await _storage.save('topics_cache', {});
  await _storage.save('content_version', remoteVersion);
}
```

## 内容深度约定

生成脚本会过滤 `今日练习与总结` 这类日程复盘文件，并清理 `学习时间`、`第几天`、`第几阶段` 等排期文案。每个正式 topic 至少包含：

- `explain`：知识全景和关键机制拆解。
- `compareTable` / `diagram` / `code`：对比边界、图示提示或代码抓手，至少一类深度卡片。
- `interviewAnswer`：面试回答模板。
- `checklist`：学完后应能说清楚的检查项。

App 每次加载最新 manifest/domain 后会按引用列表裁剪本地缓存，因此从内容平台删除并发布的 topic 会从用户本地缓存中移除。

## 领域分类规则

### Java 领域

| 分类 ID | 名称 | 关键词 |
|---------|------|--------|
| jvm | JVM | JVM, GC, 类加载, 垃圾回收, 堆内存, 元空间 |
| concurrency | 并发编程 | 并发, 线程, 锁, AQS, ThreadLocal, volatile, synchronized |
| collections | 集合与 Java 基础 | 集合, HashMap, ArrayList, 泛型, 反射, 注解 |
| spring | Spring 生态 | Spring, MyBatis, Nacos, Gateway, OpenFeign, Sentinel |
| database | 数据库与中间件 | MySQL, Redis, RabbitMQ, Kafka, 事务, 索引, SQL |

### Agent 领域

| 分类 ID | 名称 | 关键词 |
|---------|------|--------|
| llm | LLM 基础 | Transformer, 大模型, LLM, Prompt, 注意力机制 |
| rag | RAG 与向量检索 | RAG, 向量, Embedding, 检索, 向量数据库 |
| agent-architecture | Agent 架构 | Agent, MCP, Function Calling, LangChain |
| ai-engineering | AI 工程化 | 工程化, 评估, 观测, 安全, 合规, 项目, Python |

### Algorithm 领域

| 分类 ID | 名称 | 关键词 |
|---------|------|--------|
| array-list | 数组与链表 | 数组, 链表, 数据结构 |
| tree-graph | 树与图 | 二叉树, 图, 最短路径, 设计题 |
| dynamic-programming | 动态规划 | 动态规划, DP, 背包 |
| string-search | 字符串、排序与查找 | 字符串, 排序, 二分, 查找 |
| backtracking | 回溯算法 | 回溯, 搜索, 剪枝, 组合, 排列 |

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

## 常见问题

### Q: 更新了内容但 App 没有显示？

**A:** 检查是否更新了 `manifest.json` 中的 `contentVersion`。App 通过版本号判断是否有内容更新，版本号不变则使用缓存。

### Q: 如何强制刷新 App 缓存？

**A:** 两种方式：
1. 更新 `contentVersion` 并重新部署
2. 在 App 个人中心 → 数据管理 → 清除缓存（如果有此功能）

### Q: 知识点标题显示"高频题目"？

**A:** 内容生成脚本会自动将"高频题目"改为更具体的名称（如"数组基础高频题"）。如果仍有问题，检查源文件是否正确。
