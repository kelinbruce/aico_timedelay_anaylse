import json

from transformers import AutoTokenizer
from functools import lru_cache


class ReqMetadata:
    def __init__(self, spec_step_num=0, req_id='', category='', concurrency=0) -> None:
        self.req_js = {}
        self.req_id = req_id
        self.category = category
        self.prefill_latency = 0.0
        self.prefill_token = ''
        self.spec_step_num = spec_step_num
        self.concurrency = concurrency
        self.decode_raw_texts = []
        self.decode_raw_latency = []


    def check_validation(self) -> None:
        assert len(self.decode_raw_texts) == len(self.decode_raw_latency)


    def put_req_js(self, js: "dict") -> None:
        self.req_js = js


    def put_prefill(self, token: "str", latency: "float") -> None:
        self.prefill_token = token
        self.prefill_latency = latency


    def put_new_decode(self, texts: "str", latency: "float") -> None:
        """
        For every new decode response, we store the raw decode text and the latency.
        """
        self.decode_raw_texts.append(texts)
        self.decode_raw_latency.append(latency)


    @lru_cache
    def get_decode_token_num_list(self, tokenizer: AutoTokenizer) -> "list[int]":
        if self.spec_step_num == 0:
            return [1 for _ in range(len(self.decode_raw_texts))]
        ret = []
        for text in self.decode_raw_texts:
            length = len(tokenizer.encode(text, add_special_tokens=False))
            if (length <= 0):
                continue
            ret.append(length)
        return ret


    def get_avg_decode_latency(self, tokenizer: AutoTokenizer) -> float:
        decode_token_num = self.get_decode_token_num_list(tokenizer)
        assert decode_token_num
        # 这里不用join直接拼接是为了防止下一个token与上一个token在词表中会变成另一个token的情况，但尽管如此应该还是有特别情况
        return sum(self.decode_raw_latency) / sum(decode_token_num)


    def get_prefill_latency(self) -> float:
        return self.prefill_latency


    def get_avg_spec_length(self, tokenizer: AutoTokenizer) -> float:
        decode_token_num = self.get_decode_token_num_list(tokenizer)
        return sum(decode_token_num) / len(decode_token_num)


    def get_acc_per_position(self, tokenizer: AutoTokenizer) -> "tuple[float]":
        if self.spec_step_num == 0:
            return ()

        accepted_tokens_per_position = [0 for _ in range(self.spec_step_num)]
        rounds = 0
        for text in self.decode_raw_texts:
            decode_output_length: int
            if self.spec_step_num == 0:
                decode_output_length = 1
            else:
                decode_output = tokenizer.encode(text, add_special_tokens=False)
                decode_output_length = len(decode_output)

            if decode_output_length <= 0:
                continue
            spec_output_length = decode_output_length - 1 # We only consider the speculative decoding accepted tokens.
            for i in range(spec_output_length):
                if i >= self.spec_step_num: break
                accepted_tokens_per_position[i] += 1
            rounds += 1

        for i in range(self.spec_step_num):
            accepted_tokens_per_position[i] /= rounds

        return tuple(accepted_tokens_per_position)


    def dump(self, file_path: str = None) -> str:
        """
        将对象序列化为 JSON 字符串。
        如果提供了 file_path，则写入文件。
        """
        # 使用 __dict__ 拷贝属性，lru_cache 装饰的方法不会被包含在内
        data = self.__dict__.copy()
        json_str = json.dumps(data, ensure_ascii=False, indent=4)
        
        if file_path:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(json_str)
        return json_str


    def dump_json(self) -> str:
        return json.dumps(self.__dict__, ensure_ascii=False)


    @classmethod
    def from_file(cls, path: str) -> "ReqMetadata":
        """
        从 JSON 文件中读取并还原 ReqMetadata 对象。
        """
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # 创建实例
        instance = cls(
            spec_step_num=data.get('spec_step_num', 0),
            req_id=data.get('req_id', ''),
            category=data.get('category', ''),
            concurrency=data.get('concurrency', 0)
        )
        # 还原属性
        instance.req_js = data.get('req_js', {})
        instance.prefill_latency = data.get('prefill_latency', 0.0)
        instance.prefill_token = data.get('prefill_token', '')
        instance.decode_raw_texts = data.get('decode_raw_texts', [])
        instance.decode_raw_latency = data.get('decode_raw_latency', [])

        return instance


    @classmethod
    def from_json_str(cls, json_str: str) -> "ReqMetadata":
        """
        从 JSON 字符串中还原对象。
        """
        data = json.loads(json_str)
        return ReqMetadata.from_dict(data)


    @classmethod
    def from_dict(cls, json_dict: dict) -> "ReqMetadata":
        """
        从 JSON 字符串中还原对象。
        """
        data = json_dict
        instance = cls(
            spec_step_num=data.get('spec_step_num', 0),
            req_id=data.get('req_id', ''),
            category=data.get('category', ''),
            concurrency=data.get('concurrency', 0)
        )
        for key, value in data.items():
            setattr(instance, key, value)
        return instance