import json
import time
import argparse
import threading
import requests
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from tqdm import tqdm
from transformers import AutoTokenizer
from collections import defaultdict
from req_metadata import ReqMetadata
from benchmark_args import BenchmarkArgs
from datetime import datetime


class ResultWriter:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        # 'a' 模式支持追加，防止程序重启覆盖
        self.file = open(path, 'a', encoding='utf-8')

    def write(self, metadata: ReqMetadata):
        line = metadata.dump_json()
        with self.lock:
            self.file.write(line + '\n')
            self.file.flush() # 确保实时写入磁盘

    def close(self):
        self.file.close()


class BenchmarkFramework:
    def __init__(self, args):
        self.args = args
        self.url = f'http://{args.ip}:{args.port}/v1/chat/completions'
        self.tokenizer = AutoTokenizer.from_pretrained(args.tokenizer_path, trust_remote_code=True)
        self.writer = ResultWriter(args.output_file)

    def single_infer(self, task):
        """路由与组装函数：决定是发单轮还是多轮"""
        category = task.get('category', 'default')
        base_id = task['id']

        if self.args.multi_turn and len(task['turns']) > 1:
            # multi-turn
            accumulated_questions = []
            for turn_idx, current_turn in enumerate(task['turns']):
                accumulated_questions.append(current_turn)
                # 拼接
                question_payload = self.args.turn_separator.join(accumulated_questions)
                
                req_id = f"{base_id}_turn_{turn_idx + 1}"
                
                self._execute_request(req_id, category, question_payload)
        else:
            # single turn
            question_payload = task['turns'][0]
            self._execute_request(base_id, category, question_payload)

    def _execute_request(self, req_id, category, question):
        """原来 single_infer 的后半部分"""
        req_meta = ReqMetadata(spec_step_num=self.args.spec_step_num, req_id=req_id, category=category, concurrency=self.args.concurrency)
        
        messages = []
        if self.args.with_system_prompt:
            messages.append({"role": "system", "content": self.args.system_prompt})
        messages.append({"role": "user", "content": question})
        if self.args.is_magistral:
            js = {
                "model": self.args.model,
                "messages": messages,
                "max_tokens": self.args.max_tokens,
                "temperature": self.args.temperature,
                "top_p": self.args.top_p,
                "stream": True,
            }
        else:
            js = {
                "model": self.args.model,
                "messages": messages,
                "max_tokens": self.args.max_tokens,
                "temperature": self.args.temperature,
                "top_p": self.args.top_p,
                "stream": True,
                "chat_template_kwargs": {
                    "enable_thinking": self.args.enable_thinking
                }
            }

        req_meta.put_req_js(js)

        try:
            start_request_time = time.perf_counter()
            response = requests.post(self.url, json=js, stream=True, timeout=120)
            
            first_token_received = False
            prev_token_time = 0.0
            
            if response.status_code == 200:
                # 使用 iter_content 进行流式读取
                for chunk in response.iter_content(chunk_size=None):
                    if not chunk: continue
                    chunk_str = chunk.decode('utf-8')

                    # 可能在一次 chunk 中包含多行 data:
                    lines = [line for line in chunk_str.split('\n') if line.startswith('data:')]
                    
                    for line in lines:
                        data_payload = line.lstrip('data:').strip()
                        if data_payload == "[DONE]": break
                        
                        try:
                            data_json = json.loads(data_payload)
                            content = data_json['choices'][0]['delta'].get('content', '')
                            if not content: continue
                            
                            cur_time = time.perf_counter()
                            if not first_token_received:
                                 # Prefill Latency (TTFT)
                                latency = cur_time - start_request_time
                                req_meta.put_prefill(content, latency)
                                first_token_received = True
                            else:
                                # Decode Latency (TPOT)
                                latency = cur_time - prev_token_time
                                req_meta.put_new_decode(content, latency)

                            # 更新上一个 token 的到达时间（以当前记录的时间为准）
                            # 这里虽然可能在非常极端的情况下，前面这部分执行的时间会影响到统计结果（比一次decode时间还慢）；
                            # 但绝大多数情况下都不至于，因此这里可以认为时间是准确的。
                            prev_token_time = cur_time
                        except:
                            continue
                
                self.writer.write(req_meta)
            else:
                print(f"\n[Error] {req_id} returned status {response.status_code}")
        except Exception as e:
            print(f"\n[Exception] {req_id} failed: {e}")

    def post_sort_results(self):
        """对最终生成的 jsonl 按 category 排序"""
        print(f"Sorting results by Category...")
        results = []
        header = None
        with open(self.args.output_file, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    raw_data = json.loads(line)
                    if header is None and raw_data.get("__type__", "") == "meta":
                        header = raw_data
                        continue
                    results.append(raw_data)
        
        results.sort(key=lambda x: x.get('category', ''))
        
        if header is not None:
            results.insert(0, header)
        with open(self.args.output_file, 'w', encoding='utf-8') as f:
            for item in results:
                f.write(json.dumps(item, ensure_ascii=False) + '\n')

    def run(self, dataset_path):
        tasks = []
        with open(dataset_path, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    tasks.append(json.loads(line))
        
        print(f"Total tasks: {len(tasks)}. Concurrency: {self.args.concurrency}")

        if os.path.getsize(self.writer.path) == 0:
            header = {
                "__type__": "meta",
                "__payload__" : {
                    "url": f"{self.args.ip}:{self.args.port}",
                    "dataset": self.args.dataset,
                    "model": self.args.model,
                    "tokenizer": self.args.tokenizer_path,
                    "concurrency": self.args.concurrency,
                    "spec_step_num": self.args.spec_step_num,
                    "max_tokens": self.args.max_tokens,
                    "temperature": self.args.temperature,
                    "top_p": self.args.top_p,
                    "with_system_prompt": self.args.with_system_prompt,
                    "system_prompt": self.args.system_prompt,
                    "message": self.args.message
                }
            }
            self.writer.file.write(json.dumps(header, ensure_ascii=False) + '\n')
        
        # 使用 ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=self.args.concurrency) as executor:
            # 1. 立即提交所有任务到线程池队列中
            # 线程池内部会自动维护：只要有空闲线程，就从队列里取下一个任务执行
            futures = [executor.submit(self.single_infer, task) for task in tasks]
            
            # 2. 使用 as_completed 监听任务完成情况
            # 只要任何一个任务完成，它就会立即 yield，从而触发 tqdm 更新
            for _ in tqdm(as_completed(futures), total=len(tasks), desc="Benchmarking"):
                pass
        
        self.writer.close()
        self.post_sort_results()


class MetricsAnalyzer:
    def __init__(self, result_file, tokenizer_path):
        self.result_file = result_file
        self.tokenizer = AutoTokenizer.from_pretrained(tokenizer_path, trust_remote_code=True)

    def analyze(self):
        results = []
        header = None
        with open(self.result_file, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    raw_data = json.loads(line)
                    if header is None and raw_data.get("__type__", "") == "meta":
                        header = raw_data
                        continue
                    results.append(ReqMetadata.from_dict(raw_data))

        if not results:
            print("No data to analyze.")
            return

        cat_map = defaultdict(list)
        for r in results:
            cat_map[r.category].append(r)
        cat_map['[OVERALL]'] = results

        print(f"\n{'Category':<15} | {'TTFT(ms)':<10} | {'TPOT(ms)':<10} | {'SpecAcc(%)':<10} | {'AvgSpecLen':<10} | {'AvgDecodeLen':<10} | {'AvgPer-posAcc':<20}")
        print("-" * 75)

        total_ttft = 0.0
        total_tpot = 0.0
        concurrency = 0
        total_decode_num = 0
        if header:
            concurrency = header['__payload__']['concurrency']
        else:
            concurrency = cat_map['[OVERALL]'][0].concurrency
        for cat, items in cat_map.items():
            valid_ttfts = [i.prefill_latency * 1000 for i in items if i.prefill_latency > 0]
            
            cat_spec_lens = []
            cat_pos_accs = []
            cat_total_decode_num = 0
            cat_decode_latency = 0.0

            for i in items:
                assert i.concurrency == concurrency, "Different concurrency detected, maybe using a mixed result file."
                # 计算该请求的 TPOT
                token_nums = i.get_decode_token_num_list(self.tokenizer)
                token_number_sum = sum(token_nums)
                cat_total_decode_num += token_number_sum
                if token_nums and token_number_sum > 0:
                    cat_decode_latency += sum(i.decode_raw_latency) * 1000
                
                # 投机统计
                if i.spec_step_num > 0 and token_nums:
                    avg_spec_len = token_number_sum / len(token_nums)
                    cat_spec_lens.append(avg_spec_len)
                    
                    pos_acc = i.get_acc_per_position(self.tokenizer)
                    if pos_acc: cat_pos_accs.append(pos_acc)

            avg_ttft = sum(valid_ttfts)/len(valid_ttfts) if valid_ttfts else 0
            avg_tpot = cat_decode_latency/cat_total_decode_num if cat_total_decode_num!=0 else 0
            avg_spec_len = sum(cat_spec_lens)/len(cat_spec_lens) if cat_spec_lens else 0
            
            pos_means = []
            self.overall_pos_accs = []
            # 计算位置平均接受率
            mean_acc = 0.0
            if cat_pos_accs:
                num_pos = len(cat_pos_accs[0])
                pos_means = [sum(pa[p] for pa in cat_pos_accs)/len(cat_pos_accs) for p in range(num_pos)]
                mean_acc = (sum(pos_means) / num_pos) * 100
            # 如果是 OVERALL 还可以打印具体位置的
            if cat == '[OVERALL]':
                total_ttft = sum(valid_ttfts)
                total_tpot = sum([sum(i.decode_raw_latency) for i in items]) * 1000
                total_decode_num = cat_total_decode_num
                self.overall_pos_accs = pos_means

            print(f"{cat:<15} | {avg_ttft:<10.2f} | {avg_tpot:<10.2f} | {mean_acc:<10.1f} | {avg_spec_len:<10.2f} | {cat_total_decode_num/len(valid_ttfts):<10.1f} | {[f'{x*100:.1f}%' for x in pos_means]}")

        print(f"\nOverall Per-position Acceptance Rate: {[f'{x*100:.1f}%' for x in self.overall_pos_accs]}")


        print(f"Total Prefill Time({concurrency} batch avg): {total_ttft / concurrency:.3f}ms")
        print(f"Total Decode Time({concurrency} batch avg): {total_tpot / concurrency:.3f}ms, Total Decode Token Number: {total_decode_num}, TPOT Total Avg: {total_tpot / total_decode_num:.3f}ms")
        print(f"Total E2E time({concurrency} batch avg): {(total_tpot + total_ttft) / concurrency:.3f}ms")
        if header:
            print(f"[Benchmark metadata]")
            for key, value in header['__payload__'].items():
                print(f"{key}: {value}")


if __name__ == '__main__':
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    parser = argparse.ArgumentParser()

    BenchmarkArgs.add_args(parser)
    
    args = parser.parse_args()

    base, ext = os.path.splitext(args.output_file)

    args.output_file = f"{base}_{timestamp}{ext}"

    if not args.analyze_only:
        if(args.with_system_prompt and args.system_prompt == ''):
            print("\033[31m[WARNING]\033[0m You enabled 'with_system_prompt' but used an empty system_prompt, please make sure you passed the correct argument '--system_prompt'")
        framework = BenchmarkFramework(args)
        framework.run(args.dataset)

    analyzer = MetricsAnalyzer(args.output_file, args.tokenizer_path)
    analyzer.analyze()

    print()