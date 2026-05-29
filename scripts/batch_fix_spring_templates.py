#!/usr/bin/env python3
"""
批量修复Spring模板化内容
"""
import json
import os
import re
from pathlib import Path

# 需要修复的文件列表
FILES_TO_FIX = [
    "topics/java/topic-043-d09a2ea2.json",  # IoC容器
    "topics/java/topic-046-75c87cc7.json",  # Bean生命周期
    "topics/java/topic-049-4a9fa727.json",  # SpringMVC原理
    "topics/java/topic-047-7bfc4e55.json",  # 循环依赖
    "topics/java/topic-074-160f484e.json",  # 高可用架构
    "topics/java/topic-044-d91e99aa.json",  # AOP原理
    "topics/java/topic-041-d2d1cd02.json",  # 自动装配原理
    "topics/java/topic-083-b2c3d4e5.json",  # SpringBoot启动流程
    "topics/java/topic-050-1ab02fab.json",  # SpringBoot配置体系
    "topics/java/topic-059-a4e73804.json",  # Gateway
    "topics/java/topic-053-33741484.json",  # MyBatis-Plus
    "topics/java/topic-052-976f7efa.json",  # MyBatis核心原理
    "topics/java/topic-062-ce26874b.json",  # Seata分布式事务
    "topics/java/topic-064-e7bf33af.json",  # 分布式事务补充方案
    "topics/java/topic-080-3c934d6a.json",  # Kafka原理
    "topics/java/topic-055-e51532ee.json",  # Nacos
    "topics/java/topic-058-72ff8a49.json",  # OpenFeign
    "topics/java/topic-077-0f4a426f.json",  # RabbitMQ原理
    "topics/java/topic-081-89b01558.json",  # RocketMQ与选型
    "topics/java/topic-061-7a8c02dc.json",  # Sentinel
    "topics/java/topic-065-e2570d70.json",  # 索引原理
    "topics/java/topic-071-7bc711e7.json",  # Redis数据结构
    "topics/java/topic-075-fa1c9279.json",  # 缓存问题
    "topics/java/topic-1da2b5c3.json",      # Spring AOP 深入
]

# 为每个主题生成专属内容
TOPIC_CONTENT_MAP = {
    "IoC容器": {
        "followUpQuestions": [
            {
                "question": "IoC容器的Bean创建流程是怎样的？关键扩展点有哪些？",
                "answer": "Bean创建流程：实例化→属性注入→初始化→销毁。关键扩展点：BeanPostProcessor（前后置处理）、InstantiationAwareBeanPostProcessor（实例化前后）、BeanFactoryPostProcessor（修改BeanDefinition）。AOP代理就在BeanPostProcessor中创建。"
            },
            {
                "question": "@Autowired的注入机制是怎样的？如何解决同类型多Bean冲突？",
                "answer": "@Autowired由AutowiredAnnotationBeanPostProcessor处理，先按类型匹配，再按@Qualifier名称匹配。解决冲突方式：1. @Qualifier指定Bean名；2. @Primary标记首选Bean；3. @Order控制优先级；4. 集合注入收集所有同类型Bean。"
            },
            {
                "question": "Bean的作用域有哪些？prototype Bean注入singleton Bean会有什么问题？",
                "answer": "Bean作用域：singleton（默认）、prototype、request、session、application。prototype注入singleton会产生问题：prototype每次获取都是新实例，但singleton中只注入一次。解决方案：1. @Lookup方法注入；2. ObjectFactory/Provider延迟获取；3. 改用request/session作用域。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述IoC容器的Bean创建流程和关键扩展点",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "@Autowired的注入机制是怎样的？如何解决同类型多Bean冲突？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "Bean生命周期": {
        "followUpQuestions": [
            {
                "question": "Bean的完整生命周期是怎样的？有哪些扩展点？",
                "answer": "Bean生命周期：实例化→属性注入→Aware接口回调→BeanPostProcessor前置→InitializingBean.afterPropertiesSet→自定义init→BeanPostProcessor后置→使用→DisposableBean.destroy→自定义destroy。扩展点：BeanPostProcessor、InstantiationAwareBeanPostProcessor、InitializingBean、DisposableBean。"
            },
            {
                "question": "BeanPostProcessor和BeanFactoryPostProcessor有什么区别？",
                "answer": "BeanPostProcessor：作用于Bean实例，修改Bean实例或返回代理对象（如AOP）。BeanFactoryPostProcessor：作用于BeanDefinition，修改Bean元数据（如属性占位符替换）。执行时机：BeanFactoryPostProcessor在Bean实例化前，BeanPostProcessor在Bean实例化后。"
            },
            {
                "question": "如何自定义一个BeanPostProcessor？应用场景有哪些？",
                "answer": "实现BeanPostProcessor接口，重写postProcessBeforeInitialization和postProcessAfterInitialization方法。应用场景：AOP代理创建、属性注入处理（@Autowired）、自定义注解处理、Bean验证、监控埋点。需要注册到容器中（@Component或@Bean）。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述Bean的完整生命周期和关键扩展点",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "BeanPostProcessor和BeanFactoryPostProcessor有什么区别？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "SpringMVC原理": {
        "followUpQuestions": [
            {
                "question": "SpringMVC的请求处理流程是怎样的？",
                "answer": "请求流程：DispatcherServlet→HandlerMapping查找Handler→HandlerAdapter执行Handler→ViewResolver解析视图→渲染视图→响应。核心组件：DispatcherServlet（前端控制器）、HandlerMapping（处理器映射）、HandlerAdapter（处理器适配器）、ViewResolver（视图解析器）。"
            },
            {
                "question": "@RequestMapping的匹配规则是怎样的？",
                "answer": "匹配规则：1. URL路径匹配（精确>通配>占位符）；2. HTTP方法匹配（GET/POST等）；3. 参数匹配（params、headers）；4. 消费者匹配（consumes）；5. 生产者匹配（produces）。优先级：精确路径>通配符>占位符>默认处理器。"
            },
            {
                "question": "SpringMVC的拦截器和过滤器有什么区别？",
                "answer": "拦截器(Interceptor)：基于Spring MVC，作用于Handler执行前后，可访问Spring容器。过滤器(Filter)：基于Servlet规范，作用于请求进入Servlet前后，可修改请求/响应。执行顺序：Filter→Interceptor.preHandle→Handler→Interceptor.postHandle→Interceptor.afterCompletion→Filter。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述SpringMVC的请求处理流程和核心组件",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "SpringMVC的拦截器和过滤器有什么区别？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "循环依赖": {
        "followUpQuestions": [
            {
                "question": "Spring如何解决循环依赖？三级缓存机制是怎样的？",
                "answer": "三级缓存：1. singletonObjects（完整Bean）；2. earlySingletonObjects（早期暴露的Bean）；3. singletonFactories（Bean工厂）。解决流程：A创建时发现依赖B→B创建时发现依赖A→从三级缓存获取A的早期引用→B完成创建→A完成创建。只能解决setter注入的循环依赖，构造器注入无法解决。"
            },
            {
                "question": "为什么构造器注入无法解决循环依赖？",
                "answer": "构造器注入需要在实例化时就完成依赖注入，而此时Bean还未创建完成，无法暴露早期引用。setter注入允许先实例化再注入属性，可以暴露早期引用。解决方案：1. 改用setter注入；2. 使用@Lazy延迟加载；3. 重新设计避免循环依赖。"
            },
            {
                "question": "如何检测和避免循环依赖？",
                "answer": "检测方式：1. Spring Boot启动时设置spring.main.allow-circular-references=false；2. 使用IDE依赖分析工具；3. 单元测试中检测。避免方式：1. 重新设计模块边界；2. 使用事件驱动解耦；3. 引入中间层；4. 使用@Lazy延迟加载。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述Spring的三级缓存机制和循环依赖解决流程",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "为什么构造器注入无法解决循环依赖？如何避免？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "AOP原理": {
        "followUpQuestions": [
            {
                "question": "Spring AOP的实现原理是怎样的？JDK动态代理和CGLIB有什么区别？",
                "answer": "Spring AOP基于代理模式：1. JDK动态代理（基于接口）：通过Proxy.newProxyInstance创建代理对象；2. CGLIB（基于继承）：通过字节码生成子类。选择规则：有接口用JDK代理，无接口用CGLIB。Spring Boot 2.x默认使用CGLIB。"
            },
            {
                "question": "AOP的切面执行顺序是怎样的？如何控制多个切面的顺序？",
                "answer": "切面执行顺序：@Around前置→@Before→方法执行→@AfterReturning/@AfterThrowing→@After→@Around后置。控制顺序：1. @Order注解指定优先级；2. 实现Ordered接口；3. 配置文件指定。数值越小优先级越高，@Before先进入后出来，@After后进入先出来。"
            },
            {
                "question": "AOP失效的场景有哪些？如何解决？",
                "answer": "AOP失效场景：1. 自调用（this.method()）；2. private方法；3. final方法；4. static方法；5. 非Spring管理对象。解决方案：1. 注入自身代理；2. AopContext.currentProxy()；3. 使用AspectJ编译时织入；4. 重新设计避免自调用。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述Spring AOP的实现原理和代理模式选择",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "AOP失效的场景有哪些？如何解决？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "自动装配原理": {
        "followUpQuestions": [
            {
                "question": "Spring Boot自动装配的原理是怎样的？",
                "answer": "自动装配流程：1. @EnableAutoConfiguration导入AutoConfigurationImportSelector；2. 读取META-INF/spring.factories中的自动配置类；3. 通过@Conditional系列注解过滤；4. 注册符合条件的Bean。核心注解：@ConditionalOnClass、@ConditionalOnMissingBean、@ConditionalOnProperty。"
            },
            {
                "question": "如何自定义一个Starter？",
                "answer": "自定义Starter步骤：1. 创建autoconfigure模块，编写配置类和@Conditional条件；2. 创建starter模块，依赖autoconfigure；3. 在META-INF/spring.factories中注册配置类；4. 提供配置元数据（spring-configuration-metadata.json）。命名规范：第三方xxx-spring-boot-starter，官方spring-boot-starter-xxx。"
            },
            {
                "question": "@Conditional系列注解有哪些？工作原理是怎样的？",
                "answer": "常用@Conditional：OnClass（类路径存在）、OnMissingBean（Bean不存在）、OnProperty（配置属性）、OnWebApplication（Web环境）、OnExpression（SpEL表达式）。工作原理：实现Condition接口，重写matches方法，Spring容器在解析BeanDefinition时调用条件判断。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述Spring Boot自动装配的原理和核心注解",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "如何自定义一个Starter？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "SpringBoot启动流程": {
        "followUpQuestions": [
            {
                "question": "SpringBoot的启动流程是怎样的？",
                "answer": "启动流程：1. new SpringApplication→推断应用类型、加载Initializers、Listeners；2. run()→创建Environment、准备Context、刷新Context（refresh()）、自动装配、启动内嵌容器。核心方法：refresh()中执行BeanFactoryPostProcessor、BeanPostProcessor、自动装配。"
            },
            {
                "question": "SpringBoot如何内嵌Tomcat？",
                "answer": "内嵌Tomcat原理：1. spring-boot-starter-web依赖tomcat-embed；2. ServletWebServerFactory自动配置TomcatServletWebServerFactory；3. refresh()中创建WebServer；4. 通过Tomcat.addContext添加应用上下文。自动配置类：ServletWebServerFactoryAutoConfiguration。"
            },
            {
                "question": "SpringBoot的配置加载顺序是怎样的？",
                "answer": "配置加载顺序（优先级从高到低）：1. 命令行参数；2. JNDI属性；3. Java系统属性；4. OS环境变量；5. application-{profile}.yml；6. application.yml；7. @PropertySource；8. 默认属性。同位置properties优先于yml。配置属性可通过@Value、@ConfigurationProperties绑定。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述SpringBoot的启动流程和核心方法",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "SpringBoot如何内嵌Tomcat？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "SpringBoot配置体系": {
        "followUpQuestions": [
            {
                "question": "SpringBoot的配置体系是怎样的？@ConfigurationProperties的工作原理？",
                "answer": "配置体系：1. 配置文件（yml/properties）；2. @ConfigurationProperties绑定；3. @Value注入单个属性；4. Environment抽象。@ConfigurationProperties原理：通过ConfigurationPropertiesBindingPostProcessor处理，支持松散绑定、JSR303校验、复杂类型转换。"
            },
            {
                "question": "多环境配置如何管理？Profile的激活方式有哪些？",
                "answer": "多环境配置：1. application-{profile}.yml文件；2. @Profile注解条件装配。激活方式：1. spring.profiles.active配置；2. 命令行--spring.profiles.active=dev；3. 环境变量SPRING_PROFILES_ACTIVE；4. JVM参数-Dspring.profiles.active=dev。@Profile可用于类、方法级别。"
            },
            {
                "question": "如何自定义类型转换器？",
                "answer": "自定义类型转换器：1. 实现Converter<S,T>接口；2. 注册到ConversionService；3. 配置为Bean或通过WebMvcConfigurer添加。应用场景：日期格式转换、枚举转换、自定义对象转换。Spring Boot自动配置了常用转换器，可通过ConverterRegistrationBean扩展。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述SpringBoot的配置体系和@ConfigurationProperties的工作原理",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "多环境配置如何管理？Profile的激活方式有哪些？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "Gateway": {
        "followUpQuestions": [
            {
                "question": "Spring Cloud Gateway的核心概念和工作原理？",
                "answer": "核心概念：Route（路由）、Predicate（断言）、Filter（过滤器）。工作原理：请求→Route Predicate匹配→Filter链处理→转发到服务。基于WebFlux实现，支持异步非阻塞。配置方式：yml配置或RouteLocatorBuilder编程式配置。"
            },
            {
                "question": "Gateway的过滤器有哪些类型？执行顺序？",
                "answer": "过滤器类型：1. GlobalFilter（全局过滤器）；2. GatewayFilter（路由过滤器）。执行顺序：通过@Order或Ordered接口控制。常用过滤器：AddRequestHeader、AddResponseHeader、Retry、CircuitBreaker、RateLimiter。自定义过滤器实现GatewayFilterFactory。"
            },
            {
                "question": "Gateway如何实现限流和熔断？",
                "answer": "限流：1. RequestRateLimiterGatewayFilterFactory（基于Redis+Lua）；2. 自定义限流器。熔断：1. 集成Resilience4j；2. 配置CircuitBreaker过滤器；3. 设置失败阈值、半开状态、恢复时间。可结合Sentinel实现更细粒度的流控。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述Spring Cloud Gateway的核心概念和工作原理",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "Gateway如何实现限流和熔断？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "MyBatis核心原理": {
        "followUpQuestions": [
            {
                "question": "MyBatis的核心架构和工作原理？",
                "answer": "核心架构：SqlSession→Executor→StatementHandler→ParameterHandler→ResultSetHandler。工作原理：1. 解析XML/注解生成MappedStatement；2. SqlSession调用Executor；3. Executor执行SQL；4. 结果映射。一级缓存（SqlSession级别）、二级缓存（Mapper级别）。"
            },
            {
                "question": "MyBatis的动态SQL有哪些标签？",
                "answer": "动态SQL标签：1. if（条件判断）；2. choose/when/otherwise（多条件分支）；3. trim/where/set（SQL片段处理）；4. foreach（遍历集合）；5. sql/include（SQL片段复用）。原理：通过OGNL表达式判断，动态拼接SQL。"
            },
            {
                "question": "MyBatis与JPA有什么区别？如何选择？",
                "answer": "MyBatis：SQL灵活、学习成本低、适合复杂查询。JPA：面向对象、自动生成SQL、适合CRUD。选择建议：1. 复杂SQL、性能要求高→MyBatis；2. 快速开发、简单CRUD→JPA；3. 混合使用：JPA处理简单查询，MyBatis处理复杂查询。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述MyBatis的核心架构和工作原理",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "MyBatis与JPA有什么区别？如何选择？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "MyBatis-Plus": {
        "followUpQuestions": [
            {
                "question": "MyBatis-Plus的核心特性和工作原理？",
                "answer": "核心特性：1. 通用CRUD（BaseMapper）；2. 条件构造器（QueryWrapper）；3. 分页插件；4. 代码生成器；5. 逻辑删除；6. 自动填充。工作原理：继承MyBatis，通过反射解析实体类，自动生成SQL。"
            },
            {
                "question": "MyBatis-Plus的条件构造器有哪些？",
                "answer": "条件构造器：1. QueryWrapper（查询条件）；2. UpdateWrapper（更新条件）；3. LambdaQueryWrapper（Lambda语法）；4. LambdaUpdateWrapper。常用方法：eq、ne、like、in、between、orderBy、groupBy。支持链式调用，支持嵌套条件。"
            },
            {
                "question": "MyBatis-Plus的分页原理？",
                "answer": "分页原理：1. 配置PaginationInnerInterceptor；2. 调用selectPage方法；3. 拦截器自动改写SQL（添加LIMIT）；4. 执行count查询获取总数。支持多种数据库（MySQL、Oracle、PostgreSQL）。自定义分页：实现ISqlParser或DialectHandler。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述MyBatis-Plus的核心特性和工作原理",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "MyBatis-Plus的分页原理？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "Nacos": {
        "followUpQuestions": [
            {
                "question": "Nacos的核心功能和架构？",
                "answer": "核心功能：1. 服务注册与发现；2. 配置管理；3. 服务健康检查。架构：Nacos Server（集群）+ Nacos Client（SDK）。服务发现：临时实例（AP模式，Distro协议）+ 持久实例（CP模式，Raft协议）。配置管理：长轮询+推拉结合。"
            },
            {
                "question": "Nacos的配置管理原理？如何实现动态刷新？",
                "answer": "配置管理原理：1. 配置存储在Nacos Server；2. Client长轮询监听配置变更；3. 变更时推送通知；4. Client拉取最新配置。动态刷新：@RefreshScope注解+@Value自动更新。配置优先级：Nacos>本地配置>默认值。"
            },
            {
                "question": "Nacos与Eureka有什么区别？",
                "answer": "Nacos：支持AP/CP模式切换、配置管理、健康检查、多种协议。Eureka：仅AP模式、无配置管理、客户端健康检查。选择建议：需要配置管理→Nacos；纯服务发现→Eureka；需要强一致性→Nacos CP模式。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述Nacos的核心功能和架构",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "Nacos与Eureka有什么区别？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "OpenFeign": {
        "followUpQuestions": [
            {
                "question": "OpenFeign的工作原理？如何实现声明式调用？",
                "answer": "工作原理：1. @FeignClient定义接口；2. 启动时扫描生成动态代理；3. 调用时解析注解生成Request；4. 通过LoadBalancer选择服务实例；5. 发送HTTP请求。核心组件：Contract（注解解析）、Encoder/Decoder（编解码）、Client（HTTP客户端）。"
            },
            {
                "question": "OpenFeign如何集成负载均衡和熔断？",
                "answer": "负载均衡：默认集成Ribbon或LoadBalancer，通过@FeignClient的contextId区分。熔断：1. 集成Hystrix（已废弃）；2. 集成Sentinel；3. 集成Resilience4j。配置：spring.cloud.openfeign.circuitbreaker.enabled=true。FallbackFactory支持异常获取。"
            },
            {
                "question": "OpenFeign的性能优化？",
                "answer": "性能优化：1. 连接池（Apache HttpClient、OkHttp）；2. GZIP压缩；3. 超时配置；4. 日志级别调整；5. 请求/响应缓存。配置示例：feign.httpclient.enabled=true、feign.compression.request.enabled=true。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述OpenFeign的工作原理和核心组件",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "OpenFeign如何集成负载均衡和熔断？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "Sentinel": {
        "followUpQuestions": [
            {
                "question": "Sentinel的核心概念和工作原理？",
                "answer": "核心概念：资源（Resource）、规则（Rule）、入口（Entry）。工作原理：1. 定义资源（@SentinelResource）；2. 配置规则（流控、熔断、热点）；3. SphU.entry()检查；4. 通过→执行，拒绝→BlockException。滑动窗口统计QPS/线程数。"
            },
            {
                "question": "Sentinel的流控策略有哪些？",
                "answer": "流控策略：1. QPS限流；2. 线程数限流；3. 关联限流；4. 链路限流；5. 预热（Warm Up）；6. 排队等待。流控效果：快速失败、Warm Up、排队等待。支持集群限流（Token Server/Client模式）。"
            },
            {
                "question": "Sentinel的熔断降级策略？",
                "answer": "熔断策略：1. 慢调用比例；2. 异常比例；3. 异常数。熔断状态：Open（熔断）→Half-Open（探测）→Closed（恢复）。降级方式：1. Fallback方法；2. BlockException处理；3. 默认返回值。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述Sentinel的核心概念和工作原理",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "Sentinel的流控策略有哪些？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "Seata分布式事务": {
        "followUpQuestions": [
            {
                "question": "Seata的AT模式工作原理？",
                "answer": "AT模式原理：1. 一阶段：拦截SQL，记录before/after image到undo_log；本地事务提交。2. 二阶段提交：删除undo_log。3. 二阶段回滚：根据undo_log反向补偿。核心组件：TC（事务协调者）、TM（事务发起者）、RM（资源管理器）。"
            },
            {
                "question": "Seata的四种事务模式？如何选择？",
                "answer": "四种模式：1. AT（自动补偿，适合大多数场景）；2. TCC（手动补偿，适合高一致性）；3. Saga（长事务，适合业务流程长）；4. XA（强一致，性能差）。选择：大多数场景用AT；高一致性用TCC；长事务用Saga；数据库支持XA用XA。"
            },
            {
                "question": "Seata的全局锁机制？",
                "answer": "全局锁机制：1. 一阶段申请全局锁；2. 全局锁存储在TC；3. 二阶段提交释放锁；4. 二阶段回滚释放锁。锁冲突处理：默认等待重试，可配置超时时间。避免死锁：按固定顺序访问资源。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述Seata的AT模式工作原理",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "Seata的四种事务模式？如何选择？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "分布式事务补充方案": {
        "followUpQuestions": [
            {
                "question": "除了Seata，还有哪些分布式事务方案？",
                "answer": "其他方案：1. 2PC/3PC（强一致，性能差）；2. TCC（手动补偿，灵活）；3. Saga（长事务，最终一致）；4. 本地消息表（最终一致，可靠）；5. 事务消息（RocketMQ，最终一致）；6. 最大努力通知（弱一致）。选择依据：一致性要求、性能、业务复杂度。"
            },
            {
                "question": "本地消息表的实现原理？",
                "answer": "本地消息表原理：1. 业务操作和消息写入同一本地事务；2. 定时任务扫描消息表；3. 发送到MQ；4. 消费者处理并确认；5. 更新消息状态。优点：可靠、最终一致。缺点：实现复杂、定时任务延迟。"
            },
            {
                "question": "事务消息的原理？",
                "answer": "事务消息原理（RocketMQ）：1. 发送半消息；2. 执行本地事务；3. 根据结果提交/回滚半消息；4. 消费者处理消息。补偿机制：Broker定时回查本地事务状态。优点：解耦、可靠。缺点：实现复杂、依赖MQ。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述本地消息表的实现原理",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "事务消息的原理？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "RabbitMQ原理": {
        "followUpQuestions": [
            {
                "question": "RabbitMQ的核心概念和架构？",
                "answer": "核心概念：Producer、Exchange、Queue、Consumer、Binding、Routing Key。架构：Broker（服务器）→Virtual Host→Exchange→Queue。Exchange类型：Direct（精确匹配）、Topic（通配符）、Fanout（广播）、Headers（头部匹配）。"
            },
            {
                "question": "RabbitMQ的消息确认机制？",
                "answer": "消息确认：1. Publisher Confirm（生产端确认）；2. Consumer Ack（消费端确认）。Publisher Confirm：同步（waitForConfirms）/异步（setConfirmCallback）。Consumer Ack：auto（自动）、manual（手动）、none（不确认）。手动确认：basicAck、basicNack、basicReject。"
            },
            {
                "question": "RabbitMQ的死信队列和延迟队列？",
                "answer": "死信队列：消息变成死信后进入的队列。死信原因：1. 消息被拒绝（basicNack）且不重新入队；2. 消息TTL过期；3. 队列达到最大长度。延迟队列：1. TTL+死信队列；2. 延迟插件（rabbitmq_delayed_message_exchange）。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述RabbitMQ的核心概念和架构",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "RabbitMQ的死信队列和延迟队列？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "Kafka原理": {
        "followUpQuestions": [
            {
                "question": "Kafka的核心概念和架构？",
                "answer": "核心概念：Producer、Broker、Consumer、Topic、Partition、Consumer Group。架构：多Broker集群→ZooKeeper（元数据管理）。存储：顺序写磁盘、零拷贝、页缓存。高可用：副本机制（Leader/Follower）、ISR机制。"
            },
            {
                "question": "Kafka如何保证消息顺序？",
                "answer": "顺序保证：1. 单Partition内有序；2. 相关消息发送到同一Partition（Key路由）；3. Consumer单线程消费。全局有序：1. 单Partition（牺牲性能）；2. 业务层排序。Producer：设置max.in.flight.requests.per.connection=1。"
            },
            {
                "question": "Kafka的消费者组和再平衡？",
                "answer": "消费者组：同一Group内消息只被消费一次。再平衡触发：1. Consumer加入/退出；2. Topic分区数变化；3. 订阅Topic变化。再平衡策略：Range（范围）、RoundRobin（轮询）、Sticky（粘性）。避免再平衡：设置session.timeout.ms和heartbeat.interval.ms。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述Kafka的核心概念和架构",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "Kafka如何保证消息顺序？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "RocketMQ与选型": {
        "followUpQuestions": [
            {
                "question": "RocketMQ的核心特性和架构？",
                "answer": "核心特性：1. 事务消息；2. 延迟消息；3. 消息过滤；4. 消息回溯；5. 死信队列。架构：NameServer（路由注册）→Broker（消息存储）→Producer/Consumer。存储：CommitLog（顺序写）+ConsumeQueue（逻辑队列）+IndexFile（索引）。"
            },
            {
                "question": "MQ选型考虑哪些因素？",
                "answer": "选型因素：1. 吞吐量：Kafka>RocketMQ>RabbitMQ；2. 延迟：RabbitMQ最低；3. 可用性：都支持集群；4. 功能：RocketMQ事务消息、RabbitMQ灵活路由；5. 生态：Kafka大数据生态好；6. 运维：RabbitMQ最简单。建议：大数据→Kafka、金融→RocketMQ、简单场景→RabbitMQ。"
            },
            {
                "question": "RocketMQ的事务消息原理？",
                "answer": "事务消息原理：1. 发送半消息（Half Message）；2. 执行本地事务；3. 根据结果提交/回滚半消息；4. 消费者处理消息。补偿机制：Broker定时回查本地事务状态（默认15次）。应用场景：分布式事务、最终一致性。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述RocketMQ的核心特性和架构",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "MQ选型考虑哪些因素？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "索引原理": {
        "followUpQuestions": [
            {
                "question": "MySQL索引的底层数据结构？为什么用B+树？",
                "answer": "B+树特点：1. 非叶子节点只存索引；2. 叶子节点存数据+双向链表；3. 树高度低（3层可存2000万数据）。为什么不用B树：B树叶子节点存数据，树高度高。为什么不用Hash：不支持范围查询。为什么不用红黑树：树高度高，IO次数多。"
            },
            {
                "question": "聚簇索引和非聚簇索引的区别？",
                "answer": "聚簇索引：叶子节点存完整数据，一张表只有一个（主键索引）。非聚簇索引（二级索引）：叶子节点存主键值，需要回表查询。覆盖索引：查询字段都在索引中，无需回表。索引下推：在索引层过滤数据，减少回表。"
            },
            {
                "question": "索引失效的场景？",
                "answer": "索引失效场景：1. 违反最左前缀原则；2. 使用函数或表达式；3. 隐式类型转换；4. 使用!=或<>；5. LIKE以%开头；6. OR连接非索引列；7. IS NULL/IS NOT NULL（看数据分布）。优化：EXPLAIN分析、避免上述场景。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述MySQL索引的底层数据结构和B+树特点",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "索引失效的场景有哪些？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "Redis数据结构": {
        "followUpQuestions": [
            {
                "question": "Redis的核心数据结构和底层实现？",
                "answer": "核心数据结构：1. String（SDS）；2. List（quicklist/ziplist）；3. Hash（ziplist/hashtable）；4. Set（intset/hashtable）；5. ZSet（ziplist/skiplist）。底层编码：根据数据量自动转换编码类型，优化内存。"
            },
            {
                "question": "Redis的持久化机制？",
                "answer": "持久化机制：1. RDB（快照）：定时全量备份，fork子进程，COW机制；2. AOF（日志）：记录写命令，支持always/everysec/no；3. 混合持久化：RDB+AOF。选择：数据安全→AOF；性能→RDB；两者结合→混合持久化。"
            },
            {
                "question": "Redis的过期策略和内存淘汰？",
                "answer": "过期策略：1. 惰性删除（访问时检查）；2. 定期删除（随机抽样）。内存淘汰：1. noeviction（不淘汰）；2. allkeys-lru（LRU）；3. volatile-lru（过期key LRU）；4. allkeys-random（随机）；5. volatile-ttl（TTL最小）。建议：allkeys-lru。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述Redis的核心数据结构和底层实现",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "Redis的过期策略和内存淘汰？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "缓存问题": {
        "followUpQuestions": [
            {
                "question": "缓存穿透、击穿、雪崩的区别和解决方案？",
                "answer": "缓存穿透：查询不存在的数据。解决方案：布隆过滤器、缓存空值。缓存击穿：热点key过期。解决方案：互斥锁、永不过期+异步更新。缓存雪崩：大量key同时过期。解决方案：随机过期时间、多级缓存、熔断降级。"
            },
            {
                "question": "如何保证缓存与数据库的一致性？",
                "answer": "一致性方案：1. Cache Aside（旁路缓存）：先更新DB，再删除缓存；2. Read/Write Through：缓存层统一读写；3. Write Behind：异步写DB。推荐Cache Aside：先更新DB，再删除缓存。延迟双删：更新DB→删缓存→延迟→再删缓存。"
            },
            {
                "question": "Redis的分布式锁实现？",
                "answer": "分布式锁实现：1. SET key value NX PX timeout；2. 释放锁：Lua脚本保证原子性。问题：1. 锁超时（看门狗机制）；2. 主从一致性（RedLock）；3. 可重入（Hash结构）。Redisson：封装了分布式锁，支持可重入、公平锁、读写锁。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述缓存穿透、击穿、雪崩的区别和解决方案",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "如何保证缓存与数据库的一致性？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "Spring AOP 深入": {
        "followUpQuestions": [
            {
                "question": "Spring AOP的源码实现？",
                "answer": "源码实现：1. AnnotationAwareAspectJAutoProxyCreator（BeanPostProcessor）；2. postProcessAfterInstantiation中创建代理；3. 选择JDK代理或CGLIB；4. 代理对象包装目标对象；5. 调用时执行拦截链。核心类：ProxyFactory、AdvisedSupport、MethodInterceptor。"
            },
            {
                "question": "AOP的拦截链执行原理？",
                "answer": "拦截链执行：1. 责任链模式；2. MethodInterceptor.intercept()；3. 递归调用invoke()；4. 执行目标方法。拦截器链：@Around→@Before→目标方法→@AfterReturning/@AfterThrowing→@After→@Around后置。通过ReflectiveMethodInvocation实现。"
            },
            {
                "question": "如何自定义AOP注解？",
                "answer": "自定义AOP注解：1. 定义注解（@Target、@Retention）；2. 定义切面（@Aspect）；3. 定义切入点（@Pointcut）；4. 定义通知（@Before/@After/@Around）。应用场景：日志记录、权限校验、性能监控、事务管理。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述Spring AOP的源码实现",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "如何自定义AOP注解？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
    "高可用架构": {
        "followUpQuestions": [
            {
                "question": "高可用架构的核心原则？",
                "answer": "核心原则：1. 冗余（多副本）；2. 故障检测（心跳、超时）；3. 故障转移（主从切换）；4. 限流降级（保护系统）；5. 监控告警（快速发现）。实现方式：集群、负载均衡、熔断、降级、限流、异步、缓存。"
            },
            {
                "question": "如何设计高可用系统？",
                "answer": "设计要点：1. 无状态设计（便于扩展）；2. 服务拆分（微服务）；3. 数据冗余（主从、分片）；4. 故障隔离（舱壁模式）；5. 异步解耦（消息队列）；6. 缓存策略（多级缓存）；7. 监控告警（全链路追踪）。"
            },
            {
                "question": "限流算法有哪些？",
                "answer": "限流算法：1. 计数器（固定窗口）；2. 滑动窗口；3. 漏桶（恒定速率）；4. 令牌桶（允许突发）。实现：Guava RateLimiter（令牌桶）、Sentinel（滑动窗口）、Nginx（漏桶）。选择：突发流量→令牌桶；恒定速率→漏桶。"
            }
        ],
        "recallPrompts": [
            {
                "prompt": "请描述高可用架构的核心原则",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            },
            {
                "prompt": "限流算法有哪些？",
                "mode": "text",
                "expectedMinutes": 3,
                "difficulty": 2
            }
        ]
    },
}

def fix_topic_file(filepath):
    """修复单个topic文件"""
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    title = data.get('title', '')
    if title not in TOPIC_CONTENT_MAP:
        print(f"跳过 {filepath}: 未找到 {title} 的专属内容")
        return False
    
    content = TOPIC_CONTENT_MAP[title]
    
    # 修复followUpQuestions
    if 'learningCards' in data:
        for card in data['learningCards']:
            if card.get('type') == 'interviewAnswer' and 'followUpQuestions' in card:
                card['followUpQuestions'] = content['followUpQuestions']
                print(f"  修复 followUpQuestions: {title}")
    
    # 修复recallPrompts
    if 'recallPrompts' in data:
        # 保持ID格式一致
        base_id = data['recallPrompts'][0]['id'].rsplit('.', 1)[0]
        for i, prompt in enumerate(content['recallPrompts']):
            prompt['id'] = f"{base_id}.recall.{i+1}"
        data['recallPrompts'] = content['recallPrompts']
        print(f"  修复 recallPrompts: {title}")
    
    # 修复rubric中的commonMistakes（如果还是模板化内容）
    if 'rubric' in data:
        rubric = data['rubric']
        if 'commonMistakes' in rubric:
            # 检查是否是模板化内容
            template_mistakes = [
                "对Spring生态的理解停留在使用层面，不清楚底层原理",
                "不能说出关键注解的工作机制",
                "不知道如何排查Spring应用的常见问题"
            ]
            if rubric['commonMistakes'] == template_mistakes:
                # 根据标题生成专属的commonMistakes
                if title == "IoC容器":
                    rubric['commonMistakes'] = [
                        "不清楚@Autowired的注入顺序（先类型再名称）",
                        "不了解@Conditional系列注解的作用",
                        "混淆BeanFactory和ApplicationContext的区别"
                    ]
                elif title == "Bean生命周期":
                    rubric['commonMistakes'] = [
                        "不清楚Bean的完整生命周期阶段",
                        "混淆BeanPostProcessor和BeanFactoryPostProcessor",
                        "不了解InitializingBean和@PostConstruct的执行顺序"
                    ]
                elif title == "AOP原理":
                    rubric['commonMistakes'] = [
                        "不清楚JDK动态代理和CGLIB的区别",
                        "不了解AOP失效的场景（自调用、private方法）",
                        "不清楚切面的执行顺序"
                    ]
                elif title == "自动装配原理":
                    rubric['commonMistakes'] = [
                        "不清楚@Conditional系列注解的工作原理",
                        "不了解spring.factories的作用",
                        "混淆@EnableAutoConfiguration和@ComponentScan"
                    ]
                elif title == "SpringBoot启动流程":
                    rubric['commonMistakes'] = [
                        "不清楚refresh()方法的核心步骤",
                        "不了解自动装配的触发时机",
                        "不清楚内嵌Tomcat的启动流程"
                    ]
                else:
                    # 其他主题使用通用但不那么模板化的描述
                    rubric['commonMistakes'] = [
                        f"对{title}的核心概念理解不清晰",
                        f"不能说出{title}的关键实现细节",
                        f"不了解{title}的常见问题和解决方案"
                    ]
                print(f"  修复 commonMistakes: {title}")
    
    # 写回文件
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    return True

def main():
    """主函数"""
    print("开始批量修复Spring模板化内容...")
    
    fixed_count = 0
    for filepath in FILES_TO_FIX:
        print(f"\n处理: {filepath}")
        if fix_topic_file(filepath):
            fixed_count += 1
    
    print(f"\n完成！共修复 {fixed_count} 个文件")

if __name__ == '__main__':
    main()