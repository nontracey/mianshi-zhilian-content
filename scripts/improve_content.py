#!/usr/bin/env python3
"""
Phase 1 structural improvements for all topics:
- Fix difficulty distribution
- Fix estimatedMinutes
- Fix learning order within categories
- Fix draft → production status
- Fix category misplacements
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
# 1. Difficulty calibration based on content analysis
# ============================================================

def estimate_difficulty(topic):
    """Estimate difficulty based on content complexity indicators"""
    title = topic.get("title", "")
    summary = topic.get("summary", "")
    cards = topic.get("learningCards", [])
    
    # Gather all text content
    all_text = title + " " + summary
    for card in cards:
        all_text += " " + card.get("content", "")
        all_text += " " + card.get("title", "")
    
    score = 0
    
    # Advanced concepts boost
    advanced_keywords = [
        "源码", "底层", "原理", "架构", "分布式", "高并发", "性能优化",
        "JIT", "字节码", "AQS", "happens-before", "内存屏障", "指令重排",
        "volatile", "synchronized底层", "Reactor", "背压", "热重启",
        "分库分表", "分布式事务", "一致性", "CAP", "Paxos", "Raft",
        "Transformer", "注意力机制", "微调", "Fine-tuning", "LoRA",
        "虚拟线程", "Virtual Threads", "协程", "Coroutine",
        "DDD", "CQRS", "事件溯源", "Event Sourcing",
        "Fiber", "reconciliation", "Concurrent",
        "GC调优", "类加载器", "字节码增强", "Agent", "Attach",
        "泛型", "协变", "逆变", "反射", "动态代理",
        "缓存穿透", "缓存雪崩", "缓存击穿", "布隆过滤器",
        "零拷贝", "mmap", "epoll", "IO多路复用",
        "死锁", "活锁", "饥饿", "线程安全",
    ]
    
    intermediate_keywords = [
        "对比", "区别", "深入", "进阶", "优化", "策略",
        "Spring Boot", "Spring Cloud", "MyBatis",
        "Redis", "Kafka", "RabbitMQ", "MQ",
        "事务", "索引", "SQL优化", "慢查询",
        "React Hooks", "Vue响应式", "状态管理",
        "Webpack", "Vite", "工程化",
        "设计模式", "单例", "工厂", "代理",
        "双指针", "滑动窗口", "动态规划", "回溯",
        "TCP", "HTTP", "HTTPS", "WebSocket",
        "进程", "线程", "锁", "同步",
    ]
    
    beginner_keywords = [
        "基础", "概述", "入门", "简介", "什么是",
        "数据类型", "变量", "函数", "数组基础",
        "Hello", "第一个", "快速开始",
        "Linux基础", "常用命令", "文件权限",
    ]
    
    for kw in advanced_keywords:
        if kw in all_text:
            score += 2
    
    for kw in intermediate_keywords:
        if kw in all_text:
            score += 1
    
    for kw in beginner_keywords:
        if kw in all_text:
            score -= 1
    
    # Content length factor
    total_length = len(all_text)
    if total_length > 3000:
        score += 2
    elif total_length > 1500:
        score += 1
    
    # Number of cards factor
    if len(cards) >= 8:
        score += 1
    
    # Code complexity
    code_cards = [c for c in cards if c.get("type") == "code"]
    for cc in code_cards:
        code_content = cc.get("content", "")
        if len(code_content) > 500:
            score += 1
        if any(kw in code_content for kw in ["synchronized", "volatile", "async", "await", "Concurrent", "Lock"]):
            score += 1
    
    # Map score to difficulty
    if score <= 0:
        return 1
    elif score <= 2:
        return 2
    elif score <= 5:
        return 3
    elif score <= 8:
        return 4
    else:
        return 5


def estimate_minutes(topic):
    """Estimate reading time based on content length"""
    cards = topic.get("learningCards", [])
    total_chars = 0
    for card in cards:
        content = card.get("content", "")
        items = card.get("items", [])
        total_chars += len(content)
        for item in items:
            total_chars += len(item)
    
    # Average reading speed: ~400 chars/min for technical content in Chinese
    # Plus extra time for code understanding
    code_chars = sum(len(c.get("content", "")) for c in cards if c.get("type") == "code")
    text_chars = total_chars - code_chars
    
    minutes = (text_chars / 400) + (code_chars / 200)  # Code takes longer to understand
    minutes = max(10, min(45, round(minutes / 5) * 5))  # Round to 5, clamp 10-45
    return minutes


# ============================================================
# 2. Learning order within categories
# ============================================================

# Define ideal ordering keywords per category
CATEGORY_ORDER_HINTS = {
    # Java
    "jvm": ["概述", "内存", "堆", "栈", "GC", "垃圾回收", "类加载", "调优", "JIT", "字节码"],
    "concurrency": ["基础", "理论", "线程", "创建", "锁", "synchronized", "volatile", "AQS", "线程池", "并发容器", "CompletableFuture", "ThreadLocal"],
    "collections": ["集合", "HashMap", "ArrayList", "泛型", "反射", "注解"],
    "spring": ["概述", "IoC", "DI", "AOP", "Bean", "生命周期", "Boot", "Cloud", "MyBatis", "事务", "Security"],
    "database": ["索引", "事务", "锁", "SQL", "优化", "分库", "分表"],
    "middleware": ["Redis", "RabbitMQ", "Kafka", "分布式锁", "消息队列"],
    "new-features": ["Lambda", "Stream", "Optional", "DateTime", "Record", "Sealed", "Pattern", "Virtual"],
    
    # Agent
    "llm": ["Transformer", "注意力", "训练", "推理", "Tokenizer", "Prompt", "上下文", "幻觉"],
    "rag": ["RAG", "向量", "Embedding", "检索", "分块", "重排序"],
    "agent-architecture": ["Agent", "MCP", "Function Calling", "多Agent", "编排"],
    "ai-engineering": ["评估", "缓存", "成本", "安全", "观测"],
    
    # Algorithm
    "array-list": ["数组基础", "链表基础", "双指针", "滑动窗口", "前缀和"],
    "tree-graph": ["二叉树", "遍历", "图", "BFS", "DFS", "最短路径"],
    "dynamic-programming": ["基础", "背包", "区间", "状态压缩"],
    "string-search": ["字符串", "排序", "二分", "KMP"],
    "stack-queue": ["栈", "队列", "单调栈", "堆", "优先队列"],
    "hash-greedy": ["哈希", "贪心", "区间"],
    "backtracking": ["回溯基础", "组合", "排列", "剪枝"],
    
    # Design pattern
    "creational": ["单例", "工厂", "建造者"],
    "structural": ["代理", "适配器", "装饰器", "门面"],
    "behavioral": ["策略", "模板方法", "观察者", "责任链", "状态"],
    "principles": ["SOLID", "Spring"],
    
    # Frontend
    "js-fundamentals": ["数据类型", "原型链", "闭包", "Event Loop", "Promise"],
    "typescript": ["基础类型", "泛型", "类型体操", "配置"],
    "css-layout": ["盒模型", "Flex", "Grid", "响应式"],
    "react": ["核心", "Fiber", "Hooks", "状态管理", "性能", "路由", "React18"],
    "vue": ["响应式", "生命周期", "编译", "生态"],
    "nodejs": ["核心", "模块", "Koa", "Express", "工程"],
    "engineering": ["Webpack", "Vite", "CI/CD", "监控"],
    "frontend-architecture": ["状态管理", "微前端", "性能", "路由", "BFF"],
    "client-dev": ["Electron", "React Native", "跨平台", "移动端适配"],
    "network-security": ["HTTP", "跨域", "安全"],
    
    # .NET
    "csharp": ["类型系统", "LINQ", "async", "泛型", "反射"],
    "dotnet-core": ["依赖注入", "中间件", "配置", "日志", "运行时"],
    "aspnet": ["Web API", "过滤器", "认证", "SignalR", "性能"],
    "ef-core": ["基础", "性能", "仓储", "多租户"],
    "client": ["WPF", "MAUI", "Avalonia", "XAML", "架构"],
    "microservice-dotnet": ["gRPC", "消息队列", "通信", "容器化"],
    "advanced": ["性能诊断", "设计模式", "Java对比"],
    
    # OS
    "process-thread": ["进程线程", "IPC", "同步", "死锁", "协程"],
    "memory-management": ["虚拟内存", "分页", "页面置换", "内存泄漏"],
    "io-model": ["IO模型", "select", "poll", "epoll", "Reactor"],
    "linux-basics": ["命令", "文件权限", "进程管理"],
    
    # Network
    "tcp-udp": ["握手", "可靠传输", "流量控制", "TCP vs UDP", "粘包"],
    "http-https": ["HTTP演进", "HTTPS", "状态码", "跨域"],
    "dns-cdn": ["DNS", "CDN"],
    "websocket": ["WebSocket", "轮询对比"],
    
    # Architecture
    "methodology": ["DDD", "CQRS", "事件驱动", "六边形"],
    "microservice": ["拆分", "分布式事务", "分布式锁", "限流", "治理"],
    "system-design": ["秒杀", "消息队列", "缓存", "分库分表", "读写分离"],
    "project-design": ["多租户", "低代码", "API网关"],
}


def assign_order_to_category(topics_dir, domain_id, category_id):
    """Assign order values to topics within a category based on content"""
    hints = CATEGORY_ORDER_HINTS.get(category_id, [])
    cat_topics = []
    
    for fpath in glob.glob(os.path.join(topics_dir, "*.json")):
        try:
            topic = read_json(fpath)
            if topic.get("category") != category_id:
                continue
            
            title = topic.get("title", "")
            summary = topic.get("summary", "")
            combined = title + " " + summary
            
            # Find best matching hint position
            best_pos = len(hints)  # default to end
            for i, hint in enumerate(hints):
                if hint.lower() in combined.lower():
                    best_pos = i
                    break
            
            cat_topics.append((fpath, topic, best_pos, title))
        except Exception:
            continue
    
    # Sort by hint position, then by title
    cat_topics.sort(key=lambda x: (x[2], x[3]))
    
    # Assign order values (10, 20, 30, ...)
    results = []
    for i, (fpath, topic, pos, title) in enumerate(cat_topics):
        new_order = (i + 1) * 10
        results.append((fpath, topic, new_order))
    
    return results


# ============================================================
# 3. Category misplacement fixes
# ============================================================

CATEGORY_MOVES = {
    # Move MCP from llm to agent-architecture
    "agent.llm.topic-115-35c5dcec": {
        "old_category": "llm",
        "new_category": "agent-architecture",
        "new_group": "agent-architecture"
    },
}


def fix_category_misplacement(topic):
    """Fix known category misplacements"""
    topic_id = topic.get("id", "")
    if topic_id in CATEGORY_MOVES:
        move = CATEGORY_MOVES[topic_id]
        topic["category"] = move["new_category"]
        topic["group"] = move["new_group"]
        return True
    return False


# ============================================================
# Main execution
# ============================================================

def process_all_topics():
    """Process all topics for structural improvements"""
    manifest = read_json(os.path.join(CONTENT_ROOT, "manifest.json"))
    
    stats = {
        "total": 0,
        "difficulty_changed": 0,
        "minutes_changed": 0,
        "order_changed": 0,
        "status_changed": 0,
        "category_fixed": 0,
    }
    
    for domain_entry in manifest.get("domains", []):
        domain_id = domain_entry["id"]
        domain_path = os.path.join(CONTENT_ROOT, f"domains/{domain_id}.json")
        if not os.path.exists(domain_path):
            continue
        
        domain = read_json(domain_path)
        topics_dir = os.path.join(CONTENT_ROOT, f"topics/{domain_id}")
        
        if not os.path.isdir(topics_dir):
            continue
        
        # Process each topic file
        for fpath in glob.glob(os.path.join(topics_dir, "*.json")):
            try:
                topic = read_json(fpath)
                changed = False
                stats["total"] += 1
                
                # Fix difficulty
                new_diff = estimate_difficulty(topic)
                if new_diff != topic.get("difficulty"):
                    topic["difficulty"] = new_diff
                    stats["difficulty_changed"] += 1
                    changed = True
                
                # Fix estimatedMinutes
                new_minutes = estimate_minutes(topic)
                if new_minutes != topic.get("estimatedMinutes"):
                    topic["estimatedMinutes"] = new_minutes
                    stats["minutes_changed"] += 1
                    changed = True
                
                # Fix status: draft → production if content is complete
                if topic.get("status") == "draft":
                    cards = topic.get("learningCards", [])
                    has_explain = any(c.get("type") == "explain" for c in cards)
                    has_answer = any(c.get("type") == "interviewAnswer" for c in cards)
                    has_checklist = any(c.get("type") == "checklist" for c in cards)
                    if has_explain and has_answer and has_checklist:
                        topic["status"] = "production"
                        stats["status_changed"] += 1
                        changed = True
                
                # Fix category misplacement
                if fix_category_misplacement(topic):
                    stats["category_fixed"] += 1
                    changed = True
                
                if changed:
                    write_json(fpath, topic)
                    
            except Exception as e:
                print(f"  ⚠️ Error processing {os.path.basename(fpath)}: {e}")
        
        # Now fix ordering within each category
        for cat in domain.get("categories", []):
            cat_id = cat.get("id", "")
            ordered_topics = assign_order_to_category(topics_dir, domain_id, cat_id)
            
            order_changed = False
            new_topic_paths = []
            for fpath, topic, new_order in ordered_topics:
                rel_path = f"topics/{domain_id}/{os.path.basename(fpath)}"
                new_topic_paths.append(rel_path)
                
                if topic.get("order") != new_order:
                    topic["order"] = new_order
                    write_json(fpath, topic)
                    stats["order_changed"] += 1
                    order_changed = True
            
            if order_changed:
                cat["topics"] = new_topic_paths
        
        # Write back domain file
        write_json(domain_path, domain)
        
        # Update manifest topicCount
        total_in_domain = sum(len(c.get("topics", [])) for c in domain.get("categories", []))
        domain_entry["topicCount"] = total_in_domain
    
    # Write back manifest
    write_json(os.path.join(CONTENT_ROOT, "manifest.json"), manifest)
    
    return stats


def rename_collections_category():
    """Rename 'collections' to 'java-fundamentals' in Java domain"""
    domain_path = os.path.join(CONTENT_ROOT, "domains/java.json")
    domain = read_json(domain_path)
    
    for cat in domain.get("categories", []):
        if cat["id"] == "collections":
            cat["id"] = "java-fundamentals"
            cat["title"] = "Java 基础与集合"
            cat["description"] = "集合、泛型、反射、注解与语言特性"
            
            # Update all topics in this category
            for topic_path in cat.get("topics", []):
                full_path = os.path.join(CONTENT_ROOT, topic_path)
                if os.path.exists(full_path):
                    topic = read_json(full_path)
                    topic["category"] = "java-fundamentals"
                    topic["group"] = "java-fundamentals"
                    write_json(full_path, topic)
            
            break
    
    write_json(domain_path, domain)
    print("✅ Renamed collections → java-fundamentals")


if __name__ == "__main__":
    print("🚀 Starting structural improvements...")
    print()
    
    print("📊 Processing all topics...")
    stats = process_all_topics()
    
    print(f"\n📈 Results:")
    print(f"  Total topics processed: {stats['total']}")
    print(f"  Difficulty adjusted: {stats['difficulty_changed']}")
    print(f"  Minutes adjusted: {stats['minutes_changed']}")
    print(f"  Order adjusted: {stats['order_changed']}")
    print(f"  Draft → Production: {stats['status_changed']}")
    print(f"  Category fixed: {stats['category_fixed']}")
    
    print(f"\n🔧 Renaming categories...")
    rename_collections_category()
    
    print(f"\n✅ Structural improvements complete!")
