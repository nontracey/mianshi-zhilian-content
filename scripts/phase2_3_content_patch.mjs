import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const today = "2026-06-12";

async function readJson(file) {
  return JSON.parse(await readFile(path.join(root, file), "utf8"));
}

async function writeJson(file, data) {
  await writeFile(path.join(root, file), `${JSON.stringify(data, null, 2)}\n`);
}

function hasDiagram(topic) {
  return (topic.learningCards || []).some((card) => card.type === "diagram");
}

function mergePrerequisites(topic, prerequisites) {
  const existing = Array.isArray(topic.prerequisites) ? topic.prerequisites : [];
  const merged = [...new Set([...existing, ...prerequisites])]
    .filter((id) => id && id !== topic.id);
  if (merged.length) topic.prerequisites = merged;
}

function insertBeforeInterviewAnswer(topic, card) {
  const cards = topic.learningCards || [];
  const index = cards.findIndex((item) => item.type === "interviewAnswer");
  if (index >= 0) cards.splice(index, 0, card);
  else cards.push(card);
  topic.learningCards = cards;
}

const algorithmDiagramTemplates = {
  array: {
    title: "数组题状态推进图",
    content:
      "flowchart LR\nA[输入数组] --> B[确定下标和区间]\nB --> C[维护当前最优或中间状态]\nC --> D[遍历元素并更新答案]\nD --> E[返回目标结果]",
    caption: "数组题通常围绕下标、区间和当前最优状态推进，面试时先讲状态再讲更新时机。",
  },
  "linked-list": {
    title: "链表指针改写图",
    content:
      "flowchart LR\nA[虚拟头或前驱节点] --> B[定位 curr 和 next]\nB --> C[调整 next 指针]\nC --> D[移动前驱和当前节点]\nD --> E[返回新头或目标节点]",
    caption: "链表题的关键是先保护 next，再改指针，最后移动游标，避免断链。",
  },
  "two-pointer": {
    title: "双指针收敛图",
    content:
      "flowchart LR\nA[左右或快慢指针初始化] --> B[根据条件移动一侧]\nB --> C[维护候选答案]\nC --> D[指针相遇或越界]\nD --> E[输出最优解]",
    caption: "双指针题要说明指针移动规则为什么不会漏解。",
  },
  "sliding-window": {
    title: "滑动窗口状态图",
    content:
      "flowchart LR\nA[右指针扩张窗口] --> B[更新窗口统计]\nB --> C[判断合法性]\nC --> D[左指针收缩窗口]\nD --> E[在正确时机更新答案]",
    caption: "滑动窗口的核心是不变量：窗口统计与合法性判断必须同步更新。",
  },
  stack: {
    title: "栈状态变化图",
    content:
      "flowchart LR\nA[读取当前元素] --> B[比较栈顶或括号类型]\nB --> C[入栈保存候选]\nC --> D[出栈消解或更新答案]\nD --> E[检查栈剩余状态]",
    caption: "栈题关注后进先出、不匹配处理和栈顶代表的语义。",
  },
  queue: {
    title: "队列与堆维护图",
    content:
      "flowchart LR\nA[元素进入候选集合] --> B[按 FIFO 或优先级维护]\nB --> C[弹出过期或低优先级元素]\nC --> D[读取队头或堆顶]\nD --> E[更新当前答案]",
    caption: "队列/堆题要说清候选集合的排序或过期规则。",
  },
  "hash-table": {
    title: "哈希表查找图",
    content:
      "flowchart LR\nA[遍历元素] --> B[计算 key]\nB --> C[查询已有状态]\nC --> D[命中则更新答案]\nD --> E[写入或合并状态]",
    caption: "哈希表题的关键是把题意映射成稳定的 key 和可增量维护的 value。",
  },
  "binary-tree": {
    title: "二叉树递归状态图",
    content:
      "flowchart TD\nA[当前节点] --> B[处理左子树]\nA --> C[处理右子树]\nB --> D[合并子问题结果]\nC --> D[合并子问题结果]\nD --> E[返回当前节点答案]",
    caption: "二叉树题先定义递归函数返回值，再说明左右子树如何合并。",
  },
  graph: {
    title: "图遍历状态图",
    content:
      "flowchart LR\nA[建图或读取邻接关系] --> B[初始化 visited]\nB --> C[BFS 或 DFS 扩展]\nC --> D[处理邻居和状态转移]\nD --> E[统计连通性或可达性]",
    caption: "图题要交代 visited、边界和遍历顺序，避免重复访问。",
  },
  "dynamic-programming": {
    title: "动态规划转移图",
    content:
      "flowchart LR\nA[定义状态 dp] --> B[确定初始值]\nB --> C[枚举状态顺序]\nC --> D[套用转移方程]\nD --> E[从 dp 中取答案]",
    caption: "DP 题面试回答优先讲状态定义、转移方程和遍历顺序。",
  },
  backtracking: {
    title: "回溯搜索树图",
    content:
      "flowchart TD\nA[选择列表] --> B[做选择]\nB --> C[递归进入下一层]\nC --> D[命中终止条件]\nC --> E[撤销选择回溯]\nE --> A[选择列表]",
    caption: "回溯题的核心是路径、选择列表、终止条件和撤销选择。",
  },
  greedy: {
    title: "贪心决策图",
    content:
      "flowchart LR\nA[排序或定义局部规则] --> B[扫描候选]\nB --> C[做当前最优选择]\nC --> D[更新剩余约束]\nD --> E[证明不会影响全局最优]",
    caption: "贪心题必须补充选择规则的正确性理由，而不是只写代码。",
  },
  "binary-search": {
    title: "二分边界收缩图",
    content:
      "flowchart LR\nA[确定搜索区间] --> B[计算 mid]\nB --> C[判断答案所在半区]\nC --> D[收缩 left 或 right]\nD --> E[循环结束返回边界]",
    caption: "二分题要明确区间开闭、边界更新和循环退出条件。",
  },
  string: {
    title: "字符串状态扫描图",
    content:
      "flowchart LR\nA[读取字符] --> B[维护索引或频次]\nB --> C[匹配模式或更新状态]\nC --> D[处理边界字符]\nD --> E[输出子串或数值结果]",
    caption: "字符串题要把字符级处理、边界和状态更新说清。",
  },
  sorting: {
    title: "排序划分图",
    content:
      "flowchart LR\nA[选择排序策略] --> B[划分或建堆]\nB --> C[局部有序扩大]\nC --> D[处理第 k 或全局顺序]\nD --> E[返回排序结果或目标元素]",
    caption: "排序题关注比较规则、分区/堆化过程和复杂度。",
  },
  design: {
    title: "数据结构设计图",
    content:
      "flowchart LR\nA[明确操作语义] --> B[选择底层结构]\nB --> C[维护辅助索引]\nC --> D[保证核心操作复杂度]\nD --> E[处理容量和边界]",
    caption: "设计题要先列操作，再解释为什么组合数据结构能满足复杂度要求。",
  },
};

const pythonDiagramTemplates = {
  "python-basics": {
    title: "Python 对象与引用图",
    content:
      "flowchart LR\nA[变量名] --> B[对象引用]\nB --> C[类型和值]\nC --> D[操作产生新对象或原地修改]\nD --> E[作用域中继续绑定]",
    caption: "Python 基础题要区分变量名、对象和值，避免把变量理解成内存盒子。",
  },
  "python-advanced": {
    title: "进阶语法执行图",
    content:
      "flowchart LR\nA[定义函数或协议对象] --> B[创建包装或迭代状态]\nB --> C[调用时进入协议方法]\nC --> D[保存上下文或暂停点]\nD --> E[返回结果或继续迭代]",
    caption: "进阶特性通常围绕协议、包装和执行时机展开。",
  },
  "oop-python": {
    title: "Python OOP 查找图",
    content:
      "flowchart LR\nA[实例访问属性] --> B[检查实例字典]\nB --> C[沿 MRO 查找类属性]\nC --> D[触发描述符或魔术方法]\nD --> E[返回绑定结果]",
    caption: "OOP 面试题要说清实例、类、MRO 和描述符之间的查找顺序。",
  },
  "concurrent-python": {
    title: "Python 并发执行图",
    content:
      "flowchart LR\nA[任务提交] --> B[线程进程或协程调度]\nB --> C[遇到 CPU 或 IO 边界]\nC --> D[切换执行单元]\nD --> E[汇总结果或处理异常]",
    caption: "并发题要区分 CPU 密集、IO 密集和协作式调度。",
  },
  "engineering-python": {
    title: "工程实践闭环图",
    content:
      "flowchart LR\nA[代码组织] --> B[类型和依赖管理]\nB --> C[测试与静态检查]\nC --> D[性能分析]\nD --> E[发布和运行监控]",
    caption: "工程实践题强调从开发到测试、性能和发布的闭环。",
  },
  "web-python": {
    title: "Python Web 请求链路图",
    content:
      "flowchart LR\nA[HTTP 请求] --> B[路由匹配]\nB --> C[依赖注入或中间件]\nC --> D[业务与 ORM]\nD --> E[序列化响应]",
    caption: "Web 题要串起路由、中间件、业务层和数据库访问。",
  },
  "coding-python": {
    title: "Pythonic 编码决策图",
    content:
      "flowchart LR\nA[明确数据形态] --> B[选择内置函数或推导式]\nB --> C[组合标准库能力]\nC --> D[控制可读性和复杂度]\nD --> E[处理边界输入]",
    caption: "编码面试题关注 Pythonic 写法、可读性和边界处理。",
  },
};

function diagramFor(topic) {
  const templates =
    topic.domain === "algorithm" ? algorithmDiagramTemplates :
    topic.domain === "python" ? pythonDiagramTemplates :
    null;
  const template = templates?.[topic.category];
  if (!template) return null;
  return {
    type: "diagram",
    title: template.title,
    format: "mermaid",
    content: template.content,
    caption: template.caption,
    fallback: `${topic.title} 的图解可以按「输入 -> 状态维护 -> 边界处理 -> 输出答案」复述，重点说明每一步维护的状态和更新时机。`,
  };
}

const manifest = await readJson("manifest.json");
const targetDomains = new Set(["algorithm", "python", "java", "architecture"]);
let changedTopics = 0;
let addedDiagrams = 0;
let addedPrereqTopics = 0;

for (const domainEntry of manifest.domains) {
  if (!targetDomains.has(domainEntry.id)) continue;
  const domain = await readJson(domainEntry.entry);
  const categoryFirstTopicId = new Map();
  const categoryTopicIds = new Map();

  for (const category of domain.categories) {
    const ids = [];
    for (const topicPath of category.topics) {
      const topic = await readJson(topicPath);
      ids.push(topic.id);
    }
    categoryTopicIds.set(category.id, ids);
    if (ids[0]) categoryFirstTopicId.set(category.id, ids[0]);
  }

  for (let categoryIndex = 0; categoryIndex < domain.categories.length; categoryIndex++) {
    const category = domain.categories[categoryIndex];
    const previousCategory = domain.categories[categoryIndex - 1];
    const categoryPrereqIds = (category.prerequisites || [])
      .map((categoryId) => categoryFirstTopicId.get(categoryId))
      .filter(Boolean);
    const fallbackCategoryPrereq = previousCategory
      ? categoryFirstTopicId.get(previousCategory.id)
      : null;
    const currentFirst = categoryFirstTopicId.get(category.id);

    for (let topicIndex = 0; topicIndex < category.topics.length; topicIndex++) {
      const topicPath = category.topics[topicIndex];
      const topic = await readJson(topicPath);
      const before = JSON.stringify(topic);

      if ((topic.domain === "algorithm" || topic.domain === "python") && !hasDiagram(topic)) {
        const card = diagramFor(topic);
        if (card) {
          insertBeforeInterviewAnswer(topic, card);
          addedDiagrams++;
        }
      }

      const prereqs = [];
      if (topicIndex === 0) {
        prereqs.push(...categoryPrereqIds);
        if (!prereqs.length && fallbackCategoryPrereq) prereqs.push(fallbackCategoryPrereq);
      } else if (currentFirst && currentFirst !== topic.id) {
        prereqs.push(currentFirst);
      }
      mergePrerequisites(topic, prereqs);

      if (JSON.stringify(topic) !== before) {
        topic.updatedAt = today;
        await writeJson(topicPath, topic);
        changedTopics++;
        if ((topic.prerequisites || []).length > 0 && !(JSON.parse(before).prerequisites || []).length) {
          addedPrereqTopics++;
        }
      }
    }
  }
}

console.log(`Changed topics: ${changedTopics}`);
console.log(`Added diagram cards: ${addedDiagrams}`);
console.log(`Topics newly receiving prerequisites: ${addedPrereqTopics}`);
