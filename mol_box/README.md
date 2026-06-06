# mol_box

分子模拟盒子的小工具：根据分子数、密度、体积或比例，计算体积、密度和立方盒边长。

## 文件

- `mol_box.py` — 主程序

## 支持的情况

1. 已知分子数和密度，计算体积与立方盒边长。
2. 已知分子数和体积，计算密度与立方盒边长。
3. 已知分子比例、密度和体积，计算分子数。

## 单位

| 量 | 单位 |
| --- | --- |
| 密度 | `g/cm^3` |
| 体积 | `nm^3`，同时也输出为 `A^3` |
| 立方盒边长 | `nm`，同时也输出为 `A` |

这里 `A` 表示 angstrom。

## 输入格式

### 固定分子数

```bash
-species "H2O:10,NH3:5"
```

### 分子比例

```bash
-species "H2O:NH3:HF=3:2:1"
```

单分子比例也支持：

```bash
-species "H2O=1"
```

## 示例

```bash
python mol_box.py -species "H2O:10,NH3:5" -density 1.0
```

```bash
python mol_box.py -species "H2O:10,NH3:5" -volume 10
```

```bash
python mol_box.py -species "H2O:NH3:HF=3:2:1" -density 1.0 -volume 10
```

## 备注

- 固定分子数模式下，提供 `-density` 或 `-volume` 其一即可。
- 比例模式下，需要同时提供 `-density` 和 `-volume`。
- 使用内置原子质量和阿伏伽德罗常数。