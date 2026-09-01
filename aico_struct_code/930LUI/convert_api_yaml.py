import argparse
import json
import yaml


def convert_api_yaml_to_batch_format(api_yaml_path):
    """
    读取API YAML文件，提取x-owner-id，转换为批量导入格式
    
    Args:
        api_yaml_path: API YAML文件路径
        output_path: 输出JSON文件路径（可选）
    
    Returns:
        list: 包含转换后数据的列表
    """
    
    # 读取API YAML内容
    with open(api_yaml_path, 'r', encoding='utf-8') as f:
        api_content = f.read()
    
    # 解析YAML获取owner_id
    api_config = yaml.safe_load(api_content)
    
    # 从info.x-owner-id提取owner_id
    owner_id = api_config.get('info', {}).get('x-owner-id', 'test')
    
    # 构建目标格式
    result = [{
        "ownerId": owner_id,
        "action": "ADD",
        "yamlContent": api_content
    }]
    
    return result

# 使用示例
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("-f", "--file", help="YAML file path")
    args = parser.parse_args()

    result = convert_api_yaml_to_batch_format(
        api_yaml_path=args.file,
    )
    
    # 打印结果
    print(json.dumps(result, ensure_ascii=False, indent=2))