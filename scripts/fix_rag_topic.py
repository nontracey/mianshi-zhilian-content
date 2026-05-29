#!/usr/bin/env python3
"""
整改RAG topic内容，收敛为基础链路原理
"""
import json
import os

def fix_rag_topic():
    """修改RAG topic文件"""
    filepath = "topics/agent/topic-106-bf5350b9.json"
    
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 修改标题
    data['title'] = 'RAG基本链路'
    
    # 修改summary
    data['summary'] = 'RAG完整Pipeline：文档加载、分块、Embedding、向量索引、检索召回、重排序、上下文构建、生成、引用溯源、评估'
    
    # 修改learningCards
    data['learningCards'] = [
        {
            "type": "explain",
            "title": "核心概念",
            "content": "# RAG基本链路\n\n## 一、RAG概述\nRAG（Retrieval-Augmented Generation，检索增强生成）是将**外部知识检索**与**大语言模型生成**相结合的架构范式。其核心思想是：先从知识库中检索相关文档，再将检索结果作为上下文注入Prompt，由LLM生成最终回答。\n\n**为什么需要RAG？**\nRAG的核心价值在于\"让LLM在生成时有据可依\"。相比Fine-tuning，RAG的优势是：1）无需重新训练模型，知识更新只需更新文档库；2）生成结果可溯源到具体文档片段，增强可信度；3）部署成本低，适合企业快速落地知识问答场景。"
        },
        {
            "type": "explain",
            "title": "深入理解",
            "content": "## 二、RAG完整流程\nRAG的标准Pipeline包含六个阶段：\n```\n加载(Loading) → 分割(Splitting) → 嵌入(Embedding) → 存储(Storage) → 检索(Retrieval) → 生成(Generation)\n```\n\n### 2.1 文档加载（Document Loading）\n将不同格式的源数据统一为结构化文档，包含文本内容和元数据。支持格式：PDF、Word、网页、数据库等。\n\n### 2.2 文本分割（Text Splitting）\n文本分割是RAG质量的关键环节。分割粒度直接影响检索精度和生成质量。\n\n**分割策略对比**\n| 策略 | 优点 | 缺点 | 适用场景 |\n| --- | --- | --- | --- |\n| 固定字符分割 | 简单快速 | 可能切断语义 | 通用文本 |\n| 递归字符分割 | 按语义边界分割 | 需要调参 | 结构化文档 |\n| 语义分割 | 保持语义完整 | 计算成本高 | 高质量需求 |\n\n**关键参数**\n- **chunk_size**：分块大小。推荐值：500-1500字符\n- **chunk_overlap**：重叠区域大小。推荐值：chunk_size的10%-20%\n\n### 2.3 嵌入模型（Embedding）\nEmbedding将文本转换为高维向量，是语义检索的基础。\n\n**Embedding原理**\n- 将文本映射到稠密向量空间\n- 语义相似的文本向量距离近\n- 训练方式：对比学习（正样本拉近，负样本推远）\n\n### 2.4 向量存储与索引\n将Embedding向量存入向量数据库，建立索引以支持高效检索。常用向量数据库：FAISS、Milvus、Pinecone、Weaviate等。\n\n### 2.5 检索召回\n根据用户查询，从向量数据库中检索最相关的文档片段。\n\n**检索方式**\n- **向量检索**：计算查询向量与文档向量的相似度\n- **关键词检索**：基于BM25等算法的精确匹配\n- **混合检索**：结合向量检索和关键词检索\n\n### 2.6 重排序（Reranking）\n先用向量检索召回候选集（如Top-20），再用Cross-Encoder模型精排，取Top-5。\n\n### 2.7 上下文构建\n将检索到的文档片段组织成Prompt上下文，注入LLM。\n\n**Prompt模板示例**\n```\n基于以下参考资料回答用户问题。\n如果参考资料中没有相关信息，请说明无法回答。\n\n参考资料：\n{retrieved_chunks}\n\n用户问题：{question}\n```\n\n### 2.8 生成与引用溯源\nLLM基于上下文生成回答，并标注信息来源。\n\n## 三、向量相似度\n\n### 余弦相似度\n```\ncos_sim(A,B) = (A·B) / (|A|×|B|)\n```\n- 范围：[-1, 1]，1表示完全相同\n- 优点：不受向量长度影响\n\n### 欧氏距离\n```\ndist(A,B) = √(Σ(A_i - B_i)²)\n```\n- 范围：[0, +∞)，0表示完全相同\n- 优点：直观\n\n### 点积相似度\n```\ndot_sim(A,B) = A·B\n```\n- 范围：(-∞, +∞)\n- 优点：计算效率高，适合已归一化向量\n\n## 四、RAG优化技巧\n\n### 4.1 分块优化\n- chunk_size建议500-1000字符，太大会稀释相关性，太小会丢失上下文\n- chunk_overlap设为chunk_size的15%-20%，避免信息在边界处被截断\n- 对于结构化文档优先使用结构感知的Splitter\n\n### 4.2 检索优化\n- 混合检索：结合向量检索和关键词检索\n- 重排序：用Cross-Encoder模型精排\n- 查询改写：Multi-Query、HyDE等技术\n\n### 4.3 生成优化\n- Prompt工程：明确要求模型基于检索结果回答\n- 引用溯源：标注信息来源\n- 答案校验：检查回答是否与检索结果一致\n\n## 五、使用场景\n- **企业知识库问答**：将内部文档、产品文档接入AI助手\n- **客服机器人**：基于产品手册和FAQ回答用户问题\n- **研究助手**：检索学术论文和报告，辅助研究\n- **法律咨询**：检索法律条文和案例，提供法律建议\n- **医疗问答**：检索医学文献和指南，辅助诊断"
        },
        {
            "type": "compareTable",
            "title": "对比与边界",
            "content": "| 对比项 | RAG | Fine-tuning | 纯LLM |\n| --- | --- | --- | --- |\n| 知识更新 | 更新文档库即可，无需重新训练 | 需要重新训练模型 | 依赖模型已有知识 |\n| 可溯源性 | 可追溯到具体文档片段 | 难以溯源 | 无法溯源 |\n| 部署成本 | 低，只需向量数据库 | 高，需要GPU训练 | 最低，直接调用API |\n| 适用场景 | 企业知识问答、文档助手 | 特定领域任务优化 | 通用对话、创意生成 |\n| 回答质量 | 基于检索结果，准确性高 | 依赖训练数据质量 | 可能产生幻觉 |\n| 延迟影响 | 增加检索延迟（100-500ms） | 无额外延迟 | 无额外延迟 |\n\n| 对比项 | 余弦相似度 | 欧氏距离 | 点积相似度 |\n| --- | --- | --- | --- |\n| 计算公式 | (A·B)/(\\|A\\|×\\|B\\|) | √(Σ(A_i-B_i)²) | A·B |\n| 取值范围 | [-1, 1] | [0, +∞) | (-∞, +∞) |\n| 完全相同 | 1 | 0 | 最大值 |\n| 向量长度影响 | 不受影响 | 受影响 | 受影响 |\n| 计算复杂度 | 中等 | 较高 | 最低 |\n| 适用场景 | RAG检索、语义搜索 | 聚类、异常检测 | 推荐系统 |"
        },
        {
            "type": "diagram",
            "title": "结构图解",
            "content": "RAG的学习路径图，用于替代原始Markdown中容易变形的ASCII图。",
            "fallback": "建议用“输入/触发 → 核心流程 → 关键状态 → 输出/风险”的流程图复述RAG，并标出它在LLM基础中的位置。",
            "items": [
                "定位：LLM基础的检索增强架构",
                "输入：用户问题与外部知识库",
                "阶段一：文档加载与文本分割",
                "阶段二：向量嵌入与存储",
                "阶段三：语义检索与上下文构建",
                "阶段四：LLM生成最终回答",
                "输出：可溯源的准确回答",
                "关键风险：检索质量、延迟、成本"
            ],
            "asset": "assets/diagrams/05-rag-pipeline.svg"
        },
        {
            "type": "code",
            "title": "代码/伪代码抓手",
            "content": "```python\n# RAG完整流程伪代码\ndef rag_pipeline(question, knowledge_base):\n    # 1. 加载文档\n    documents = load_documents(knowledge_base)\n    \n    # 2. 文本分割\n    chunks = split_text(documents, chunk_size=1000, chunk_overlap=200)\n    \n    # 3. 向量化\n    embeddings = embed_text(chunks)\n    \n    # 4. 建立索引\n    vectorstore = create_vectorstore(embeddings)\n    \n    # 5. 检索\n    relevant_chunks = retrieve(question, vectorstore, top_k=5)\n    \n    # 6. 重排序\n    reranked_chunks = rerank(question, relevant_chunks)\n    \n    # 7. 构建Prompt\n    prompt = build_prompt(question, reranked_chunks)\n    \n    # 8. 生成回答\n    answer = llm.generate(prompt)\n    \n    # 9. 引用溯源\n    answer_with_sources = add_sources(answer, reranked_chunks)\n    \n    return answer_with_sources\n```",
            "language": "python"
        },
        {
            "type": "interviewAnswer",
            "title": "面试回答模板",
            "content": "**问题1：什么是RAG？它解决了什么问题？**\n\nRAG是检索增强生成，它通过将外部知识检索与LLM生成相结合，解决了纯LLM的知识局限和幻觉问题。具体来说，RAG先从知识库中检索相关文档，再将检索结果作为上下文注入Prompt，让LLM基于这些信息生成回答。这样既保留了LLM的生成能力，又确保了回答有据可依，特别适合企业知识问答、文档助手等场景。\n\n**问题2：RAG和Fine-tuning有什么区别？如何选择？**\n\nRAG和Fine-tuning是两种不同的知识注入方式。RAG通过检索外部知识库来增强生成，优势是知识更新快、可溯源、部署成本低；Fine-tuning通过重新训练模型来注入知识，优势是响应快、无额外延迟。选择建议：如果知识频繁更新或需要溯源，选RAG；如果任务特定且知识稳定，选Fine-tuning；在实际项目中，通常做法是先用RAG快速验证，再根据效果决定是否Fine-tuning。\n\n**问题3：如何优化RAG系统的检索质量？**\n\n优化RAG检索质量可以从三个层面入手：首先是数据层面，优化文档分割策略，使用结构化分割而非简单字符分割，chunk_size建议500-1000字符；其次是检索层面，使用混合检索（语义检索+关键词检索），并设置合理的相似度阈值；最后是生成层面，优化Prompt模板，明确要求模型基于检索结果回答。\n\n**问题4：Embedding的原理是什么？**\n\nEmbedding是将文本映射到稠密向量空间的技术。核心思想是：语义相似的文本在向量空间中距离更近。训练方式通常采用对比学习，将正样本拉近、负样本推远。常用模型包括OpenAI text-embedding-3-small、BGE、M3E等，向量维度通常在768到3072之间。在RAG系统中，Embedding质量直接影响检索效果。\n\n**问题5：余弦相似度和欧氏距离有什么区别？**\n\n余弦相似度衡量两个向量的方向相似性，计算公式是(A·B)/(|A|×|B|)，范围[-1, 1]，不受向量长度影响；欧氏距离衡量两个向量的空间距离，计算公式是√(Σ(A_i-B_i)²)，范围[0, +∞)，受向量长度影响。在RAG系统中，余弦相似度最常用，因为它对向量长度不敏感，更适合文本语义匹配。",
            "followUpQuestions": [
                {
                    "question": "如果 RAG 系统出现效果不佳（如召回不准、生成幻觉），你会怎么定位问题？",
                    "answer": "定位 RAG 系统效果问题的思路：先拆解为召回质量、排序质量、生成质量三个环节。用评估指标（Recall@K、MRR、Faithfulness）逐环节排查，结合 trace 日志看每一步的输入输出。常见问题包括 chunk 粒度不当、embedding 模型不匹配、prompt 模板缺陷等。"
                },
                {
                    "question": "RAG 系统在不同规模（小规模 POC vs 大规模生产）下，架构设计有什么区别？",
                    "answer": "POC 阶段 RAG 系统可以用简单架构快速验证；生产环境需要考虑高可用、成本控制、延迟优化、安全合规。比如向量库需要分片和副本，LLM 调用需要缓存和降级，需要完整的监控和评估体系。"
                },
                {
                    "question": "RAG系统有哪些评估指标？",
                    "answer": "RAG系统评估指标：1. 检索质量：Recall@K（召回率）、Precision@K（精确率）、MRR（平均倒数排名）；2. 生成质量：Faithfulness（忠实度）、Relevance（相关性）、Answer Correctness（答案正确性）；3. 端到端：F1-score、Exact Match。评估方法：人工评估、自动评估（RAGAS框架）。"
                }
            ]
        },
        {
            "type": "checklist",
            "title": "学完后应能说清楚",
            "items": [
                "能准确描述RAG的定义和核心价值",
                "能解释RAG的完整流程：加载、分割、嵌入、存储、检索、生成",
                "能比较RAG与Fine-tuning的区别和适用场景",
                "能说明文本分割策略对检索质量的影响",
                "能分析向量检索与关键词检索的优缺点",
                "能讨论RAG系统的性能优化方法",
                "能解释Embedding的原理和训练方式",
                "能比较余弦相似度和欧氏距离的区别",
                "能设计有效的Prompt模板",
                "能说出RAG系统的评估指标"
            ]
        }
    ]
    
    # 修改recallPrompts
    data['recallPrompts'] = [
        {
            "id": "agent.rag.topic-106-bf5350b9.recall.1",
            "prompt": "请描述RAG的核心流程和架构，以及在生产环境中的工程化挑战",
            "mode": "text",
            "expectedMinutes": 3,
            "difficulty": 2
        },
        {
            "id": "agent.rag.topic-106-bf5350b9.recall.2",
            "prompt": "RAG系统有哪些评估指标？如何优化检索质量？",
            "mode": "text",
            "expectedMinutes": 3,
            "difficulty": 2
        }
    ]
    
    # 修改rubric
    data['rubric'] = {
        "mustHave": [
            "能准确描述RAG的定义和核心价值",
            "能解释RAG的完整流程：加载、分割、嵌入、存储、检索、生成",
            "能比较RAG与Fine-tuning的区别和适用场景",
            "能解释Embedding的原理和训练方式",
            "能比较余弦相似度和欧氏距离的区别"
        ],
        "goodToHave": [
            "能说出RAG系统的评估指标和优化方法",
            "能解释RAG在生产环境中的工程化挑战和解决方案",
            "能设计有效的Prompt模板"
        ],
        "commonMistakes": [
            "不清楚分块策略对检索质量的影响",
            "不了解向量检索和关键词检索的区别",
            "不知道重排（Re-ranking）的作用"
        ],
        "scoreWeights": {
            "coverage": 25,
            "accuracy": 30,
            "interviewExpression": 20,
            "depth": 25
        }
    }
    
    # 修改interviewerFocus
    data['interviewerFocus'] = "考察对RAG核心流程的理解，包括文档分割、Embedding原理、检索优化和评估方法"
    
    # 写回文件
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"已修改 {filepath}")
    print(f"  标题: RAG原理与实战 -> RAG基本链路")
    print(f"  内容: 收敛为基础链路原理，删除框架代码和工具清单")

if __name__ == '__main__':
    fix_rag_topic()