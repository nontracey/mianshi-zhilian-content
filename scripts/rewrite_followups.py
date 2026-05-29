#!/usr/bin/env python3
"""Rewrite followUpQuestions for all topics with specific, contextual answers."""
import json, glob, re

# ============================================================
# Domain-specific answer generators
# ============================================================

def generate_jvm_deep_answer(title, content, concepts):
    if 'GC' in title or '垃圾' in title:
        return ("GC调优的核心是理解对象的生命周期。新生代用复制算法（Eden→S0/S1），老年代用标记-清除或标记-整理。"
                "关键参数：-XX:MaxTenuringThreshold控制晋升年龄，-XX:GCTimeRatio控制吞吐量。"
                "实际项目中，频繁Minor GC通常是新生代太小或大对象直接进入老年代导致的。"
                "用jstat -gcutil观察各区域使用率，如果S0/S1频繁翻转说明Survivor空间不足。")
    elif '类加载' in title:
        return ("类加载的核心是双亲委派模型：Bootstrap→Extension→Application→自定义ClassLoader。"
                "打破双亲委派的典型场景：Tomcat的WebAppClassLoader（每个应用独立加载）、"
                "SPI机制（Thread.getContextClassLoader）、OSGi模块化。"
                "实际排查时用-verbose:class参数打印类加载日志，用jcmd查看类的元数据占用。")
    elif '调优' in title or '参数' in title:
        return ("JVM调优的核心步骤：1）用jstat/gc.log收集GC数据；2）分析Full GC频率和停顿时间；"
                "3）调整堆大小和新生代比例；4）选择合适的GC收集器。"
                "生产环境推荐：-Xms=-Xmx（避免动态扩缩）、-XX:+HeapDumpOnOutOfMemoryError（自动转储）。"
                "用Arthas在线诊断比重启应用更高效。")
    elif '运行时' in title or '内存' in title or '堆' in title:
        return ("运行时数据区的关键是理解线程私有和共享的区别。程序计数器是唯一不会OOM的区域。"
                "虚拟机栈的栈帧包含局部变量表、操作数栈、动态链接、返回地址。"
                "堆是GC主战场，分新生代(Eden+S0+S1)和老年代。"
                "方法区在JDK8后改为元空间(Metaspace)，使用本地内存。"
                "排查OOM时先用-XX:+HeapDumpOnOutOfMemoryError生成堆转储，再用MAT分析。")
    elif '引用' in title:
        return ("Java四种引用类型：强引用（不会被GC）、软引用（内存不足时GC，适合缓存）、"
                "弱引用（下次GC就回收，如ThreadLocalMap的key）、虚引用（仅用于跟踪GC）。"
                "实际项目中：SoftReference做图片缓存，WeakReference做规范映射（如WeakHashMap）。"
                "GC Roots包括：虚拟机栈引用、方法区静态变量/常量引用、本地方法栈JNI引用。")
    else:
        return (title + "的核心实现涉及JVM底层机制。关键是要理解数据在内存中的布局和生命周期。"
                "建议用jcmd、jmap、jstack等工具实际观察，结合源码理解HotSpot的实现。")

def generate_concurrency_deep_answer(title, content, concepts):
    if 'synchronized' in title.lower():
        return ("synchronized在JDK6后有偏向锁→轻量级锁→重量级锁的升级过程。"
                "偏向锁在对象头Mark Word中记录线程ID，无竞争时几乎零开销。"
                "轻量级锁用CAS自旋，适合竞争不激烈的场景。"
                "重量级锁涉及OS的mutex，开销最大。"
                "实际项目中大部分锁竞争都不激烈，偏向锁就能解决。")
    elif 'volatile' in title.lower():
        return ("volatile通过内存屏障保证可见性和禁止指令重排。"
                "写操作后加StoreLoad屏障，读操作前加LoadLoad屏障。"
                "但它不保证原子性，i++这种复合操作仍然不安全。"
                "实际项目中volatile最常用于状态标志位和双重检查锁定（DCL单例）。")
    elif 'AQS' in title:
        return ("AQS的核心是state变量+CLH队列。state=0表示无锁，state>0表示有锁（重入次数）。"
                "获取锁时CAS修改state，失败则封装为Node加入CLH队列并park。"
                "释放锁时unpark队列头部节点。ReentrantLock、Semaphore、CountDownLatch都基于AQS。"
                "面试时要能画出CLH队列的结构和节点状态变化图。")
    elif '线程池' in title:
        return ("线程池的核心参数：corePoolSize→workQueue→maximumPoolSize→RejectedExecutionHandler。"
                "执行流程：核心线程未满→创建核心线程；队列未满→入队；最大线程未满→创建非核心线程；满了→拒绝。"
                "生产环境建议用ThreadPoolExecutor而非Executors，后者用无界队列可能导致OOM。"
                "用allowCoreThreadTimeOut(true)让核心线程也能回收。")
    elif 'ConcurrentHashMap' in title:
        return ("ConcurrentHashMap在JDK8后改为数组+链表+红黑树，用CAS+synchronized实现并发安全。"
                "put时对桶头节点加synchronized锁（锁粒度比Segment更细），扩容时多线程协作迁移数据。"
                "size()方法用baseCount+CounterCell数组实现高效计数。")
    elif 'ThreadLocal' in title:
        return ("ThreadLocal的核心是每个Thread持有一个ThreadLocalMap，key是弱引用，value是实际值。"
                "内存泄漏原因：ThreadLocal被GC后key变null，但value仍被Entry强引用。"
                "解决方案：用完后调用remove()。典型场景：数据库连接、用户上下文。"
                "线程池中使用ThreadLocal要特别注意，因为线程会被复用。")
    elif 'CompletableFuture' in title:
        return ("CompletableFuture核心方法：supplyAsync（异步执行）、thenApply（转换结果）、"
                "thenCombine（合并两个Future）、allOf（等待全部完成）。"
                "异常处理：exceptionally（降级）、handle（统一处理）。"
                "实际项目中用thenCompose处理有依赖的异步链。自定义线程池避免用ForkJoinPool.commonPool()。")
    elif 'HashMap' in title:
        return ("HashMap核心：数组+链表+红黑树。默认容量16，负载因子0.75，扩容时容量翻倍。"
                "链表长度≥8且数组长度≥64时转红黑树，红黑树节点≤6时退化为链表。"
                "rehash通过高位bit判断新位置：要么在原位，要么在原位+旧容量。"
                "JDK8的改进：头插法改为尾插法（解决死循环）。")
    elif 'ArrayList' in title or 'LinkedList' in title:
        return ("ArrayList底层是数组，随机访问O(1)，中间插入O(n)；"
                "LinkedList底层是双向链表，随机访问O(n)，已知位置插入O(1)。"
                "实际项目中ArrayList几乎总是优于LinkedList，因为CPU缓存友好性远比理论复杂度重要。"
                "ArrayList扩容：新容量=旧容量*1.5，Arrays.copyOf()复制。")
    else:
        return (title + "的核心是理解Java内存模型(JMM)和并发原语。"
                "关键要点：原子性（CAS/synchronized）、可见性（volatile）、有序性（happens-before）。"
                "建议通过画时序图、debug源码来理解线程间的交互。")

def generate_spring_deep_answer(title, content, concepts):
    if '自动装配' in title or 'IoC' in title:
        return ("Spring IoC核心是BeanFactory和ApplicationContext。"
                "自动装配流程：@ComponentScan扫描→解析BeanDefinition→实例化→属性注入→初始化。"
                "@Autowired先按类型匹配，再按@Qualifier名称匹配。"
                "@Conditional系列注解控制Bean的条件加载。源码入口：AbstractApplicationContext.refresh()。")
    elif 'AOP' in title:
        return ("Spring AOP实现：JDK动态代理（接口）或CGLIB（类）。"
                "代理对象在BeanPostProcessor.postProcessAfterInitialization中创建。"
                "@Aspect定义切面，@Around/@Before/@After定义通知。"
                "关键类：AnnotationAwareAspectJAutoProxyCreator。实际项目中AOP常用于日志、权限、事务。")
    elif 'Bean' in title or '生命周期' in title:
        return ("Bean的完整生命周期：实例化→属性注入→Aware回调→BeanPostProcessor前置→"
                "@PostConstruct→InitializingBean→init-method→BeanPostProcessor后置→使用→销毁。"
                "循环依赖通过三级缓存解决：singletonObjects→earlySingletonObjects→singletonFactories。")
    elif 'MyBatis' in title:
        return ("MyBatis核心流程：解析XML/注解→创建SqlSessionFactory→获取SqlSession→执行Mapper代理→JDBC。"
                "一级缓存是SqlSession级别（默认开启），二级缓存是namespace级别（需手动开启）。"
                "井号花括号防SQL注入（PreparedStatement），美元花括号直接拼接。"
                "插件机制通过Interceptor链实现。")
    elif 'Nacos' in title:
        return ("Nacos注册中心机制：服务注册→心跳保活(15s)→服务发现(Pull+Push)。"
                "临时实例用AP模式（Distro协议），持久实例用CP模式（Raft协议）。"
                "配置管理：长轮询(30s超时)+本地文件缓存。"
                "注意namespace/group/dataId三层隔离，以及配置的灰度发布。")
    elif 'Gateway' in title:
        return ("Spring Cloud Gateway核心：Route→Predicate→Filter。"
                "请求流程：客户端→Gateway Handler Mapping→Filter Chain→目标服务。"
                "过滤器分Pre和Post两种。自定义过滤器实现GlobalFilter接口。"
                "限流用RequestRateLimiter+Redis，跨域用CorsWebFilter。")
    elif 'Sentinel' in title:
        return ("Sentinel的核心概念：资源→规则→效果。"
                "三种防护：限流（QPS/线程数）、降级（慢调用/异常比例）、熔断（断路器）。"
                "限流算法：滑动窗口（默认）、令牌桶、漏桶。"
                "热点参数限流：对特定参数值单独限流。集群限流：Token Server统一管理。")
    elif 'Seata' in title or '分布式事务' in title:
        return ("Seata支持AT/TCC/Saga/XA四种模式。"
                "AT模式核心：一阶段本地事务+undo log，二阶段提交或回滚。"
                "全局事务通过TC（Transaction Coordinator）协调。"
                "实际项目中大部分场景用最终一致性就够了，如本地消息表+MQ。")
    elif 'Redis' in title:
        return ("Redis核心数据结构：String→SDS、List→quicklist、Hash→ziplist/hashtable、"
                "Set→intset/hashtable、ZSet→ziplist/skiplist。"
                "持久化：RDB（快照）+AOF（追加命令）。生产环境建议同时开启。"
                "缓存穿透→布隆过滤器、缓存击穿→互斥锁、缓存雪崩→随机过期时间。")
    elif 'RabbitMQ' in title:
        return ("RabbitMQ核心：Exchange→Binding→Queue→Consumer。"
                "四种Exchange：Direct（精确）、Topic（通配符）、Fanout（广播）、Headers。"
                "可靠性：生产端confirm、持久化、消费端ack。死信队列处理失败消息。"
                "延迟队列用TTL+死信或延迟插件。")
    elif 'Kafka' in title:
        return ("Kafka核心：Producer→Broker→Consumer Group。"
                "一个Topic有多个Partition，消费者组内每个Partition只能被一个Consumer消费。"
                "副本机制：Leader处理读写，Follower同步。ISR列表维护同步副本。"
                "ack=all时等所有ISR确认才返回。Partition数决定消费并行度。")
    else:
        return (title + "的源码实现涉及Spring的核心机制。"
                "建议从AbstractApplicationContext.refresh()入口跟踪Bean的创建、依赖注入、AOP代理全流程。")

def generate_database_deep_answer(title, content, concepts):
    if '索引' in title:
        return ("MySQL索引核心是B+树：非叶子节点只存索引，叶子节点存数据且用双向链表连接。"
                "联合索引遵循最左前缀原则。覆盖索引避免回表。"
                "EXPLAIN看type列：const>eq_ref>ref>range>index>ALL。"
                "实际优化：避免索引列上用函数、避免隐式类型转换、用LIMIT限制扫描行数。")
    elif '事务' in title or 'MVCC' in title:
        return ("MySQL事务ACID实现：A靠undo log、I靠锁、D靠redo log(WAL)、D+I靠MVCC。"
                "MVCC通过Read View + undo log版本链实现。"
                "RC级别每次读创建新Read View，RR级别只在第一次读时创建。"
                "InnoDB行锁有三种：Record Lock、Gap Lock、Next-Key Lock。")
    elif '锁' in title:
        return ("MySQL锁层次：全局锁→表锁→行锁。"
                "InnoDB行锁：Record Lock（记录锁）、Gap Lock（间隙锁）、Next-Key Lock。"
                "加锁规则：等值查询唯一索引命中→Record Lock；未命中→Gap Lock；范围查询→Next-Key Lock。"
                "死锁排查：SHOW ENGINE INNODB STATUS查看死锁日志。")
    elif 'SQL' in title or '优化' in title or '慢' in title:
        return ("SQL优化核心：1）EXPLAIN分析执行计划；2）避免全表扫描；3）减少IO（覆盖索引、LIMIT）；"
                "4）减少CPU（避免函数计算、减少排序）。"
                "慢SQL排查：开启slow_query_log，用mysqldumpslow分析。"
                "分库分表中间件：ShardingSphere。")
    else:
        return (title + "的核心是理解MySQL的存储引擎架构。"
                "InnoDB的Buffer Pool、redo log、undo log协同工作保证事务ACID。"
                "建议用EXPLAIN分析实际SQL，结合源码理解加锁和MVCC机制。")

def generate_middleware_deep_answer(title, content, concepts):
    if 'Redis' in title and ('数据结构' in title or '基础' in title or 'String' in title):
        return ("Redis五种基础数据结构底层实现：String→SDS、List→quicklist、"
                "Hash→ziplist/hashtable、Set→intset/hashtable、ZSet→ziplist/skiplist。"
                "大Key问题：单个Key的value过大导致阻塞，用UNLINK异步删除。"
                "实际项目中用ZSet实现排行榜，用Hash存储对象，用Bitmap做签到统计。")
    elif 'Redis' in title and ('集群' in title or '高可用' in title):
        return ("Redis集群方案：主从复制（读写分离）→Sentinel（自动故障转移）→Cluster（数据分片）。"
                "Cluster用16384个槽位分配数据。故障转移：主观下线→客观下线→从节点选举→提升为主。"
                "客户端用MOVED/ASK重定向到正确节点。实际项目中Cluster至少3主3从。")
    elif '分布式锁' in title:
        return ("Redis分布式锁核心：SET key value NX PX 30000（原子操作+超时）。"
                "释放锁用Lua脚本保证原子性。Redisson的看门狗机制自动续期。"
                "Zookeeper分布式锁用临时顺序节点+Watcher，性能不如Redis但更可靠。"
                "选型：高并发选Redis，强一致选Zookeeper。")
    elif 'RabbitMQ' in title:
        return ("RabbitMQ核心：Exchange→Binding→Queue→Consumer。"
                "四种Exchange：Direct、Topic、Fanout、Headers。"
                "可靠性保证：生产端confirm、持久化、消费端ack。死信队列处理失败消息。")
    elif 'Kafka' in title:
        return ("Kafka核心架构：Producer→Broker→Consumer Group。"
                "分区机制保证有序，消费者组保证不重复消费。"
                "副本机制：Leader处理读写，Follower同步。ISR列表维护同步副本。"
                "ack=all等所有ISR确认才返回。Partition数决定消费并行度。")
    else:
        return (title + "的核心是理解分布式系统中的一致性、可用性和分区容错。"
                "建议结合实际项目中的使用场景理解中间件的设计动机和最佳实践。")

def generate_java_deep_answer(title, content, concepts):
    if '泛型' in title:
        return ("Java泛型是类型擦除的：编译期检查类型安全，运行时擦除为原始类型。"
                "? extends T（上界，只读）、? super T（下界，只写）——PECS原则。"
                "不能new T()、不能instanceof T、不能创建泛型数组。"
                "桥接方法：编译器为保持多态性自动生成。")
    elif '反射' in title or '注解' in title:
        return ("反射核心类：Class、Field、Method、Constructor。"
                "获取Class三种方式：Class.forName()、obj.getClass()、类名.class。"
                "反射性能开销：比直接调用慢5-10倍，setAccessible(true)跳过安全检查提速。"
                "Spring大量使用反射实现IoC和AOP。JDK动态代理基于反射。")
    elif 'Lambda' in title or '函数式' in title:
        return ("Lambda本质是匿名内部类的语法糖，但实现机制不同：invokedynamic指令动态生成实现类。"
                "函数式接口：只有一个抽象方法的接口（@FunctionalInterface）。"
                "常用：Function（转换）、Predicate（判断）、Consumer（消费）、Supplier（供给）。"
                "方法引用：类::静态方法、对象::实例方法。")
    elif 'Stream' in title:
        return ("Stream核心操作：中间操作（filter/map/flatMap/sorted/distinct）和终端操作（collect/reduce/forEach）。"
                "并行流用ForkJoinPool.commonPool()，注意线程安全。"
                "常用收集器：Collectors.toList()、groupingBy()、joining()。"
                "性能注意：小数据量用for循环更快，大数据量用并行流。")
    elif 'Optional' in title:
        return ("Optional的核心：避免NullPointerException。"
                "创建：Optional.of(value)、Optional.ofNullable(value)、Optional.empty()。"
                "使用：map（转换）、flatMap（扁平转换）、filter（过滤）、orElse（默认值）。"
                "最佳实践：不要用Optional做字段类型、不要orElse(null)、用orElseGet避免不必要的计算。")
    elif 'Record' in title:
        return ("Record是Java 14+引入的数据类：自动生成构造器、getter、equals、hashCode、toString。"
                "Record是不可变的（final字段），不能继承其他类（但可以实现接口）。"
                "适用场景：DTO、值对象、API响应。和Lombok @Data的区别：Record是语言特性。")
    elif 'Virtual' in title or '虚拟线程' in title:
        return ("Virtual Threads是Java 21+的协程实现：用户态线程，由JVM调度（不经过OS内核）。"
                "创建：Thread.ofVirtual().start(runnable) 或 Executors.newVirtualThreadPerTaskExecutor()。"
                "优势：可以轻松创建百万个，适合IO密集型任务。"
                "注意：不要用synchronized（会pin carrier thread），用ReentrantLock替代。")
    else:
        return (title + "的核心是理解Java语言特性的设计动机和底层实现。"
                "建议通过反编译字节码、阅读JLS规范来深入理解。")

def generate_algorithm_deep_answer(title, content, concepts):
    if '数组' in title:
        return ("数组题核心技巧：1）双指针将O(n²)降到O(n)；2）滑动窗口维护[left,right)区间；"
                "3）前缀和将区间求和从O(n)优化到O(1)；4）原地哈希利用下标。"
                "变体：三数之和→排序+双指针+去重；盛水容器→移动短边；接雨水→维护leftMax/rightMax。")
    elif '链表' in title:
        return ("链表题核心技巧：1）dummy头节点简化边界处理；2）快慢指针找中点/判环；"
                "3）反转链表用三指针法（prev/curr/next）。"
                "变体：K个一组反转→递归/迭代；LRU缓存→HashMap+双向链表。"
                "最易错：边界处理（空链表、单节点、头尾节点）。")
    elif '二叉树' in title:
        return ("二叉树核心是递归思维：处理当前节点+递归左右子树。"
                "遍历：前序（根左右）、中序（左根右）、后序（左右根）、层序（BFS）。"
                "变体：路径总和→DFS+回溯；最近公共祖先→后序遍历；序列化→前序+null标记。")
    elif 'DP' in title or '动态规划' in title:
        return ("DP核心：定义状态→推导转移方程→确定初始条件→确定遍历顺序。"
                "背包问题：0-1背包用dp[i][w]=max(dp[i-1][w], dp[i-1][w-wi]+vi)，空间优化为一维倒序。"
                "变体：编辑距离→二维DP；最长公共子序列→二维DP；打家劫舍→一维DP。")
    elif '回溯' in title:
        return ("回溯核心：选择→递归→撤销。模板：for循环遍历选择列表→做选择→递归→撤销。"
                "关键：剪枝条件（排序后跳过重复）、选择列表维护（used数组或startIndex）。"
                "变体：全排列→used数组；组合→startIndex；N皇后→列+对角线集合。")
    elif '排序' in title:
        return ("排序对比：快排O(nlogn)平均不稳定→partition思想；归并O(nlogn)稳定→分治+合并；"
                "堆排O(nlogn)不稳定→建堆+取堆顶。"
                "快排优化：三数取中、小数组用插入排序。Java的Arrays.sort：基本类型用双轴快排。")
    elif '二分' in title:
        return ("二分查找核心：确定搜索区间和边界条件。"
                "两种模板：左闭右闭[left,right]和左闭右开[left,right)。"
                "mid计算防溢出用left+(right-left)/2。"
                "易错点：循环条件（<vs<=）、边界更新（mid±1 vs mid）、返回值。")
    elif '栈' in title or '队列' in title:
        return ("栈的经典应用：括号匹配、表达式求值、单调栈（下一个更大元素）。"
                "队列的经典应用：BFS层序遍历、单调队列（滑动窗口最大值）。"
                "优先队列（堆）：TopK用小根堆、中位数用两个堆。"
                "单调栈关键：维护递减/递增序列，弹出时处理结果。")
    elif '哈希' in title:
        return ("哈希表核心：哈希函数→冲突解决→扩容。"
                "Java HashMap：数组+链表+红黑树，负载因子0.75，链表≥8转红黑树。"
                "常用技巧：用HashMap存储中间结果（两数之和）、字符计数（字母异位词）。"
                "变体：LRU→HashMap+双向链表；LFU→HashMap+双HashMap。")
    elif '贪心' in title:
        return ("贪心核心：每一步都选当前最优解。适用条件：贪心选择性质+最优子结构。"
                "经典问题：区间调度（按结束时间排序）、跳跃游戏（维护最远可达位置）。"
                "和DP的区别：贪心不需要回溯，DP需要记录所有子问题。"
                "贪心的正确性需要证明（反证法/交换论证）。")
    elif '图' in title or 'BFS' in title or 'DFS' in title:
        return ("图的BFS核心：用队列实现层序遍历，适合求最短路径（无权图）。"
                "DFS核心：用栈或递归实现深度遍历，适合求连通分量、拓扑排序。"
                "邻接矩阵vs邻接表：稠密图用矩阵，稀疏图用邻接表。"
                "Dijkstra求最短路径（非负权），Bellman-Ford处理负权边。")
    elif '拓扑排序' in title:
        return ("拓扑排序核心：对DAG（有向无环图）进行线性排序，使得所有边(u,v)中u排在v前面。"
                "两种算法：Kahn算法（BFS+入度表）和DFS后序遍历反转。"
                "应用场景：任务调度、课程安排、编译依赖。"
                "检测环：如果排序后节点数<图中节点数，说明有环。")
    elif '背包' in title:
        return ("背包问题核心：0-1背包每件物品只能选一次，完全背包可以选无限次。"
                "0-1背包：dp[j]=max(dp[j], dp[j-w]+v)，一维倒序遍历。"
                "完全背包：dp[j]=max(dp[j], dp[j-w]+v)，一维正序遍历。"
                "变体：多重背包（二进制拆分）、分组背包。")
    elif '并查集' in title:
        return ("并查集核心操作：Find（查找根节点）和Union（合并两个集合）。"
                "优化：路径压缩（find时直接指向根）+按秩合并（矮树接高树）。"
                "时间复杂度：近似O(1)（阿克曼函数的反函数）。"
                "应用：连通分量判断、Kruskal最小生成树、朋友圈问题。")
    elif 'Trie' in title:
        return ("Trie（字典树）核心：每个节点代表一个字符，从根到叶的路径代表一个单词。"
                "插入和查找时间复杂度O(L)，L为单词长度。空间复杂度O(N*L)。"
                "应用：自动补全、拼写检查、IP路由表。"
                "优化：压缩Trie（Patricia Trie）合并单分支节点。")
    else:
        return (title + "的核心是理解算法思想和模板。"
                "建议先理解模板，再通过变体题练习灵活运用。面试时先说思路再写代码。")

def generate_frontend_deep_answer(title, content, concepts):
    if '闭包' in title:
        return ("闭包本质：函数记住并访问其词法作用域，即使在作用域外执行。"
                "经典应用：防抖/节流、模块模式、柯里化。"
                "内存泄漏风险：闭包持有外部变量引用。事件监听器和定时器中的闭包最容易泄漏。")
    elif 'Promise' in title and '手写' in title:
        return ("手写Promise关键：then方法返回新Promise实现链式调用、"
                "异步执行用微任务队列、错误冒泡用try-catch。"
                "Promise.all用计数器判断全部完成，Promise.race用第一个resolve/reject。"
                "async/await是Promise的语法糖，本质是Generator+自动执行器。")
    elif 'Event Loop' in title:
        return ("JS事件循环：宏任务→微任务→渲染→下一帧。"
                "Node.js有6个阶段：timers→poll→check(setImmediate)等。"
                "关键区别：浏览器微任务在宏任务之间执行，Node微任务在每个阶段之间执行。"
                "process.nextTick优先级高于Promise。requestAnimationFrame在渲染前执行。")
    elif 'React' in title and 'Fiber' in title:
        return ("React Fiber核心：将渲染拆分为小单元，可中断和恢复。"
                "双缓冲：current tree和workInProgress tree。"
                "调度优先级：Immediate>UserBlocking>Normal>Low>Idle。"
                "Concurrent Mode让渲染可中断，避免阻塞主线程。")
    elif 'React' in title and 'Hooks' in title:
        return ("Hooks规则：只在顶层调用、只在React函数组件中调用。"
                "useState用链表存储状态，useEffect用链表存储副作用。"
                "useCallback缓存函数引用，useMemo缓存计算结果。"
                "闭包陷阱：useEffect中拿到的是旧值，用useRef解决。")
    elif 'Vue' in title and '响应式' in title:
        return ("Vue3响应式：Proxy+effect+track/trigger。"
                "Proxy拦截get时track收集依赖，set时trigger触发更新。"
                "和Vue2区别：Vue2用defineProperty无法监听新增属性和数组下标。"
                "ref需要.value访问，reactive直接访问。computed是带缓存的effect。")
    elif 'Webpack' in title:
        return ("Webpack核心流程：初始化→创建Compiler→确定Entry→递归分析依赖→构建Module→输出Bundle。"
                "Loader是转换器（如babel-loader），Plugin是扩展器（通过hooks介入编译）。"
                "Tree Shaking基于ESM静态分析。代码分割：动态import()、SplitChunksPlugin。")
    elif 'Vite' in title:
        return ("Vite优势：开发阶段用ESM原生加载，不需要打包（快！）。生产用Rollup打包。"
                "预构建：esbuild将CommonJS转为ESM、合并小模块。"
                "HMR基于ESM模块图。和Webpack区别：Webpack先打包再启动，Vite直接启动按需编译。")
    elif '深拷贝' in title:
        return ("深拷贝实现：1）JSON.parse(JSON.stringify())（最简单但丢失函数/undefined/Symbol）；"
                "2）structuredClone()（原生API，处理循环引用）；3）递归+WeakMap处理循环引用。"
                "手写关键：判断Date/RegExp/Set/Map等特殊对象、用WeakMap记录已拷贝对象防循环。")
    elif '防抖' in title or '节流' in title:
        return ("防抖：连续触发只执行最后一次（搜索框输入）。实现：clearTimeout+setTimeout。"
                "节流：每隔一段时间执行一次（滚动事件、resize）。实现：时间戳或setTimeout。"
                "区别：防抖延迟执行，节流固定频率执行。面试要能手写并说明应用场景。")
    elif '原型链' in title:
        return ("原型链核心：每个对象有__proto__指向构造函数的prototype。"
                "属性查找沿原型链向上，直到null。hasOwnProperty判断自身属性。"
                "new的实现：创建空对象→绑定原型→执行构造函数→返回对象。"
                "ES6 class是语法糖，底层还是原型链。")
    else:
        return (title + "的核心是理解浏览器/Node.js的运行机制。"
                "建议通过Chrome DevTools的Performance面板和Sources面板实际调试。")

def generate_agent_deep_answer(title, content, concepts):
    if 'Transformer' in title or '注意力' in title:
        return ("Transformer核心是Self-Attention：Q/K/V三个矩阵，Attention=softmax(QK^T/√d)V。"
                "Multi-Head让模型关注不同位置信息。位置编码用正弦函数或RoPE。"
                "实际训练用Flash Attention优化显存和速度。"
                "GPT用Decoder-only（带Masked Attention），BERT用Encoder-only。")
    elif 'RAG' in title and '基础' in title:
        return ("RAG核心流程：文档加载→分块→Embedding→存入向量库→查询→检索→重排→LLM生成。"
                "分块策略：按句子/段落/固定长度，chunk_size通常500-1000 tokens。"
                "检索方式：向量检索+关键词检索(BM25)，混合检索效果最好。"
                "重排用Cross-Encoder提高精度。")
    elif 'Function Calling' in title:
        return ("Function Calling核心：LLM只输出调用意图（函数名+参数JSON），不直接执行。"
                "Schema质量直接影响准确率：好的描述能将准确率从70%提升到95%。"
                "最佳实践：命名用动词+名词、参数≤5个、给默认值和枚举约束。"
                "常见坑：参数格式错误、工具选择错误（控制≤10个）、幻觉参数。")
    elif 'MCP' in title:
        return ("MCP标准化LLM与外部工具/数据源的通信协议。"
                "架构：Host→Client→Server。三种能力：Tools、Resources、Prompts。"
                "传输方式：stdio（本地进程）和SSE（HTTP）。"
                "和Function Calling区别：FC是模型能力，MCP是协议标准。")
    elif 'ReAct' in title:
        return ("ReAct核心：Thought→Action→Observation循环。"
                "和Plan-and-Execute区别：ReAct边想边做（简单任务），Plan先规划后执行（复杂任务）。"
                "实际实现要设置最大循环次数防死循环，用LLM判断是否得到最终答案。")
    elif 'LoRA' in title or 'Fine-tuning' in title:
        return ("LoRA核心：冻结预训练权重，在每个Transformer层注入低秩矩阵A和B（rank 8-64）。"
                "QLoRA用4-bit量化底模+LoRA，单卡就能微调7B模型。"
                "关键参数：rank、alpha、target_modules（通常选q_proj和v_proj）。"
                "数据质量比数据数量更重要。")
    elif 'RAG' in title and '评估' in title:
        return ("RAG评估核心指标：检索精度（Recall@K、MRR）、生成质量（Faithfulness、Relevancy）。"
                "评估框架：RAGAS（自动化评估）、TruLens（可观测性）。"
                "优化方向：分块策略、Embedding模型、检索方式、重排模型、Prompt模板。"
                "关键：先评估检索质量，再优化生成质量。")
    elif '向量数据库' in title:
        return ("向量数据库对比：Milvus（分布式、高性能）、Pinecone（全托管、易用）、"
                "Weaviate（支持混合检索）、Chroma（轻量级、适合原型）、FAISS（Facebook开源、纯库）。"
                "选型考虑：数据规模、性能要求、运维成本、社区活跃度。"
                "索引类型：HNSW（精度高、内存大）、IVF（内存省、需要训练）。")
    elif '分块' in title:
        return ("文档分块策略：固定长度（简单但可能切断语义）、"
                "按句子/段落（语义完整但长度不均）、递归分割（先大后小）。"
                "chunk_size通常500-1000 tokens，overlap 10-20%。"
                "高级策略：语义分块（用Embedding判断语义边界）、Parent-Child分块。")
    elif '语义缓存' in title or '成本优化' in title:
        return ("语义缓存核心：用Embedding计算查询相似度，相似查询直接返回缓存结果。"
                "成本优化：1）缓存减少重复调用；2）路由（简单问题用小模型）；"
                "3）压缩Prompt（减少Token数）；4）批处理（合并多个请求）。"
                "监控：跟踪每个请求的Token消耗和延迟。")
    elif '模型路由' in title or '降级' in title:
        return ("模型路由核心：根据查询复杂度、领域、语言选择不同模型。"
                "简单问题→小模型（便宜快），复杂问题→大模型（贵但准）。"
                "降级方案：主模型超时/报错→切换备用模型。"
                "实现：规则路由（关键词匹配）或ML路由（分类器判断复杂度）。")
    elif '多Agent' in title:
        return ("多Agent协作模式：主从模式（一个调度多个执行）、对等模式（Agent间平等协作）、"
                "层级模式（多层Agent逐级分解任务）。"
                "关键挑战：任务分解、结果合并、冲突解决、通信开销。"
                "框架：AutoGen、CrewAI、LangGraph。实际项目中先用单Agent，复杂时再拆多Agent。")
    elif '状态管理' in title and 'Agent' in title:
        return ("Agent状态管理核心：短期记忆（当前对话上下文）、长期记忆（历史知识）、"
                "工作记忆（当前任务的中间结果）。"
                "存储方案：向量数据库（语义检索）、KV存储（精确查找）、图数据库（关系推理）。"
                "关键：上下文窗口有限，要做信息压缩和优先级排序。")
    else:
        return (title + "的核心是理解AI系统的工程化实践。"
                "建议通过实际搭建RAG/Agent系统来理解各个环节的挑战和最佳实践。")

def generate_architecture_deep_answer(title, content, concepts):
    if 'DDD' in title:
        return ("DDD核心概念：限界上下文（模型边界）、聚合（一致性边界）、实体（有唯一标识）、"
                "值对象（无标识，不可变）。"
                "战略设计：事件风暴→识别限界上下文→定义上下文映射。"
                "落地关键：和团队达成统一语言（Ubiquitous Language）。")
    elif '分布式锁' in title:
        return ("分布式锁三种实现：Redis（SET NX PX + Lua释放）、Zookeeper（临时顺序节点+Watcher）、"
                "数据库（SELECT FOR UPDATE或唯一索引）。"
                "选型：高并发选Redis、强一致选Zookeeper、简单场景用数据库。"
                "Redisson看门狗自动续期避免锁提前释放。")
    elif '分布式事务' in title:
        return ("分布式事务方案：2PC（强一致但阻塞）、TCC（灵活但侵入大）、Saga（长事务但补偿复杂）、"
                "本地消息表（可靠但实现复杂）、RocketMQ事务消息（最终一致性）。"
                "实际项目中大部分场景用最终一致性就够了。")
    elif '秒杀' in title:
        return ("秒杀系统核心：1）前端：静态化+CDN+验证码；2）网关：限流+风控；"
                "3）服务：Redis预减库存+Lua原子操作+异步下单；4）数据库：乐观锁+唯一索引。"
                "关键：把请求拦截在最前面，真正到数据库的请求很少。")
    elif '缓存' in title:
        return ("缓存三大问题：穿透（查不存在的数据→布隆过滤器）、击穿（热点Key过期→互斥锁）、"
                "雪崩（大量Key同时过期→随机过期时间）。"
                "缓存策略：Cache-Aside（先更新DB再删缓存）、Read/Write Through、Write Behind。"
                "一致性方案：延迟双删、Canal监听Binlog。")
    elif '分库分表' in title:
        return ("分库分表核心：垂直拆分（按业务）和水平拆分（按规则）。"
                "分片键选择：查询频率高、数据分布均匀。"
                "分片算法：取模、范围、一致性哈希。"
                "常见问题：跨分片查询、分布式ID（雪花算法）、分页排序。")
    elif '限流' in title or '降级' in title or '熔断' in title:
        return ("限流算法：固定窗口→滑动窗口→漏桶→令牌桶。"
                "降级：非核心服务暂时关闭，保证核心链路可用。"
                "熔断：错误率超阈值→断路器打开→快速失败→半开探测。"
                "Sentinel/Gateway集成限流，Hystrix/Resilience4j实现熔断。")
    elif '幂等' in title:
        return ("幂等性核心：同一个操作执行多次，结果和执行一次相同。"
                "实现方案：唯一请求ID+去重表、Token机制（提交前获取token，提交时验证）、"
                "数据库唯一索引、乐观锁（version字段）。"
                "场景：支付回调、消息重试、表单重复提交。")
    elif 'Service Mesh' in title or '服务网格' in title:
        return ("Service Mesh核心：将服务通信逻辑从业务代码中抽离，下沉到基础设施层。"
                "数据面（Sidecar代理，如Envoy）处理实际流量，控制面（如Istio）管理配置。"
                "能力：流量管理、安全（mTLS）、可观测性、故障注入。"
                "和传统微服务的区别：业务代码不感知通信逻辑，统一在网格层配置。")
    elif 'CQRS' in title:
        return ("CQRS核心：读写分离——Command（写操作）和Query（读操作）使用不同的模型。"
                "写模型优化事务一致性，读模型优化查询性能。"
                "通常结合Event Sourcing：写操作产生事件，读模型通过消费事件更新。"
                "适用场景：读写比例差异大、查询模型和命令模型差异大。")
    elif '事件驱动' in title:
        return ("事件驱动核心：生产者发布事件，消费者订阅并处理。"
                "好处：解耦（生产者不关心谁消费）、可扩展（增加消费者不影响生产者）。"
                "挑战：事件顺序保证、幂等消费、最终一致性的延迟。"
                "实现：Kafka/RabbitMQ（消息队列）、EventBridge（云服务）。")
    elif '六边形' in title:
        return ("六边形架构（端口与适配器）核心：业务逻辑在中心，通过端口（接口）与外部交互。"
                "端口分入站（HTTP Controller、消息消费者）和出站（数据库、MQ客户端）。"
                "好处：业务逻辑独立于技术栈，易于测试（mock适配器）。"
                "和DDD的关系：六边形架构是DDD战术设计的基础设施层实现方式。")
    elif 'API网关' in title:
        return ("API网关核心功能：路由转发、认证鉴权、限流熔断、日志监控、协议转换。"
                "技术选型：Spring Cloud Gateway（Java生态）、Kong（Nginx+Lua）、Envoy（C++高性能）。"
                "和BFF的区别：BFF是面向特定前端的聚合层，网关是统一入口。"
                "注意：网关不要放业务逻辑，保持轻量。")
    elif '多租户' in title:
        return ("多租户架构三种方案：1）独立数据库（隔离最好、成本最高）；"
                "2）共享数据库独立Schema（中等隔离）；3）共享数据库共享Schema（tenant_id字段）。"
                "数据隔离：Hibernate Filter、MyBatis Interceptor、Spring全局查询过滤器。"
                "注意：定时任务、消息队列、缓存都要考虑租户隔离。")
    else:
        return (title + "的核心是理解大规模系统的设计原则和权衡。"
                "建议结合实际项目中的规模和约束来选择方案，没有银弹。")

def generate_design_pattern_deep_answer(title, content, concepts):
    if '单例' in title:
        return ("单例在Spring中的应用：Bean默认单例，通过BeanFactory缓存。"
                "DCL需要volatile的原因：new对象分三步（分配→初始化→赋值），JVM可能重排。"
                "枚举单例最安全：天然防反射和序列化破坏。"
                "Effective Java推荐枚举方式。")
    elif '代理' in title:
        return ("代理模式在Spring AOP中的应用：JDK动态代理（基于接口）和CGLIB（基于继承）。"
                "Spring Boot 2.x后默认全用CGLIB。MyBatis的Mapper也是通过JDK动态代理实现。"
                "性能差异：JDK代理调用快但创建慢，CGLIB创建快但调用略慢。")
    elif '策略' in title:
        return ("策略模式核心：定义算法族，封装每个算法，使它们可以互换。"
                "Spring典型应用：@Autowired注入Map<String, Strategy>实现策略选择。"
                "和状态模式区别：策略是客户端主动选择算法，状态是对象根据自身状态自动切换。")
    elif '观察者' in title:
        return ("观察者模式在Spring中的应用：ApplicationEvent+ApplicationListener。"
                "@EventListener注解简化注册。Spring事件是同步的，异步需要@Async。"
                "MQ本质上是分布式观察者模式。Guava的EventBus也是实现。")
    elif '工厂' in title:
        return ("工厂模式核心：将对象创建和使用分离。"
                "简单工厂、工厂方法、抽象工厂三种形式。"
                "Spring的BeanFactory就是工厂模式。MyBatis的SqlSessionFactory也是。"
                "工厂方法符合开闭原则。")
    elif '模板方法' in title:
        return ("模板方法在Spring中的应用：JdbcTemplate、RestTemplate、AbstractApplicationContext.refresh()。"
                "核心：在抽象类中定义算法骨架，将某些步骤延迟到子类。"
                "和策略模式区别：模板方法通过继承改变行为，策略通过组合。Spring更推荐组合。")
    elif '责任链' in title:
        return ("责任链在Spring中的应用：Filter链、Interceptor链、AOP的Advice链。"
                "Netty的ChannelPipeline也是责任链。"
                "实际项目中：审批流程、异常处理链、日志级别过滤。"
                "注意设置终止条件避免无限传递。")
    elif '装饰器' in title:
        return ("装饰器模式核心：动态地给对象添加额外职责，比继承更灵活。"
                "Java中的应用：IO流（BufferedInputStream装饰FileInputStream）、"
                "Collections.synchronizedList()装饰普通List。"
                "和代理模式区别：装饰器关注功能增强，代理关注访问控制。")
    elif '适配器' in title:
        return ("适配器模式核心：将一个接口转换为客户端期望的另一个接口。"
                "Spring MVC中的HandlerAdapter：不同类型的Controller通过适配器统一调用。"
                "类适配器（继承）vs 对象适配器（组合）。Spring用的是对象适配器。")
    elif '门面' in title:
        return ("门面模式核心：为子系统提供一个统一的高层接口，简化调用。"
                "Spring中的应用：JdbcTemplate封装了Connection/Statement/ResultSet的复杂操作。"
                "实际项目中：Service层就是DAO层的门面，Controller层就是Service层的门面。")
    elif '建造者' in title:
        return ("建造者模式核心：分步骤构建复杂对象，相同的构建过程可以创建不同的表示。"
                "Java中的应用：StringBuilder、Lombok @Builder、Stream.Builder。"
                "和工厂模式区别：工厂创建完整对象，建造者分步骤构建复杂对象。")
    elif 'SOLID' in title:
        return ("SOLID原则：S（单一职责）、O（开闭原则）、L（里氏替换）、I（接口隔离）、D（依赖倒置）。"
                "Spring中的体现：IoC容器实现依赖倒置、AOP实现单一职责、"
                "BeanFactory实现开闭原则（新增Bean不修改容器代码）。"
                "实际项目中不必教条主义，在复杂度和可维护性之间找平衡。")
    elif '设计模式' in title and 'Spring' in title:
        return ("Spring中的设计模式：工厂（BeanFactory）、单例（Bean默认单例）、"
                "代理（AOP）、模板方法（JdbcTemplate）、观察者（ApplicationEvent）、"
                "策略（ResourceLoader）、适配器（HandlerAdapter）、装饰器（BeanWrapper）。"
                "理解这些模式在Spring中的应用比死记类图更实用。")
    else:
        return (title + "的核心是理解其设计动机和适用场景。"
                "建议结合Spring源码中的实际应用来理解，而不是死记类图。")

def generate_dotnet_deep_answer(title, content, concepts):
    if '依赖注入' in title:
        return (".NET Core DI容器内置在框架中。三种生命周期：Transient、Scoped、Singleton。"
                "和Spring区别：.NET Core以构造函数注入为主，不支持属性注入（需Autofac）。"
                "Host.CreateDefaultBuilder自动注册大量框架服务。")
    elif '中间件' in title:
        return ("ASP.NET Core中间件管道：Request→Middleware1→...→Endpoint→Response。"
                "每个中间件可处理请求、调用next()传递、短路。"
                "Use/Run/Map三种注册方式。自定义中间件实现IMiddleware接口。")
    elif 'async/await' in title:
        return ("C# async/await核心：编译器将async方法转为状态机。await释放当前线程。"
                "ConfigureAwait(false)避免死锁。"
                "和Java区别：C# Task是热任务（创建就执行），Java CompletableFuture需手动触发。"
                "ValueTask避免Task的堆分配。")
    elif 'EF Core' in title:
        return ("EF Core核心：DbContext→DbSet→LINQ→Change Tracker→SQL→执行。"
                "性能优化：AsNoTracking()、批量操作、避免N+1（Include）。"
                "迁移管理Schema变更。多租户：Discriminator列、全局查询过滤器。")
    elif 'gRPC' in title:
        return ("gRPC基于HTTP/2和Protobuf，四种模式：Unary、Server/Client/Bidirectional Streaming。"
                "性能比REST高5-10倍。.NET中用Grpc.AspNetCore包。"
                "负载均衡：客户端负载+服务端负载（Envoy/Nginx）。")
    elif '认证' in title or '授权' in title:
        return ("ASP.NET Core认证：Authentication Handler验证凭据→ClaimsPrincipal。"
                "授权：基于角色（[Authorize(Roles=\"Admin\")]）或基于策略（Policy+Requirement）。"
                "JWT认证：AddJwtBearer()配置Token验证。"
                "和Spring Security对比：.NET用Policy模式更灵活。")
    elif 'GC' in title or '运行时' in title:
        return (".NET GC核心：分代收集（Gen0/Gen1/Gen2），Server GC和Workstation GC两种模式。"
                "和JVM GC区别：.NET GC是精确式（知道引用位置），JVM是保守式。"
                ".NET 8+引入分层编译和ReadyToRun。Span<T>和Memory<T>减少GC压力。")
    elif '反射' in title or '特性' in title:
        return ("C#反射：Type类获取类型信息，Activator.CreateInstance创建实例。"
                "Attribute（特性）：编译时附加的元数据，运行时通过反射读取。"
                "和Java区别：C#的Attribute比Java的Annotation更强大（可附加到程序集）。"
                "Source Generator（.NET 5+）减少反射的运行时开销。")
    elif 'LINQ' in title:
        return ("LINQ核心：声明式数据查询语法。两种形式：方法语法（Where/Select/GroupBy）和查询语法。"
                "延迟执行：LINQ查询在迭代时才执行（IEnumerable）。"
                "IQueryable vs IEnumerable：前者表达式树翻译为SQL，后者内存中过滤。"
                "EF Core用IQueryable实现数据库查询。")
    elif '配置' in title or '选项' in title:
        return (".NET Core配置体系：IConfiguration读取配置（JSON/环境变量/命令行/Azure等）。"
                "Options模式：IOptions<T>（单例，不支持热更新）、IOptionsSnapshot<T>（Scoped，支持热更新）、"
                "IOptionsMonitor<T>（Singleton，支持热更新+变更通知）。"
                "和Spring的@Value+@ConfigurationProperties对比。")
    elif '日志' in title or '监控' in title:
        return (".NET Core日志：ILogger<T>接口，内置Console/Debug/EventSource等Provider。"
                "第三方：Serilog（结构化日志）、NLog。"
                "监控：OpenTelemetry集成、Application Insights、Prometheus+Grafana。"
                "和Spring Boot的Actuator+Micrometer对比。")
    elif 'WPF' in title:
        return ("WPF核心：XAML声明式UI、依赖属性（Dependency Property）、路由事件、数据绑定。"
                "MVVM模式：View（XAML）→ViewModel（数据+命令）→Model（业务数据）。"
                "数据绑定通过Binding标记扩展实现。"
                "和Avalonia对比：WPF只支持Windows，Avalonia跨平台。")
    elif 'Avalonia' in title:
        return ("Avalonia UI核心：跨平台.NET UI框架（Windows/macOS/Linux/Android/iOS/WebAssembly）。"
                "语法类似WPF（XAML+MVVM），但有自己的控件库和样式系统。"
                "和MAUI区别：Avalonia社区驱动、更成熟，MAUI微软官方但bug较多。"
                "适用场景：桌面应用跨平台、从WPF迁移。")
    elif 'MAUI' in title:
        return (".NET MAUI核心：微软官方跨平台框架（Android/iOS/macOS/Windows）。"
                "从Xamarin.Forms演进而来。单项目结构，共享UI和业务逻辑。"
                "和Avalonia区别：MAUI微软官方但稳定性一般，Avalonia社区驱动但更成熟。"
                "适用场景：需要覆盖移动端的跨平台应用。")
    elif 'SignalR' in title:
        return ("SignalR核心：ASP.NET Core的实时通信框架。"
                "传输方式：WebSocket（优先）→Server-Sent Events→Long Polling。"
                "Hub模式：客户端调用服务器方法，服务器推送客户端方法。"
                "适用场景：聊天、实时通知、协同编辑。和WebSocket原生API的区别：SignalR自动协商传输方式。")
    elif '过滤器' in title:
        return ("ASP.NET Core过滤器管道：Authorization→Resource→Action→Exception→Result。"
                "五种过滤器对应请求生命周期的不同阶段。"
                "和中间件区别：中间件是全局的，过滤器是针对Action的。"
                "Filter Attribute（如[Authorize]）可以声明式使用。")
    elif 'Web API' in title:
        return ("ASP.NET Core Web API核心：Controller→Action→Model Binding→Validation→Response。"
                "RESTful设计：资源命名（名词）、HTTP方法语义、状态码。"
                "最小API（.NET 6+）：无需Controller，直接在Program.cs定义路由。"
                "和Spring MVC对比：ASP.NET Core更轻量，启动更快。")
    elif '容器化' in title or '部署' in title:
        return (".NET容器化核心：Dockerfile构建镜像→docker build→docker run。"
                "多阶段构建：SDK镜像编译→runtime镜像运行（减小镜像体积）。"
                "部署方案：Docker Compose（单机）、Kubernetes（集群）、Azure App Service（云托管）。"
                "健康检查：MapHealthChecks()端点。")
    elif '消息队列' in title:
        return (".NET消息队列集成：MassTransit（抽象层，支持RabbitMQ/Azure Service Bus/Kafka）、"
                "NServiceBus（企业级，付费）、原生RabbitMQ.Client。"
                "MassTransit核心：Publish/Subscribe、Saga状态机、重试策略。"
                "和Spring的RabbitMQ Template对比：MassTransit更高级（自动重试、死信、Saga）。")
    elif '仓储' in title or '工作单元' in title:
        return ("仓储模式核心：为每个聚合根定义Repository接口，封装数据访问。"
                "工作单元：DbContext本身就是UoW，SaveChanges()一次性提交所有变更。"
                "和直接用DbContext区别：仓储模式更易测试（mock Repository），但增加复杂度。"
                "实际项目中：简单场景直接用DbContext，复杂DDD场景用仓储模式。")
    elif '数据库' in title and '多租户' in title:
        return (".NET多租户方案：1）独立数据库（隔离最好）；2）共享库独立Schema；3）共享库tenant_id字段。"
                "EF Core实现：全局查询过滤器（HasQueryFilter）、动态连接字符串。"
                "注意：迁移要考虑所有租户数据库、定时任务要区分租户。")
    else:
        return (title + "的核心是理解.NET Core/8+的运行时机制和框架设计。"
                "建议对比Java/Spring的实现来加深理解。")

def generate_network_deep_answer(title, content, concepts):
    if '握手' in title:
        return ("三次握手：SYN→SYN+ACK→ACK。为什么不是两次：防止历史SYN被误认为新连接。"
                "四次挥手：FIN→ACK→FIN→ACK，TIME_WAIT等2MSL。"
                "排查工具：tcpdump抓包、ss -tlnp查看连接状态、netstat统计连接数。")
    elif 'HTTPS' in title:
        return ("HTTPS核心：非对称加密交换密钥→对称加密传输数据。"
                "TLS握手：ClientHello→ServerHello→证书验证→密钥交换→Finished。"
                "ECDHE比RSA更安全（前向保密）。排查：openssl s_client测试握手。")
    elif 'HTTP' in title and '演进' in title:
        return ("HTTP演进：1.0（短连接）→1.1（长连接/管道化）→2.0（多路复用/二进制帧）→3.0（QUIC/UDP）。"
                "2.0多路复用解决1.1的应用层队头阻塞，3.0解决TCP层队头阻塞。"
                "实际项目中大部分还是HTTP/1.1和HTTP/2。")
    elif 'DNS' in title:
        return ("DNS解析流程：浏览器缓存→OS缓存→本地DNS→根DNS→TLD→权威DNS。"
                "递归查询（客户端到本地DNS）和迭代查询（本地DNS到各级DNS）。"
                "调试：dig +trace跟踪、nslookup指定DNS查询。DNS劫持→用DoH/DoT解决。")
    elif 'WebSocket' in title:
        return ("WebSocket核心：HTTP Upgrade握手→全双工通信。"
                "和长轮询区别：长轮询反复发起HTTP请求，WebSocket建立持久连接后服务器主动推送。"
                "心跳机制：Ping/Pong帧保持连接活跃。Nginx代理需设置Upgrade头。")
    elif 'CORS' in title:
        return ("CORS核心：浏览器同源策略限制跨域。简单请求直接发送，非简单请求先发OPTIONS预检。"
                "服务器通过Access-Control-Allow-Origin等响应头允许跨域。"
                "Nginx同源代理也是解决方案。")
    elif 'TCP' in title and '可靠' in title:
        return ("TCP可靠传输机制：序列号+确认号、超时重传、校验和、流量控制（滑动窗口）、"
                "拥塞控制（慢启动→拥塞避免→快重传→快恢复）。"
                "滑动窗口：发送窗口=min(拥塞窗口, 接收窗口)。Nagle算法减少小包。")
    elif 'TCP' in title and '流量' in title:
        return ("流量控制：接收方通过窗口字段告诉发送方自己能接收多少数据。"
                "拥塞控制四个阶段：慢启动（指数增长）→拥塞避免（线性增长）→快重传→快恢复。"
                "关键算法：慢启动阈值(ssthresh)、拥塞窗口(cwnd)。"
                "实际排查：ss -i查看窗口大小、tcpdump分析重传。")
    elif '粘包' in title:
        return ("TCP粘包原因：TCP是字节流协议，没有消息边界。"
                "解决方案：1）固定长度消息；2）消息头+消息体（长度字段）；3）特殊分隔符。"
                "HTTP用Content-Length或Transfer-Encoding: chunked解决。"
                "UDP没有粘包问题，每次sendto对应一次recvfrom。")
    elif 'TCP' in title and 'UDP' in title:
        return ("TCP vs UDP：TCP面向连接、可靠、有序、流量/拥塞控制；UDP无连接、不可靠、无序、高效。"
                "TCP适用：HTTP/HTTPS、FTP、SMTP等需要可靠传输的场景。"
                "UDP适用：DNS、视频流、游戏、QUIC等对实时性要求高的场景。"
                "HTTP/3用QUIC（基于UDP）实现了可靠传输+0-RTT建连。")
    elif 'CDN' in title:
        return ("CDN核心：将内容缓存到离用户最近的边缘节点，减少延迟。"
                "工作流程：用户→Local DNS→CDN DNS（智能调度）→最近的边缘节点。"
                "回源策略：边缘节点没有缓存→回源站获取。缓存更新：主动推送+被动过期。"
                "HTTPS CDN：CDN节点需要配置SSL证书（自有证书或CDN提供的免费证书）。")
    elif '状态码' in title:
        return ("HTTP状态码分类：1xx（信息）、2xx（成功）、3xx（重定向）、4xx（客户端错误）、5xx（服务器错误）。"
                "高频考点：301永久重定向vs302临时重定向、304 Not Modified（协商缓存）、"
                "401 Unauthorized（未认证）vs 403 Forbidden（无权限）、429 Too Many Requests（限流）。"
                "自定义状态码要遵循RFC规范。")
    else:
        return (title + "的核心是理解网络协议的设计动机和实际应用。"
                "建议用Wireshark/tcpdump实际抓包分析协议交互过程。")

def generate_os_deep_answer(title, content, concepts):
    if 'IO' in title or '阻塞' in title:
        return ("四种IO模型区别在数据准备和数据拷贝两阶段。"
                "IO多路复用是同步IO（数据拷贝阶段仍需用户线程等待）。"
                "epoll优势：事件驱动、mmap减少拷贝、支持ET/LT。"
                "排查工具：strace跟踪系统调用、lsof查看打开的fd。")
    elif '进程' in title and '线程' in title:
        return ("进程是资源分配单位（独立地址空间），线程是CPU调度单位（共享进程资源）。"
                "进程间通信：管道、消息队列、共享内存、信号量、Socket。"
                "线程同步：互斥锁、读写锁、条件变量、信号量、自旋锁。")
    elif '死锁' in title:
        return ("死锁四个必要条件：互斥、持有并等待、不可剥夺、循环等待。"
                "预防：按顺序加锁破坏循环等待。"
                "检测：jstack查看线程状态、SHOW ENGINE INNODB STATUS查看InnoDB死锁。"
                "应用层：tryLock超时。数据库层：innodb_lock_wait_timeout。")
    elif '虚拟内存' in title:
        return ("虚拟内存核心：每个进程有独立虚拟地址空间，通过页表映射到物理内存。"
                "多级页表减少页表占用。TLB缓存常用页表项加速地址转换。"
                "缺页中断：访问的页不在物理内存时触发。页面置换算法：LRU、Clock。")
    elif 'select' in title or 'epoll' in title or 'poll' in title:
        return ("select/poll/epoll区别：select用fd_set位图（1024限制）、poll用链表（无限制）、"
                "epoll用红黑树+就绪链表（事件驱动）。"
                "epoll API：epoll_create、epoll_ctl、epoll_wait。"
                "ET比LT效率高但编程复杂（必须一次读完数据）。Nginx/Redis都用epoll。")
    elif '协程' in title:
        return ("协程是用户态轻量级线程，由程序自己调度（不经过OS内核）。"
                "Go的goroutine用GMP模型。Java Virtual Threads也实现了协程。"
                "和线程区别：协程切换不经过内核（更快）、栈空间更小（KB级）、可创建百万个。")
    elif '内存泄漏' in title or '溢出' in title:
        return ("内存泄漏常见原因：集合类持有引用未清理、连接/流未关闭、"
                "ThreadLocal在线程池中未remove、监听器未注销。"
                "排查：jmap堆转储→MAT分析；jstat监控GC；VisualVM观察内存曲线。")
    elif '页面置换' in title:
        return ("页面置换算法：OPT（理论最优）、FIFO（可能Belady异常）、"
                "LRU（最近最少使用，用栈或计数器实现）、Clock（近似LRU，用访问位）。"
                "实际OS中：Linux用改进的LRU（双链表：active和inactive）。"
                "颠簸（Thrashing）：频繁缺页导致CPU利用率下降。")
    elif '分页' in title or '分段' in title:
        return ("分页：将虚拟内存和物理内存分为固定大小的页（通常4KB），通过页表映射。"
                "分段：按逻辑段（代码/数据/栈）划分，段大小可变。"
                "现代OS用段页式：先分段再分页。Linux只用分页（4级页表）。"
                "大页（Huge Page）：2MB或1GB页，减少TLB miss。")
    elif '文件权限' in title:
        return ("Linux文件权限：r(4)w(2)x(1)，三组（所有者/组/其他）。"
                "chmod修改权限、chown修改所有者、chgrp修改组。"
                "特殊权限：SUID(4)以文件所有者身份执行、SGID(2)继承目录组、Sticky Bit(1)只有所有者能删除。"
                "umask决定默认权限（022→文件644，目录755）。")
    elif '常用命令' in title:
        return ("排查问题核心命令：top/htop（CPU/内存）、ps aux（进程）、"
                "netstat/ss（网络连接）、lsof（打开的文件）、strace（系统调用）、"
                "df -h（磁盘）、free -h（内存）、vmstat（虚拟内存统计）。"
                "日志分析：grep/awk/sed组合使用。")
    elif '进程管理' in title:
        return ("Linux进程管理：ps查看进程、top实时监控、kill发送信号。"
                "进程状态：R(运行)、S(睡眠)、D(不可中断)、Z(僵尸)、T(停止)。"
                "僵尸进程：子进程退出但父进程未wait()，用ps defunct查看。"
                "nohup/setsid让进程在后台运行。systemd管理服务进程。")
    elif '线程同步' in title:
        return ("线程同步机制：互斥锁（Mutex，最常用）、读写锁（RWLock，读多写少）、"
                "条件变量（CondVar，等待条件成立）、信号量（Semaphore，控制并发数）、"
                "自旋锁（Spinlock，临界区很短时使用）。"
                "用户态同步：atomic操作、futex（Fast Userspace Mutex）。")
    elif 'IPC' in title or '进程间通信' in title:
        return ("进程间通信方式：1）管道（单向，父子进程）；2）命名管道FIFO（任意进程）；"
                "3）消息队列（异步，有类型）；4）共享内存（最快，需同步）；"
                "5）信号量（同步）；6）信号（异步通知）；7）Socket（网络）。"
                "共享内存最快因为不需要内核拷贝。实际项目中MQ最常用。")
    else:
        return (title + "的核心是理解OS的资源管理机制。"
                "建议用top/htop/strace/lsof等工具实际观察系统行为。")

# ============================================================
# Generic helpers
# ============================================================

def generate_comparison_answer(title, compare_content, concepts):
    lines = compare_content.strip().split('\n')
    dims = []
    for line in lines:
        if '|' in line and '---' not in line and '对比' not in line:
            parts = [p.strip() for p in line.split('|') if p.strip()]
            if len(parts) >= 2:
                dims.append(parts[0])
    if len(dims) >= 3:
        return ("对比" + title + "中的方案时，我通常从这几个维度分析：" +
                "、".join(dims[:4]) + "。关键不是哪个绝对更好，而是理解各自的适用边界。"
                "面试时先说结论，再展开分析各维度差异，最后结合场景给出理由。")
    else:
        return ("对比" + title + "中的方案时，核心是理解各自的适用场景和限制条件。"
                "建议从性能、复杂度、可维护性三个维度分析。")

def generate_alternative_answer(title, content, domain, category):
    if domain == 'java' and 'spring' in category:
        return ("和" + title + "相关的替代方案：Spring Boot vs Quarkus vs Micronaut、"
                "MyBatis vs JPA vs JOOQ、Nacos vs Consul vs Eureka。"
                "选型关键：团队技术栈、社区活跃度、生产环境验证程度。")
    elif domain == 'java' and 'middleware' in category:
        return ("中间件选型核心考量：性能、可靠性、运维复杂度、社区活跃度。"
                "Redis适合缓存和简单队列，RabbitMQ适合复杂路由，Kafka适合高吞吐日志流。")
    elif domain == 'algorithm':
        return ("同一道题通常有多种解法：暴力→优化→最优。"
                "面试时先说暴力解法建立信心，再逐步优化。")
    elif domain == 'frontend':
        return ("前端技术选型考量：生态成熟度、学习曲线、性能、TypeScript支持。")
    else:
        return ("和" + title + "相关的替代方案选型，核心是理解各自的适用场景和限制条件。")

def generate_pitfall_answer(title, content, domain, category, concepts):
    if domain == 'java' and 'jvm' in category:
        return ("最常见的JVM坑：1）-Xms和-Xmx不一致导致堆频繁扩缩；"
                "2）MetaspaceSize设置过小导致Full GC；3）堆转储文件撑爆磁盘。"
                "排查工具：jstat、jmap、jstack、Arthas。"
                "生产环境一定要配置-XX:+HeapDumpOnOutOfMemoryError。")
    elif domain == 'java' and 'concurrency' in category:
        return ("最常见的并发坑：1）synchronized范围太大影响性能；"
                "2）wait/notify必须在synchronized块内；3）异常导致锁泄漏；"
                "4）线程池无界队列导致OOM；5）ThreadLocal在线程池中未remove。")
    elif domain == 'java' and 'spring' in category:
        return ("最常见的Spring坑：1）@Transactional在同类方法调用时不生效（代理对象调用才生效）；"
                "2）@Async默认用SimpleAsyncTaskExecutor；3）构造函数注入循环依赖报错；"
                "4）@Value读取不到配置。建议用构造函数注入替代字段注入。")
    elif domain == 'java' and 'database' in category:
        return ("最常见的数据库坑：1）索引列上用函数导致索引失效；"
                "2）隐式类型转换导致索引失效；3）大事务持有锁时间过长；4）N+1查询。"
                "建议：用EXPLAIN分析所有慢SQL、开启慢查询日志。")
    elif domain == 'java' and 'middleware' in category:
        return ("最常见的中间件坑：1）Redis大Key导致阻塞；2）缓存穿透；"
                "3）MQ消息丢失（开启confirm+持久化+ack）；4）分布式锁超时。"
                "生产环境一定要有监控告警。")
    elif domain == 'algorithm':
        return ("算法题最常见坑：1）边界条件没处理（空数组、单元素）；"
                "2）去重时机不对；3）指针越界；4）整数溢出。建议先写暴力解法对拍。")
    elif domain == 'frontend':
        return ("前端最常见坑：1）闭包导致内存泄漏；2）this指向问题；"
                "3）异步竞态条件（组件卸载后setState）；4）虚拟DOM的key用index。")
    elif domain == 'agent':
        return ("AI系统最常见坑：1）Prompt注入攻击；2）幻觉输出；"
                "3）Token超限；4）延迟过高。建议：对LLM输出做校验、设置max_tokens限制。")
    elif domain == 'architecture':
        return ("架构设计最常见坑：1）过度设计（小项目上微服务）；2）忽视数据一致性；"
                "3）单点故障；4）监控缺失。建议从单体开始，遇到瓶颈再拆分。")
    else:
        return ("最常见的坑是理论和实践脱节。建议通过实际项目验证理论。")


# ============================================================
# Main logic
# ============================================================

def extract_key_concepts(data):
    concepts = []
    for lc in data.get('learningCards', []):
        content = lc.get('content', '')
        bold_terms = re.findall(r'\*\*(.+?)\*\*', content)
        headers = re.findall(r'#{1,3}\s+(.+)', content)
        concepts.extend(bold_terms[:5])
        concepts.extend(headers[:3])
    return list(set(concepts))[:10]


def generate_specific_followups(data):
    title = data.get('title', '')
    domain = data.get('domain', '')
    category = data.get('category', '')

    all_content = ''
    compare_content = ''
    checklist_items = []
    for lc in data.get('learningCards', []):
        content = lc.get('content', '')
        all_content += content + '\n'
        if lc.get('type') == 'compareTable':
            compare_content = content
        elif lc.get('type') == 'checklist':
            checklist_items = lc.get('items', [])

    key_concepts = extract_key_concepts(data)
    followups = []

    # Q1: Deep dive
    dispatchers = {
        'java': {
            'jvm': (f"能结合实际项目说说{title}的调优经验吗？遇到过什么问题，怎么定位和解决的？", generate_jvm_deep_answer),
            'concurrency': (f"在高并发场景下，{title}有哪些需要注意的坑？能举一个实际踩坑案例吗？", generate_concurrency_deep_answer),
            'spring': (f"能说说{title}在Spring源码层面的实现原理吗？关键的类和方法是什么？", generate_spring_deep_answer),
            'database': (f"在实际项目中，你是怎么应用{title}来优化查询性能的？能举一个具体的优化案例吗？", generate_database_deep_answer),
            'middleware': (f"在生产环境中，{title}有哪些常见的坑和最佳实践？", generate_middleware_deep_answer),
            'java-fundamentals': (f"能深入说说{title}的底层实现原理吗？关键的数据结构或算法是什么？", generate_java_deep_answer),
            'new-features': (f"能深入说说{title}的底层实现原理吗？关键的数据结构或算法是什么？", generate_java_deep_answer),
        },
        'algorithm': (f"这道题有哪些变体？如果约束条件变了（如要求O(1)空间），解法会怎么变？", generate_algorithm_deep_answer),
        'frontend': (f"在实际前端项目中，{title}的最佳实践是什么？有哪些常见的坑？", generate_frontend_deep_answer),
        'agent': (f"在生产环境中部署{title}相关的系统时，有哪些工程化挑战？", generate_agent_deep_answer),
        'architecture': (f"在你的项目中，{title}是怎么落地的？遇到了什么权衡取舍？", generate_architecture_deep_answer),
        'design-pattern': (f"在Spring框架中，{title}有哪些经典应用？能结合源码说说吗？", generate_design_pattern_deep_answer),
        'dotnet': (f"在.NET Core/8+中，{title}的实现和Java有什么异同？", generate_dotnet_deep_answer),
        'network': (f"在实际排查网络问题时，{title}相关的工具和命令有哪些？能举一个排查案例吗？", generate_network_deep_answer),
        'os': (f"在Linux系统中，{title}相关的排查工具有哪些？能举一个实际排查案例吗？", generate_os_deep_answer),
    }

    if domain == 'java':
        cat_dispatch = dispatchers['java'].get(category)
        if cat_dispatch:
            q1, gen_fn = cat_dispatch
            a1 = gen_fn(title, all_content, key_concepts)
        else:
            q1 = f"能深入说说{title}的底层实现原理吗？"
            a1 = generate_java_deep_answer(title, all_content, key_concepts)
    elif domain in dispatchers and isinstance(dispatchers[domain], tuple):
        q1, gen_fn = dispatchers[domain]
        a1 = gen_fn(title, all_content, key_concepts)
    else:
        q1 = f"能深入说说{title}的核心实现原理吗？"
        a1 = f"以{title}为例，核心要点是理解其设计动机和关键实现。建议通过debug源码、画时序图、写demo的方式深入理解。"

    followups.append({"question": q1, "answer": a1})

    # Q2: Comparison
    if compare_content:
        q2 = f"如果面试官让你对比{title}中提到的几种方案，你会怎么分析各自的优劣？"
        a2 = generate_comparison_answer(title, compare_content, key_concepts)
    else:
        q2 = f"和{title}相关的替代方案有哪些？在什么场景下你会选择当前方案？"
        a2 = generate_alternative_answer(title, all_content, domain, category)
    followups.append({"question": q2, "answer": a2})

    # Q3: Pitfalls
    q3 = f"在实际项目中使用{title}时，你遇到过什么问题？是怎么发现和解决的？"
    a3 = generate_pitfall_answer(title, all_content, domain, category, key_concepts)
    followups.append({"question": q3, "answer": a3})

    return followups


# ============================================================
# Process all topics
# ============================================================

print("Starting followUpQuestions rewrite for all topics...")
count = 0
errors = 0

for f in sorted(glob.glob('topics/*/*.json')):
    try:
        with open(f) as fh:
            data = json.load(fh)
    except Exception as e:
        print(f"Error reading {f}: {e}")
        errors += 1
        continue

    updated = False
    for lc in data.get('learningCards', []):
        if lc.get('type') == 'interviewAnswer':
            new_followups = generate_specific_followups(data)
            lc['followUpQuestions'] = new_followups
            updated = True
            break

    if updated:
        with open(f, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        count += 1

print(f"\nDone! Updated {count} topics, {errors} errors")
