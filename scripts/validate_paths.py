#!/usr/bin/env python3
"""
验证并修复 domains/*.json 中的 topics 路径格式。

用法:
  python3 scripts/validate_paths.py          # 只检查，不修改
  python3 scripts/validate_paths.py --fix    # 自动修复

规则:
  topics 数组中的每个元素必须是字符串，格式为 topics/{domain}/{filename}.json
  如果发现 ID 格式或 dict 对象，--fix 模式会自动从文件系统重建路径。
"""
import json
import os
import sys
import glob

CONTENT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def read_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def write_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')

def validate_domain(domain_id, fix=False):
    """验证单个领域的 topics 路径格式"""
    domain_path = os.path.join(CONTENT_ROOT, f"domains/{domain_id}.json")
    if not os.path.exists(domain_path):
        return [f"❌ 领域文件不存在: {domain_path}"]
    
    domain = read_json(domain_path)
    issues = []
    needs_fix = False
    
    for cat in domain.get("categories", []):
        cat_id = cat.get("id", "?")
        topics = cat.get("topics", [])
        
        for i, t in enumerate(topics):
            if isinstance(t, dict):
                issues.append(f"  ❌ {cat_id}[{i}]: dict对象 (应为文件路径)")
                needs_fix = True
            elif isinstance(t, str):
                if not t.startswith("topics/"):
                    issues.append(f"  ❌ {cat_id}[{i}]: 缺少topics/前缀: {t}")
                    needs_fix = True
                elif not t.endswith(".json"):
                    issues.append(f"  ❌ {cat_id}[{i}]: 不是.json文件: {t}")
                    needs_fix = True
                elif not os.path.exists(os.path.join(CONTENT_ROOT, t)):
                    issues.append(f"  ⚠️ {cat_id}[{i}]: 文件不存在: {t}")
            else:
                issues.append(f"  ❌ {cat_id}[{i}]: 未知类型 {type(t)}")
                needs_fix = True
    
    if needs_fix and fix:
        # 从文件系统重建 topics 路径
        topics_dir = os.path.join(CONTENT_ROOT, f"topics/{domain_id}")
        if not os.path.isdir(topics_dir):
            issues.append(f"  ❌ 目录不存在: topics/{domain_id}/")
            return issues
        
        # 读取所有文件，按 category 分组
        files_by_cat = {}
        for fpath in sorted(glob.glob(f"{topics_dir}/*.json")):
            try:
                with open(fpath) as f:
                    tp = json.load(f)
                cat = tp.get("category", "")
                fname = os.path.basename(fpath)
                rel_path = f"topics/{domain_id}/{fname}"
                files_by_cat.setdefault(cat, []).append((rel_path, tp.get("order", 999)))
            except json.JSONDecodeError:
                issues.append(f"  ⚠️ JSON解析失败: {os.path.basename(fpath)}")
        
        # 重建 topics 数组
        for cat in domain.get("categories", []):
            cat_id = cat.get("id", "")
            if cat_id in files_by_cat:
                sorted_files = sorted(files_by_cat[cat_id], key=lambda x: x[1])
                cat["topics"] = [f[0] for f in sorted_files]
            else:
                cat["topics"] = []
        
        write_json(domain_path, domain)
        issues.append(f"  ✅ 已修复 {domain_id}.json")
        
        # 更新 manifest
        manifest_path = os.path.join(CONTENT_ROOT, "manifest.json")
        if os.path.exists(manifest_path):
            manifest = read_json(manifest_path)
            for entry in manifest.get("domains", []):
                if entry["id"] == domain_id:
                    entry["topicCount"] = sum(len(c.get("topics", [])) for c in domain.get("categories", []))
            write_json(manifest_path, manifest)
            issues.append(f"  ✅ 已更新 manifest.json")
    
    return issues

def main():
    fix_mode = "--fix" in sys.argv
    
    manifest_path = os.path.join(CONTENT_ROOT, "manifest.json")
    manifest = read_json(manifest_path)
    
    total_issues = 0
    for entry in manifest.get("domains", []):
        domain_id = entry["id"]
        issues = validate_domain(domain_id, fix=fix_mode)
        
        if issues:
            print(f"\n{'📁'} {domain_id}:")
            for issue in issues:
                print(f"  {issue}")
            total_issues += len([i for i in issues if "❌" in i or "⚠️" in i])
        else:
            print(f"✅ {domain_id}: 路径格式正确")
    
    if total_issues == 0:
        print(f"\n✅ 所有领域的 topics 路径格式正确")
    else:
        mode = "修复" if fix_mode else "检查"
        print(f"\n{'🔧' if fix_mode else '⚠️'} {mode}完成，共发现 {total_issues} 个问题")
        if not fix_mode:
            print("  运行 python3 scripts/validate_paths.py --fix 自动修复")

if __name__ == "__main__":
    main()
