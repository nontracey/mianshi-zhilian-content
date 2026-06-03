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

## ⚠️ 创建新领域指南（必读）

### topics 数组必须是文件路径

`domains/{domain}.json` 中每个分类的 `topics` 数组必须包含**相对文件路径**，格式：

```
topics/{domain}/{filename}.json
```

**✅ 正确示例：**

```json
{
  "id": "jvm",
  "title": "JVM",
  "topics": [
    "topics/java/topic-001-ebcc71cb.json",
    "topics/java/topic-002-3bee1565.json"
  ]
}
```

**❌ 常见错误：**

```json
// 错误1: 存的是topic ID
"topics": ["java.jvm.topic-001-ebcc71cb"]

// 错误2: 存的是dict对象
"topics": [{"id": "java.jvm.topic-001", "title": "..."}]

// 错误3: 缺少 topics/ 前缀
"topics": ["java/topic-001-ebcc71cb.json"]
```

### 创建新领域的完整步骤

1. 创建领域JSON: `domains/{domain}.json`（categories.topics 先留空 `[]`）
2. 生成知识点文件: `topics/{domain}/{filename}.json`
3. **重建topics数组**：扫描 `topics/{domain}/` 目录，按order排序后写回路径
4. 更新 `manifest.json` 的 topicCount
5. 运行验证: `python3 scripts/validate_paths.py`

### 自动修复路径脚本

如果发现topics数组格式不对，运行：

```bash
python3 scripts/validate_paths.py --fix
```

---

## 内容更新流程

### ⚠️ 重要：更新内容后必须更新版本号

App 通过 `manifest.json` 中的 `contentVersion` 字段检测内容是否有更新。如果修改了内容但没有更新版本号，App 会继续使用本地缓存的旧内容！

### 更新步骤

1. **修改内容**（知识点、分类、领域等）
2. **更新版本号**（必须！）
3. **验证内容**：`npm run validate`
4. **提交并推送**

### ⚠️ 内容结构同步规则（必读）

当内容结构发生变更时（如新增/删除领域、分类、知识点，修改字段结构等），必须同步更新以下三个项目和相关文档，确保各端一致性：

#### 需要同步的项目

| 项目             | 说明                 | 同步内容                           |
| ---------------- | -------------------- | ---------------------------------- |
| **内容维护平台** | 当前工作区（本仓库） | 内容文件、manifest、schema、文档   |
| **内容平台**     | 独立项目，有 CI 流程 | 内容文件、topics 目录结构、CI 配置 |
| **App 平台**     | 移动端应用           | 内容解析逻辑、缓存机制、版本检测   |

#### 需要同步的文档

| 文档                  | 位置          | 更新内容                     |
| --------------------- | ------------- | ---------------------------- |
| **README.md**         | 本仓库        | 目录结构、字段说明、更新流程 |
| **content-format.md** | docs/ 目录    | 格式规范、字段定义、示例     |
| **schema 文件**       | schemas/ 目录 | JSON Schema 定义             |
| **App 文档**          | App 项目      | 内容解析逻辑、缓存策略       |

#### 同步检查清单

- [ ] 内容维护平台：更新内容文件、manifest、schema
- [ ] 内容平台：同步内容文件、更新 topics 目录结构
- [ ] App 平台：更新内容解析逻辑、缓存机制
- [ ] 文档：更新 README.md、content-format.md、schema 文件
- [ ] 验证：运行 `npm run validate` 确保内容格式正确
- [ ] 测试：在各端测试内容加载和显示

#### 常见同步场景

1. **新增领域**
   - 内容维护平台：创建领域 JSON、知识点文件、更新 manifest
   - 内容平台：同步领域文件、更新 CI 配置
   - App 平台：确保能正确解析新领域
   - 文档：更新领域分类规则、示例

2. **修改知识点结构**
   - 内容维护平台：更新知识点 JSON、schema
   - 内容平台：同步知识点文件
   - App 平台：更新内容解析逻辑
   - 文档：更新字段说明、示例

3. **删除内容**
   - 内容维护平台：删除文件、更新 manifest
   - 内容平台：同步删除
   - App 平台：确保缓存清理机制正常
   - 文档：更新相关说明

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
- `interviewAnswer`：面试回答模板，含 `followUpQuestions` 追问。
- `checklist`：学完后应能说清楚的检查项。

每个 topic 推荐包含：

- `prerequisites`：前置依赖知识点 ID，帮助 App 构建学习路径。
- `interviewFrequency`：面试频率（`high`/`medium`/`low`），帮助学习者优先复习高频考点。
- `interviewerFocus`：面试官关注点，帮助学习者理解考察方向。
- `status`：生产状态（`production`/`draft`）。`npm run validate` 只校验 `production` 状态的知识点。

### 代码格式要求

代码卡片会保留原始 Markdown 中的缩进格式。确保源文件中的代码块有正确的缩进：

````markdown
```java
public class Example {
    private int count;  // 缩进会被保留

    public void method() {
        // 这里的缩进也会保留
        if (count > 0) {
            System.out.println("OK");
        }
    }
}
```
````

**注意**：

- 代码块必须用 ` ``` ` 包裹
- 缩进使用 4 个空格或 Tab
- 生成脚本会自动检测已有缩进，不会重新格式化

App 每次加载最新 manifest/domain 后会按引用列表裁剪本地缓存，因此从内容平台删除并发布的 topic 会从用户本地缓存中移除。

## 领域分类规则

### Java 领域

| 分类 ID     | 名称             | 关键词                                                   |
| ----------- | ---------------- | -------------------------------------------------------- |
| jvm         | JVM              | JVM, GC, 类加载, 垃圾回收, 堆内存, 元空间                |
| concurrency | 并发编程         | 并发, 线程, 锁, AQS, ThreadLocal, volatile, synchronized |
| collections | 集合与 Java 基础 | 集合, HashMap, ArrayList, 泛型, 反射, 注解               |
| spring      | Spring 生态      | Spring, MyBatis, Nacos, Gateway, OpenFeign, Sentinel     |
| database    | 数据库与中间件   | MySQL, Redis, RabbitMQ, Kafka, 事务, 索引, SQL           |

### Agent 领域

| 分类 ID            | 名称           | 关键词                                       |
| ------------------ | -------------- | -------------------------------------------- |
| llm                | LLM 基础       | Transformer, 大模型, LLM, Prompt, 注意力机制 |
| rag                | RAG 与向量检索 | RAG, 向量, Embedding, 检索, 向量数据库       |
| agent-architecture | Agent 架构     | Agent, MCP, Function Calling, LangChain      |
| ai-engineering     | AI 工程化      | 工程化, 评估, 观测, 安全, 合规, 项目, Python |

### Algorithm 领域

| 分类 ID             | 名称               | 关键词                         |
| ------------------- | ------------------ | ------------------------------ |
| array-list          | 数组与链表         | 数组, 链表, 数据结构           |
| tree-graph          | 树与图             | 二叉树, 图, 最短路径, 设计题   |
| dynamic-programming | 动态规划           | 动态规划, DP, 背包             |
| string-search       | 字符串、排序与查找 | 字符串, 排序, 二分, 查找       |
| stack-queue         | 栈与队列           | 栈, 队列, 单调栈, 堆, 优先队列 |
| hash-greedy         | 哈希与贪心         | 哈希表, 贪心, 区间调度         |
| backtracking        | 回溯算法           | 回溯, 搜索, 剪枝, 组合, 排列   |

### 设计模式领域

| 分类 ID    | 名称           | 关键词                               |
| ---------- | -------------- | ------------------------------------ |
| creational | 创建型模式     | 单例, 工厂, 建造者                   |
| structural | 结构型模式     | 代理, 适配器, 装饰器, 门面           |
| behavioral | 行为型模式     | 策略, 模板方法, 观察者, 责任链, 状态 |
| principles | 设计原则与实战 | SOLID, 设计模式在Spring中的应用      |

### 前端八股领域

| 分类 ID               | 名称           | 关键词                                      |
| --------------------- | -------------- | ------------------------------------------- |
| js-fundamentals       | JavaScript基础 | 数据类型, 原型链, 闭包, Event Loop, Promise |
| typescript            | TypeScript     | 类型系统, 泛型, 类型体操                    |
| css-layout            | CSS与布局      | 盒模型, BFC, Flex, Grid                     |
| react                 | React深入      | Fiber, Hooks, 状态管理, 性能优化            |
| vue                   | Vue框架        | 响应式, 组合式API, 编译优化                 |
| nodejs                | Node.js        | 事件循环, 模块系统, Koa, Express            |
| engineering           | 前端工程化     | Webpack, Vite, CI/CD, 监控                  |
| frontend-architecture | 前端架构       | 状态管理, 微前端, 性能优化, 路由            |
| client-dev            | 客户端开发     | Electron, React Native, 跨平台              |
| network-security      | 网络与安全     | HTTP, HTTPS, 跨域, XSS, CSRF                |

### 架构设计领域

| 分类 ID        | 名称         | 关键词                               |
| -------------- | ------------ | ------------------------------------ |
| methodology    | 架构方法论   | DDD, CQRS, 事件驱动, 六边形架构      |
| microservice   | 微服务设计   | 服务拆分, 分布式事务, 分布式锁, 限流 |
| system-design  | 系统设计     | 秒杀, 消息队列, 缓存, 分库分表       |
| project-design | 项目架构设计 | 多租户, 低代码, API网关              |

### .NET 开发领域

| 分类 ID             | 名称                | 关键词                                     |
| ------------------- | ------------------- | ------------------------------------------ |
| csharp              | C# 语言基础         | 类型系统, LINQ, async/await, 泛型, 反射    |
| dotnet-core         | .NET Core / .NET 8+ | 依赖注入, 中间件, 配置, 日志, GC           |
| aspnet              | ASP.NET Core        | Web API, 过滤器, 认证授权, SignalR         |
| ef-core             | EF Core 与数据库    | ORM, 迁移, 性能, 仓储模式, 多租户          |
| client              | 客户端开发          | WPF, MAUI, Avalonia, XAML绑定              |
| microservice-dotnet | .NET 微服务         | gRPC, MassTransit, Polly, Ocelot           |
| advanced            | 高级主题            | 性能调优, 内存管理, 设计模式, .NET vs Java |

## 部署

内容站通过 GitHub Actions + Wrangler CLI 部署到 Cloudflare Pages。`main` push 时自动触发：

> **⚠️ 提交信息规范**：Cloudflare Pages API 不接受中文顿号 `、` 等特殊 Unicode 字符。请使用英文逗号 `,` 或其他 ASCII 标点替代。

1. `npm ci && npm run validate` 校验内容
2. 准备 `dist/` 目录
3. `wrangler pages deploy dist --project-name=mianshi-zhilian-content` 部署

### 必需配置

- GitHub Secret `CLOUDFLARE_API_TOKEN`：需要 `Cloudflare Pages:Edit` 权限
- GitHub Variable `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账号 ID

正式内容入口：

```text
主用:

https://mianshi-zhilian-content.pages.dev/manifest.json

备用:

https://mianshizhilian-content.nontracey.de5.net/manifest.json

两个域名必须指向同一份 `dist/` 产物，`manifest.json`、`staging-manifest.json`、`draft-manifest.json`、`domains/`、`topics/`、`schemas/`、`assets/` 路径需要保持一致。部署 workflow 会在发布后检查主备 manifest 路径可访问。
```

## 常见问题

### Q: 更新了内容但 App 没有显示？

**A:** 检查是否更新了 `manifest.json` 中的 `contentVersion`。App 通过版本号判断是否有内容更新，版本号不变则使用缓存。

### Q: 如何强制刷新 App 缓存？

**A:** 两种方式：

1. 更新 `contentVersion` 并重新部署（App 下次启动会自动检测）
2. 在 App **个人中心 → 知识源配置 → 应用并重载**（立即清空缓存并重新加载）

### Q: 切换领域后内容没有更新？

**A:** App 按领域独立缓存，切换领域时会检查该领域是否需要刷新：

- 如果内容版本有更新，会从网络重新加载
- 如果版本没有变化，使用本地缓存
- 可以点击"应用并重载"强制刷新所有领域

### Q: 删除的领域还显示在 App 中？

**A:** 内容版本更新时，App 会自动清理已删除领域的本地缓存。如果没有自动清理，可以点击"应用并重载"手动清空。

### Q: 知识点标题显示"高频题目"？

**A:** 内容生成脚本会自动将"高频题目"改为更具体的名称（如"数组基础高频题"）。如果仍有问题，检查源文件是否正确。
