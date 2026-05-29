#!/usr/bin/env python3
"""
整理Java Spring分类，将微服务治理和MQ内容移出
"""
import json
import os

# 需要移到微服务治理分类的topics
MICROSERVICE_TOPICS = [
    "topics/java/topic-059-a4e73804.json",  # Gateway
    "topics/java/topic-055-e51532ee.json",  # Nacos
    "topics/java/topic-058-72ff8a49.json",  # OpenFeign
    "topics/java/topic-061-7a8c02dc.json",  # Sentinel
    "topics/java/topic-062-ce26874b.json",  # Seata分布式事务
    "topics/java/topic-064-e7bf33af.json",  # 分布式事务补充方案
]

# 需要移到中间件分类的topics（MQ相关）
MQ_TOPICS = [
    "topics/java/topic-077-0f4a426f.json",  # RabbitMQ原理
    "topics/java/topic-080-3c934d6a.json",  # Kafka原理
    "topics/java/topic-081-89b01558.json",  # RocketMQ与选型
]

# 需要移到architecture领域的topics
ARCHITECTURE_TOPICS = [
    "topics/java/topic-074-160f484e.json",  # 高可用架构
]

# Spring核心topics（保留在spring分类）
SPRING_CORE_TOPICS = [
    "topics/java/topic-043-d09a2ea2.json",  # IoC容器
    "topics/java/topic-046-75c87cc7.json",  # Bean生命周期
    "topics/java/topic-049-4a9fa727.json",  # SpringMVC原理
    "topics/java/topic-047-7bfc4e55.json",  # 循环依赖
    "topics/java/topic-044-d91e99aa.json",  # AOP原理
    "topics/java/topic-041-d2d1cd02.json",  # 自动装配原理
    "topics/java/topic-083-b2c3d4e5.json",  # SpringBoot启动流程
    "topics/java/topic-050-1ab02fab.json",  # SpringBoot配置体系
    "topics/java/topic-053-33741484.json",  # MyBatis-Plus
    "topics/java/topic-052-976f7efa.json",  # MyBatis核心原理
    "topics/java/topic-1da2b5c3.json",      # Spring AOP 深入
]

def update_topic_category(filepath, new_category):
    """更新topic文件的category字段"""
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    old_category = data.get('category')
    if old_category != new_category:
        data['category'] = new_category
        # 同时更新id中的category部分
        old_id = data.get('id', '')
        if old_id.startswith(f'java.{old_category}.'):
            new_id = old_id.replace(f'java.{old_category}.', f'java.{new_category}.')
            data['id'] = new_id
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"  {filepath}: category {old_category} -> {new_category}")
        return True
    else:
        print(f"  {filepath}: category {old_category} 未变化")
        return False

def update_java_domain_json():
    """更新domains/java.json"""
    domain_file = "domains/java.json"
    with open(domain_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 创建新的微服务治理分类
    microservice_category = {
        "id": "microservice",
        "title": "微服务治理",
        "description": "服务注册发现、网关、熔断限流、分布式事务",
        "order": 45,
        "topics": MICROSERVICE_TOPICS,
        "prerequisites": ["spring"]
    }
    
    # 检查是否已存在微服务治理分类
    existing_ids = [c['id'] for c in data['categories']]
    if 'microservice' not in existing_ids:
        # 在spring和database之间插入
        spring_index = next(i for i, c in enumerate(data['categories']) if c['id'] == 'spring')
        data['categories'].insert(spring_index + 1, microservice_category)
        print("  添加微服务治理分类")
    
    # 更新spring分类的topics列表
    for category in data['categories']:
        if category['id'] == 'spring':
            category['topics'] = SPRING_CORE_TOPICS
            category['description'] = "Spring、Spring Boot、Spring MVC、MyBatis 核心机制"
            print("  更新spring分类topics列表")
        
        elif category['id'] == 'middleware':
            # 将MQ topics添加到中间件分类
            existing_topics = set(category['topics'])
            for topic in MQ_TOPICS:
                if topic not in existing_topics:
                    category['topics'].append(topic)
            print("  更新middleware分类topics列表")
        
        elif category['id'] == 'microservice':
            # 更新微服务治理分类的topics列表
            category['topics'] = MICROSERVICE_TOPICS
            print("  更新microservice分类topics列表")
    
    # 更新learningPaths
    for path in data.get('learningPaths', []):
        for step in path.get('steps', []):
            if step.get('title') == 'Spring 生态':
                step['description'] = "IoC、AOP、Boot、MVC、MyBatis"
            elif step.get('title') == '中间件':
                step['description'] = "Redis、RabbitMQ、Kafka、分布式锁"
    
    with open(domain_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def update_architecture_domain():
    """更新architecture领域，添加高可用架构topic"""
    # 首先检查architecture领域是否存在
    manifest_file = "manifest.json"
    with open(manifest_file, 'r', encoding='utf-8') as f:
        manifest = json.load(f)
    
    # 查找architecture领域的入口文件
    arch_entry = None
    for domain in manifest.get('domains', []):
        if domain.get('id') == 'architecture':
            arch_entry = domain.get('entry')
            break
    
    if not arch_entry:
        print("  architecture领域不存在，跳过")
        return
    
    # 读取architecture领域文件
    with open(arch_entry, 'r', encoding='utf-8') as f:
        arch_data = json.load(f)
    
    # 查找system-design分类
    for category in arch_data.get('categories', []):
        if category.get('id') == 'system-design':
            # 检查是否已包含高可用架构topic
            if "topics/java/topic-074-160f484e.json" not in category.get('topics', []):
                category['topics'].append("topics/java/topic-074-160f484e.json")
                print("  将高可用架构添加到architecture领域system-design分类")
            break
    
    with open(arch_entry, 'w', encoding='utf-8') as f:
        json.dump(arch_data, f, ensure_ascii=False, indent=2)

def main():
    """主函数"""
    print("开始整理Java Spring分类...")
    
    # 更新微服务治理topics的category
    print("\n更新微服务治理topics的category:")
    for filepath in MICROSERVICE_TOPICS:
        update_topic_category(filepath, 'microservice')
    
    # 更新MQ topics的category
    print("\n更新MQ topics的category:")
    for filepath in MQ_TOPICS:
        update_topic_category(filepath, 'middleware')
    
    # 更新高可用架构topic的category
    print("\n更新高可用架构topic的category:")
    for filepath in ARCHITECTURE_TOPICS:
        update_topic_category(filepath, 'system-design')
    
    # 更新domains/java.json
    print("\n更新 domains/java.json:")
    update_java_domain_json()
    
    # 更新architecture领域
    print("\n更新 architecture 领域:")
    update_architecture_domain()
    
    print("\n完成！")

if __name__ == '__main__':
    main()