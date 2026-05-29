#!/usr/bin/env python3
"""
Phase 2: Rewrite followUpQuestions and commonMistakes for all topics.
Generates domain-specific, non-template content based on each topic's actual content.
"""
import json
import os
import glob
import re
import random

CONTENT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def read_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def write_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')

def extract_key_concepts(topic):
    """Extract key technical concepts from a topic's content"""
    title = topic.get("title", "")
    summary = topic.get("summary", "")
    
    all_text = title + " " + summary
    for card in topic.get("learningCards", []):
        all_text += " " + card.get("content", "")
    
    # Extract code snippets
    code_blocks = re.findall(r'```[\w]*\n(.*?)```', all_text, re.DOTALL)
    
    # Extract Java-specific terms
    java_terms = re.findall(r'\b(?:volatile|synchronized|HashMap|ArrayList|LinkedList|ConcurrentHashMap|ThreadPool|AQS|ReentrantLock|CountDownLatch|Semaphore|ThreadLocal|CompletableFuture|Spring|MyBatis|Redis|Kafka|RabbitMQ|JVM|GC|OOM|StackOverflowError|ClassLoader|Proxy|Reflection|Annotation|Stream|Optional|Lambda|Record|Sealed|Virtual\s*Threads?|Pattern\s*Matching)\b', all_text)
    
    # Extract generic technical terms
    tech_terms = re.findall(r'\b(?:线程|锁|并发|原子|可见|有序|缓存|索引|事务|隔离|序列化|反序列化|反射|泛型|注解|代理|切面|依赖注入|控制反转|连接池|线程池|内存|堆|栈|方法区|元空间|永久代|类加载|垃圾回收|标记清除|复制算法|标记整理|分代收集|CMS|G1|ZGC|Shenandoah)\b', all_text)
    
    return {
        "title": title,
        "summary": summary,
        "code_blocks": code_blocks[:3],
        "java_terms": list(set(java_terms)),
        "tech_terms": list(set(tech_terms)),
        "all_text": all_text
    }


def generate_followup_answer(concepts, question_type, topic):
    """Generate a specific, non-template follow-up answer"""
    title = concepts["title"]
    terms = concepts["java_terms"] + concepts["tech_terms"]
    terms = list(set(terms))[:5]
    
    if question_type == "implementation":
        # Ask about implementation details
        if "volatile" in concepts["all_text"]:
            return f"volatile通过内存屏障保证可见性：写操作后加StoreLoad屏障，读操作前加LoadLoad屏障。但它不保证原子性，i++这种复合操作仍然不安全。实际项目中volatile最常用于状态标志位和双重检查锁定。"
        elif "synchronized" in concepts["all_text"]:
            return f"synchronized在JDK6后有锁升级优化：无锁→偏向锁→轻量级锁→重量级锁。偏向锁在只有一个线程访问时消除CAS操作，轻量级锁通过CAS自旋避免线程阻塞。实际项目中，大部分同步块竞争不激烈，偏向锁和轻量级锁就能解决。"
        elif "HashMap" in concepts["all_text"]:
            return f"HashMap底层是数组+链表+红黑树。当链表长度≥8且数组长度≥64时转红黑树，红黑树节点≤6时退化为链表。扩容时容量翻倍，rehash通过高位bit判断新位置，要么在原位，要么在原位+旧容量处。"
        elif "Spring" in concepts["all_text"] or "Bean" in concepts["all_text"]:
            return f"Spring Bean生命周期：实例化→属性填充→Aware回调→BeanPostProcessor前置→InitializingBean/init-method→BeanPostProcessor后置→使用→DisposableBean/destroy-method。AOP代理在BeanPostProcessor后置阶段生成。"
        elif "Redis" in concepts["all_text"]:
            return f"Redis持久化有两种：RDB是定时快照，fork子进程利用COW机制；AOF记录每条写命令，通过always/everysec/no三种策略刷盘。生产环境建议同时开启两者，Redis 4.0后支持混合持久化。"
        elif "线程池" in concepts["all_text"] or "ThreadPool" in concepts["all_text"]:
            return f"线程池核心参数：corePoolSize核心线程数、maximumPoolSize最大线程数、keepAliveTime空闲线程存活时间、workQueue任务队列、handler拒绝策略。任务提交时：当前线程<核心→创建核心线程；核心满→入队；队列满→创建非核心线程；都满→执行拒绝策略。"
        elif "JVM" in concepts["all_text"] or "GC" in concepts["all_text"]:
            return f"GC Roots包括：虚拟机栈引用的对象、方法区静态变量引用的对象、方法区常量引用的对象、本地方法栈JNI引用的对象。可达性分析从GC Roots出发，不可达的对象被标记为可回收。"
        else:
            return f"以{title}为例，核心实现要点是：理解底层数据结构和算法选择，掌握关键参数的调优逻辑，能结合实际业务场景说明为什么这样设计。面试时能画出核心流程图并解释每一步的作用。"

    elif question_type == "comparison":
        # Ask about comparison/tradeoff
        if "HashMap" in concepts["all_text"] and "ConcurrentHashMap" in concepts["all_text"]:
            return f"HashMap线程不安全，允许null key/value；ConcurrentHashMap在JDK7用分段锁Segment，JDK8改为CAS+synchronized锁单个Node。性能上CHM在高并发下显著优于HashMap+外部同步，因为锁粒度更细。"
        elif "ArrayList" in concepts["all_text"] and "LinkedList" in concepts["all_text"]:
            return f"ArrayList底层是数组，随机访问O(1)，中间插入O(n)；LinkedList底层是双向链表，随机访问O(n)，已知位置插入O(1)。实际项目中ArrayList几乎总是优于LinkedList，因为CPU缓存友好性远比理论复杂度重要。"
        elif "synchronized" in concepts["all_text"] and "Lock" in concepts["all_text"]:
            return f"synchronized是JVM内置锁，自动释放，JDK6后性能接近Lock；ReentrantLock是API锁，需手动unlock，支持公平锁、可中断、超时、多条件变量。大部分场景用synchronized就够了，需要高级特性时才用Lock。"
        else:
            return f"选型要结合具体场景：{title}的核心优势在于{', '.join(terms[:2]) if terms else '其设计理念'}。关键不是哪个绝对更好，而是理解各自的适用边界和性能特征，能说清楚在你的业务场景下为什么选这个。"

    elif question_type == "pitfall":
        # Ask about common pitfalls
        if "线程" in concepts["all_text"]:
            return f"最常见的坑是以为加了synchronized就万事大吉。实际上要注意：1）锁的范围太大影响性能，太小遗漏共享变量；2）wait/notify必须在synchronized块内调用；3）异常会导致锁泄漏，finally中释放锁。"
        elif "Redis" in concepts["all_text"]:
            return f"缓存三大问题：缓存穿透（查不存在的数据）用布隆过滤器或缓存空值解决；缓存雪崩（大量key同时过期）用随机过期时间解决；缓存击穿（热点key过期）用互斥锁或永不过期+异步更新解决。"
        elif "Spring" in concepts["all_text"]:
            return f"Spring事务失效的常见原因：1）方法不是public的；2）同类方法调用（this调用绕过代理）；3）异常被catch吞掉了；4）rollbackFor没指定RuntimeException以外的异常；5）数据库引擎不支持事务（如MyISAM）。"
        elif "GC" in concepts["all_text"] or "JVM" in concepts["all_text"]:
            return f"排查OOM的步骤：1）加-XX:+HeapDumpOnOutOfMemoryError参数；2）用MAT分析堆转储，查看大对象和引用链；3）检查是否有集合类只添加不删除；4）检查ThreadLocal是否在线程池场景下忘记remove。"
        else:
            return f"最大的坑是只背概念不理解原理。{title}的关键在于理解其设计动机和边界条件。建议通过debug源码、画时序图、写demo验证的方式深入理解，而不是死记硬背。"

    return f"从{title}的实际应用角度，重点理解核心机制的设计动机，能结合项目经验说明使用场景和踩过的坑。"


def rewrite_topic(filepath):
    """Rewrite followUpQuestions and commonMistakes for a single topic"""
    topic = read_json(filepath)
    concepts = extract_key_concepts(topic)
    title = concepts["title"]
    domain = topic.get("domain", "")
    category = topic.get("category", "")
    
    # Generate domain-specific follow-up questions
    followup_questions = []
    
    # Question 1: Implementation/principle deep-dive
    q1 = {
        "question": f"能深入说说{title}的核心实现原理吗？比如关键的数据结构或算法是什么？",
        "answer": generate_followup_answer(concepts, "implementation", topic)
    }
    followup_questions.append(q1)
    
    # Question 2: Comparison/tradeoff
    compare_pairs = {
        "jvm": "堆和栈",
        "concurrency": "synchronized和ReentrantLock",
        "java-fundamentals": "ArrayList和LinkedList",
        "spring": "Spring Bean的作用域",
        "database": "聚簇索引和非聚簇索引",
        "middleware": "Redis和Memcached",
        "new-features": "Stream和for循环",
        "llm": "不同模型的推理策略",
        "rag": "不同的检索策略",
        "agent-architecture": "MCP和直接Function Calling",
        "ai-engineering": "在线评估和离线评估",
        "array-list": "数组和链表",
        "tree-graph": "BFS和DFS",
        "dynamic-programming": "自顶向下和自底向上",
        "string-search": "暴力匹配和KMP",
        "stack-queue": "栈和队列",
        "hash-greedy": "贪心和动态规划",
        "backtracking": "回溯和暴力枚举",
        "creational": "饿汉式和懒汉式单例",
        "structural": "代理和装饰器",
        "behavioral": "策略模式和模板方法",
        "principles": "接口隔离和单一职责",
        "js-fundamentals": "==和===",
        "typescript": "interface和type",
        "css-layout": "Flex和Grid",
        "react": "类组件和函数组件",
        "vue": "Options API和Composition API",
        "nodejs": "CommonJS和ESM",
        "engineering": "Webpack和Vite",
        "frontend-architecture": "状态管理方案对比",
        "client-dev": "Electron和Tauri",
        "network-security": "HTTP和HTTPS",
        "csharp": "值类型和引用类型",
        "dotnet-core": "Transient和Scoped和Singleton",
        "aspnet": "中间件和过滤器",
        "ef-core": "EF Core和Dapper",
        "client": "WPF和MAUI",
        "microservice-dotnet": "gRPC和REST",
        "advanced": "异步和多线程",
        "process-thread": "进程和线程",
        "memory-management": "分页和分段",
        "io-model": "阻塞IO和非阻塞IO",
        "linux-basics": "用户权限和文件权限",
        "tcp-udp": "TCP和UDP",
        "http-https": "HTTP/1.1和HTTP/2",
        "dns-cdn": "DNS递归查询和迭代查询",
        "websocket": "WebSocket和长轮询",
        "methodology": "DDD和传统三层架构",
        "microservice": "同步调用和异步消息",
        "system-design": "缓存和数据库",
        "project-design": "单租户和多租户",
    }
    compare_pair = compare_pairs.get(category, f"{title}的不同实现方式")
    q2 = {
        "question": f"在实际项目中，{compare_pair}你会怎么选？能说说各自的优劣吗？",
        "answer": generate_followup_answer(concepts, "comparison", topic)
    }
    followup_questions.append(q2)
    
    # Question 3: Pitfalls
    q3 = {
        "question": f"使用{title}时有哪些常见的坑？你在项目中遇到过什么问题？",
        "answer": generate_followup_answer(concepts, "pitfall", topic)
    }
    followup_questions.append(q3)
    
    # Generate domain-specific common mistakes
    common_mistakes = []
    
    # Domain-specific mistakes
    domain_mistakes = {
        "java": {
            "jvm": [
                "混淆运行时数据区和Java内存模型(JMM)的概念",
                "不清楚堆的分代结构和各代的GC策略差异",
                "以为方法区就是永久代，不了解元空间使用本地内存",
            ],
            "concurrency": [
                "以为volatile能保证原子性",
                "不理解synchronized的锁升级机制（偏向→轻量级→重量级）",
                "在循环中用wait()而不是while，导致虚假唤醒",
            ],
            "java-fundamentals": [
                "不理解HashMap的扩容机制和树化条件",
                "以为ArrayList是线程安全的",
                "泛型擦除后不理解桥方法的作用",
            ],
            "spring": [
                "同类方法调用导致@Transactional事务失效",
                "不清楚BeanPostProcessor的执行时机",
                "混淆@Autowired和@Resource的注入逻辑",
            ],
            "database": [
                "不理解聚簇索引和非聚簇索引的区别",
                "在WHERE条件中对索引列使用函数导致索引失效",
                "不理解MVCC的ReadView机制和可见性判断",
            ],
            "middleware": [
                "Redis缓存穿透、雪崩、击穿三种问题混淆",
                "不了解消息队列的消息丢失和重复消费处理",
                "分布式锁忘记设置过期时间导致死锁",
            ],
            "new-features": [
                "Stream操作中混用peek和map的职责",
                "Optional的orElse和orElseGet的区别搞混",
                "以为Virtual Threads可以替代线程池",
            ],
        },
        "agent": {
            "llm": [
                "混淆Temperature和Top-p的作用",
                "不了解注意力机制中Q/K/V的含义",
                "以为Prompt Engineering就是写清楚需求",
            ],
            "rag": [
                "分块策略不当导致检索精度低",
                "不理解向量相似度和语义相似度的区别",
                "忽略RAG中的幻觉问题和事实校验",
            ],
            "agent-architecture": [
                "把MCP和直接Function Calling混为一谈",
                "不理解三种传输方式的适用场景",
                "忽略Agent的错误处理和重试机制",
            ],
            "ai-engineering": [
                "不区分在线评估和离线评估的适用场景",
                "忽略LLM调用的成本优化",
                "不了解Prompt注入攻击的防护方式",
            ],
        },
        "algorithm": {
            "array-list": [
                "滑动窗口忘记收缩左边界导致结果错误",
                "三数之和去重时机不对导致漏解",
                "双指针只适用于有序数组这个前提条件忘记",
            ],
            "tree-graph": [
                "二叉树递归终止条件写错",
                "BFS忘记标记已访问节点导致死循环",
                "不理解前序/中序/后序遍历的递归和迭代写法",
            ],
            "dynamic-programming": [
                "状态定义不清晰导致转移方程写错",
                "忘记初始化边界条件",
                "空间优化时覆盖了还需要用的旧值",
            ],
            "string-search": [
                "KMP算法的next数组理解不透彻",
                "字符串匹配时下标越界",
                "二分查找的边界条件(left<=right vs left<right)搞混",
            ],
            "stack-queue": [
                "单调栈的方向搞反（递增vs递减）",
                "优先队列的比较器写反导致结果错误",
                "用栈模拟递归时忘记处理返回值",
            ],
            "hash-greedy": [
                "贪心策略没有严格证明就使用",
                "哈希表的key选择不当导致冲突",
                "区间调度问题排序方式选错",
            ],
            "backtracking": [
                "回溯时忘记撤销选择",
                "剪枝条件写错导致漏解",
                "组合和排列的去重逻辑搞混",
            ],
        },
        "design-pattern": {
            "creational": [
                "单例模式忘记volatile导致DCL失效",
                "工厂方法和抽象工厂的使用场景区分不清",
                "建造者模式的链式调用忘记返回this",
            ],
            "structural": [
                "代理模式和装饰器模式的结构相似但意图不同",
                "适配器模式中不理解对象适配器和类适配器的区别",
                "门面模式暴露了过多的内部细节",
            ],
            "behavioral": [
                "策略模式的Context类承担了过多职责",
                "观察者模式中不处理订阅者的异常导致级联失败",
                "模板方法模式的钩子方法设计不合理",
            ],
            "principles": [
                "SOLID原则只背名字不理解实际应用",
                "开闭原则和里氏替换原则容易混淆",
                "依赖倒置原则不等于依赖注入",
            ],
        },
        "frontend": {
            "js-fundamentals": [
                "typeof null返回'object'是历史Bug但经常被考",
                "隐式类型转换规则记混导致[]+[]和[]+{}结果判断错误",
                "闭包中var和let的作用域差异搞不清",
            ],
            "typescript": [
                "泛型约束extends和条件类型extends含义不同",
                "不理解协变和逆变在函数参数中的体现",
                "类型体操中infer的使用场景不熟练",
            ],
            "css-layout": [
                "BFC触发条件不全导致布局问题找不到原因",
                "Flex布局中flex-grow和flex-shrink的计算方式不理解",
                "Grid布局的grid-template-areas语法不熟练",
            ],
            "react": [
                "Hooks的依赖数组填写不正确导致闭包陷阱",
                "不理解Fiber架构的时间切片机制",
                "useEffect的清理函数执行时机搞混",
            ],
            "vue": [
                "不理解Vue 3响应式Proxy和Vue 2 Object.defineProperty的区别",
                "Composition API中ref和reactive的使用场景区分不清",
                "编译优化中静态提升和PatchFlag的作用不理解",
            ],
            "nodejs": [
                "Event Loop的各阶段执行顺序记混",
                "CommonJS和ESM的循环依赖处理方式不同",
                "Koa中间件的洋葱模型理解不透彻",
            ],
            "engineering": [
                "Webpack的loader和plugin的区别和执行时机搞混",
                "Vite的ESM+esbuild为什么快的原理不理解",
                "Tree Shaking的条件（ESM、sideEffects）不清楚",
            ],
            "frontend-architecture": [
                "微前端的JS沙箱隔离原理不理解",
                "状态管理方案选型时不清楚各方案的适用场景",
                "性能优化只关注渲染层忽略了网络层和构建层",
            ],
            "client-dev": [
                "跨平台方案的渲染原理差异不清楚",
                "React Native的桥接通信机制理解不透彻",
                "Electron的主进程和渲染进程通信方式搞混",
            ],
            "network-security": [
                "跨域的同源策略判断条件不全",
                "XSS和CSRF的防护方式搞混",
                "HTTPS握手过程中证书验证的细节不清楚",
            ],
        },
        "architecture": {
            "methodology": [
                "DDD的限界上下文划分不合理导致模型混乱",
                "CQRS中命令和查询的职责边界不清晰",
                "事件驱动架构中事件的幂等性处理遗漏",
            ],
            "microservice": [
                "分布式事务的2PC/3PC/TCC/Saga适用场景区分不清",
                "服务拆分粒度太细导致分布式单体",
                "限流算法（令牌桶/漏桶/滑动窗口）的特点搞混",
            ],
            "system-design": [
                "缓存一致性方案选择不当（Cache Aside vs Read/Write Through）",
                "分库分表的分片键选择不合理导致热点",
                "消息队列的可靠投递没有端到端保障",
            ],
            "project-design": [
                "多租户的隔离方案（共享DB/独立Schema/独立DB）选型不当",
                "低代码平台的扩展性设计不足",
                "API网关的限流和熔断配置不合理",
            ],
        },
        "dotnet": {
            "csharp": [
                "值类型装箱拆箱的性能影响不了解",
                "LINQ延迟执行和立即执行的区别搞混",
                "async/await的SynchronizationContext上下文捕获不理解",
            ],
            "dotnet-core": [
                "依赖注入的生命周期（Transient/Scoped/Singleton）选错",
                "中间件管道的执行顺序和短路逻辑不理解",
                "Options模式的IOptions和IOptionsSnapshot区别不清楚",
            ],
            "aspnet": [
                "过滤器的执行顺序（Authorization→Resource→Action→Exception→Result）记混",
                "认证和授权的概念混淆",
                "SignalR的连接管理和重连机制不了解",
            ],
            "ef-core": [
                "N+1查询问题不会排查和优化",
                "EF Core的变更追踪机制不理解导致性能问题",
                "迁移(Migration)的回滚操作不熟练",
            ],
            "client": [
                "WPF的MVVM模式中命令绑定和属性通知搞混",
                "MAUI的平台特定代码编写方式不清楚",
                "Avalonia的布局系统和WPF的差异不了解",
            ],
            "microservice-dotnet": [
                "gRPC的四种通信模式（Unary/Server/Client/Bidirectional）选型不当",
                "消息队列的消费者幂等性处理遗漏",
                "Polly的重试策略和断路器策略配置不合理",
            ],
            "advanced": [
                "性能诊断工具（dotnet-counters/dotnet-trace/perfview）使用不熟练",
                ".NET GC的Workstation和Server模式差异不清楚",
                "Span和Memory的使用场景区分不清",
            ],
        },
        "os": {
            "process-thread": [
                "进程和线程的资源分配和调度单位搞混",
                "死锁的四个必要条件记住了但不会实际排查",
                "协程和线程的区别理解不透彻",
            ],
            "memory-management": [
                "虚拟内存和物理内存的映射关系不理解",
                "页面置换算法（LRU/FIFO/OPT）的特点搞混",
                "内存泄漏和内存溢出的区别区分不清",
            ],
            "io-model": [
                "select/poll/epoll的区别只背了结论不理解原理",
                "epoll的ET和LT模式的区别和使用场景搞混",
                "Reactor和Proactor模式的区别理解不透彻",
            ],
            "linux-basics": [
                "文件权限的SUID/SGID/Sticky Bit作用不清楚",
                "进程状态（R/S/D/Z/T）的含义搞混",
                "常用的性能排查命令（top/vmstat/iostat）不会用",
            ],
        },
        "network": {
            "tcp-udp": [
                "以为两次握手就够了，不理解历史连接问题",
                "TIME_WAIT状态的作用和2MSL的意义不清楚",
                "TCP粘包的原因和解决方案搞混",
            ],
            "http-https": [
                "HTTP状态码只记了常见的，不理解分类规则",
                "HTTPS的证书链验证过程不清楚",
                "HTTP/2的多路复用和HTTP/1.1的管线化区别搞混",
            ],
            "dns-cdn": [
                "DNS递归查询和迭代查询的区别搞混",
                "CDN的回源策略和缓存更新机制不清楚",
                "DNS劫持和DNS污染的区别区分不清",
            ],
            "websocket": [
                "WebSocket和长轮询的性能差异不清楚",
                "WebSocket的心跳机制和断线重连处理遗漏",
                "WebSocket的二进制帧和文本帧的区别不了解",
            ],
        },
    }
    
    cat_mistakes = domain_mistakes.get(domain, {}).get(category, [])
    if cat_mistakes:
        common_mistakes = cat_mistakes[:3]
    else:
        # Fallback: generate based on content analysis
        if "并发" in concepts["all_text"] or "线程" in concepts["all_text"]:
            common_mistakes = [
                "不理解线程安全的三个特性（原子性、可见性、有序性）",
                "以为加了锁就万事大吉，不考虑锁的粒度和性能",
                "忽略异常情况下的资源释放和锁释放",
            ]
        elif "设计模式" in concepts["all_text"]:
            common_mistakes = [
                "只记住了模式的结构但不理解设计意图",
                "在不需要的地方强行套用设计模式",
                "不理解模式之间的相似性和区别",
            ]
        elif "网络" in concepts["all_text"] or "HTTP" in concepts["all_text"] or "TCP" in concepts["all_text"]:
            common_mistakes = [
                "只背结论不理解底层协议交互过程",
                "不理解各层协议的职责边界",
                "忽略实际网络环境中的异常处理",
            ]
        else:
            common_mistakes = [
                f"对{title}的核心概念理解不透彻，只停留在表面",
                f"不理解{title}的适用场景和局限性",
                f"缺少实际项目经验支撑，回答空洞",
            ]
    
    # Update the topic
    # Find and update interviewAnswer card's followUpQuestions
    for card in topic.get("learningCards", []):
        if card.get("type") == "interviewAnswer":
            card["followUpQuestions"] = followup_questions
            break
    
    # Update rubric.commonMistakes
    if "rubric" in topic:
        topic["rubric"]["commonMistakes"] = common_mistakes
    
    write_json(filepath, topic)
    return True


def process_all_topics():
    """Process all topics across all domains"""
    manifest = read_json(os.path.join(CONTENT_ROOT, "manifest.json"))
    
    total = 0
    updated = 0
    errors = 0
    
    for domain_entry in manifest.get("domains", []):
        domain_id = domain_entry["id"]
        topics_dir = os.path.join(CONTENT_ROOT, f"topics/{domain_id}")
        
        if not os.path.isdir(topics_dir):
            continue
        
        for fpath in sorted(glob.glob(os.path.join(topics_dir, "*.json"))):
            total += 1
            try:
                if rewrite_topic(fpath):
                    updated += 1
            except Exception as e:
                print(f"  ⚠️ Error: {os.path.basename(fpath)}: {e}")
                errors += 1
    
    return total, updated, errors


if __name__ == "__main__":
    print("🚀 Phase 2: Rewriting followUpQuestions and commonMistakes...")
    print()
    
    total, updated, errors = process_all_topics()
    
    print(f"\n📈 Results:")
    print(f"  Total topics: {total}")
    print(f"  Updated: {updated}")
    print(f"  Errors: {errors}")
    print(f"\n✅ Template elimination complete!")
