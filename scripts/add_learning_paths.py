#!/usr/bin/env python3
"""
Phase 3: Add learning paths and prerequisites to domain files and topics.
Also handles content dedup and code recall prompts.
"""
import json
import os
import glob
import re

CONTENT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def read_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def write_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')

# ============================================================
# 1. Learning paths per domain
# ============================================================

LEARNING_PATHS = {
    "java": {
        "id": "java-backend",
        "title": "Java 后端面试路线",
        "description": "从 JVM 基础到中间件，按依赖关系逐步深入",
        "steps": [
            {
                "title": "JVM 基础",
                "description": "理解内存区域、GC 机制、类加载",
                "categoryIds": ["jvm"],
                "estimatedHours": 4,
            },
            {
                "title": "Java 基础与集合",
                "description": "集合框架、泛型、反射、语言特性",
                "categoryIds": ["java-fundamentals"],
                "estimatedHours": 3,
            },
            {
                "title": "并发编程",
                "description": "线程、锁、线程池、并发容器",
                "categoryIds": ["concurrency"],
                "estimatedHours": 5,
                "prerequisiteSteps": ["JVM 基础"],
            },
            {
                "title": "Java 新特性",
                "description": "Lambda、Stream、Virtual Threads 等",
                "categoryIds": ["new-features"],
                "estimatedHours": 2,
                "prerequisiteSteps": ["Java 基础与集合"],
            },
            {
                "title": "Spring 生态",
                "description": "IoC、AOP、Boot、Cloud、MyBatis",
                "categoryIds": ["spring"],
                "estimatedHours": 6,
                "prerequisiteSteps": ["并发编程"],
            },
            {
                "title": "数据库",
                "description": "MySQL 索引、事务、锁、优化",
                "categoryIds": ["database"],
                "estimatedHours": 4,
            },
            {
                "title": "中间件",
                "description": "Redis、RabbitMQ、Kafka、分布式锁",
                "categoryIds": ["middleware"],
                "estimatedHours": 5,
                "prerequisiteSteps": ["数据库", "并发编程"],
            },
        ],
    },
    "agent": {
        "id": "agent-dev",
        "title": "Agent 开发面试路线",
        "description": "从 LLM 基础到 Agent 工程化",
        "steps": [
            {
                "title": "LLM 基础",
                "description": "Transformer、训练推理、Prompt 工程",
                "categoryIds": ["llm"],
                "estimatedHours": 4,
            },
            {
                "title": "RAG 与向量检索",
                "description": "RAG 架构、向量数据库、检索策略",
                "categoryIds": ["rag"],
                "estimatedHours": 3,
                "prerequisiteSteps": ["LLM 基础"],
            },
            {
                "title": "Agent 架构",
                "description": "Agent 设计、MCP、Function Calling",
                "categoryIds": ["agent-architecture"],
                "estimatedHours": 3,
                "prerequisiteSteps": ["LLM 基础"],
            },
            {
                "title": "AI 工程化",
                "description": "评估、缓存、成本、安全",
                "categoryIds": ["ai-engineering"],
                "estimatedHours": 3,
                "prerequisiteSteps": ["Agent 架构"],
            },
        ],
    },
    "algorithm": {
        "id": "algo-interview",
        "title": "算法面试路线",
        "description": "从基础数据结构到高级算法",
        "steps": [
            {
                "title": "数组与链表",
                "description": "基础数据结构、双指针、滑动窗口",
                "categoryIds": ["array-list"],
                "estimatedHours": 3,
            },
            {
                "title": "栈与队列",
                "description": "栈、队列、单调栈、堆",
                "categoryIds": ["stack-queue"],
                "estimatedHours": 2,
            },
            {
                "title": "哈希与贪心",
                "description": "哈希表、贪心算法",
                "categoryIds": ["hash-greedy"],
                "estimatedHours": 2,
            },
            {
                "title": "树与图",
                "description": "二叉树遍历、图算法",
                "categoryIds": ["tree-graph"],
                "estimatedHours": 3,
                "prerequisiteSteps": ["栈与队列"],
            },
            {
                "title": "字符串、排序与查找",
                "description": "字符串技巧、排序、二分",
                "categoryIds": ["string-search"],
                "estimatedHours": 2,
                "prerequisiteSteps": ["数组与链表"],
            },
            {
                "title": "动态规划",
                "description": "状态定义、转移方程、空间优化",
                "categoryIds": ["dynamic-programming"],
                "estimatedHours": 3,
                "prerequisiteSteps": ["数组与链表", "树与图"],
            },
            {
                "title": "回溯算法",
                "description": "回溯基础、组合排列、剪枝",
                "categoryIds": ["backtracking"],
                "estimatedHours": 2,
                "prerequisiteSteps": ["树与图", "动态规划"],
            },
        ],
    },
    "frontend": {
        "id": "frontend-interview",
        "title": "前端面试路线",
        "description": "从 JS 基础到框架深入",
        "steps": [
            {
                "title": "JavaScript 基础",
                "description": "数据类型、原型链、闭包、异步",
                "categoryIds": ["js-fundamentals"],
                "estimatedHours": 4,
            },
            {
                "title": "TypeScript",
                "description": "类型系统、泛型、类型体操",
                "categoryIds": ["typescript"],
                "estimatedHours": 2,
                "prerequisiteSteps": ["JavaScript 基础"],
            },
            {
                "title": "CSS 与布局",
                "description": "盒模型、Flex、Grid、响应式",
                "categoryIds": ["css-layout"],
                "estimatedHours": 2,
            },
            {
                "title": "React 深入",
                "description": "Fiber、Hooks、状态管理、性能优化",
                "categoryIds": ["react"],
                "estimatedHours": 4,
                "prerequisiteSteps": ["JavaScript 基础", "TypeScript"],
            },
            {
                "title": "Vue 框架",
                "description": "响应式原理、编译优化、生态",
                "categoryIds": ["vue"],
                "estimatedHours": 3,
                "prerequisiteSteps": ["JavaScript 基础"],
            },
            {
                "title": "Node.js",
                "description": "事件循环、模块系统、Koa/Express",
                "categoryIds": ["nodejs"],
                "estimatedHours": 3,
                "prerequisiteSteps": ["JavaScript 基础"],
            },
            {
                "title": "前端工程化",
                "description": "Webpack、Vite、CI/CD、监控",
                "categoryIds": ["engineering"],
                "estimatedHours": 3,
                "prerequisiteSteps": ["Node.js"],
            },
            {
                "title": "前端架构",
                "description": "状态管理、微前端、性能优化",
                "categoryIds": ["frontend-architecture"],
                "estimatedHours": 3,
                "prerequisiteSteps": ["React 深入", "前端工程化"],
            },
            {
                "title": "客户端开发",
                "description": "Electron、React Native、跨平台",
                "categoryIds": ["client-dev"],
                "estimatedHours": 2,
                "prerequisiteSteps": ["React 深入"],
            },
            {
                "title": "网络与安全",
                "description": "HTTP/HTTPS、跨域、XSS/CSRF",
                "categoryIds": ["network-security"],
                "estimatedHours": 2,
            },
        ],
    },
    "design-pattern": {
        "id": "design-pattern-interview",
        "title": "设计模式面试路线",
        "description": "从创建型到行为型，结合 Spring 实战",
        "steps": [
            {
                "title": "设计原则",
                "description": "SOLID 原则",
                "categoryIds": ["principles"],
                "estimatedHours": 1,
            },
            {
                "title": "创建型模式",
                "description": "单例、工厂、建造者",
                "categoryIds": ["creational"],
                "estimatedHours": 2,
                "prerequisiteSteps": ["设计原则"],
            },
            {
                "title": "结构型模式",
                "description": "代理、适配器、装饰器、门面",
                "categoryIds": ["structural"],
                "estimatedHours": 2,
                "prerequisiteSteps": ["设计原则"],
            },
            {
                "title": "行为型模式",
                "description": "策略、模板方法、观察者、责任链、状态",
                "categoryIds": ["behavioral"],
                "estimatedHours": 3,
                "prerequisiteSteps": ["创建型模式", "结构型模式"],
            },
        ],
    },
    "dotnet": {
        "id": "dotnet-interview",
        "title": ".NET 开发面试路线",
        "description": "从 C# 基础到微服务",
        "steps": [
            {
                "title": "C# 语言基础",
                "description": "类型系统、LINQ、异步、泛型",
                "categoryIds": ["csharp"],
                "estimatedHours": 4,
            },
            {
                "title": ".NET Core / .NET 8+",
                "description": "DI、中间件、配置、日志、GC",
                "categoryIds": ["dotnet-core"],
                "estimatedHours": 4,
                "prerequisiteSteps": ["C# 语言基础"],
            },
            {
                "title": "ASP.NET Core",
                "description": "Web API、过滤器、认证授权",
                "categoryIds": ["aspnet"],
                "estimatedHours": 4,
                "prerequisiteSteps": [".NET Core / .NET 8+"],
            },
            {
                "title": "EF Core 与数据库",
                "description": "ORM、迁移、性能、仓储模式",
                "categoryIds": ["ef-core"],
                "estimatedHours": 3,
                "prerequisiteSteps": ["ASP.NET Core"],
            },
            {
                "title": "客户端开发",
                "description": "WPF、MAUI、Avalonia",
                "categoryIds": ["client"],
                "estimatedHours": 3,
                "prerequisiteSteps": ["C# 语言基础"],
            },
            {
                "title": ".NET 微服务",
                "description": "gRPC、消息队列、容器化",
                "categoryIds": ["microservice-dotnet"],
                "estimatedHours": 3,
                "prerequisiteSteps": ["ASP.NET Core", "EF Core 与数据库"],
            },
            {
                "title": "高级主题",
                "description": "性能调优、设计模式、.NET vs Java",
                "categoryIds": ["advanced"],
                "estimatedHours": 2,
                "prerequisiteSteps": [".NET 微服务"],
            },
        ],
    },
    "os": {
        "id": "os-interview",
        "title": "操作系统面试路线",
        "description": "从进程线程到 IO 模型",
        "steps": [
            {
                "title": "进程与线程",
                "description": "进程线程模型、同步、死锁",
                "categoryIds": ["process-thread"],
                "estimatedHours": 3,
            },
            {
                "title": "内存管理",
                "description": "虚拟内存、分页、页面置换",
                "categoryIds": ["memory-management"],
                "estimatedHours": 3,
                "prerequisiteSteps": ["进程与线程"],
            },
            {
                "title": "IO 模型",
                "description": "阻塞/非阻塞、多路复用、Reactor",
                "categoryIds": ["io-model"],
                "estimatedHours": 3,
                "prerequisiteSteps": ["进程与线程"],
            },
            {
                "title": "Linux 基础",
                "description": "常用命令、文件权限、进程管理",
                "categoryIds": ["linux-basics"],
                "estimatedHours": 2,
            },
        ],
    },
    "network": {
        "id": "network-interview",
        "title": "计算机网络面试路线",
        "description": "从 TCP 到 WebSocket",
        "steps": [
            {
                "title": "TCP/UDP 协议",
                "description": "三次握手、四次挥手、可靠传输",
                "categoryIds": ["tcp-udp"],
                "estimatedHours": 3,
            },
            {
                "title": "HTTP/HTTPS",
                "description": "协议演进、加密原理、状态码",
                "categoryIds": ["http-https"],
                "estimatedHours": 3,
                "prerequisiteSteps": ["TCP/UDP 协议"],
            },
            {
                "title": "DNS 与 CDN",
                "description": "域名解析、CDN 加速",
                "categoryIds": ["dns-cdn"],
                "estimatedHours": 1,
                "prerequisiteSteps": ["HTTP/HTTPS"],
            },
            {
                "title": "WebSocket",
                "description": "全双工通信、与长轮询对比",
                "categoryIds": ["websocket"],
                "estimatedHours": 1,
                "prerequisiteSteps": ["HTTP/HTTPS"],
            },
        ],
    },
    "architecture": {
        "id": "architecture-interview",
        "title": "架构设计面试路线",
        "description": "从方法论到系统设计",
        "steps": [
            {
                "title": "架构方法论",
                "description": "DDD、CQRS、事件驱动、六边形架构",
                "categoryIds": ["methodology"],
                "estimatedHours": 3,
            },
            {
                "title": "微服务设计",
                "description": "服务拆分、分布式事务、限流",
                "categoryIds": ["microservice"],
                "estimatedHours": 4,
                "prerequisiteSteps": ["架构方法论"],
            },
            {
                "title": "系统设计",
                "description": "秒杀、消息队列、缓存、分库分表",
                "categoryIds": ["system-design"],
                "estimatedHours": 4,
                "prerequisiteSteps": ["微服务设计"],
            },
            {
                "title": "项目架构设计",
                "description": "多租户、低代码、API 网关",
                "categoryIds": ["project-design"],
                "estimatedHours": 3,
                "prerequisiteSteps": ["系统设计"],
            },
        ],
    },
}


# ============================================================
# 2. Prerequisites per topic (category-level)
# ============================================================

CATEGORY_PREREQUISITES = {
    # Java
    "jvm": [],
    "concurrency": ["jvm"],
    "java-fundamentals": [],
    "spring": ["jvm", "concurrency"],
    "database": [],
    "middleware": ["database", "concurrency"],
    "new-features": ["java-fundamentals"],
    
    # Agent
    "llm": [],
    "rag": ["llm"],
    "agent-architecture": ["llm"],
    "ai-engineering": ["agent-architecture"],
    
    # Algorithm
    "array-list": [],
    "stack-queue": [],
    "hash-greedy": [],
    "tree-graph": ["stack-queue"],
    "string-search": ["array-list"],
    "dynamic-programming": ["array-list", "tree-graph"],
    "backtracking": ["tree-graph", "dynamic-programming"],
    
    # Design pattern
    "principles": [],
    "creational": ["principles"],
    "structural": ["principles"],
    "behavioral": ["creational", "structural"],
    
    # Frontend
    "js-fundamentals": [],
    "typescript": ["js-fundamentals"],
    "css-layout": [],
    "react": ["js-fundamentals", "typescript"],
    "vue": ["js-fundamentals"],
    "nodejs": ["js-fundamentals"],
    "engineering": ["nodejs"],
    "frontend-architecture": ["react", "engineering"],
    "client-dev": ["react"],
    "network-security": [],
    
    # .NET
    "csharp": [],
    "dotnet-core": ["csharp"],
    "aspnet": ["dotnet-core"],
    "ef-core": ["aspnet"],
    "client": ["csharp"],
    "microservice-dotnet": ["aspnet", "ef-core"],
    "advanced": ["microservice-dotnet"],
    
    # OS
    "process-thread": [],
    "memory-management": ["process-thread"],
    "io-model": ["process-thread"],
    "linux-basics": [],
    
    # Network
    "tcp-udp": [],
    "http-https": ["tcp-udp"],
    "dns-cdn": ["http-https"],
    "websocket": ["http-https"],
    
    # Architecture
    "methodology": [],
    "microservice": ["methodology"],
    "system-design": ["microservice"],
    "project-design": ["system-design"],
}


def add_learning_paths_to_domains():
    """Add learning paths to domain files"""
    count = 0
    for domain_id, path_data in LEARNING_PATHS.items():
        domain_path = os.path.join(CONTENT_ROOT, f"domains/{domain_id}.json")
        if not os.path.exists(domain_path):
            continue
        
        domain = read_json(domain_path)
        domain["learningPaths"] = [path_data]
        
        # Add prerequisites to categories
        for cat in domain.get("categories", []):
            cat_id = cat.get("id", "")
            prereqs = CATEGORY_PREREQUISITES.get(cat_id, [])
            if prereqs:
                cat["prerequisites"] = prereqs
        
        write_json(domain_path, domain)
        count += 1
    
    return count


# ============================================================
# 3. Content dedup: merge duplicate explain cards
# ============================================================

def dedup_topic(filepath):
    """Remove duplicate explain cards within a topic"""
    topic = read_json(filepath)
    cards = topic.get("learningCards", [])
    
    if len(cards) < 2:
        return False
    
    # Find consecutive explain cards with overlapping content
    new_cards = []
    skip_indices = set()
    
    for i, card in enumerate(cards):
        if i in skip_indices:
            continue
        
        if card.get("type") != "explain":
            new_cards.append(card)
            continue
        
        # Check if next card is also explain with overlapping content
        content = card.get("content", "")
        content_lines = set(line.strip() for line in content.split("\n") if line.strip())
        
        # Look ahead for duplicates
        merged = False
        for j in range(i + 1, min(i + 3, len(cards))):
            if j in skip_indices:
                continue
            next_card = cards[j]
            if next_card.get("type") != "explain":
                break
            
            next_content = next_card.get("content", "")
            next_lines = set(line.strip() for line in next_content.split("\n") if line.strip())
            
            # Calculate overlap
            if content_lines and next_lines:
                overlap = len(content_lines & next_lines) / min(len(content_lines), len(next_lines))
                if overlap > 0.6:  # 60% overlap threshold
                    # Keep the longer one
                    if len(next_content) > len(content):
                        new_cards[-1] = next_card if new_cards and new_cards[-1] == card else card
                    skip_indices.add(j)
                    merged = True
        
        if not merged:
            new_cards.append(card)
    
    if len(new_cards) < len(cards):
        topic["learningCards"] = new_cards
        write_json(filepath, topic)
        return True
    
    return False


# ============================================================
# 4. Add code-mode recall prompts
# ============================================================

CODE_RECALL_PROMPTS = {
    "algorithm": {
        "array-list": [
            {"prompt": "请手写一个滑动窗口模板，解决「最长无重复子串」问题", "difficulty": 3},
            {"prompt": "请手写两数之和的哈希表解法", "difficulty": 2},
            {"prompt": "请手写三数之和的排序+双指针解法，注意去重", "difficulty": 3},
        ],
        "tree-graph": [
            {"prompt": "请手写二叉树的层序遍历（BFS）", "difficulty": 2},
            {"prompt": "请手写二叉树的前序遍历迭代写法", "difficulty": 3},
        ],
        "dynamic-programming": [
            {"prompt": "请手写背包问题的状态转移方程和代码", "difficulty": 3},
            {"prompt": "请手写最长递增子序列（LIS）的动态规划解法", "difficulty": 3},
        ],
        "string-search": [
            {"prompt": "请手写二分查找的模板代码", "difficulty": 2},
        ],
        "stack-queue": [
            {"prompt": "请手写用两个栈实现队列", "difficulty": 2},
            {"prompt": "请手写单调栈解决「下一个更大元素」问题", "difficulty": 3},
        ],
        "hash-greedy": [
            {"prompt": "请手写贪心算法解决「跳跃游戏」问题", "difficulty": 3},
        ],
        "backtracking": [
            {"prompt": "请手写回溯算法解决「全排列」问题", "difficulty": 3},
            {"prompt": "请手写回溯算法解决「组合总和」问题", "difficulty": 3},
        ],
    },
    "frontend": {
        "js-fundamentals": [
            {"prompt": "请手写一个通用的类型判断函数 getType(value)", "difficulty": 2},
            {"prompt": "请手写 Promise.all 的实现", "difficulty": 4},
            {"prompt": "请手写一个防抖(debounce)函数", "difficulty": 2},
            {"prompt": "请手写一个节流(throttle)函数", "difficulty": 2},
        ],
        "typescript": [
            {"prompt": "请手写一个 DeepPartial 工具类型", "difficulty": 3},
        ],
        "react": [
            {"prompt": "请手写一个简单的 useEffect 实现（核心逻辑）", "difficulty": 4},
            {"prompt": "请手写一个自定义 Hook: useDebounce", "difficulty": 3},
        ],
    },
    "java": {
        "concurrency": [
            {"prompt": "请手写一个线程安全的单例模式（DCL）", "difficulty": 3},
            {"prompt": "请手写一个生产者-消费者模型", "difficulty": 3},
            {"prompt": "请手写一个自定义线程池的核心逻辑", "difficulty": 4},
        ],
        "jvm": [
            {"prompt": "请画出 JVM 运行时数据区的结构图并说明各区域作用", "difficulty": 2},
        ],
    },
}


def add_code_recall_prompts():
    """Add code-mode recall prompts to algorithm and frontend topics"""
    count = 0
    
    for domain_id, categories in CODE_RECALL_PROMPTS.items():
        topics_dir = os.path.join(CONTENT_ROOT, f"topics/{domain_id}")
        if not os.path.isdir(topics_dir):
            continue
        
        for fpath in glob.glob(os.path.join(topics_dir, "*.json")):
            try:
                topic = read_json(fpath)
                category = topic.get("category", "")
                
                if category not in categories:
                    continue
                
                # Check if already has code-mode recall prompts
                existing = topic.get("recallPrompts", [])
                has_code = any(p.get("mode") == "code" for p in existing)
                if has_code:
                    continue
                
                # Add code-mode prompts
                code_prompts = categories[category]
                for i, prompt_data in enumerate(code_prompts):
                    prompt_id = f"{topic.get('id', '')}.code.{i+1}"
                    existing.append({
                        "id": prompt_id,
                        "prompt": prompt_data["prompt"],
                        "mode": "code",
                        "expectedMinutes": 10,
                        "difficulty": prompt_data["difficulty"],
                    })
                
                topic["recallPrompts"] = existing
                write_json(fpath, topic)
                count += 1
                
            except Exception as e:
                print(f"  ⚠️ Error: {os.path.basename(fpath)}: {e}")
    
    return count


if __name__ == "__main__":
    print("🚀 Phase 3: Learning paths, dedup, and code recall prompts...")
    print()
    
    print("📚 Adding learning paths to domains...")
    path_count = add_learning_paths_to_domains()
    print(f"  ✅ Added learning paths to {path_count} domains")
    
    print("\n🔍 Deduplicating explain cards...")
    dedup_count = 0
    manifest = read_json(os.path.join(CONTENT_ROOT, "manifest.json"))
    for domain_entry in manifest.get("domains", []):
        domain_id = domain_entry["id"]
        topics_dir = os.path.join(CONTENT_ROOT, f"topics/{domain_id}")
        if not os.path.isdir(topics_dir):
            continue
        for fpath in glob.glob(os.path.join(topics_dir, "*.json")):
            if dedup_topic(fpath):
                dedup_count += 1
    print(f"  ✅ Deduplicated {dedup_count} topics")
    
    print("\n💻 Adding code-mode recall prompts...")
    code_count = add_code_recall_prompts()
    print(f"  ✅ Added code prompts to {code_count} topics")
    
    print(f"\n✅ Phase 3 complete!")
