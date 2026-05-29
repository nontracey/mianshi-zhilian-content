#!/usr/bin/env python3
"""
调整Agent领域topic顺序
"""
import json
import os

# 定义新的顺序
# embedding-retrieval分类
EMBEDDING_ORDER = {
    "topics/agent/topic-088-d8088d8c.json": 10,  # 向量数据库索引与检索
    "topics/agent/topic-121-15a0b1b4.json": 20,  # 向量数据库核心能力对比
}

# tool-agent分类
TOOL_AGENT_ORDER = {
    "topics/agent/topic-087-81c07ef4.json": 10,  # Function Calling与工具调用
    "topics/agent/topic-123-b51b29dc.json": 20,  # ReAct与Plan-and-Execute
    "topics/agent/topic-115-35c5dcec.json": 30,  # MCP协议基础
    "topics/agent/topic-093-de1a9ab0.json": 40,  # MCP协议深度
    "topics/agent/topic-107-9a15a561.json": 50,  # Agent架构与MCP
    "topics/agent/topic-125-30dc0c91.json": 60,  # Agent状态管理
    "topics/agent/topic-124-6e95a1cd.json": 70,  # 多Agent协作模式
}

def update_topic_order(filepath, new_order):
    """更新topic文件的order值"""
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    old_order = data.get('order')
    if old_order != new_order:
        data['order'] = new_order
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"  {filepath}: order {old_order} -> {new_order}")
        return True
    else:
        print(f"  {filepath}: order {old_order} 未变化")
        return False

def update_domain_json():
    """更新domains/agent.json中的topics列表顺序"""
    domain_file = "domains/agent.json"
    with open(domain_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 更新embedding-retrieval分类的topics顺序
    for category in data['categories']:
        if category['id'] == 'embedding-retrieval':
            # 按新顺序排列
            category['topics'] = [
                "topics/agent/topic-088-d8088d8c.json",
                "topics/agent/topic-121-15a0b1b4.json"
            ]
            print(f"  更新 embedding-retrieval 分类顺序")
        
        elif category['id'] == 'tool-agent':
            # 按新顺序排列
            category['topics'] = [
                "topics/agent/topic-087-81c07ef4.json",
                "topics/agent/topic-123-b51b29dc.json",
                "topics/agent/topic-115-35c5dcec.json",
                "topics/agent/topic-093-de1a9ab0.json",
                "topics/agent/topic-107-9a15a561.json",
                "topics/agent/topic-125-30dc0c91.json",
                "topics/agent/topic-124-6e95a1cd.json"
            ]
            print(f"  更新 tool-agent 分类顺序")
    
    with open(domain_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def main():
    """主函数"""
    print("开始调整Agent领域topic顺序...")
    
    # 更新embedding-retrieval分类的topic order
    print("\n更新 embedding-retrieval 分类:")
    for filepath, new_order in EMBEDDING_ORDER.items():
        update_topic_order(filepath, new_order)
    
    # 更新tool-agent分类的topic order
    print("\n更新 tool-agent 分类:")
    for filepath, new_order in TOOL_AGENT_ORDER.items():
        update_topic_order(filepath, new_order)
    
    # 更新domains/agent.json
    print("\n更新 domains/agent.json:")
    update_domain_json()
    
    print("\n完成！")

if __name__ == '__main__':
    main()