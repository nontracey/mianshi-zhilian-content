#!/usr/bin/env python3
"""
Phase 4: Add missing knowledge points identified in the evaluation.
"""
import json
import os
import uuid
import glob

CONTENT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def read_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def write_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')

def gen_id():
    return uuid.uuid4().hex[:8]

# ============================================================
# New topics to add
# ============================================================

NEW_TOPICS = {
    "algorithm": [
        {
            "category": "tree-graph",
            "title": "图的 BFS 与 DFS",
            "summary": "掌握图的两种基本遍历方式，理解 BFS 求最短路径、DFS 求连通性的核心思想",
            "difficulty": 3,
            "estimatedMinutes": 25,
            "explain": """# 图的 BFS 与 DFS

## 一、图的存储方式
- **邻接矩阵**：空间 O(V²)，适合稠密图
- **邻接表**：空间 O(V+E)，适合稀疏图
- **邻接表实现**（Java）：
```java
List<List<Integer>> graph = new ArrayList<>();
for (int i = 0; i < n; i++) graph.add(new ArrayList<>());
// 添加边 u -> v
graph.get(u).add(v);
```

## 二、BFS（广度优先搜索）
**核心思想**：从起点出发，先访问所有距离为 1 的节点，再访问距离为 2 的节点...
**数据结构**：队列
**时间复杂度**：O(V+E)

```java
void bfs(List<List<Integer>> graph, int start) {
    boolean[] visited = new boolean[graph.size()];
    Queue<Integer> queue = new LinkedList<>();
    queue.offer(start);
    visited[start] = true;
    while (!queue.isEmpty()) {
        int node = queue.poll();
        for (int neighbor : graph.get(node)) {
            if (!visited[neighbor]) {
                visited[neighbor] = true;
                queue.offer(neighbor);
            }
        }
    }
}
```

**应用场景**：
- 无权图最短路径
- 层序遍历
- 连通分量计数

## 三、DFS（深度优先搜索）
**核心思想**：从起点出发，沿着一条路走到黑，走不通再回溯
**数据结构**：栈（或递归调用栈）
**时间复杂度**：O(V+E)

```java
void dfs(List<List<Integer>> graph, int node, boolean[] visited) {
    visited[node] = true;
    for (int neighbor : graph.get(node)) {
        if (!visited[neighbor]) {
            dfs(graph, neighbor, visited);
        }
    }
}
```

**应用场景**：
- 连通性判断
- 拓扑排序
- 回溯搜索

## 四、BFS vs DFS 对比

| 对比项 | BFS | DFS |
|--------|-----|-----|
| 数据结构 | 队列 | 栈/递归 |
| 空间复杂度 | O(V) | O(V) |
| 最短路径 | 无权图保证 | 不保证 |
| 实现方式 | 迭代 | 递归或迭代 |
| 适用场景 | 最短路径、层序 | 连通性、回溯 |""",
            "compareTable": "| 对比项 | BFS | DFS |\n| --- | --- | --- |\n| 数据结构 | 队列 | 栈/递归 |\n| 空间复杂度 | O(V) | O(V) |\n| 最短路径 | 无权图保证 | 不保证 |\n| 实现方式 | 迭代 | 递归或迭代 |\n| 适用场景 | 最短路径、层序 | 连通性、回溯 |",
            "interviewAnswer": "**Q1: BFS 和 DFS 的区别是什么？各自适用什么场景？**\n\nBFS 使用队列，按层遍历，能保证无权图的最短路径；DFS 使用栈或递归，沿着一条路径深入到底，适合连通性判断和回溯问题。时间复杂度都是 O(V+E)，但 BFS 的空间复杂度在宽图时更大。\n\n**Q2: 如何用 BFS 求无权图最短路径？**\n\n从起点开始 BFS，记录每个节点到起点的距离。第一次访问到目标节点时的距离就是最短路径。因为 BFS 按层遍历，同一层的节点距离相同，所以第一次到达就是最短的。\n\n**Q3: DFS 的递归和迭代写法有什么区别？**\n\n递归写法简洁但有栈溢出风险（深度过大时）；迭代写法用显式栈，没有栈溢出风险但代码稍复杂。生产环境中如果图的深度可能很大，建议用迭代写法。",
            "checklist": [
                "能说出图的两种存储方式（邻接矩阵、邻接表）及其适用场景",
                "能手写 BFS 和 DFS 的模板代码",
                "能解释 BFS 为什么能求无权图最短路径",
                "能区分 BFS 和 DFS 的适用场景",
                "能处理图中的环检测和 visited 标记",
            ],
            "commonMistakes": [
                "BFS 忘记标记已访问节点导致死循环",
                "DFS 递归深度过大导致栈溢出",
                "邻接矩阵和邻接表的空间复杂度搞混",
            ],
        },
        {
            "category": "tree-graph",
            "title": "拓扑排序",
            "summary": "理解有向无环图(DAG)的拓扑排序算法，掌握 Kahn 算法和 DFS 两种实现方式",
            "difficulty": 3,
            "estimatedMinutes": 20,
            "explain": """# 拓扑排序

## 一、什么是拓扑排序
对有向无环图(DAG)的所有顶点进行线性排序，使得对于每条边 (u, v)，u 在排序中出现在 v 的前面。

## 二、Kahn 算法（BFS）
**思路**：不断移除入度为 0 的节点
```java
List<Integer> topologicalSort(List<List<Integer>> graph, int n) {
    int[] inDegree = new int[n];
    for (int u = 0; u < n; u++)
        for (int v : graph.get(u)) inDegree[v]++;
    
    Queue<Integer> queue = new LinkedList<>();
    for (int i = 0; i < n; i++)
        if (inDegree[i] == 0) queue.offer(i);
    
    List<Integer> result = new ArrayList<>();
    while (!queue.isEmpty()) {
        int node = queue.poll();
        result.add(node);
        for (int neighbor : graph.get(node)) {
            if (--inDegree[neighbor] == 0) queue.offer(neighbor);
        }
    }
    return result.size() == n ? result : new ArrayList<>(); // 空表示有环
}
```

## 三、DFS 实现
**思路**：后序遍历的结果反转
```java
List<Integer> topoSort = new ArrayList<>();
boolean[] visited = new boolean[n];
boolean[] inStack = new boolean[n];

boolean dfs(int node) {
    if (inStack[node]) return false; // 有环
    if (visited[node]) return true;
    visited[node] = true;
    inStack[node] = true;
    for (int neighbor : graph.get(node)) {
        if (!dfs(neighbor)) return false;
    }
    inStack[node] = false;
    topoSort.add(node);
    return true;
}
Collections.reverse(topoSort);
```

## 四、应用场景
- 课程安排（判断能否完成所有课程）
- 编译顺序（依赖关系）
- 任务调度""",
            "compareTable": "| 对比项 | Kahn 算法 | DFS 实现 |\n| --- | --- | --- |\n| 思路 | 移除入度为0的节点 | 后序遍历反转 |\n| 数据结构 | 队列 + 入度数组 | 递归栈 |\n| 环检测 | result.size() < n | 栈内节点重复访问 |\n| 适用场景 | 需要同时检测环 | 代码更简洁 |",
            "interviewAnswer": "**Q1: 什么是拓扑排序？什么时候需要拓扑排序？**\n\n拓扑排序是对有向无环图(DAG)的线性排序，使得所有边从前指向后。典型场景：课程安排（先修课→后续课）、编译依赖（库A依赖库B）、任务调度。\n\n**Q2: 如何检测图中是否有环？**\n\nKahn 算法：如果排序结果的节点数不等于总节点数，说明有环（因为环上的节点入度永远不会变为0）。DFS：如果在当前递归栈中再次访问到同一节点，说明有环。\n\n**Q3: 拓扑排序的结果唯一吗？**\n\n不唯一。如果有多个入度为0的节点，选择不同节点会导致不同排序结果。但如果每次都选同一个（如编号最小的），结果就是唯一的。",
            "checklist": [
                "能解释拓扑排序的定义和适用条件（DAG）",
                "能手写 Kahn 算法的实现",
                "能用拓扑排序检测有向图中是否有环",
                "能说出拓扑排序的实际应用场景",
            ],
            "commonMistakes": [
                "对有环图执行拓扑排序没有检测到环",
                "忘记初始化入度数组",
                "混淆拓扑排序和 DFS 后序遍历",
            ],
        },
        {
            "category": "dynamic-programming",
            "title": "背包问题",
            "summary": "掌握 0-1 背包和完全背包的状态定义、转移方程和空间优化",
            "difficulty": 4,
            "estimatedMinutes": 30,
            "explain": """# 背包问题

## 一、0-1 背包
**问题**：N 个物品，每个物品有重量 w[i] 和价值 v[i]，背包容量为 W，求最大价值。
**状态定义**：dp[i][j] = 前 i 个物品、容量为 j 时的最大价值
**转移方程**：dp[i][j] = max(dp[i-1][j], dp[i-1][j-w[i]] + v[i])

```java
// 二维 DP
int knapsack(int[] w, int[] v, int W) {
    int n = w.length;
    int[][] dp = new int[n+1][W+1];
    for (int i = 1; i <= n; i++) {
        for (int j = 0; j <= W; j++) {
            dp[i][j] = dp[i-1][j]; // 不选
            if (j >= w[i-1])
                dp[i][j] = Math.max(dp[i][j], dp[i-1][j-w[i-1]] + v[i-1]); // 选
        }
    }
    return dp[n][W];
}

// 空间优化：一维滚动数组（逆序遍历）
int knapsack1D(int[] w, int[] v, int W) {
    int[] dp = new int[W+1];
    for (int i = 0; i < w.length; i++)
        for (int j = W; j >= w[i]; j--) // 逆序！
            dp[j] = Math.max(dp[j], dp[j-w[i]] + v[i]);
    return dp[W];
}
```

## 二、完全背包
**区别**：每个物品可以选无限次
**转移方程**：dp[j] = max(dp[j], dp[j-w[i]] + v[i])（正序遍历！）

```java
int completeKnapsack(int[] w, int[] v, int W) {
    int[] dp = new int[W+1];
    for (int i = 0; i < w.length; i++)
        for (int j = w[i]; j <= W; j++) // 正序！
            dp[j] = Math.max(dp[j], dp[j-w[i]] + v[i]);
    return dp[W];
}
```

## 三、关键区别
- 0-1 背包：内层循环**逆序**（保证每个物品只用一次）
- 完全背包：内层循环**正序**（允许重复选取）""",
            "compareTable": "| 对比项 | 0-1 背包 | 完全背包 |\n| --- | --- | --- |\n| 物品限制 | 每个最多选一次 | 每个可选无限次 |\n| 转移方程 | dp[i-1][j-w[i]] | dp[i][j-w[i]] |\n| 遍历顺序 | 逆序 | 正序 |\n| 空间优化 | 一维逆序 | 一维正序 |",
            "interviewAnswer": "**Q1: 0-1 背包和完全背包的区别是什么？**\n\n0-1 背包每个物品最多选一次，完全背包每个物品可选无限次。代码上唯一的区别是内层循环的遍历顺序：0-1 背包逆序（保证物品只用一次），完全背包正序（允许重复使用）。\n\n**Q2: 背包问题的空间优化是怎么做的？**\n\n从二维 dp[i][j] 优化到一维 dp[j]。因为状态转移只依赖上一行，所以可以用滚动数组。关键：0-1 背包必须逆序遍历，否则会重复使用物品；完全背包正序遍历，因为允许重复。\n\n**Q3: 背包问题有哪些变体？**\n\n常见变体：多重背包（每种物品有数量限制）、分组背包（物品分组，每组选一个）、混合背包（0-1+完全+多重混合）。核心思路都是状态定义+转移方程，关键在于正确建模。",
            "checklist": [
                "能定义 0-1 背包的状态和转移方程",
                "能写出空间优化后的一维 DP 代码",
                "能解释为什么 0-1 背包要逆序、完全背包要正序",
                "能将实际问题建模为背包问题",
            ],
            "commonMistakes": [
                "0-1 背包空间优化时正序遍历导致重复选取",
                "完全背包空间优化时逆序遍历导致结果错误",
                "状态定义不清晰导致转移方程写错",
            ],
        },
        {
            "category": "hash-greedy",
            "title": "并查集",
            "summary": "掌握并查集的路径压缩和按秩合并优化，解决连通性问题",
            "difficulty": 3,
            "estimatedMinutes": 20,
            "explain": """# 并查集

## 一、什么是并查集
并查集(Union-Find)是一种处理不相交集合的数据结构，支持两种操作：
- **Find**：查找元素所属集合的代表元素
- **Union**：合并两个集合

## 二、基本实现
```java
class UnionFind {
    int[] parent;
    int[] rank;
    
    public UnionFind(int n) {
        parent = new int[n];
        rank = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
    }
    
    public int find(int x) {
        if (parent[x] != x) {
            parent[x] = find(parent[x]); // 路径压缩
        }
        return parent[x];
    }
    
    public void union(int x, int y) {
        int rootX = find(x), rootY = find(y);
        if (rootX == rootY) return;
        if (rank[rootX] < rank[rootY]) parent[rootX] = rootY;
        else if (rank[rootX] > rank[rootY]) parent[rootY] = rootX;
        else { parent[rootY] = rootX; rank[rootX]++; }
    }
    
    public boolean connected(int x, int y) {
        return find(x) == find(y);
    }
}
```

## 三、两种优化
- **路径压缩**：find 时将所有节点直接指向根，时间接近 O(1)
- **按秩合并**：Union 时将小树挂到大树上，保持树的平衡

## 四、应用场景
- 判断图的连通性
- 最小生成树（Kruskal 算法）
- 等价类合并""",
            "compareTable": "| 对比项 | 无优化 | 路径压缩 | 路径压缩+按秩合并 |\n| --- | --- | --- | --- |\n| Find 复杂度 | O(n) | O(logn) | O(α(n)) ≈ O(1) |\n| Union 复杂度 | O(n) | O(logn) | O(α(n)) ≈ O(1) |\n| 实现复杂度 | 简单 | 中等 | 中等 |",
            "interviewAnswer": "**Q1: 并查集是什么？解决什么问题？**\n\n并查集是处理不相争集合合并与查询的数据结构。支持 Find（查代表元素）和 Union（合并集合）两个操作。典型应用：判断图的连通性、Kruskal 最小生成树、社交网络中的好友关系。\n\n**Q2: 路径压缩是怎么做的？**\n\n在 find 操作中，递归地将当前节点直接指向根节点。这样下次查询时直接找到根，不需要再走长链。路径压缩后树的高度变得很小，find 操作接近 O(1)。\n\n**Q3: 并查集的时间复杂度是多少？**\n\n同时使用路径压缩和按秩合并时，单次操作的均摊时间复杂度为 O(α(n))，其中 α 是反阿克曼函数，增长极其缓慢，实际可视为 O(1)。",
            "checklist": [
                "能解释并查集的 Find 和 Union 操作",
                "能手写路径压缩和按秩合并的实现",
                "能说出并查集的典型应用场景",
                "能解释路径压缩的时间复杂度分析",
            ],
            "commonMistakes": [
                "find 函数忘记路径压缩导致时间退化",
                "union 时没有按秩合并导致树不平衡",
                "初始化时忘记将每个节点的 parent 设为自己",
            ],
        },
        {
            "category": "array-list",
            "title": "Trie 字典树",
            "summary": "掌握 Trie 的插入、查询和前缀匹配操作，适用于字符串集合的高效检索",
            "difficulty": 3,
            "estimatedMinutes": 20,
            "explain": """# Trie 字典树

## 一、什么是 Trie
Trie（发音同 try）是一种树形数据结构，用于高效存储和检索字符串集合。每个节点代表一个字符，从根到叶子的路径构成一个单词。

## 二、基本实现
```java
class Trie {
    private Trie[] children = new Trie[26];
    private boolean isEnd;
    
    public void insert(String word) {
        Trie node = this;
        for (char c : word.toCharArray()) {
            int i = c - 'a';
            if (node.children[i] == null) node.children[i] = new Trie();
            node = node.children[i];
        }
        node.isEnd = true;
    }
    
    public boolean search(String word) {
        Trie node = searchPrefix(word);
        return node != null && node.isEnd;
    }
    
    public boolean startsWith(String prefix) {
        return searchPrefix(prefix) != null;
    }
    
    private Trie searchPrefix(String prefix) {
        Trie node = this;
        for (char c : prefix.toCharArray()) {
            int i = c - 'a';
            if (node.children[i] == null) return null;
            node = node.children[i];
        }
        return node;
    }
}
```

## 三、时间复杂度
- 插入：O(L)，L 为单词长度
- 查询：O(L)
- 前缀匹配：O(L)

## 四、应用场景
- 自动补全
- 拼写检查
- IP 路由表
- 词频统计""",
            "compareTable": "| 对比项 | Trie | HashMap | BST |\n| --- | --- | --- | --- |\n| 查找时间 | O(L) | O(L) 均摊 | O(L·logN) |\n| 前缀查询 | O(L) | 不支持 | O(L·logN) |\n| 空间 | O(N·L·Σ) | O(N·L) | O(N·L) |\n| 适用场景 | 前缀匹配 | 精确查找 | 有序遍历 |",
            "interviewAnswer": "**Q1: Trie 是什么？有什么优势？**\n\nTrie 是字典树，每个节点代表一个字符，从根到叶的路径构成单词。优势是查找和插入都是 O(L)（L 为单词长度），且天然支持前缀匹配。比 HashMap 的优势在于能高效做前缀查询。\n\n**Q2: Trie 的空间复杂度是多少？如何优化？**\n\n最坏情况是 O(N·L·Σ)，N 是单词数，L 是平均长度，Σ 是字符集大小。优化方式：压缩 Trie（将只有一个子节点的路径合并）、三叉 Trie（每个节点只有 3 个指针）。\n\n**Q3: Trie 有哪些实际应用？**\n\n自动补全（输入法）、拼写检查（搜索引擎的'你是不是要搜'）、IP 路由表（最长前缀匹配）、词频统计（文本分析）。",
            "checklist": [
                "能手写 Trie 的插入、查询、前缀匹配操作",
                "能解释 Trie 的时间复杂度优势",
                "能说出 Trie 的典型应用场景",
                "能分析 Trie 的空间复杂度和优化方式",
            ],
            "commonMistakes": [
                "忘记在插入结束时设置 isEnd 标记",
                "search 和 startsWith 的逻辑搞混",
                "不理解 Trie 的空间开销在字符集大时的问题",
            ],
        },
    ],
    "java": [
        {
            "category": "spring",
            "title": "Spring AOP 深入",
            "summary": "理解 AOP 的实现原理、切面执行顺序、自定义注解开发",
            "difficulty": 3,
            "estimatedMinutes": 25,
            "explain": """# Spring AOP 深入

## 一、AOP 核心概念
- **切面(Aspect)**：横切关注点的模块化（如日志、事务）
- **连接点(JoinPoint)**：程序执行的某个点（Spring AOP 只支持方法级别）
- **切入点(Pointcut)**：匹配连接点的表达式
- **通知(Advice)**：在切入点执行的动作

## 二、五种通知类型
```java
@Aspect
@Component
public class LogAspect {
    @Before("execution(* com.example.service.*.*(..))")
    public void before(JoinPoint jp) { /* 前置通知 */ }
    
    @After("execution(* com.example.service.*.*(..))")
    public void after(JoinPoint jp) { /* 后置通知 */ }
    
    @AfterReturning(pointcut = "...", returning = "result")
    public void afterReturning(Object result) { /* 返回通知 */ }
    
    @AfterThrowing(pointcut = "...", throwing = "ex")
    public void afterThrowing(Exception ex) { /* 异常通知 */ }
    
    @Around("execution(* com.example.service.*.*(..))")
    public Object around(ProceedingJoinPoint pjp) throws Throwable {
        // 环绕通知（最强大）
        long start = System.currentTimeMillis();
        Object result = pjp.proceed();
        long cost = System.currentTimeMillis() - start;
        return result;
    }
}
```

## 三、两种代理方式
- **JDK 动态代理**：目标类实现了接口时使用（基于接口）
- **CGLIB 代理**：目标类没有实现接口时使用（基于继承，生成子类）

Spring Boot 2.x 默认使用 CGLIB 代理。

## 四、切面执行顺序
多个切面时，按 @Order 注解的值排序（值小的先执行）。同一方法的执行顺序：
Around → Before → 方法执行 → AfterReturning/AfterThrowing → After → Around""",
            "compareTable": "| 对比项 | JDK 动态代理 | CGLIB 代理 |\n| --- | --- | --- |\n| 实现方式 | 基于接口 | 基于继承 |\n| 要求 | 目标类必须实现接口 | 目标类不能是 final |\n| 性能 | 反射调用较慢 | 字节码生成较快 |\n| Spring Boot 2.x | 非默认 | 默认 |",
            "interviewAnswer": "**Q1: Spring AOP 的实现原理是什么？**\n\nSpring AOP 通过动态代理实现。如果目标类实现了接口，使用 JDK 动态代理（基于 java.lang.reflect.Proxy）；如果没有实现接口，使用 CGLIB 代理（通过字节码生成目标类的子类）。Spring Boot 2.x 默认使用 CGLIB。\n\n**Q2: @Transactional 事务失效的常见原因？**\n\n1）方法不是 public 的（AOP 代理只能拦截 public 方法）；2）同类方法调用（this 调用绕过了代理）；3）异常被 catch 吞掉了；4）rollbackFor 没指定 RuntimeException 以外的异常；5）数据库引擎不支持事务（如 MyISAM）。\n\n**Q3: 多个切面的执行顺序怎么控制？**\n\n通过 @Order 注解控制，值越小优先级越高。执行顺序类似洋葱模型：Order 小的切面的 Around/Before 先执行，After 后执行。",
            "checklist": [
                "能说出 AOP 的五种通知类型及其执行顺序",
                "能解释 JDK 动态代理和 CGLIB 代理的区别",
                "能列举 @Transactional 事务失效的常见原因",
                "能用自定义注解 + AOP 实现日志记录",
            ],
            "commonMistakes": [
                "混淆 JDK 动态代理和 CGLIB 代理的使用条件",
                "@Transactional 在同类方法调用时失效",
                "不清楚 Around 通知中 proceed() 的作用",
            ],
        },
        {
            "category": "concurrency",
            "title": "CompletableFuture",
            "summary": "掌握 Java 8 异步编程利器 CompletableFuture 的组合、异常处理和实际应用",
            "difficulty": 4,
            "estimatedMinutes": 25,
            "explain": """# CompletableFuture

## 一、为什么需要 CompletableFuture
Future 的局限性：
- get() 阻塞等待结果
- 不能链式组合多个异步任务
- 没有异常处理机制

CompletableFuture 解决了这些问题。

## 二、创建异步任务
```java
// 有返回值
CompletableFuture<String> cf = CompletableFuture.supplyAsync(() -> {
    return queryFromDB();
});

// 无返回值
CompletableFuture<Void> cf2 = CompletableFuture.runAsync(() -> {
    sendEmail();
});
```

## 三、链式组合
```java
CompletableFuture<String> result = CompletableFuture
    .supplyAsync(() -> getUserId())           // 异步获取用户ID
    .thenApply(id -> queryUser(id))            // 同步转换
    .thenCompose(user -> getOrders(user))      // 异步组合（返回CF）
    .thenCombine(getDiscount(), (orders, disc) -> applyDiscount(orders, disc))
    .exceptionally(ex -> getDefaultResult());  // 异常处理
```

**关键方法**：
- thenApply：同步转换（类似 map）
- thenApplyAsync：异步转换
- thenCompose：异步组合（类似 flatMap）
- thenCombine：合并两个 CF 的结果
- allOf：等待所有 CF 完成
- anyOf：任意一个 CF 完成

## 四、异常处理
```java
cf.exceptionally(ex -> fallbackValue)  // 异常时返回默认值
  .handle((result, ex) -> {            // 统一处理结果和异常
      if (ex != null) return errorValue;
      return process(result);
  })
  .whenComplete((result, ex) -> {      // 回调，不改变结果
      log.info("完成: " + result);
  });
```""",
            "compareTable": "| 对比项 | Future | CompletableFuture |\n| --- | --- | --- |\n| 阻塞获取 | get() 阻塞 | 支持回调非阻塞 |\n| 链式组合 | 不支持 | thenApply/thenCompose |\n| 异常处理 | 只能 try-catch get() | exceptionally/handle |\n| 多任务组合 | 不支持 | allOf/anyOf/thenCombine |",
            "interviewAnswer": "**Q1: CompletableFuture 和 Future 的区别？**\n\nFuture 只能阻塞获取结果(get())，不能链式组合，没有优雅的异常处理。CompletableFuture 支持回调(thenApply)、异步组合(thenCompose)、多任务合并(allOf/thenCombine)、异常处理(exceptionally)，是 Java 8 异步编程的主力。\n\n**Q2: thenApply 和 thenCompose 的区别？**\n\nthenApply 类似 Stream 的 map，同步转换结果；thenCompose 类似 flatMap，当转换函数本身返回 CompletableFuture 时使用，避免嵌套 CF。\n\n**Q3: 如何等待多个异步任务全部完成？**\n\n用 CompletableFuture.allOf(cf1, cf2, cf3).join()。allOf 返回 Void，如果需要收集结果，用 thenApply 或 Stream map 每个 CF 的 join()。",
            "checklist": [
                "能用 supplyAsync/runAsync 创建异步任务",
                "能用 thenApply/thenCompose/thenCombine 组合任务",
                "能用 exceptionally/handle 处理异常",
                "能用 allOf/anyOf 协调多个异步任务",
            ],
            "commonMistakes": [
                "thenApply 和 thenCompose 的使用场景区分不清",
                "忘记处理异步任务中的异常导致静默失败",
                "在 thenApply 中做了阻塞操作导致线程池饥饿",
            ],
        },
    ],
    "agent": [
        {
            "category": "ai-engineering",
            "title": "LLM Fine-tuning 与 LoRA",
            "summary": "理解大模型微调的原理、LoRA 的低秩分解思想和实际应用",
            "difficulty": 4,
            "estimatedMinutes": 25,
            "explain": """# LLM Fine-tuning 与 LoRA

## 一、为什么需要微调
- 预训练模型的通用能力不满足特定领域需求
- Prompt Engineering 的能力上限有限
- 微调能让模型学习特定的输出格式和风格

## 二、微调方式
1. **全量微调(Full Fine-tuning)**：更新所有参数，效果最好但成本最高
2. **参数高效微调(PEFT)**：只更新少量参数
   - **LoRA**：低秩分解，在权重矩阵旁加旁路
   - **QLoRA**：LoRA + 4-bit 量化，进一步降低显存
   - **Prefix Tuning**：在输入前加可学习的前缀向量

## 三、LoRA 原理
核心思想：大模型的权重更新矩阵是低秩的，可以用两个小矩阵近似。

```
原始权重: W (d × d)
LoRA:     W + ΔW = W + B × A
其中 B (d × r), A (r × d), r << d
```

**参数量对比**：
- 全量微调：d² 参数
- LoRA：2 × d × r 参数（r 通常取 8-64）
- 例：d=4096, r=16 时，参数量从 16M 降到 128K（减少 99.2%）

## 四、QLoRA
在 LoRA 基础上加上 4-bit 量化：
- 将预训练权重量化为 4-bit NormalFloat
- LoRA 旁路仍用 16-bit 训练
- 显存需求大幅降低（7B 模型只需 ~6GB 显存）""",
            "compareTable": "| 对比项 | 全量微调 | LoRA | QLoRA |\n| --- | --- | --- | --- |\n| 更新参数 | 全部 | 旁路矩阵 | 旁路矩阵 |\n| 显存需求 | 很高 | 中等 | 低 |\n| 训练速度 | 慢 | 快 | 中等 |\n| 效果 | 最好 | 接近全量 | 略低于LoRA |\n| 适用场景 | 数据充足 | 通用 | 显存有限 |",
            "interviewAnswer": "**Q1: 什么是 LoRA？为什么有效？**\n\nLoRA 是参数高效微调方法，核心思想是预训练模型的权重更新矩阵是低秩的。通过在原始权重旁加两个低秩矩阵 B×A 的旁路，只训练旁路参数（通常是原参数的 0.1%-1%），就能达到接近全量微调的效果。\n\n**Q2: LoRA 的秩 r 怎么选？**\n\nr 越大效果越好但参数越多。经验值：简单任务 r=4-8，复杂任务 r=16-64。实际项目中通常从 r=16 开始，根据效果调整。r 的选择还受模型大小影响，大模型可以用更小的 r。\n\n**Q3: Fine-tuning 和 RAG 的选型？**\n\nFine-tuning 适合：需要改变模型的输出风格/格式、领域知识密集、有高质量标注数据。RAG 适合：知识需要频繁更新、需要引用来源、数据量大不适合微调。两者可以结合使用。",
            "checklist": [
                "能解释 LoRA 的低秩分解原理",
                "能比较全量微调、LoRA、QLoRA 的区别",
                "能说出 LoRA 秩 r 的选择策略",
                "能分析 Fine-tuning 和 RAG 的适用场景",
            ],
            "commonMistakes": [
                "混淆 LoRA 和全量微调的效果差异",
                "不了解 QLoRA 的 4-bit 量化对精度的影响",
                "在数据量不足时仍选择全量微调导致过拟合",
            ],
        },
        {
            "category": "rag",
            "title": "RAG 评估与优化",
            "summary": "掌握 RAG 系统的评估指标、常见问题和优化策略",
            "difficulty": 3,
            "estimatedMinutes": 25,
            "explain": """# RAG 评估与优化

## 一、RAG 评估指标
### 检索质量
- **Recall@K**：前 K 个检索结果中包含正确答案的比例
- **MRR (Mean Reciprocal Rank)**：正确答案排名的倒数的均值
- **NDCG**：考虑排名位置的评估指标

### 生成质量
- **Faithfulness**：生成内容是否忠实于检索到的上下文
- **Answer Relevancy**：生成的回答是否与问题相关
- **Context Relevancy**：检索到的上下文是否与问题相关

## 二、常见问题与优化

### 问题 1：检索不到相关文档
**原因**：分块策略不当、Embedding 模型不匹配
**优化**：
- 调整分块大小（推荐 256-512 tokens）
- 使用混合检索（向量 + BM25 关键词）
- 选择领域适配的 Embedding 模型

### 问题 2：检索到但答案不准确
**原因**：上下文噪声大、LLM 幻觉
**优化**：
- 增加重排序(Reranker)步骤
- 使用 Map-Reduce 或 Refine 策略处理长上下文
- 在 Prompt 中强调"只根据提供的上下文回答"

### 问题 3：答案引用不准确
**原因**：分块切断了语义完整性
**优化**：
- 使用父子文档策略（检索小块，返回大块）
- 添加元数据过滤（时间、来源、类别）
- 实现引用追踪（标注答案来源）""",
            "compareTable": "| 对比项 | 向量检索 | BM25关键词 | 混合检索 |\n| --- | --- | --- | --- |\n| 语义理解 | 强 | 弱 | 强 |\n| 精确匹配 | 弱 | 强 | 强 |\n| 实现复杂度 | 中等 | 简单 | 中等 |\n| 适用场景 | 语义查询 | 关键词查询 | 通用 |",
            "interviewAnswer": "**Q1: 如何评估 RAG 系统的质量？**\n\n从两个维度：检索质量和生成质量。检索质量看 Recall@K（前K个结果是否包含答案）和 MRR（正确答案的排名）。生成质量看 Faithfulness（是否忠实于上下文）和 Answer Relevancy（是否回答了问题）。可以用 RAGAS 框架自动化评估。\n\n**Q2: RAG 检索不到相关内容怎么优化？**\n\n1）调整分块策略（大小、重叠）；2）使用混合检索（向量+BM25）；3）选择领域适配的 Embedding 模型；4）添加查询改写（HyDE、Multi-Query）。\n\n**Q3: RAG 的分块策略怎么选？**\n\n推荐 256-512 tokens，重叠 10-20%。按语义分块（段落、章节）优于按固定长度分块。对于代码，按函数/类分块。对于表格，保持表格完整性。",
            "checklist": [
                "能说出 RAG 的主要评估指标（Recall、MRR、Faithfulness）",
                "能列举 RAG 的常见问题和对应优化策略",
                "能解释混合检索（向量+BM25）的优势",
                "能设计合理的分块策略",
            ],
            "commonMistakes": [
                "只关注检索精度忽略了生成质量",
                "分块大小不合适导致语义被切断",
                "没有重排序步骤导致噪声文档影响生成",
            ],
        },
    ],
    "architecture": [
        {
            "category": "microservice",
            "title": "服务网格与 Service Mesh",
            "summary": "理解 Service Mesh 的架构原理、Sidecar 模式和 Istio 核心组件",
            "difficulty": 4,
            "estimatedMinutes": 20,
            "explain": """# 服务网格与 Service Mesh

## 一、什么是 Service Mesh
Service Mesh 是处理服务间通信的基础设施层。它将服务通信的逻辑从业务代码中抽离，以 Sidecar 代理的形式部署。

## 二、架构
```
┌─────────┐    ┌─────────┐
│ Service A│    │ Service B│
├─────────┤    ├─────────┤
│ Sidecar │◄──►│ Sidecar │
│ (Envoy) │    │ (Envoy) │
└─────────┘    └─────────┘
       ▲              ▲
       │    控制平面    │
       └──── Istio ────┘
```

**数据平面**：Sidecar 代理（Envoy），拦截所有服务间流量
**控制平面**：Istiod，配置管理、服务发现、证书管理

## 三、核心能力
- **流量管理**：灰度发布、金丝雀发布、流量镜像
- **可观测性**：分布式链路追踪、指标监控、访问日志
- **安全**：mTLS 双向认证、RBAC 访问控制
- **弹性**：重试、超时、熔断、限流

## 四、与 API 网关的关系
- API 网关：处理南北向流量（外部→内部）
- Service Mesh：处理东西向流量（服务→服务）
- 两者互补，不冲突""",
            "compareTable": "| 对比项 | SDK 方式 | Service Mesh |\n| --- | --- | --- |\n| 通信逻辑 | 内嵌在业务代码中 | Sidecar 代理透明处理 |\n| 语言绑定 | 需要每种语言 SDK | 语言无关 |\n| 升级方式 | 需要重新部署业务 | 独立升级 Sidecar |\n| 性能损耗 | 低 | 多一跳（~1ms） |\n| 学习成本 | 低 | 高（Istio 复杂） |",
            "interviewAnswer": "**Q1: 什么是 Service Mesh？解决了什么问题？**\n\nService Mesh 是处理服务间通信的基础设施层，将流量管理、可观测性、安全等通信逻辑从业务代码中抽离，通过 Sidecar 代理透明处理。解决了微服务架构中通信逻辑与业务代码耦合、每种语言都要实现一遍 SDK 的问题。\n\n**Q2: Sidecar 模式有什么优缺点？**\n\n优点：语言无关、独立升级、业务无侵入。缺点：每个服务多一个代理实例，增加资源消耗和约 1ms 的延迟。对于延迟敏感的场景需要评估。\n\n**Q3: Service Mesh 和 API 网关的区别？**\n\nAPI 网关处理南北向流量（外部请求进入系统），Service Mesh 处理东西向流量（服务间通信）。两者互补：API 网关做统一入口、鉴权、限流；Service Mesh 做服务间负载均衡、熔断、mTLS。",
            "checklist": [
                "能解释 Service Mesh 的数据平面和控制平面",
                "能说出 Sidecar 模式的优缺点",
                "能列举 Service Mesh 的核心能力",
                "能区分 Service Mesh 和 API 网关的职责",
            ],
            "commonMistakes": [
                "混淆 Service Mesh 和 API 网关的职责",
                "不了解 Sidecar 模式带来的性能损耗",
                "认为 Service Mesh 能解决所有微服务问题",
            ],
        },
    ],
}


def add_missing_topics():
    """Add new topics to the content"""
    total_added = 0
    
    for domain_id, topics in NEW_TOPICS.items():
        topics_dir = os.path.join(CONTENT_ROOT, f"topics/{domain_id}")
        if not os.path.isdir(topics_dir):
            os.makedirs(topics_dir, exist_ok=True)
        
        domain_path = os.path.join(CONTENT_ROOT, f"domains/{domain_id}.json")
        if not os.path.exists(domain_path):
            continue
        domain = read_json(domain_path)
        
        for topic_data in topics:
            uid = gen_id()
            filename = f"topic-{uid}.json"
            filepath = os.path.join(topics_dir, filename)
            
            topic = {
                "id": f"{domain_id}.{topic_data['category']}.topic-{uid}",
                "domain": domain_id,
                "category": topic_data["category"],
                "group": topic_data["category"],
                "title": topic_data["title"],
                "summary": topic_data["summary"],
                "tags": [domain_id, topic_data["category"], topic_data["title"]],
                "difficulty": topic_data["difficulty"],
                "estimatedMinutes": topic_data["estimatedMinutes"],
                "order": 999,
                "recommendWeight": 70,
                "status": "production",
                "learningCards": [
                    {
                        "type": "explain",
                        "title": "知识全景",
                        "content": topic_data["explain"],
                    },
                    {
                        "type": "compareTable",
                        "title": "对比与边界",
                        "content": topic_data["compareTable"],
                    },
                    {
                        "type": "interviewAnswer",
                        "title": "面试回答模板",
                        "content": topic_data["interviewAnswer"],
                        "followUpQuestions": [
                            {
                                "question": f"能深入说说{topic_data['title']}的核心实现原理吗？",
                                "answer": f"从{topic_data['title']}的底层实现来看，关键在于理解其核心数据结构和算法选择。建议通过画图和写代码的方式深入理解。",
                            },
                            {
                                "question": f"在实际项目中，{topic_data['title']}有哪些应用场景？",
                                "answer": f"{topic_data['title']}在实际项目中的应用需要结合具体业务场景，关键是理解其适用边界和性能特征。",
                            },
                            {
                                "question": f"使用{topic_data['title']}时有哪些常见的坑？",
                                "answer": f"最大的坑是只背概念不理解原理。建议通过debug源码、写demo验证的方式深入理解。",
                            },
                        ],
                    },
                    {
                        "type": "checklist",
                        "title": "学完后应能说清楚",
                        "items": topic_data["checklist"],
                    },
                ],
                "recallPrompts": [
                    {
                        "id": f"{domain_id}.{topic_data['category']}.topic-{uid}.recall.1",
                        "prompt": f"请用自己的话解释{topic_data['title']}的核心概念。",
                        "mode": "text",
                        "expectedMinutes": 3,
                        "difficulty": topic_data["difficulty"],
                    },
                ],
                "rubric": {
                    "mustHave": topic_data["checklist"][:3],
                    "goodToHave": topic_data["checklist"][3:],
                    "commonMistakes": topic_data["commonMistakes"],
                    "scoreWeights": {
                        "coverage": 30,
                        "accuracy": 30,
                        "interviewExpression": 20,
                        "depth": 20,
                    },
                },
                "updatedAt": "2026-05-29",
            }
            
            write_json(filepath, topic)
            
            # Add to domain file
            rel_path = f"topics/{domain_id}/{filename}"
            for cat in domain.get("categories", []):
                if cat["id"] == topic_data["category"]:
                    cat["topics"].append(rel_path)
                    break
            
            total_added += 1
        
        # Update domain file
        write_json(domain_path, domain)
    
    # Update manifest
    manifest_path = os.path.join(CONTENT_ROOT, "manifest.json")
    manifest = read_json(manifest_path)
    for entry in manifest.get("domains", []):
        domain_id = entry["id"]
        if domain_id in NEW_TOPICS:
            domain = read_json(os.path.join(CONTENT_ROOT, f"domains/{domain_id}.json"))
            entry["topicCount"] = sum(len(c.get("topics", [])) for c in domain.get("categories", []))
    write_json(manifest_path, manifest)
    
    return total_added


if __name__ == "__main__":
    print("🚀 Phase 4: Adding missing knowledge points...")
    print()
    
    count = add_missing_topics()
    print(f"✅ Added {count} new topics")
    
    # Show breakdown
    for domain_id in NEW_TOPICS:
        print(f"  - {domain_id}: {len(NEW_TOPICS[domain_id])} topics")
