#!/usr/bin/env python3
"""
整改过泛标题
"""
import json
import os

def fix_concurrent_tools():
    """修改其他锁与并发工具topic"""
    filepath = "topics/java/topic-019-a5a85fab.json"
    
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 读取当前内容，了解具体包含哪些并发工具
    content = ""
    for card in data.get('learningCards', []):
        if card.get('type') == 'explain':
            content += card.get('content', '')
    
    # 根据内容判断具体工具
    if 'CountDownLatch' in content and 'CyclicBarrier' in content and 'Semaphore' in content:
        new_title = "CountDownLatch、CyclicBarrier与Semaphore"
        new_summary = "三个并发工具类的原理、区别和使用场景：CountDownLatch倒计数、CyclicBarrier循环屏障、Semaphore信号量"
    elif 'ReadWriteLock' in content:
        new_title = "ReadWriteLock读写锁"
        new_summary = "ReadWriteLock的原理、锁降级、StampedLock对比"
    else:
        # 如果内容不明确，保持原样
        print(f"  {filepath}: 内容不明确，跳过")
        return
    
    # 修改标题
    old_title = data['title']
    data['title'] = new_title
    
    # 修改summary
    data['summary'] = new_summary
    
    # 写回文件
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"已修改 {filepath}")
    print(f"  标题: {old_title} -> {new_title}")

def fix_react_features():
    """修改React 18+新特性topic"""
    filepath = "topics/frontend/topic-react18-features.json"
    
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 修改标题
    old_title = data['title']
    data['title'] = 'React并发渲染与自动批处理'
    
    # 修改summary
    data['summary'] = 'React 18并发特性：Concurrent Mode、useTransition、useDeferredValue、自动批处理'
    
    # 写回文件
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"已修改 {filepath}")
    print(f"  标题: {old_title} -> React并发渲染与自动批处理")

def fix_perf_optimization():
    """修改前端性能优化全景topic"""
    filepath = "topics/frontend/topic-perf-optimization.json"
    
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 修改标题
    old_title = data['title']
    data['title'] = '前端加载性能优化'
    
    # 修改summary
    data['summary'] = '前端加载性能优化策略：资源压缩、懒加载、预加载、CDN、Core Web Vitals指标'
    
    # 写回文件
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"已修改 {filepath}")
    print(f"  标题: {old_title} -> 前端加载性能优化")

def fix_service_governance():
    """修改服务治理全景topic"""
    filepath = "topics/architecture/architecture.microservice.topic-service-governance.json"
    
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 修改标题
    old_title = data['title']
    data['title'] = '服务治理核心链路'
    
    # 修改summary
    data['summary'] = '微服务治理核心链路：注册发现、配置中心、负载均衡、熔断限流、可观测性的协作关系'
    
    # 写回文件
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"已修改 {filepath}")
    print(f"  标题: {old_title} -> 服务治理核心链路")

def main():
    """主函数"""
    print("开始整改过泛标题...")
    
    # 修改其他锁与并发工具
    print("\n修改 其他锁与并发工具:")
    fix_concurrent_tools()
    
    # 修改React 18+新特性
    print("\n修改 React 18+新特性:")
    fix_react_features()
    
    # 修改前端性能优化全景
    print("\n修改 前端性能优化全景:")
    fix_perf_optimization()
    
    # 修改服务治理全景
    print("\n修改 服务治理全景:")
    fix_service_governance()
    
    print("\n完成！")

if __name__ == '__main__':
    main()