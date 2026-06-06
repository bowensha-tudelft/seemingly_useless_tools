# seemingly_useless_tools

Small utilities that are probably useless until the exact five-minute moment when they are not.

This repository collects a small set of utilities and related files. The detailed descriptions now live in each tool's own folder.

## `gjf_swap.py`

Reorders selected atoms in Gaussian `.gjf` files, prints the molecular formula and atom count, and supports both batch and interactive use.

Detailed docs: [gjf_swap/README.md](gjf_swap/README.md)

## `mol_box.py`

Calculates molecular simulation box quantities such as molecule counts, density, volume, and cubic box length.

Detailed docs: [mol_box/README.md](mol_box/README.md)

## `deepseek-pricing-extension`

A Chrome extension for the DeepSeek Platform Usage page that adds RMB prices to token tooltip values.

Detailed docs: [deepseek-pricing-extension/README.md](deepseek-pricing-extension/README.md)

## `bilibili-tab-sorter`

A Chrome extension for sorting open Bilibili tabs by video duration, with support for sleeping and pinned tabs.

Detailed docs: [bilibili-tab-sorter/README.md](bilibili-tab-sorter/README.md)

## Notes

- Python-based tools use only the Python standard library.
- Browser extensions live in their own folders and can be loaded unpacked from there.
- The list can grow over time.

## License

GPL-3.0. See [LICENSE](LICENSE).