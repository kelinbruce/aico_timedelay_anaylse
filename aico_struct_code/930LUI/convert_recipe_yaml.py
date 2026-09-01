import argparse
import json


def convert_recipe(yaml_file_path):
    # 读取YAML文件内容
    with open(args.file, 'r', encoding='utf-8') as f:
        recipe_content = f.read()

    # 构建JSON并自动转义
    result = {
        "ownerService": "test",
        "recipeContentList": [{
            "recipeContent": recipe_content,
            "type": "yaml",
            "lang": "zh"
        }]
    }

    # 输出转义后的JSON字符串
    json_string = json.dumps(result, ensure_ascii=False, indent=2)
    return json_string
    
if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument("-f", "--file", help="YAML file path")

    args = parser.parse_args()
    json_string = convert_recipe(args.file)
    print(json_string)