# gjf_swap

Gaussian `.gjf` files 的小工具：读取坐标区、打印分子式和原子数，并把选中的原子移到坐标列表顶部或底部。

## 文件

- `gjf_swap.py` — 主程序

## 用法

```bash
python gjf_swap.py -f input.gjf -atoms "1,3-5" -t
```

或：

```bash
python gjf_swap.py -f input.gjf -o output.gjf -atoms "1,3-5" -b -v
```

如果不带参数运行，会进入交互模式。

## 参数

| 参数 | 说明 |
| --- | --- |
| `-f FILE` | 输入 `.gjf` 文件 |
| `-o FILE` | 输出 `.gjf` 文件，默认覆盖输入文件 |
| `-atoms SPEC` | 选择要移动的原子，例如 `"1,3-5,7"` |
| `-t` | 把选中的原子移到顶部 |
| `-b` | 把选中的原子移到底部 |
| `-v` | 输出更详细的信息 |
| `-h`, `--help` | 显示帮助信息 |

## 备注

- 原子编号从 1 开始。
- 选择支持逗号和范围。
- 分子式按 C、H、其他元素字母序的简单顺序输出。