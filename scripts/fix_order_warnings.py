#!/usr/bin/env python3
"""
修复顺序警告
"""
import json
import os

def fix_microservice_order():
    """修复java/microservice分类的顺序"""
    # 读取domains/java.json
    with open("domains/java.json", 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 找到microservice分类
    for category in data['categories']:
        if category['id'] == 'microservice':
            # 读取每个topic的order值
            topics_with_order = []
            for topic_ref in category['topics']:
                with open(topic_ref, 'r', encoding='utf-8') as f:
                    topic_data = json.load(f)
                topics_with_order.append({
                    'ref': topic_ref,
                    'order': topic_data.get('order', 0),
                    'title': topic_data.get('title', '')
                })
            
            # 按order排序
            topics_with_order.sort(key=lambda x: x['order'])
            
            # 更新topics列表
            category['topics'] = [t['ref'] for t in topics_with_order]
            
            # 打印排序结果
            print("  microservice分类排序结果:")
            for t in topics_with_order:
                print(f"    {t['title']}: order={t['order']}")
            break
    
    # 写回文件
    with open("domains/java.json", 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def fix_middleware_order():
    """修复java/middleware分类的顺序"""
    # 读取domains/java.json
    with open("domains/java.json", 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 找到middleware分类
    for category in data['categories']:
        if category['id'] == 'middleware':
            # 读取每个topic的order值
            topics_with_order = []
            for topic_ref in category['topics']:
                with open(topic_ref, 'r', encoding='utf-8') as f:
                    topic_data = json.load(f)
                topics_with_order.append({
                    'ref': topic_ref,
                    'order': topic_data.get('order', 0),
                    'title': topic_data.get('title', '')
                })
            
            # 按order排序
            topics_with_order.sort(key=lambda x: x['order'])
            
            # 更新topics列表
            category['topics'] = [t['ref'] for t in topics_with_order]
            
            # 打印排序结果
            print("  middleware分类排序结果:")
            for t in topics_with_order:
                print(f"    {t['title']}: order={t['order']}")
            break
    
    # 写回文件
    with open("domains/java.json", 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def fix_architecture_order():
    """修复architecture/system-design分类的顺序"""
    # 读取domains/architecture.json
    with open("domains/architecture.json", 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 找到system-design分类
    for category in data['categories']:
        if category['id'] == 'system-design':
            # 读取每个topic的order值
            topics_with_order = []
            for topic_ref in category['topics']:
                with open(topic_ref, 'r', encoding='utf-8') as f:
                    topic_data = json.load(f)
                topics_with_order.append({
                    'ref': topic_ref,
                    'order': topic_data.get('order', 0),
                    'title': topic_data.get('title', '')
                })
            
            # 按order排序
            topics_with_order.sort(key=lambda x: x['order'])
            
            # 更新topics列表
            category['topics'] = [t['ref'] for t in topics_with_order]
            
            # 打印排序结果
            print("  system-design分类排序结果:")
            for t in topics_with_order:
                print(f"    {t['title']}: order={t['order']}")
            break
    
    # 写回文件
    with open("domains/architecture.json", 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def fix_duplicate_order():
    """修复重复order问题"""
    # 读取高可用架构topic
    with open("topics/java/topic-074-160f484e.json", 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 修改order值，避免与"读写分离与数据一致性"重复
    old_order = data.get('order')
    new_order = 55  # 设置为55，避免重复
    data['order'] = new_order
    
    print(f"  高可用架构: order {old_order} -> {new_order}")
    
    # 写回文件
    with open("topics/java/topic-074-160f484e.json", 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def main():
    """主函数"""
    print("开始修复顺序警告...")
    
    # 修复microservice分类顺序
    print("\n修复 microservice 分类顺序:")
    fix_microservice_order()
    
    # 修复middleware分类顺序
    print("\n修复 middleware 分类顺序:")
    fix_middleware_order()
    
    # 修复architecture/system-design分类顺序
    print("\n修复 architecture/system-design 分类顺序:")
    fix_architecture_order()
    
    # 修复重复order问题
    print("\n修复重复order问题:")
    fix_duplicate_order()
    
    print("\n完成！")

if __name__ == '__main__':
    main()