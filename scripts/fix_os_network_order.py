#!/usr/bin/env python3
"""
调整OS和Network领域topic顺序
"""
import json
import os

# OS进程线程分类的新顺序
OS_PROCESS_THREAD_ORDER = {
    "topics/os/topic-process-vs-thread.json": 10,  # 进程与线程的区别
    "topics/os/topic-thread-sync.json": 20,  # 线程同步机制
    "topics/os/topic-deadlock.json": 30,  # 死锁的产生与避免
    "topics/os/topic-ipc.json": 40,  # 进程间通信方式
    "topics/os/topic-coroutine.json": 50,  # 协程与纤程
}

# OS IO模型分类的新顺序
OS_IO_MODEL_ORDER = {
    "topics/os/topic-io-models.json": 10,  # 阻塞/非阻塞/同步/异步
    "topics/os/topic-select-poll-epoll.json": 20,  # select/poll/epoll
    "topics/os/topic-reactor.json": 30,  # Reactor模式
}

# Network TCP/UDP分类的新顺序
NETWORK_TCP_UDP_ORDER = {
    "topics/network/topic-tcp-vs-udp.json": 10,  # TCP与UDP的区别
    "topics/network/topic-tcp-handshake.json": 20,  # TCP三次握手与四次挥手
    "topics/network/topic-tcp-reliable.json": 30,  # TCP可靠传输机制
    "topics/network/topic-tcp-flow-congestion.json": 40,  # TCP流量控制与拥塞控制
    "topics/network/topic-tcp-sticky-packet.json": 50,  # TCP粘包与拆包
}

# Network HTTP/HTTPS分类的新顺序
NETWORK_HTTP_HTTPS_ORDER = {
    "topics/network/topic-http-evolution.json": 10,  # HTTP版本演进
    "topics/network/topic-http-status-headers.json": 20,  # HTTP状态码与头部字段
    "topics/network/topic-https.json": 30,  # HTTPS加密原理
    "topics/network/topic-cors.json": 40,  # 跨域与CORS
}

# Network DNS/CDN分类的新顺序
NETWORK_DNS_CDN_ORDER = {
    "topics/network/topic-dns.json": 10,  # DNS解析流程
    "topics/network/topic-cdn.json": 20,  # CDN原理与应用
}

# Network WebSocket分类的新顺序
NETWORK_WEBSOCKET_ORDER = {
    "topics/network/topic-websocket.json": 10,  # WebSocket协议原理
    "topics/network/topic-websocket-vs-polling.json": 20,  # WebSocket与长轮询对比
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

def update_os_domain_json():
    """更新domains/os.json中的topics列表顺序"""
    domain_file = "domains/os.json"
    with open(domain_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    for category in data['categories']:
        if category['id'] == 'process-thread':
            category['topics'] = [
                "topics/os/topic-process-vs-thread.json",
                "topics/os/topic-thread-sync.json",
                "topics/os/topic-deadlock.json",
                "topics/os/topic-ipc.json",
                "topics/os/topic-coroutine.json"
            ]
            print(f"  更新 process-thread 分类顺序")
        
        elif category['id'] == 'io-model':
            category['topics'] = [
                "topics/os/topic-io-models.json",
                "topics/os/topic-select-poll-epoll.json",
                "topics/os/topic-reactor.json"
            ]
            print(f"  更新 io-model 分类顺序")
    
    with open(domain_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def update_network_domain_json():
    """更新domains/network.json中的topics列表顺序"""
    domain_file = "domains/network.json"
    with open(domain_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    for category in data['categories']:
        if category['id'] == 'tcp-udp':
            category['topics'] = [
                "topics/network/topic-tcp-vs-udp.json",
                "topics/network/topic-tcp-handshake.json",
                "topics/network/topic-tcp-reliable.json",
                "topics/network/topic-tcp-flow-congestion.json",
                "topics/network/topic-tcp-sticky-packet.json"
            ]
            print(f"  更新 tcp-udp 分类顺序")
        
        elif category['id'] == 'http-https':
            category['topics'] = [
                "topics/network/topic-http-evolution.json",
                "topics/network/topic-http-status-headers.json",
                "topics/network/topic-https.json",
                "topics/network/topic-cors.json"
            ]
            print(f"  更新 http-https 分类顺序")
        
        elif category['id'] == 'dns-cdn':
            category['topics'] = [
                "topics/network/topic-dns.json",
                "topics/network/topic-cdn.json"
            ]
            print(f"  更新 dns-cdn 分类顺序")
        
        elif category['id'] == 'websocket':
            category['topics'] = [
                "topics/network/topic-websocket.json",
                "topics/network/topic-websocket-vs-polling.json"
            ]
            print(f"  更新 websocket 分类顺序")
    
    with open(domain_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def main():
    """主函数"""
    print("开始调整OS和Network领域topic顺序...")
    
    # 更新OS进程线程分类的topic order
    print("\n更新 OS process-thread 分类:")
    for filepath, new_order in OS_PROCESS_THREAD_ORDER.items():
        update_topic_order(filepath, new_order)
    
    # 更新OS IO模型分类的topic order
    print("\n更新 OS io-model 分类:")
    for filepath, new_order in OS_IO_MODEL_ORDER.items():
        update_topic_order(filepath, new_order)
    
    # 更新Network TCP/UDP分类的topic order
    print("\n更新 Network tcp-udp 分类:")
    for filepath, new_order in NETWORK_TCP_UDP_ORDER.items():
        update_topic_order(filepath, new_order)
    
    # 更新Network HTTP/HTTPS分类的topic order
    print("\n更新 Network http-https 分类:")
    for filepath, new_order in NETWORK_HTTP_HTTPS_ORDER.items():
        update_topic_order(filepath, new_order)
    
    # 更新Network DNS/CDN分类的topic order
    print("\n更新 Network dns-cdn 分类:")
    for filepath, new_order in NETWORK_DNS_CDN_ORDER.items():
        update_topic_order(filepath, new_order)
    
    # 更新Network WebSocket分类的topic order
    print("\n更新 Network websocket 分类:")
    for filepath, new_order in NETWORK_WEBSOCKET_ORDER.items():
        update_topic_order(filepath, new_order)
    
    # 更新domains/os.json
    print("\n更新 domains/os.json:")
    update_os_domain_json()
    
    # 更新domains/network.json
    print("\n更新 domains/network.json:")
    update_network_domain_json()
    
    print("\n完成！")

if __name__ == '__main__':
    main()