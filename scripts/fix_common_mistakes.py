#!/usr/bin/env python3
"""Fix rubric.commonMistakes to be topic-specific instead of generic/mismatched."""
import json, glob

def generate_specific_mistakes(data):
    """Generate topic-specific commonMistakes based on content."""
    title = data.get('title', '')
    domain = data.get('domain', '')
    category = data.get('category', '')

    # Extract content for context
    all_content = ''
    for lc in data.get('learningCards', []):
        all_content += lc.get('content', '') + '\n'

    # Domain+category dispatch
    if domain == 'java':
        if 'jvm' in category:
            return generate_jvm_mistakes(title, all_content)
        elif 'concurrency' in category:
            return generate_concurrency_mistakes(title, all_content)
        elif 'spring' in category:
            return generate_spring_mistakes(title, all_content)
        elif 'database' in category:
            return generate_database_mistakes(title, all_content)
        elif 'middleware' in category:
            return generate_middleware_mistakes(title, all_content)
        elif 'java-fundamentals' in category or 'new-features' in category:
            return generate_java_basics_mistakes(title, all_content)
    elif domain == 'algorithm':
        return generate_algorithm_mistakes(title, all_content)
    elif domain == 'frontend':
        return generate_frontend_mistakes(title, all_content)
    elif domain == 'agent':
        return generate_agent_mistakes(title, all_content)
    elif domain == 'architecture':
        return generate_architecture_mistakes(title, all_content)
    elif domain == 'design-pattern':
        return generate_design_pattern_mistakes(title, all_content)
    elif domain == 'dotnet':
        return generate_dotnet_mistakes(title, all_content)
    elif domain == 'network':
        return generate_network_mistakes(title, all_content)
    elif domain == 'os':
        return generate_os_mistakes(title, all_content)

    # Fallback: extract from existing content
    return [
        "对" + title + "的理解停留在表面，没有深入底层原理",
        "不能结合实际项目说明应用场景",
        "面试回答缺乏条理和结构"
    ]

def generate_jvm_mistakes(title, content):
    if '运行时' in title or '数据区' in title:
        return ["混淆运行时数据区和Java内存模型(JMM)的概念",
                "不清楚堆的分代结构和各代的GC策略差异",
                "以为方法区就是永久代，不了解元空间使用本地内存"]
    elif 'GC' in title or '垃圾' in title:
        return ["混淆Minor GC和Full GC的触发条件",
                "不清楚G1/ZGC等新收集器的工作原理",
                "只记住GC算法名称，不能解释为什么选择某种算法"]
    elif '类加载' in title:
        return ["混淆加载、链接、初始化三个阶段",
                "不了解双亲委派模型的打破场景（如Tomcat、SPI）",
                "把Class.forName和ClassLoader.loadClass的区别搞混"]
    elif '调优' in title or '参数' in title:
        return ["-Xms和-Xmx设置不一致导致堆频繁扩缩",
                "忘记配置HeapDumpOnOutOfMemoryError导致OOM时无法排查",
                "盲目调参而不先用jstat/gc.log收集数据"]
    elif '堆' in title or '内存' in title:
        return ["混淆新生代和老年代的GC算法差异",
                "不清楚Eden和Survivor的比例关系（默认8:1:1）",
                "以为增大堆内存就能解决所有OOM问题"]
    elif '方法区' in title or '元空间' in title:
        return ["混淆永久代和元空间（JDK8后元空间使用本地内存）",
                "不清楚运行时常量池的位置变化",
                "不了解MetaspaceSize和MaxMetaspaceSize的区别"]
    elif '引用' in title:
        return ["混淆四种引用类型（强/软/弱/虚）的GC行为",
                "不清楚WeakHashMap的使用场景",
                "以为软引用和弱引用在任何时候都会被GC"]
    else:
        return ["对" + title + "的理解停留在概念层面，不能结合实际项目",
                "不能画出JVM内存布局图",
                "面试表达缺乏条理"]

def generate_concurrency_mistakes(title, content):
    if 'synchronized' in title.lower():
        return ["不了解锁升级过程（偏向锁→轻量级锁→重量级锁）",
                "混淆synchronized和ReentrantLock的使用场景",
                "以为synchronized一定比CAS性能差"]
    elif 'volatile' in title.lower():
        return ["以为volatile能保证原子性（i++仍然不安全）",
                "不清楚volatile的内存屏障机制",
                "把volatile和synchronized混为一谈"]
    elif 'AQS' in title:
        return ["只背了AQS的名字，不理解state变量+CLH队列的核心机制",
                "不清楚ReentrantLock/Semaphore/CountDownLatch和AQS的关系",
                "不能画出CLH队列的结构图"]
    elif '线程池' in title:
        return ["直接使用Executors创建线程池（可能OOM）",
                "不清楚线程池的执行流程（核心线程→队列→最大线程→拒绝）",
                "忘记处理线程池中未捕获的异常"]
    elif 'ConcurrentHashMap' in title:
        return ["以为ConcurrentHashMap用的是分段锁（JDK7），不清楚JDK8改为CAS+synchronized",
                "混淆ConcurrentHashMap和Hashtable的区别",
                "不清楚size()方法的实现原理"]
    elif 'ThreadLocal' in title:
        return ["不清楚ThreadLocalMap的key是弱引用（导致内存泄漏）",
                "在线程池中使用ThreadLocal忘记调用remove()",
                "混淆ThreadLocal和线程局部变量的概念"]
    elif 'CompletableFuture' in title:
        return ["忘记自定义线程池导致用ForkJoinPool.commonPool()",
                "混淆thenApply和thenCompose的区别",
                "异常处理不当导致异常被吞掉"]
    elif 'HashMap' in title:
        return ["不清楚链表转红黑树的条件（链表≥8且数组≥64）",
                "以为HashMap是线程安全的",
                "不了解JDK8头插法改尾插法的原因（解决死循环）"]
    elif 'ArrayList' in title or 'LinkedList' in title:
        return ["盲目使用LinkedList（实际项目中ArrayList几乎总是更好）",
                "不清楚ArrayList扩容机制（1.5倍）",
                "在for循环中调用list.remove()导致ConcurrentModificationException"]
    elif 'volatile' in title:
        return ["以为volatile能保证原子性",
                "不清楚volatile的内存屏障机制",
                "把volatile和synchronized混为一谈"]
    else:
        return ["对" + title + "的并发机制理解不深入",
                "不能画出线程状态转换图",
                "不知道如何排查死锁和线程安全问题"]

def generate_spring_mistakes(title, content):
    if '自动装配' in title or 'IoC' in title:
        return ["不清楚@Autowired的注入顺序（先类型再名称）",
                "不了解@Conditional系列注解的作用",
                "混淆BeanFactory和ApplicationContext的区别"]
    elif 'AOP' in title:
        return ["不清楚JDK动态代理和CGLIB的使用条件",
                "以为AOP只用于日志和事务",
                "同类方法调用时AOP不生效（因为代理对象调用才生效）"]
    elif 'Bean' in title or '生命周期' in title:
        return ["不能完整说出Bean的生命周期步骤",
                "不清楚三级缓存解决循环依赖的原理",
                "混淆@PostConstruct和InitializingBean的执行顺序"]
    elif 'MyBatis' in title:
        return ["不清楚一级缓存和二级缓存的作用域和默认行为",
                "以为#{}和${}的区别只是格式不同",
                "不了解MyBatis插件机制（Interceptor链）"]
    elif 'Nacos' in title:
        return ["不清楚临时实例和持久实例的区别（AP vs CP）",
                "不了解配置管理的长轮询机制",
                "混淆namespace/group/dataId的层级关系"]
    elif 'Gateway' in title:
        return ["不清楚Route/Predicate/Filter三者的关系",
                "不了解Pre过滤器和Post过滤器的执行顺序",
                "不知道如何自定义全局过滤器"]
    elif 'Sentinel' in title:
        return ["混淆限流、降级、熔断三个概念",
                "不清楚滑动窗口限流和令牌桶限流的区别",
                "不知道热点参数限流的使用场景"]
    elif 'Seata' in title or '分布式事务' in title:
        return ["不清楚AT模式的undo log机制",
                "混淆强一致性和最终一致性的适用场景",
                "以为分布式事务一定要用Seata（实际上很多场景用MQ就够了）"]
    elif 'Redis' in title:
        return ["不清楚五种数据结构的底层实现差异",
                "不了解缓存穿透/击穿/雪崩的区别和解决方案",
                "以为Redis单线程就很慢（内存操作+IO多路复用其实很快）"]
    elif 'RabbitMQ' in title:
        return ["不清楚四种Exchange类型的区别",
                "不了解消息可靠性的完整链路（confirm→持久化→ack）",
                "不知道死信队列的使用场景"]
    elif 'Kafka' in title:
        return ["不清楚分区（Partition）和消费者组的关系",
                "不了解ISR（In-Sync Replicas）的作用",
                "以为Kafka只能用于日志收集"]
    else:
        return ["对Spring生态的理解停留在使用层面，不清楚底层原理",
                "不能说出关键注解的工作机制",
                "不知道如何排查Spring应用的常见问题"]

def generate_database_mistakes(title, content):
    if '索引' in title:
        return ["不清楚B+树为什么适合作为索引结构",
                "不了解联合索引的最左前缀原则",
                "在索引列上使用函数导致索引失效"]
    elif '事务' in title or 'MVCC' in title:
        return ["不清楚MVCC的Read View机制",
                "混淆RC和RR隔离级别下MVCC的行为差异",
                "不了解undo log版本链的作用"]
    elif '锁' in title:
        return ["不清楚Record Lock、Gap Lock、Next-Key Lock的区别",
                "不了解加锁规则（等值查询 vs 范围查询）",
                "不知道如何排查死锁（SHOW ENGINE INNODB STATUS）"]
    elif 'SQL' in title or '优化' in title:
        return ["不用EXPLAIN分析执行计划就直接优化",
                "不清楚type列各值的含义和优劣",
                "不了解覆盖索引和回表的概念"]
    else:
        return ["对MySQL的存储引擎架构理解不深入",
                "不清楚redo log和undo log的作用",
                "不知道如何排查慢SQL"]

def generate_middleware_mistakes(title, content):
    if 'Redis' in title and ('数据结构' in title or '基础' in title):
        return ["不清楚五种数据结构的底层实现（SDS/quicklist/skiplist等）",
                "不了解大Key问题的危害和排查方法",
                "以为Redis只能做缓存"]
    elif 'Redis' in title and ('集群' in title or '高可用' in title):
        return ["混淆主从复制、Sentinel、Cluster三种方案",
                "不清楚Cluster的槽位分配机制",
                "不了解故障转移的流程"]
    elif '分布式锁' in title:
        return ["释放锁时没有用Lua脚本保证原子性",
                "不了解Redisson看门狗自动续期机制",
                "混淆Redis分布式锁和Zookeeper分布式锁的适用场景"]
    elif 'RabbitMQ' in title:
        return ["不清楚四种Exchange类型的区别和适用场景",
                "不了解消息可靠性的完整链路",
                "不知道死信队列和延迟队列的实现方式"]
    elif 'Kafka' in title:
        return ["不清楚Partition和Consumer Group的关系",
                "不了解ISR的作用和Leader选举机制",
                "以为ack=all就能保证消息不丢（还需要ISR确认）"]
    elif '缓存' in title:
        return ["混淆穿透、击穿、雪崩三个概念",
                "不清楚Cache-Aside策略的更新顺序",
                "不了解延迟双删和Canal监听Binlog的一致性方案"]
    else:
        return ["对分布式中间件的理解停留在使用层面",
                "不清楚中间件的核心架构和工作原理",
                "不知道如何排查生产环境的中间件问题"]

def generate_java_basics_mistakes(title, content):
    if '泛型' in title:
        return ["不清楚类型擦除的概念和影响",
                "混淆? extends T和? super T的使用场景（PECS原则）",
                "不知道桥接方法的作用"]
    elif '反射' in title or '注解' in title:
        return ["不清楚反射的性能开销（比直接调用慢5-10倍）",
                "混淆Class.forName和ClassLoader.loadClass",
                "不了解Spring如何使用反射实现IoC"]
    elif 'Lambda' in title or '函数式' in title:
        return ["不清楚invokedynamic指令的作用",
                "混淆函数式接口和普通接口",
                "不知道方法引用的三种形式"]
    elif 'Stream' in title:
        return ["混淆中间操作和终端操作（中间操作是惰性的）",
                "不清楚并行流使用的线程池（ForkJoinPool.commonPool）",
                "在小数据量场景下使用Stream反而更慢"]
    elif 'Optional' in title:
        return ["用Optional做字段类型（不推荐）",
                "用orElse(null)而不是orElseGet",
                "不清楚Optional的设计初衷（替代null检查）"]
    elif 'Record' in title:
        return ["不清楚Record的不可变特性（final字段）",
                "以为Record可以继承其他类（不能）",
                "混淆Record和Lombok @Data"]
    elif 'Virtual' in title or '虚拟线程' in title:
        return ["不清楚Virtual Threads和Platform Threads的区别",
                "在Virtual Threads中使用synchronized导致carrier thread被pin",
                "以为Virtual Threads适合所有场景（CPU密集型不适合）"]
    else:
        return ["对" + title + "的理解停留在API使用层面",
                "不清楚底层实现原理",
                "不能结合实际项目说明应用场景"]

def generate_algorithm_mistakes(title, content):
    if '数组' in title:
        return ["忘记去重导致三数之和重复输出",
                "滑动窗口忘记收缩左边界",
                "前缀和数组下标处理出错（区间[left,right]的和=prefix[right+1]-prefix[left]）"]
    elif '链表' in title:
        return ["忘记处理空链表和单节点的边界情况",
                "反转链表时丢失引用（没有先保存next）",
                "快慢指针找中点时，偶数个节点的处理方式不一致"]
    elif '二叉树' in title:
        return ["递归终止条件写错（null判断遗漏）",
                "层序遍历忘记按层分组",
                "路径问题忘记回溯（撤销选择）"]
    elif 'DP' in title or '动态规划' in title:
        return ["状态定义不清晰导致转移方程写错",
                "遍历顺序搞反（如0-1背包一维数组要倒序遍历）",
                "忘记初始化边界条件"]
    elif '回溯' in title:
        return ["忘记撤销选择（回溯的核心）",
                "去重条件写错（应该排序后跳过相邻相同元素）",
                "剪枝条件不完整导致超时"]
    elif '排序' in title:
        return ["快排的partition写错（边界条件处理）",
                "归并排序的merge操作忘记处理剩余元素",
                "堆排序的siftDown操作下标计算出错"]
    elif '二分' in title:
        return ["循环条件用<还是<=搞混",
                "边界更新用mid还是mid±1搞混",
                "mid计算用(left+right)/2可能溢出"]
    elif '栈' in title or '队列' in title:
        return ["单调栈的弹出条件写错",
                "用两个栈实现队列时忘记处理输出栈为空的情况",
                "优先队列（堆）的比较器方向搞反"]
    elif '哈希' in title:
        return ["两数之和用两层循环而不是哈希表",
                "字母异位词比较时排序而不是用字符计数",
                "和为K的子数组忘记初始化map.put(0,1)"]
    elif '贪心' in title:
        return ["没有证明贪心选择的正确性就使用贪心",
                "把应该用DP的问题用贪心解决",
                "区间调度问题排序依据搞错（应该按结束时间排序）"]
    else:
        return ["边界条件处理不当",
                "时间空间复杂度分析不准确",
                "代码实现有bug但发现不了"]

def generate_frontend_mistakes(title, content):
    if '闭包' in title:
        return ["不清楚闭包的内存泄漏风险",
                "在事件监听器中创建闭包忘记移除监听器",
                "把闭包和匿名函数混为一谈"]
    elif 'Promise' in title:
        return ["不清楚Promise的三种状态（pending/fulfilled/rejected）",
                "忘记Promise.all和Promise.race的区别",
                "在async函数中忘记处理异常"]
    elif 'Event Loop' in title:
        return ["混淆宏任务和微任务的执行顺序",
                "不清楚Node.js和浏览器Event Loop的区别",
                "不知道process.nextTick和Promise.then的优先级"]
    elif 'React' in title:
        return ["不清楚Fiber架构的作用（可中断渲染）",
                "在Hooks中违反规则（条件调用、循环调用）",
                "useEffect的依赖数组填写不当导致无限循环"]
    elif 'Vue' in title:
        return ["不清楚Vue3 Proxy和Vue2 defineProperty的区别",
                "混淆ref和reactive的使用场景",
                "computed和watch的使用场景搞混"]
    elif 'Webpack' in title:
        return ["不清楚Loader和Plugin的区别",
                "不了解Tree Shaking的原理（ESM静态分析）",
                "代码分割策略选择不当"]
    elif 'Vite' in title:
        return ["不清楚Vite为什么比Webpack快（ESM原生加载）",
                "不了解预构建（Pre-Bundling）的作用",
                "HMR原理理解不深入"]
    elif '深拷贝' in title:
        return ["JSON.parse(JSON.stringify())丢失函数/undefined/Symbol",
                "没有处理循环引用",
                "没有处理Date/RegExp/Set/Map等特殊对象"]
    elif '防抖' in title or '节流' in title:
        return ["混淆防抖和节流的概念",
                "手写实现时忘记清除定时器",
                "this绑定丢失"]
    elif '原型链' in title:
        return ["不清楚__proto__和prototype的关系",
                "属性查找沿原型链向上的过程不理解",
                "ES6 class和原型链的关系不清楚"]
    else:
        return ["对浏览器/Node.js运行机制理解不深入",
                "不能手写核心实现",
                "不知道如何排查前端性能问题"]

def generate_agent_mistakes(title, content):
    if 'Transformer' in title or '注意力' in title:
        return ["不清楚Self-Attention的Q/K/V矩阵的含义",
                "不了解Multi-Head Attention的作用",
                "混淆Encoder-only和Decoder-only架构"]
    elif 'RAG' in title:
        return ["不清楚分块策略对检索质量的影响",
                "不了解向量检索和关键词检索的区别",
                "不知道重排（Re-ranking）的作用"]
    elif 'Function Calling' in title:
        return ["不清楚Schema质量对准确率的影响",
                "不了解参数校验和重试机制",
                "以为LLM直接执行工具（实际只输出调用意图）"]
    elif 'MCP' in title:
        return ["混淆MCP和Function Calling（FC是模型能力，MCP是协议标准）",
                "不清楚Host/Client/Server三层架构",
                "不了解stdio和SSE两种传输方式的区别"]
    elif 'ReAct' in title:
        return ["不清楚ReAct和Plan-and-Execute的区别",
                "不知道如何设置最大循环次数防死循环",
                "不能画出Thought→Action→Observation的循环图"]
    elif 'LoRA' in title or 'Fine-tuning' in title:
        return ["不清楚LoRA的低秩矩阵分解原理",
                "混淆rank和alpha参数的作用",
                "不了解QLoRA的4-bit量化机制"]
    elif '向量数据库' in title:
        return ["不清楚HNSW和IVF两种索引的区别",
                "不了解Embedding模型的选型考量",
                "以为向量数据库只能做相似度搜索"]
    elif '分块' in title:
        return ["不清楚chunk_size和overlap的设置原则",
                "不了解语义分块和固定长度分块的区别",
                "分块过大或过小影响检索质量"]
    else:
        return ["对AI系统的工程化挑战认识不足",
                "不清楚关键组件的工作原理",
                "不能结合实际项目说明应用场景"]

def generate_architecture_mistakes(title, content):
    if 'DDD' in title:
        return ["混淆实体和值对象的区别",
                "不清楚限界上下文的划分原则",
                "把DDD当成技术框架而不是设计方法论"]
    elif '分布式锁' in title:
        return ["释放锁时没有判断锁的持有者（可能释放别人的锁）",
                "不了解Redlock算法的争议（Martin Kleppmann的批评）",
                "锁超时时间设置不当"]
    elif '分布式事务' in title:
        return ["混淆2PC/TCC/Saga/本地消息表的适用场景",
                "不清楚Seata AT模式的undo log机制",
                "所有场景都用强一致性（很多场景最终一致性就够了）"]
    elif '秒杀' in title:
        return ["没有在最前面拦截请求（导致数据库压力过大）",
                "库存扣减没有用原子操作（导致超卖）",
                "没有做限流和风控"]
    elif '缓存' in title:
        return ["混淆穿透、击穿、雪崩三个概念",
                "缓存更新策略选择不当（Cache-Aside vs Read/Write Through）",
                "一致性方案实现有bug"]
    elif '分库分表' in title:
        return ["分片键选择不当导致数据倾斜",
                "跨分片查询没有做优化",
                "分布式ID方案选择不当"]
    elif '限流' in title or '降级' in title or '熔断' in title:
        return ["混淆限流、降级、熔断三个概念",
                "限流算法选择不当（固定窗口有临界问题）",
                "熔断器状态转换不理解（Closed→Open→Half-Open）"]
    elif '幂等' in title:
        return ["幂等性实现方案选择不当",
                "唯一请求ID的生成和传递方式不完善",
                "并发场景下幂等校验和业务操作不是原子的"]
    elif 'Service Mesh' in title:
        return ["不清楚Sidecar代理模式的工作原理",
                "混淆数据面和控制面的职责",
                "不了解mTLS的实现机制"]
    else:
        return ["过度设计或设计不足",
                "不了解系统设计的核心权衡（CAP、一致性 vs 可用性）",
                "不能结合实际项目规模选择合适的方案"]

def generate_design_pattern_mistakes(title, content):
    if '单例' in title:
        return ["DCL单例忘记volatile导致指令重排问题",
                "以为Spring的单例和GoF单例实现方式相同",
                "枚举单例为什么最安全说不清楚"]
    elif '代理' in title:
        return ["不清楚JDK动态代理和CGLIB的使用条件",
                "以为AOP只用于日志和事务",
                "同类方法调用时AOP不生效的原因不清楚"]
    elif '策略' in title:
        return ["把策略模式和状态模式搞混",
                "不知道Spring中如何用Map注入实现策略选择",
                "策略实现类的管理方式不清楚"]
    elif '观察者' in title:
        return ["不清楚Spring事件机制是同步的（异步需要@Async）",
                "不了解MQ作为分布式观察者模式的应用",
                "观察者和被观察者的解耦方式不清楚"]
    elif '工厂' in title:
        return ["混淆简单工厂、工厂方法、抽象工厂",
                "不清楚Spring BeanFactory的工厂模式体现",
                "不知道工厂方法为什么符合开闭原则"]
    elif '模板方法' in title:
        return ["把模板方法模式和策略模式搞混（继承 vs 组合）",
                "不清楚Spring中JdbcTemplate等模板方法的应用",
                "不知道Spring更推荐组合而非继承"]
    elif '责任链' in title:
        return ["不清楚Filter/Interceptor/AOP Advice的执行顺序",
                "不知道如何设置终止条件避免无限传递",
                "责任链和装饰器模式的区别不清楚"]
    elif '装饰器' in title:
        return ["把装饰器模式和代理模式搞混",
                "不清楚Java IO流中的装饰器模式应用",
                "不知道装饰器如何动态添加职责"]
    elif '适配器' in title:
        return ["不清楚类适配器和对象适配器的区别",
                "不知道Spring MVC HandlerAdapter的作用",
                "适配器和装饰器的区别不清楚"]
    elif 'SOLID' in title:
        return ["只背了五个原则的名字，不能结合代码说明",
                "不清楚依赖倒置和依赖注入的区别",
                "在实际项目中教条主义地应用SOLID"]
    else:
        return ["只记住了类图，不理解设计动机",
                "不能结合Spring源码说明应用场景",
                "不知道何时应该使用设计模式（避免过度设计）"]

def generate_dotnet_mistakes(title, content):
    if '依赖注入' in title:
        return ["不清楚三种生命周期（Transient/Scoped/Singleton）的区别",
                "Scoped服务在Singleton中使用导致问题",
                "不了解构造函数注入和属性注入的区别"]
    elif '中间件' in title:
        return ["不清楚中间件的执行顺序",
                "混淆中间件和过滤器的区别",
                "不知道如何自定义中间件"]
    elif 'async/await' in title:
        return ["在UI线程中使用.Result导致死锁",
                "不清楚ConfigureAwait(false)的作用",
                "混淆Task和ValueTask的使用场景"]
    elif 'EF Core' in title:
        return ["不清楚Change Tracker的工作机制",
                "不了解AsNoTracking()的使用场景",
                "N+1查询问题不知道用Include解决"]
    elif 'gRPC' in title:
        return ["不清楚四种通信模式的区别",
                "不了解Protobuf的序列化机制",
                "不知道如何做gRPC的负载均衡"]
    else:
        return ["对.NET Core/8+的运行时机制理解不深入",
                "不清楚和Java/Spring的异同",
                "不能结合实际项目说明应用场景"]

def generate_network_mistakes(title, content):
    if '握手' in title:
        return ["说不清楚为什么是三次握手而不是两次",
                "混淆SYN_SENT和SYN_RCVD状态",
                "TIME_WAIT的作用说不清楚"]
    elif 'HTTPS' in title:
        return ["不清楚TLS握手的完整流程",
                "混淆对称加密和非对称加密的使用场景",
                "不知道证书验证链的作用"]
    elif 'HTTP' in title and '演进' in title:
        return ["不清楚HTTP/2多路复用解决了什么问题",
                "不了解HTTP/3 QUIC的优势",
                "混淆队头阻塞在应用层和传输层的表现"]
    elif 'DNS' in title:
        return ["混淆递归查询和迭代查询的使用场景",
                "不清楚DNS缓存的层次（浏览器→OS→本地DNS）",
                "不知道dig +trace命令的作用"]
    elif 'WebSocket' in title:
        return ["不清楚WebSocket和长轮询的本质区别",
                "不了解心跳机制的作用",
                "不知道Nginx如何配置WebSocket代理"]
    elif 'CORS' in title:
        return ["不清楚简单请求和非简单请求的区别",
                "不了解OPTIONS预检请求的作用",
                "Access-Control-Allow-Origin配置不当"]
    elif 'TCP' in title:
        return ["不清楚流量控制和拥塞控制的区别",
                "不了解滑动窗口的工作机制",
                "粘包问题的解决方案说不清楚"]
    elif 'CDN' in title:
        return ["不清楚CDN的工作流程（用户→Local DNS→CDN DNS→边缘节点）",
                "不了解回源策略和缓存更新机制",
                "不知道HTTPS CDN的证书配置"]
    elif '状态码' in title:
        return ["混淆301和302重定向的区别",
                "分不清401和403的区别",
                "不知道304 Not Modified的触发条件"]
    else:
        return ["对网络协议的理解停留在概念层面",
                "不能用tcpdump/Wireshark实际抓包分析",
                "不知道如何排查网络问题"]

def generate_os_mistakes(title, content):
    if 'IO' in title or '阻塞' in title:
        return ["不清楚四种IO模型的本质区别（数据准备+数据拷贝两阶段）",
                "以为IO多路复用是异步IO（实际上是同步IO）",
                "不了解epoll的ET和LT模式的区别"]
    elif '进程' in title and '线程' in title:
        return ["不清楚进程和线程的本质区别（资源分配 vs CPU调度）",
                "不了解各种进程间通信方式的优劣",
                "不能说出线程同步机制的适用场景"]
    elif '死锁' in title:
        return ["不能完整说出死锁的四个必要条件",
                "不清楚如何破坏循环等待（按顺序加锁）",
                "不知道如何排查死锁（jstack、SHOW ENGINE INNODB STATUS）"]
    elif '虚拟内存' in title:
        return ["不清楚页表的作用和多级页表的优势",
                "不了解TLB的作用",
                "缺页中断的处理流程说不清楚"]
    elif 'epoll' in title or 'select' in title:
        return ["不清楚select/poll/epoll的核心区别",
                "不了解epoll的红黑树+就绪链表结构",
                "ET和LT模式的使用场景搞混"]
    elif '协程' in title:
        return ["不清楚协程和线程的本质区别",
                "不了解Go的GMP调度模型",
                "不知道Java Virtual Threads的使用注意事项"]
    elif '内存泄漏' in title:
        return ["不清楚内存泄漏的常见原因",
                "不知道如何用jmap/MAT排查内存泄漏",
                "混淆内存泄漏和内存溢出"]
    elif '页面置换' in title:
        return ["不清楚LRU的实现方式（栈或计数器）",
                "不了解Clock算法如何近似LRU",
                "不知道颠簸（Thrashing）的原因和解决"]
    elif '文件权限' in title:
        return ["不清楚rwx三种权限的含义",
                "不了解SUID/SGID/Sticky Bit特殊权限",
                "umask的作用说不清楚"]
    else:
        return ["对OS的核心概念理解不深入",
                "不能用top/strace/lsof等工具排查问题",
                "不知道如何将OS知识应用到实际开发中"]

# ============================================================
# Process all topics
# ============================================================

print("Fixing commonMistakes for all topics...")
count = 0
for f in sorted(glob.glob('topics/*/*.json')):
    try:
        with open(f) as fh:
            data = json.load(fh)
    except:
        continue

    title = data.get('title', '')
    old_mistakes = data.get('rubric', {}).get('commonMistakes', [])
    new_mistakes = generate_specific_mistakes(data)

    if old_mistakes != new_mistakes:
        if 'rubric' in data:
            data['rubric']['commonMistakes'] = new_mistakes
            with open(f, 'w', encoding='utf-8') as fh:
                json.dump(data, fh, ensure_ascii=False, indent=2)
            count += 1

print(f"Done! Updated {count} topics' commonMistakes")
